import { Injectable, Logger } from '@nestjs/common';
import { PlaywrightService } from '../../discovery/playwright.service';
import { JobSource } from './job-source.interface';
import { parseRelativeAge, ScrapedJob } from './job-discovery.types';

const DEV_RE = /(developer|engineer|programmer|full[\s-]?stack|back[\s-]?end|front[\s-]?end|node|react|software)/i;

/**
 * Bayt.com — the Middle East's largest job site (legit). GCC country pages,
 * loaded via Playwright (no login). GCC roles need no visa sponsorship for Umer.
 * Best-effort: logs + returns [] on a block.
 */
@Injectable()
export class BaytScraper implements JobSource {
  readonly name = 'bayt';
  private readonly logger = new Logger(BaytScraper.name);

  private readonly markets = [
    { path: 'uae', country: 'United Arab Emirates' },
    { path: 'saudi-arabia', country: 'Saudi Arabia' },
  ];

  constructor(private readonly playwright: PlaywrightService) {}

  async scrape(opts?: {
    queries?: string[];
    knownUrls?: Set<string>;
    delayMs?: number;
    maxPerQuery?: number;
  }): Promise<ScrapedJob[]> {
    const known = opts?.knownUrls ?? new Set<string>();
    const queries = (opts?.queries ?? ['software engineer', 'node js developer']).slice(0, 2);
    const perQuery = opts?.maxPerQuery ?? 15;
    const out: ScrapedJob[] = [];
    const seen = new Set<string>();

    for (const m of this.markets) {
      for (const q of queries) {
        const slug = q.trim().replace(/\s+/g, '-').toLowerCase();
        const url = `https://www.bayt.com/en/${m.path}/jobs/${slug}-jobs/`;
        try {
          const cards = await this.playwright.withPage(url, async (page) => {
            await page.waitForTimeout(2500);
            return page.evaluate(() => {
              const abs = (h: string) => (h.startsWith('http') ? h : `https://www.bayt.com${h}`);
              const rows: { title: string; company: string; location: string; url: string; posted: string }[] = [];
              const anchors = Array.from(
                document.querySelectorAll('li[data-js-aid="jobID"] h2 a, a[data-js-aid="jobID"], h2 a[href*="/jobs/"]'),
              ) as HTMLAnchorElement[];
              for (const a of anchors) {
                const title = (a.textContent || '').replace(/\s+/g, ' ').trim();
                const href = a.getAttribute('href') || '';
                if (!title || !href) continue;
                const card = a.closest('li, div');
                const company = (card?.querySelector('.t-nowrap, [class*="company"], b')?.textContent || '').trim();
                const location = (card?.querySelector('[class*="location"], .t-mute')?.textContent || '').replace(/\s+/g, ' ').trim();
                const posted = ((card?.textContent || '').match(/\d+\+?\s*(day|week|month|hour|min)s?\s*ago|today|just now|yesterday/i) || [''])[0];
                rows.push({ title, company, location, url: abs(href), posted });
              }
              return rows;
            });
          });

          let added = 0;
          for (const c of cards.slice(0, perQuery)) {
            if (!DEV_RE.test(c.title)) continue;
            if (known.has(c.url) || seen.has(c.url)) continue;
            seen.add(c.url);
            out.push({
              source: this.name,
              sourceId: c.url,
              url: c.url,
              title: c.title,
              company: c.company || 'Unknown',
              location: c.location || m.country,
              country: m.country,
              remote: /remote/i.test(`${c.title} ${c.location}`),
              description: c.title,
              salary: null,
              applyUrl: c.url,
              tags: [],
              postedAt: parseRelativeAge(c.posted, Date.now()),
            });
            added++;
          }
          this.logger.log(`Bayt ${m.path} "${q}": ${cards.length} cards, ${added} new`);
        } catch (err) {
          this.logger.warn(`Bayt ${m.path} "${q}" failed: ${(err as Error).message}`);
        }
        await this.sleep(opts?.delayMs ?? 2500);
      }
    }
    return out;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
