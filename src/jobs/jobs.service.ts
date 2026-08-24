import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { ScrapedJob } from './discovery/job-discovery.types';
import { SeenJob } from './discovery/seen-job.model';
import { JobMatchResult } from './matching/job-matching.service';
import { JobApplication } from './job-application.model';
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

  async setStatus(id: string, status: JobListingStatus): Promise<JobListing> {
    const row = await this.findOne(id);
    await row.update({ status } as never);
    return row;
  }

  // ---- applications ----------------------------------------------------

  createApplication(data: Partial<JobApplication>): Promise<JobApplication> {
    return this.applications.create(data as any);
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
