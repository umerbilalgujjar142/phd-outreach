import { Injectable, Logger } from '@nestjs/common';
import { PlaywrightService } from '../../discovery/playwright.service';
import { JobSource } from './job-source.interface';
import { parseRelativeAge, ScrapedJob } from './job-discovery.types';

/** Indeed domains → country, for Umer's target markets (no login needed). */
const INDEED_MARKETS: { domain: string; country: string }[] = [
  { domain: 'ae.indeed.com', country: 'United Arab Emirates' }, // no sponsorship — priority
  { domain: 'sa.indeed.com', country: 'Saudi Arabia' },
  { domain: 'ie.indeed.com', country: 'Ireland' },
  { domain: 'uk.indeed.com', country: 'United Kingdom' },
];

/**
 * Indeed — HTML search results via Playwright (no login). Indeed sits behind
 * Cloudflare Bot Management, which:
 *   - lets DISCOVERY through when the context is WARMED (visit the market
 *     homepage first → `__cf_bm` cookie → the search returns real job cards);
 *   - but BLOCKS automated LOGIN/APPLY entirely ("Additional Verification
 *     Required"), which no de-automation flag defeats. So this scraper is
 *     discovery-only; applying to Indeed jobs happens via the external ATS
 *     ("Apply on company website") or the user's own browser.
 *
 * Cloudflare rate-challenges repeated searches in one context, so we use a
 * FRESH warmed context per query. Each job is tagged by apply type
 * ("indeed-easy-apply" needs Indeed login → user/extension; "external-apply"
 * routes to a company ATS → automatable). BEST-EFFORT: challenges degrade
 * gracefully so the API sources still carry the run.
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
    const queries = (opts?.queries ?? ['software engineer', 'node.js developer']).slice(0, 4);
    const perQuery = opts?.maxPerQuery ?? 25;
    const delayMs = Math.max(opts?.delayMs ?? 3000, 6000);
    const out: ScrapedJob[] = [];
    const seen = new Set<string>();
    const now = Date.now();

    for (const market of INDEED_MARKETS) {
      let challenged = 0;
      for (const q of queries) {
        const url = `https://${market.domain}/jobs?q=${encodeURIComponent(q)}&fromage=7&sort=date`;
        try {
          // Fresh warmed context PER query: each query gets its own `__cf_bm`,
          // sidestepping the in-context rate challenge.
          const cards = await this.playwright.withContext(
            async (ctx) => {
              const page = await ctx.newPage();
              try {
                return await this.loadSearch(page, url);
              } finally {
                await page.close().catch(() => undefined);
              }
            },
            { warmup: [`https://${market.domain}/`] },
          );

          if (cards === null) {
            challenged++;
            this.logger.warn(`Indeed ${market.domain} "${q}": Cloudflare challenge`);
            await this.sleep(delayMs);
            continue;
          }

          let added = 0;
          for (const c of cards.slice(0, perQuery)) {
            const jobUrl = c.url || `https://${market.domain}/viewjob?jk=${encodeURIComponent(c.id)}`;
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
              // Apply-type tag drives how we apply: Indeed-native needs login
              // (user/extension); external routes to a company ATS (automatable).
              tags: [c.easilyApply ? 'indeed-easy-apply' : 'external-apply'],
              postedAt: parseRelativeAge(c.age, now),
            });
            added++;
          }
          this.logger.log(`Indeed ${market.domain} "${q}": ${cards.length} cards, ${added} new`);
        } catch (err) {
          this.logger.warn(`Indeed ${market.domain} "${q}" failed: ${(err as Error).message}`);
        }
        await this.sleep(delayMs);
      }
      if (challenged >= queries.length) {
        this.logger.warn(`Indeed ${market.domain}: all queries challenged (Cloudflare) — skipping ahead`);
      }
    }
    return out;
  }

  /**
   * Navigate to a search URL and return its cards, or `null` if Cloudflare
   * served a challenge page instead of results.
   */
  private async loadSearch(
    page: import('playwright').Page,
    url: string,
  ): Promise<Awaited<ReturnType<IndeedScraper['readCards']>> | null> {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(2500);
    const title = await page.title().catch(() => '');
    if (/just a moment|verify you are human|checking your browser|additional verification/i.test(title)) {
      return null;
    }
    return this.readCards(page);
  }

  /** Read the job cards on an Indeed search results page. */
  private readCards(page: import('playwright').Page) {
    return page.evaluate(() => {
      const abs = (href: string) => (href.startsWith('http') ? href : `https://${location.host}${href}`);
      const cardEls = Array.from(
        document.querySelectorAll('div.job_seen_beacon, div.cardOutline, td.resultContent'),
      );
      const rows: {
        id: string;
        title: string;
        company: string;
        location: string;
        snippet: string;
        age: string;
        easilyApply: boolean;
        url: string;
      }[] = [];
      for (const el of cardEls) {
        const titleEl = el.querySelector('h2.jobTitle a, a.jcs-JobTitle, h2 a');
        const title = (titleEl?.textContent || '').trim();
        if (!title) continue;
        const href = titleEl?.getAttribute('href') || '';
        const company = (
          el.querySelector('[data-testid="company-name"], .companyName')?.textContent || ''
        ).trim();
        const loc = (
          el.querySelector('[data-testid="text-location"], .companyLocation')?.textContent || ''
        ).trim();
        const snippet = (
          el.querySelector('.job-snippet, [data-testid="jobsnippet_footer"]')?.textContent || ''
        )
          .replace(/\s+/g, ' ')
          .trim();
        const age = (
          el.querySelector('.date, [data-testid="myJobsStateDate"], span[class*="date" i]')?.textContent || ''
        ).trim();
        // "Easily apply" badge → Indeed-native apply (needs Indeed login).
        const easilyApply =
          !!el.querySelector('[data-testid="indeedApply"], .indeedApply, [aria-label*="Easily apply" i]') ||
          /easily apply/i.test(el.textContent || '');
        const jk =
          titleEl?.getAttribute('data-jk') ||
          el.querySelector('[data-jk]')?.getAttribute('data-jk') ||
          href;
        rows.push({
          id: jk || href,
          title,
          company,
          location: loc,
          snippet,
          age,
          easilyApply,
          url: href ? abs(href) : '',
        });
      }
      return rows;
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
