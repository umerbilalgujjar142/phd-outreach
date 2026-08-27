import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { ScrapedJob } from './discovery/job-discovery.types';
import { SeenJob } from './discovery/seen-job.model';
import { JobMatchResult } from './matching/job-matching.service';
import { JobApplication } from './job-application.model';
import { JobApplied } from './job-applied.model';
import { JobListing } from './job-listing.model';
import {
  JobApplicationStatus,
  JobListingStatus,
  RoleType,
} from './job-status.enum';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  /** Minimum heuristic fit for a matched job to become a real lead. */
  private readonly fitThreshold: number;

  constructor(
    @InjectModel(JobListing) private readonly listings: typeof JobListing,
    @InjectModel(JobApplication) private readonly applications: typeof JobApplication,
    @InjectModel(JobApplied) private readonly applied: typeof JobApplied,
    @InjectModel(SeenJob) private readonly seen: typeof SeenJob,
    private readonly config: ConfigService,
  ) {
    this.fitThreshold = Number(this.config.get('JOB_FIT_THRESHOLD') ?? 55);
  }

  // ---- listings --------------------------------------------------------

  /**
   * Create or update a listing (dedup identity = url). A qualifying job at/above
   * the fit threshold lands as MATCHED; qualifying-but-weak or non-qualifying as
   * REJECTED. Never downgrades a listing that a human already advanced
   * (READY/APPLIED) or parked (SKIPPED).
   */
  async upsertListing(
    job: ScrapedJob,
    match: JobMatchResult,
  ): Promise<{ created: boolean; status: JobListingStatus }> {
    const status =
      match.qualifies && match.fitScore >= this.fitThreshold
        ? JobListingStatus.MATCHED
        : JobListingStatus.REJECTED;

    const fields = {
      source: job.source,
      sourceId: job.sourceId,
      url: job.url,
      title: job.title,
      company: job.company,
      location: job.location ?? null,
      country: job.country ?? null,
      remote: job.remote,
      description: job.description,
      salary: job.salary ?? null,
      applyUrl: job.applyUrl ?? null,
      tags: job.tags ?? [],
      roleType: match.roleType,
      matchedSkills: match.matchedSkills,
      fitScore: match.fitScore,
      needsSponsorship: match.needsSponsorship,
      sponsorshipOffered: job.sponsorshipOffered ?? null,
      postedAt: job.postedAt ?? null,
      reason: match.reason,
    };

    const existing = await this.listings.findOne({ where: { url: job.url } });
    if (existing) {
      const advanced = [
        JobListingStatus.READY,
        JobListingStatus.APPLIED,
        JobListingStatus.SKIPPED,
      ].includes(existing.status);
      await existing.update(advanced ? fields : { ...fields, status });
      return { created: false, status: existing.status };
    }

    await this.listings.create({ ...fields, status } as any);
    return { created: true, status };
  }

  findAll(filter?: {
    status?: JobListingStatus;
    roleType?: RoleType;
    /** Only jobs posted within this many days (falls back to dateDiscovered). */
    withinDays?: number;
  }): Promise<JobListing[]> {
    const where: Record<string, unknown> = {};
    if (filter?.status) where.status = filter.status;
    if (filter?.roleType) where.roleType = filter.roleType;
    if (filter?.withinDays && filter.withinDays > 0) {
      const cutoff = new Date(Date.now() - filter.withinDays * 24 * 60 * 60 * 1000);
      // Posted within the window, OR (unknown posted date) discovered within it.
      (where as any)[Op.or] = [
        { postedAt: { [Op.gte]: cutoff } },
        { postedAt: { [Op.is]: null }, dateDiscovered: { [Op.gte]: cutoff } },
      ];
    }
    return this.listings.findAll({ where, order: [['fitScore', 'DESC']] });
  }

  /** Max posting age (days) allowed at discovery — older jobs are dropped. */
  get maxAgeDays(): number {
    return Number(this.config.get('JOB_MAX_AGE_DAYS') ?? 15);
  }

  async findOne(id: string): Promise<JobListing> {
    const row = await this.listings.findByPk(id);
    if (!row) throw new NotFoundException(`Job listing ${id} not found`);
    return row;
  }

  /** Matched leads that still need documents prepared — best fit first. */
  findMatchedNeedingDocs(limit = 20): Promise<JobListing[]> {
    return this.listings.findAll({
      where: { status: JobListingStatus.MATCHED, fitScore: { [Op.gte]: this.fitThreshold } },
      order: [['fitScore', 'DESC']],
      limit,
    });
  }

  /** Leads whose documents are ready → queued for assisted apply, best first. */
  findReadyToApply(limit = 20): Promise<JobListing[]> {
    return this.listings.findAll({
      where: { status: JobListingStatus.READY },
      order: [['fitScore', 'DESC']],
      limit,
    });
  }

  /**
   * Re-apply a fresh match result to an existing listing (used when the matching
   * rules change). Never touches listings a human already advanced/parked
   * (ready/applied/skipped). Returns the resulting status.
   */
  async rematch(listing: JobListing, match: JobMatchResult): Promise<JobListingStatus> {
    if (
      [JobListingStatus.READY, JobListingStatus.APPLIED, JobListingStatus.SKIPPED].includes(
        listing.status,
      )
    ) {
      return listing.status;
    }
    const status =
      match.qualifies && match.fitScore >= this.fitThreshold
        ? JobListingStatus.MATCHED
        : JobListingStatus.REJECTED;
    await listing.update({
      roleType: match.roleType,
      matchedSkills: match.matchedSkills,
      fitScore: match.fitScore,
      needsSponsorship: match.needsSponsorship,
      reason: match.reason,
      status,
    } as never);
    return status;
  }

  async setStatus(
    id: string,
    status: JobListingStatus,
    reason?: string,
  ): Promise<JobListing> {
    const row = await this.findOne(id);
    await row.update((reason ? { status, reason } : { status }) as never);
    return row;
  }

  // ---- applications ----------------------------------------------------

  /**
   * Create an application row. Automatically snapshots the linked listing's
   * title/company/country/portal/url onto the row so `job_applications` is a
   * complete, self-contained tracker (no join needed to read what you applied
   * to). Explicit values in `data` win over the snapshot.
   */
  async createApplication(data: Partial<JobApplication>): Promise<JobApplication> {
    const snapshot: Partial<JobApplication> = {};
    if (data.jobListingId) {
      const l = await this.listings.findByPk(data.jobListingId);
      if (l) {
        Object.assign(snapshot, {
          jobTitle: l.title,
          company: l.company,
          country: l.country,
          location: l.location,
          remote: l.remote,
          portal: l.source,
          jobUrl: l.url,
          roleType: l.roleType,
        });
      }
    }
    return this.applications.create({ ...snapshot, ...data } as any);
  }

  async updateApplication(id: string, patch: Partial<JobApplication>): Promise<JobApplication> {
    const row = await this.applications.findByPk(id);
    if (!row) throw new NotFoundException(`Job application ${id} not found`);
    await row.update(patch as never);
    return row;
  }

  findApplicationForListing(jobListingId: string): Promise<JobApplication | null> {
    return this.applications.findOne({
      where: { jobListingId },
      order: [['createdAt', 'DESC']],
    });
  }

  // ---- tracker (application history & rollups) -------------------------

  /**
   * Flat application tracker — every application with its snapshot fields,
   * newest first. Optionally filter by status / country / portal. This is the
   * "one table with everything" view for tracking what was applied to.
   */
  trackerRows(filter?: {
    status?: JobApplicationStatus;
    country?: string;
    portal?: string;
  }): Promise<JobApplication[]> {
    const where: Record<string, unknown> = {};
    if (filter?.status) where.status = filter.status;
    if (filter?.country) where.country = filter.country;
    if (filter?.portal) where.portal = filter.portal;
    return this.applications.findAll({ where, order: [['createdAt', 'DESC']] });
  }

  /** Rollup counts so you can see totals by status / country / portal / role. */
  async trackerSummary(): Promise<{
    total: number;
    submitted: number;
    byStatus: Record<string, number>;
    byCountry: Record<string, number>;
    byPortal: Record<string, number>;
    byRole: Record<string, number>;
  }> {
    const rows = await this.applications.findAll({
      attributes: ['status', 'country', 'portal', 'roleType'],
      raw: true,
    });
    const tally = (key: keyof (typeof rows)[number]) => {
      const out: Record<string, number> = {};
      for (const r of rows) {
        const k = ((r as any)[key] ?? 'unknown') as string;
        out[k] = (out[k] ?? 0) + 1;
      }
      return out;
    };
    const byStatus = tally('status');
    return {
      total: rows.length,
      submitted: byStatus[JobApplicationStatus.SUBMITTED] ?? 0,
      byStatus,
      byCountry: tally('country'),
      byPortal: tally('portal'),
      byRole: tally('roleType'),
    };
  }

  // ---- applied log (clean "what I actually applied to" table) ----------

  /**
   * Append a row to `job_applied` the moment a submit is confirmed. Snapshots
   * the listing so the log is self-contained (position / company / country /
   * portal / url — no join needed). Idempotent per listing: a re-submit updates
   * the existing row instead of duplicating, keeping the daily/country counts
   * honest.
   */
  async recordApplied(data: {
    jobListingId: string;
    applicationId?: string;
    cvPath?: string;
    screenshotPath?: string;
  }): Promise<JobApplied> {
    const listing = await this.listings.findByPk(data.jobListingId);
    const app = data.applicationId
      ? await this.applications.findByPk(data.applicationId)
      : null;
    const row = {
      jobListingId: data.jobListingId,
      applicationId: data.applicationId ?? null,
      position: listing?.title ?? app?.jobTitle ?? 'unknown',
      company: listing?.company ?? app?.company ?? null,
      country: listing?.country ?? app?.country ?? null,
      location: listing?.location ?? app?.location ?? null,
      remote: listing?.remote ?? app?.remote ?? null,
      portal: listing?.source ?? app?.portal ?? null,
      jobUrl: listing?.url ?? app?.jobUrl ?? null,
      roleType: listing?.roleType ?? app?.roleType ?? RoleType.OTHER,
      cvVariant: app?.cvVariant ?? null,
      cvPath: data.cvPath ?? app?.cvPath ?? null,
      screenshotPath: data.screenshotPath ?? null,
      appliedAt: new Date(),
    };
    const existing = await this.applied.findOne({
      where: { jobListingId: data.jobListingId },
    });
    if (existing) {
      await existing.update(row as never);
      return existing;
    }
    return this.applied.create(row as any);
  }

  /** The clean applied log, newest first. Optional country / portal filter. */
  appliedLog(filter?: { country?: string; portal?: string }): Promise<JobApplied[]> {
    const where: Record<string, unknown> = {};
    if (filter?.country) where.country = filter.country;
    if (filter?.portal) where.portal = filter.portal;
    return this.applied.findAll({ where, order: [['appliedAt', 'DESC']] });
  }

  /** Everything applied to since local midnight today, newest first. */
  appliedToday(): Promise<JobApplied[]> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return this.applied.findAll({
      where: { appliedAt: { [Op.gte]: start } },
      order: [['appliedAt', 'DESC']],
    });
  }

  /** How many applied-to jobs, total and today, with by-country/portal/role counts. */
  async appliedSummary(): Promise<{
    total: number;
    today: number;
    byCountry: Record<string, number>;
    byPortal: Record<string, number>;
    byRole: Record<string, number>;
  }> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [rows, today] = await Promise.all([
      this.applied.findAll({ attributes: ['country', 'portal', 'roleType'], raw: true }),
      this.applied.count({ where: { appliedAt: { [Op.gte]: start } } }),
    ]);
    const tally = (key: keyof (typeof rows)[number]) => {
      const out: Record<string, number> = {};
      for (const r of rows) {
        const k = ((r as any)[key] ?? 'unknown') as string;
        out[k] = (out[k] ?? 0) + 1;
      }
      return out;
    };
    return {
      total: rows.length,
      today,
      byCountry: tally('country'),
      byPortal: tally('portal'),
      byRole: tally('roleType'),
    };
  }

  // ---- stats -----------------------------------------------------------

  async stats(): Promise<Record<string, number>> {
    const rows = (await this.listings.findAll({
      attributes: ['status', [this.listings.sequelize!.fn('COUNT', '*'), 'n']],
      group: ['status'],
      raw: true,
    })) as unknown as { status: string; n: string }[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = Number(r.n);
    return out;
  }

  countSubmittedToday(): Promise<number> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return this.applications.count({
      where: { status: JobApplicationStatus.SUBMITTED, submittedAt: { [Op.gte]: start } },
    });
  }

  // ---- seen-jobs (dedup) ----------------------------------------------

  async getSeenUrls(source: string): Promise<Set<string>> {
    const rows = await this.seen.findAll({ where: { source }, attributes: ['url'] });
    return new Set(rows.map((r) => r.url));
  }

  async markSeen(url: string, source: string, matched: boolean): Promise<void> {
    if (!url) return;
    try {
      await this.seen.upsert({ url, source, matched } as any);
    } catch {
      /* a duplicate race is harmless */
    }
  }

  async pruneOldSeenJobs(days = 60): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.seen.destroy({ where: { createdAt: { [Op.lt]: cutoff } } });
  }
}
