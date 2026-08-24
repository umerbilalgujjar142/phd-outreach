import { Injectable, Logger } from '@nestjs/common';
import { PlaywrightService } from '../../discovery/playwright.service';
import { JobSource } from './job-source.interface';
import { ScrapedJob } from './job-discovery.types';

/** Indeed domains → country, for Umer's target markets (no login needed). */
const INDEED_MARKETS: { domain: string; country: string }[] = [
  { domain: 'ae.indeed.com', country: 'United Arab Emirates' },
  { domain: 'sa.indeed.com', country: 'Saudi Arabia' },
  { domain: 'ie.indeed.com', country: 'Ireland' },
  { domain: 'uk.indeed.com', country: 'United Kingdom' },
  { domain: 'www.indeed.com', country: 'United States' },
];

/**
 * Indeed — HTML search results loaded via Playwright (no login). Indeed is
 * aggressively anti-bot, so this is BEST-EFFORT: on a challenge/block it logs
 * and returns what it has rather than throwing, so RemoteOK + Arbeitnow still
 * carry the run. Uses the last-3-days, date-sorted search and reads job cards
 * only (title + company + snippet) — enough for matching without hammering
 * per-job pages.
 */
@Injectable()
export class IndeedScraper implements JobSource {
  readonly name = 'indeed';
  private readonly logger = new Logger(IndeedScraper.name);

  constructor(private readonly playwright: PlaywrightService) {}

  async scrape(opts?: {
    queries?: string[];
    knownUrls?: Set<string>;
    delayMs?: number;
    maxPerQuery?: number;
  }): Promise<ScrapedJob[]> {
    const known = opts?.knownUrls ?? new Set<string>();
    const queries = (opts?.queries ?? ['software engineer', 'node.js developer']).slice(0, 3);
    const perQuery = opts?.maxPerQuery ?? 15;
    const out: ScrapedJob[] = [];
    const seen = new Set<string>();

    for (const market of INDEED_MARKETS) {
      for (const q of queries) {
        const url = `https://${market.domain}/jobs?q=${encodeURIComponent(q)}&fromage=3&sort=date`;
        try {
          const cards = await this.playwright.withPage(url, async (page) => {
            await page.waitForTimeout(2500);
            return page.evaluate(() => {
              const abs = (href: string) =>
                href.startsWith('http') ? href : `https://${location.host}${href}`;
              const cardEls = Array.from(
                document.querySelectorAll('div.job_seen_beacon, div.cardOutline, td.resultContent'),
              );
              const rows: {
                id: string;
                title: string;
                company: string;
                location: string;
                snippet: string;
                url: string;
              }[] = [];
              for (const el of cardEls) {
                const titleEl = el.querySelector('h2.jobTitle a, a.jcs-JobTitle, h2 a');
                const title = (titleEl?.textContent || '').trim();
                if (!title) continue;
                const href = titleEl?.getAttribute('href') || '';
                const company =
                  (el.querySelector('[data-testid="company-name"], .companyName')?.textContent || '').trim();
                const loc =
                  (el.querySelector('[data-testid="text-location"], .companyLocation')?.textContent || '').trim();
                const snippet =
                  (el.querySelector('.job-snippet, [data-testid="jobsnippet_footer"]')?.textContent || '')
                    .replace(/\s+/g, ' ')
                    .trim();
                const jk =
                  titleEl?.getAttribute('data-jk') ||
                  el.querySelector('[data-jk]')?.getAttribute('data-jk') ||
                  href;
                rows.push({ id: jk || href, title, company, location: loc, snippet, url: href ? abs(href) : '' });
              }
              return rows;
            });
          });

          let added = 0;
          for (const c of cards.slice(0, perQuery)) {
            const jobUrl =
              c.url || `https://${market.domain}/viewjob?jk=${encodeURIComponent(c.id)}`;
            if (!jobUrl || known.has(jobUrl) || seen.has(jobUrl)) continue;
            seen.add(jobUrl);
            const remote = /remote/i.test(c.location) || /remote/i.test(c.title);
            out.push({
              source: this.name,
              sourceId: c.id,
              url: jobUrl,
              title: c.title,
              company: c.company || 'Unknown',
              location: c.location || market.country,
              country: remote ? null : market.country,
              remote,
              description: c.snippet || c.title,
              salary: null,
              applyUrl: jobUrl,
              tags: [],
            });
            added++;
          }
          this.logger.log(`Indeed ${market.domain} "${q}": ${cards.length} cards, ${added} new`);
        } catch (err) {
          this.logger.warn(
            `Indeed ${market.domain} "${q}" failed (likely anti-bot): ${(err as Error).message}`,
          );
        }
        await this.sleep(opts?.delayMs ?? 3000);
      }
    }
    return out;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
