import { Injectable, Logger } from '@nestjs/common';
import { PlaywrightService } from '../../discovery/playwright.service';
import { JobSource } from './job-source.interface';
import { parseRelativeAge, ScrapedJob } from './job-discovery.types';

const DEV_RE = /(developer|engineer|programmer|full[\s-]?stack|back[\s-]?end|front[\s-]?end|node|react|software)/i;

/**
 * IrishJobs.ie — Ireland's main job board (legit, StepStone group). Loaded via
 * Playwright (no login). Ireland roles need visa sponsorship for Umer, so they
 * rank below GCC/remote but are still pursued. Best-effort: logs + returns [].
 */
@Injectable()
export class IrishJobsScraper implements JobSource {
  readonly name = 'irishjobs';
  private readonly logger = new Logger(IrishJobsScraper.name);

  constructor(private readonly playwright: PlaywrightService) {}

  async scrape(opts?: {
    queries?: string[];
    knownUrls?: Set<string>;
    delayMs?: number;
    maxPerQuery?: number;
  }): Promise<ScrapedJob[]> {
    const known = opts?.knownUrls ?? new Set<string>();
    const queries = (opts?.queries ?? ['software developer', 'backend developer', 'full stack developer']).slice(0, 3);
    const perQuery = opts?.maxPerQuery ?? 15;
    const out: ScrapedJob[] = [];
    const seen = new Set<string>();

    for (const q of queries) {
      const slug = q.trim().replace(/\s+/g, '-').toLowerCase();
      const url = `https://www.irishjobs.ie/jobs/${slug}`;
      try {
        const cards = await this.playwright.withPage(url, async (page) => {
          await page.waitForTimeout(3000);
          return page.evaluate(() => {
            const abs = (h: string) => (h.startsWith('http') ? h : `https://www.irishjobs.ie${h}`);
            const rows: { title: string; company: string; location: string; url: string; posted: string }[] = [];
            // Real IrishJobs (StepStone) job cards.
            document.querySelectorAll('[data-testid="job-item"]').forEach((card) => {
              const a = card.querySelector('[data-testid="job-item-title"]') as HTMLAnchorElement | null;
              const href = a?.getAttribute('href') || '';
              const title = (a?.textContent || '').replace(/\s+/g, ' ').trim();
              if (!href || !title) return;
              const company = (card.querySelector('[data-testid="company-name"], [data-testid="company-element"], [data-genesis-element="TEXT"]')?.textContent || '')
                .replace(/\s+/g, ' ')
                .trim();
              const location = (card.querySelector('[data-testid="location-name"], [data-testid*="location"]')?.textContent || '')
                .replace(/\s+/g, ' ')
                .trim();
              const posted = ((card.textContent || '').match(/\d+\+?\s*(day|week|month|hour|min)s?\s*ago|today|just now|yesterday/i) || [''])[0];
              rows.push({ title, company, location, url: abs(href), posted });
            });
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
            location: c.location || 'Ireland',
            country: 'Ireland',
            remote: /remote/i.test(`${c.title} ${c.location}`),
            description: c.title,
            salary: null,
            applyUrl: c.url,
            tags: [],
            postedAt: parseRelativeAge(c.posted, Date.now()),
          });
          added++;
        }
        this.logger.log(`IrishJobs "${q}": ${cards.length} cards, ${added} new`);
      } catch (err) {
        this.logger.warn(`IrishJobs "${q}" failed: ${(err as Error).message}`);
      }
      await this.sleep(opts?.delayMs ?? 2500);
    }
    return out;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
