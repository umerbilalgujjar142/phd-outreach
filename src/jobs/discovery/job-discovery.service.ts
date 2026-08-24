import { Injectable, Logger } from '@nestjs/common';
import { JobMatchingService } from '../matching/job-matching.service';
import { JobsService } from '../jobs.service';
import { ArbeitnowScraper } from './arbeitnow.scraper';
import { BaytScraper } from './bayt.scraper';
import { IndeedScraper } from './indeed.scraper';
import { IrishJobsScraper } from './irishjobs.scraper';
import { JobSource, JOB_QUERIES } from './job-source.interface';
import { JobDiscoveryRunResult, ScrapedJob } from './job-discovery.types';
import { NaukriGulfScraper } from './naukrigulf.scraper';
import { RemoteOkScraper } from './remoteok.scraper';

/**
 * Runs every registered job source, matches each posting against Umer's profile,
 * and upserts the results. Mirrors DiscoveryService on the professor side.
 */
@Injectable()
export class JobDiscoveryService {
  private readonly logger = new Logger(JobDiscoveryService.name);
  private readonly sources: JobSource[];

  constructor(
    private readonly remoteok: RemoteOkScraper,
    private readonly arbeitnow: ArbeitnowScraper,
    private readonly naukrigulf: NaukriGulfScraper,
    private readonly bayt: BaytScraper,
    private readonly irishjobs: IrishJobsScraper,
    private readonly indeed: IndeedScraper,
    private readonly matching: JobMatchingService,
    private readonly jobs: JobsService,
  ) {
    // API-based sources first (reliable), HTML/Playwright ones after (best-effort).
    // Indeed is intentionally excluded: it is Cloudflare bot-walled (returns a
    // "Just a moment…" challenge), so it yields nothing and only slows the sweep.
    // The scraper is kept in the codebase but not run.
    void this.indeed;
    this.sources = [this.remoteok, this.arbeitnow, this.naukrigulf, this.bayt, this.irishjobs];
  }

  async runDiscovery(): Promise<JobDiscoveryRunResult[]> {
    await this.jobs.pruneOldSeenJobs();
    const results: JobDiscoveryRunResult[] = [];
    for (const source of this.sources) {
      results.push(await this.runSource(source));
    }
    return results;
  }

  /** Re-run the matcher over ALL stored listings (after matching-rule changes). */
  async rematchAll(): Promise<{ total: number; matched: number; rejected: number }> {
    const all = await this.jobs.findAll();
    let matched = 0;
    let rejected = 0;
    for (const l of all) {
      const m = this.matching.match({
        source: l.source,
        sourceId: l.sourceId,
        url: l.url,
        title: l.title,
        company: l.company,
        location: l.location,
        country: l.country,
        remote: l.remote,
        description: l.description || '',
        salary: l.salary,
        applyUrl: l.applyUrl,
        tags: l.tags || [],
      });
      const status = await this.jobs.rematch(l, m);
      if (status === 'matched') matched++;
      else if (status === 'rejected') rejected++;
    }
    this.logger.log(`Rematch: ${all.length} listings → ${matched} matched, ${rejected} rejected`);
    return { total: all.length, matched, rejected };
  }

  private async runSource(source: JobSource): Promise<JobDiscoveryRunResult> {
    const result: JobDiscoveryRunResult = {
      source: source.name,
      scanned: 0,
      matched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
    };

    const knownUrls = await this.jobs.getSeenUrls(source.name);
    let jobs: ScrapedJob[];
    try {
      jobs = await source.scrape({ queries: JOB_QUERIES, knownUrls, delayMs: 2000, maxPerQuery: 15 });
    } catch (err) {
      result.errors++;
      this.logger.error(`${source.name} scrape failed: ${(err as Error).message}`);
      return result;
    }
    result.scanned = jobs.length;

    const maxAgeMs = this.jobs.maxAgeDays * 24 * 60 * 60 * 1000;
    for (const job of jobs) {
      try {
        // Freshness gate: drop postings older than the max age (default 15d).
        if (job.postedAt && Date.now() - new Date(job.postedAt).getTime() > maxAgeMs) {
          result.skipped++;
          await this.jobs.markSeen(job.url, source.name, false);
          continue;
        }
        const match = this.matching.match(job);
        const { created } = await this.jobs.upsertListing(job, match);
        if (match.qualifies) result.matched++;
        else result.skipped++;
        created ? result.created++ : result.updated++;
        await this.jobs.markSeen(job.url, source.name, match.qualifies);
      } catch (err) {
        result.errors++;
        this.logger.warn(`Upsert failed for ${job.url}: ${(err as Error).message}`);
      }
    }

    this.logger.log(
      `${source.name}: scanned=${result.scanned} matched=${result.matched} ` +
        `created=${result.created} updated=${result.updated} ` +
        `skipped=${result.skipped} errors=${result.errors}`,
    );
    return result;
  }
}
