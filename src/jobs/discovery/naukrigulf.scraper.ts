import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { JobSource } from './job-source.interface';
import { ScrapedJob } from './job-discovery.types';

const API = 'https://www.naukrigulf.com/spapi/jobapi/search';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const DEV_RE =
  /(developer|engineer|programmer|full[\s-]?stack|back[\s-]?end|front[\s-]?end|node|react|software)/i;

/**
 * NaukriGulf — the Gulf's major job board (legit, Naukri/InfoEdge). Uses the
 * same JSON search API its own site calls (requires the appid/systemid headers).
 * GCC roles → no visa sponsorship needed for Umer, so these rank as fast wins.
 * Best-effort: on any error it logs and returns [] so the run still completes.
 */
@Injectable()
export class NaukriGulfScraper implements JobSource {
  readonly name = 'naukrigulf';
  private readonly logger = new Logger(NaukriGulfScraper.name);

  async scrape(opts?: {
    queries?: string[];
    knownUrls?: Set<string>;
    delayMs?: number;
    maxPerQuery?: number;
  }): Promise<ScrapedJob[]> {
    const known = opts?.knownUrls ?? new Set<string>();
    const queries = (opts?.queries ?? ['software engineer', 'node js developer', 'full stack developer']).slice(0, 4);
    const perQuery = opts?.maxPerQuery ?? 15;
    const out: ScrapedJob[] = [];
    const seen = new Set<string>();

    for (const q of queries) {
      let jobs: any[] = [];
      try {
        const res = await axios.get(API, {
          params: { keyword: q, pageNo: 1, location: 'uae' },
          headers: {
            'User-Agent': UA,
            Accept: 'application/json',
            appid: '205',
            systemid: '2313',
          },
          timeout: 30_000,
        });
        jobs = res.data?.jobs ?? res.data?.jobDetails ?? [];
        if (!Array.isArray(jobs)) jobs = [];
      } catch (err) {
        this.logger.warn(`NaukriGulf "${q}" failed: ${(err as Error).message}`);
        continue;
      }

      let added = 0;
      for (const j of jobs.slice(0, perQuery)) {
        const title: string = j.designation || j.title || j.jobTitle || '';
        if (!title || !DEV_RE.test(title)) continue;
        let url: string = j.jdURL || j.url || j.jobUrl || '';
        if (url && !/^https?:/i.test(url)) url = `https://www.naukrigulf.com${url.startsWith('/') ? '' : '/'}${url}`;
        if (!url) continue;
        if (known.has(url) || seen.has(url)) continue;
        seen.add(url);

        const location: string = j.location || j.jobLocation || j.city || 'UAE';
        out.push({
          source: this.name,
          sourceId: String(j.jobId || j.id || url),
          url,
          title,
          company: j.companyName || j.company || 'Unknown',
          location,
          country: this.country(location),
          remote: /remote/i.test(`${title} ${location}`),
          description: (j.jobDescription || j.description || title).toString().slice(0, 4000),
          salary: j.salaryDetail?.label || j.salary || null,
          applyUrl: url,
          tags: Array.isArray(j.keySkills) ? j.keySkills.map(String) : [],
        });
        added++;
      }
      this.logger.log(`NaukriGulf "${q}": ${jobs.length} results, ${added} new dev roles`);
      if (opts?.delayMs) await this.sleep(opts.delayMs);
    }
    return out;
  }

  private country(location: string): string {
    const l = (location || '').toLowerCase();
    if (/saudi|riyadh|jeddah|dammam|ksa/.test(l)) return 'Saudi Arabia';
    if (/qatar|doha/.test(l)) return 'Qatar';
    if (/kuwait/.test(l)) return 'Kuwait';
    if (/bahrain/.test(l)) return 'Bahrain';
    if (/oman|muscat/.test(l)) return 'Oman';
    return 'United Arab Emirates';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
