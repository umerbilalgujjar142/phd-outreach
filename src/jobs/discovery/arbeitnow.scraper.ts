import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { JobSource } from './job-source.interface';
import { ScrapedJob } from './job-discovery.types';

const API = 'https://www.arbeitnow.com/api/job-board-api';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const DEV_RE =
  /(developer|engineer|programmer|full[\s-]?stack|back[\s-]?end|front[\s-]?end|node|react|software|typescript|javascript)/i;

/**
 * Arbeitnow — public paginated JSON API (mostly EU tech roles). Carries an
 * explicit `visa_sponsorship` flag, which we record so sponsorship-friendly EU
 * jobs can be ranked first. No login required.
 */
@Injectable()
export class ArbeitnowScraper implements JobSource {
  readonly name = 'arbeitnow';
  private readonly logger = new Logger(ArbeitnowScraper.name);

  async scrape(opts?: {
    knownUrls?: Set<string>;
    delayMs?: number;
    maxPerQuery?: number;
  }): Promise<ScrapedJob[]> {
    const known = opts?.knownUrls ?? new Set<string>();
    const maxPages = Math.max(1, Math.min(10, opts?.maxPerQuery ?? 5));
    const delayMs = opts?.delayMs ?? 1500;
    const jobs: ScrapedJob[] = [];

    for (let page = 1; page <= maxPages; page++) {
      let data: any[];
      try {
        const res = await axios.get(API, {
          params: { page },
          headers: { 'User-Agent': UA, Accept: 'application/json' },
          timeout: 30_000,
        });
        data = Array.isArray(res.data?.data) ? res.data.data : [];
      } catch (err) {
        this.logger.warn(`Arbeitnow page ${page} failed: ${(err as Error).message}`);
        break;
      }
      if (!data.length) break;

      for (const r of data) {
        const title: string = r.title || '';
        const tags: string[] = Array.isArray(r.tags) ? r.tags : [];
        if (!DEV_RE.test(title) && !tags.some((t) => DEV_RE.test(String(t)))) continue;

        const url: string = r.url;
        if (!url || known.has(url)) continue;

        const country = this.country(r.location);
        jobs.push({
          source: this.name,
          sourceId: r.slug || url,
          url,
          title,
          company: r.company_name || 'Unknown',
          location: r.location || null,
          country,
          remote: !!r.remote,
          description: this.stripHtml(r.description || ''),
          salary: null,
          applyUrl: null,
          tags: tags.map(String),
          sponsorshipOffered: r.visa_sponsorship === true ? true : undefined,
          postedAt: r.created_at ? new Date(Number(r.created_at) * 1000) : null,
        });
      }
      if (delayMs) await this.sleep(delayMs);
    }
    this.logger.log(`Arbeitnow: ${jobs.length} new dev roles across ${maxPages} page(s)`);
    return jobs;
  }

  /** Arbeitnow locations are German-centric free text; extract a country hint. */
  private country(location?: string): string | null {
    if (!location) return null;
    const l = location.toLowerCase();
    if (/germany|deutschland|berlin|munich|münchen|hamburg|cologne|köln|frankfurt/.test(l)) return 'Germany';
    if (/netherlands|amsterdam|rotterdam|utrecht/.test(l)) return 'Netherlands';
    if (/ireland|dublin/.test(l)) return 'Ireland';
    if (/united kingdom|london|manchester/.test(l)) return 'United Kingdom';
    if (/austria|vienna|wien/.test(l)) return 'Austria';
    if (/switzerland|zurich|zürich/.test(l)) return 'Switzerland';
    if (/spain|madrid|barcelona/.test(l)) return 'Spain';
    if (/portugal|lisbon|lisboa/.test(l)) return 'Portugal';
    if (/poland|warsaw|krakow|kraków/.test(l)) return 'Poland';
    return null;
  }

  private stripHtml(html: string): string {
    try {
      return cheerio.load(html).text().replace(/\s+/g, ' ').trim().slice(0, 8000);
    } catch {
      return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
