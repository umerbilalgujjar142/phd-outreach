import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { JobSource } from './job-source.interface';
import { ScrapedJob } from './job-discovery.types';

const API = 'https://remoteok.com/api';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

/** Loose developer-role gate so we don't ingest sales/marketing remote roles. */
const DEV_RE =
  /(developer|engineer|programmer|full[\s-]?stack|back[\s-]?end|front[\s-]?end|node|react|software|typescript|javascript)/i;

/**
 * RemoteOK — public JSON API (no login, no scraping fragility). Returns the
 * latest ~100 remote postings; element [0] is a legal notice we drop. Every
 * posting is remote by definition, so sponsorship never applies.
 */
@Injectable()
export class RemoteOkScraper implements JobSource {
  readonly name = 'remoteok';
  private readonly logger = new Logger(RemoteOkScraper.name);

  async scrape(opts?: { knownUrls?: Set<string> }): Promise<ScrapedJob[]> {
    const known = opts?.knownUrls ?? new Set<string>();
    let rows: any[];
    try {
      const res = await axios.get(API, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        timeout: 30_000,
      });
      rows = Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      this.logger.warn(`RemoteOK fetch failed: ${(err as Error).message}`);
      return [];
    }

    const jobs: ScrapedJob[] = [];
    for (const r of rows) {
      if (!r || !r.id || !r.position) continue; // skip the legend element
      const title: string = r.position;
      const tags: string[] = Array.isArray(r.tags) ? r.tags : [];
      if (!DEV_RE.test(title) && !tags.some((t) => DEV_RE.test(t))) continue;

      const url: string = r.url || `https://remoteok.com/remote-jobs/${r.slug ?? r.id}`;
      if (known.has(url)) continue;

      const salary =
        r.salary_min && r.salary_max
          ? `$${r.salary_min}–$${r.salary_max}`
          : null;

      jobs.push({
        source: this.name,
        sourceId: String(r.id),
        url,
        title,
        company: r.company || 'Unknown',
        location: r.location || 'Remote',
        country: null,
        remote: true,
        description: this.stripHtml(r.description || ''),
        salary,
        applyUrl: r.apply_url || null,
        tags,
        postedAt: r.epoch ? new Date(Number(r.epoch) * 1000) : r.date ? new Date(r.date) : null,
      });
    }
    this.logger.log(`RemoteOK: ${rows.length} rows, ${jobs.length} new dev roles`);
    return jobs;
  }

  private stripHtml(html: string): string {
    try {
      return cheerio.load(html).text().replace(/\s+/g, ' ').trim();
    } catch {
      return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }
}
