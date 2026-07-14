import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { DiscoverySource } from './discovery-source.interface';
import { ScrapedContact, ScrapedListing } from './discovery.types';

const BASE = 'https://euraxess.ec.europa.eu';
const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

// EURAXESS "Research Field" facet IDs relevant to this search (network/AppSec,
// ML-for-security, systems, intrusion/anomaly detection). EURAXESS has NO
// dedicated "cybersecurity" field — security roles live inside these CS /
// engineering / information-science categories — so the tag matcher still does
// the final security precision. Filtering here cuts the listing from ~8,200
// (all fields) to ~1,400, so each daily sweep is dense with relevant posts and
// makes far fewer detail requests (which also relieves rate-limiting).
const RESEARCH_FIELD_IDS = [
  78, 91, //         Computer science, Computer science other
  172, //            Computer engineering
  171, //            Communication engineering
  87, //             Informatics
  251, 257, 255, 415, // Information science / … other / management / technology
  85, //             Database management
  175, 176, //       Electrical / Electronic engineering
  439, //            Telecommunications technology
  191, //            Systems engineering
  81, 83, 405, //    Computer architecture / systems / technology
  80, //             Autonomic computing
];

/**
 * Scraper for EURAXESS (PROJECT.md Section 8, Step 1). The listing pages are
 * server-rendered HTML (no JS needed), so Axios + Cheerio is sufficient.
 * Strategy: paginate the jobs listing to collect offer IDs, then fetch each
 * offer's detail page which exposes structured dt/dd fields.
 */
@Injectable()
export class EuraxessScraper implements DiscoverySource {
  readonly name = 'euraxess';
  private readonly logger = new Logger(EuraxessScraper.name);
  private readonly http: AxiosInstance = axios.create({
    timeout: 25_000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; phd-outreach/1.0; academic PhD search)',
      'Accept-Language': 'en',
    },
    maxRedirects: 5,
  });

  /** Faceted jobs-search URL for a page, pre-filtered to our research fields. */
  private searchUrl(page: number): string {
    const facets = RESEARCH_FIELD_IDS.map(
      (id, i) => `f%5B${i}%5D=job_research_field%3A${id}`,
    ).join('&');
    return `${BASE}/jobs/search?${facets}&page=${page}`;
  }

  /**
   * GET with polite back-off on rate-limiting. EURAXESS answers 429 (and
   * occasionally 503) when hit too fast; we honour its Retry-After header when
   * present, else exponential back-off. This lets a sweep ride through
   * throttling instead of silently dropping pages/offers.
   */
  private async getWithRetry(url: string, retries = 5): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      try {
        const { data } = await this.http.get<string>(url);
        return data;
      } catch (err) {
        const status = (err as { response?: { status?: number; headers?: Record<string, string> } })
          .response?.status;
        if ((status === 429 || status === 503) && attempt < retries) {
          const retryAfter = Number(
            (err as { response?: { headers?: Record<string, string> } }).response?.headers?.[
              'retry-after'
            ],
          );
          const waitMs =
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : Math.min(30_000, 1000 * 2 ** attempt);
          this.logger.warn(
            `${status} for ${url} — backing off ${waitMs}ms (retry ${attempt + 1}/${retries})`,
          );
          await this.sleep(waitMs);
          continue;
        }
        throw err;
      }
    }
  }

  /** Collect distinct offer IDs from a single (filtered) listing page. */
  private async fetchListingPage(page: number): Promise<string[]> {
    const data = await this.getWithRetry(this.searchUrl(page));
    const $ = cheerio.load(data);
    const ids = new Set<string>();
    $('a[href*="/jobs/"]').each((_, el) => {
      const m = ($(el).attr('href') || '').match(/\/jobs\/(\d+)/);
      if (m) ids.add(m[1]);
    });
    return [...ids];
  }

  /**
   * Fetch and parse a single offer detail page. `retries` is kept low by the
   * daily sweep (see scrape): a 429 here means we've hit EURAXESS's burst quota,
   * and retrying in a few seconds can't clear it — it just adds load to an
   * endpoint that's asking us to back off. The offer stays unseen and is
   * retried on the next run instead.
   */
  async fetchOffer(id: string, retries = 5): Promise<ScrapedListing | null> {
    const url = `${BASE}/jobs/${id}`;
    try {
      const data = await this.getWithRetry(url, retries);
      const $ = cheerio.load(data);

      // Structured dt/dd fields.
      const fields: Record<string, string> = {};
      $('dt').each((_, el) => {
        const key = $(el).text().trim();
        const val = $(el).next('dd').text().trim().replace(/\s+/g, ' ');
        if (key) fields[key] = val;
      });

      // The page's first <h1> is the generic chrome "Job offer"; the real
      // position title is in og:title (and a later <h1>). Prefer those.
      const h1s = $('h1')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter((t) => t && !/^job offer$/i.test(t));
      const title =
        ($('meta[property="og:title"]').attr('content') || '').trim() ||
        h1s[0] ||
        'Untitled position';

      // Prefer explicit mailto: contacts (the intended "where to apply"
      // address) — captured BEFORE we strip chrome.
      const mailtoEmails = $('a[href^="mailto:"]')
        .map((_, el) =>
          ($(el).attr('href') || '')
            .replace(/^mailto:/i, '')
            .split('?')[0]
            .trim()
            .toLowerCase(),
        )
        .get()
        .filter(Boolean);

      // External "Apply now" link (institution ATS). Captured BEFORE stripping
      // chrome; we only keep off-EURAXESS destinations so the user can submit
      // the formal application manually later.
      const applyUrl =
        $('a')
          .filter((_, el) => /apply\s*now/i.test($(el).text()))
          .map((_, el) => $(el).attr('href') || '')
          .get()
          .find((h) => /^https?:\/\//i.test(h) && !/euraxess\.ec\.europa/i.test(h)) ||
        null;

      // Prose text (pre-strip) used to parse "Name (email)" style PI contacts,
      // which live in the Contact / Selection-process / Additional-comments
      // sections that the chrome-strip below would otherwise mangle.
      const proseText = $('main').text().replace(/\s+/g, ' ').trim();
      const contacts = this.parseContacts(proseText);

      // Strip navigation / related-jobs / chrome so tag-matching and any
      // fallback email scrape only see this offer's own content.
      $('nav, header, footer, aside, script, style, [class*="related"], [class*="sidebar"]').remove();
      const contentHtml = $('main').html() || $.html();
      const bodyText = $('main').text().replace(/\s+/g, ' ').trim();

      const scraped = (contentHtml.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])
        .map((e) => e.toLowerCase())
        .filter(
          (e) =>
            !/sentry|example|w3\.org|\.png|\.jpg|\.gif|\.svg|euraxess\.ec\.europa/.test(e),
        );

      const emails = [...new Set([...mailtoEmails, ...scraped])];

      return {
        source: 'euraxess',
        sourceId: id,
        url,
        title,
        organisation:
          fields['Organisation/Company'] || fields['Company/Institute'] || '',
        country: fields['Country'] || null,
        researchField: fields['Research Field'] || null,
        applicationDeadline: this.parseDeadline(fields['Application Deadline']),
        city: fields['City'] || null,
        description: `${title}. ${fields['Research Field'] || ''}. ${bodyText}`.slice(0, 8000),
        emails,
        contacts,
        applyUrl,
      };
    } catch (err) {
      this.logger.warn(`Failed to fetch offer ${id}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Scrape up to `maxPages` listing pages and return parsed offers.
   * `delayMs` throttles detail-page requests to stay polite.
   */
  async scrape(
    opts: { maxPages?: number; delayMs?: number; knownUrls?: Set<string> } = {},
  ): Promise<ScrapedListing[]> {
    const maxPages = opts.maxPages ?? 3;
    // Detail pages are the rate-limit hot path: pace them generously. Because
    // we now fetch only NEW offers (see below), this is a small number of
    // requests, so a gentle delay costs little and avoids the 429 storm.
    const delayMs = opts.delayMs ?? 1500;
    const knownUrls = opts.knownUrls ?? new Set<string>();

    const ids = new Set<string>();
    for (let p = 0; p < maxPages; p++) {
      try {
        const pageIds = await this.fetchListingPage(p);
        pageIds.forEach((id) => ids.add(id));
        this.logger.log(`Listing page ${p}: ${pageIds.length} offers`);
        if (pageIds.length === 0) break;
        // Space out listing requests too — hammering these back-to-back is what
        // tripped EURAXESS's 429; getWithRetry handles the rest.
        await this.sleep(delayMs);
      } catch (err) {
        this.logger.warn(`Listing page ${p} failed: ${(err as Error).message}`);
        break;
      }
    }

    // Only fetch offers we have NOT already evaluated on a previous run. This is
    // the key fix for the rate limit: re-fetching the whole ~200-offer listing
    // every day blew EURAXESS's quota; now we pull only the daily new ones.
    const candidates = [...ids];
    const newIds = candidates.filter((id) => !knownUrls.has(`${BASE}/jobs/${id}`));
    const skipped = candidates.length - newIds.length;
    this.logger.log(
      `EURAXESS: ${candidates.length} candidates, ${skipped} already seen, fetching ${newIds.length} new`,
    );

    // Circuit breaker: EURAXESS lets through a burst (~50-60 detail requests),
    // then 429s everything until a long cooldown. Once we've hit that wall we
    // must STOP — grinding through it fetches nothing and only deepens the
    // block. We count TOTAL failures this run (not consecutive: candidate IDs
    // interleave, so an occasional lucky success would keep resetting a
    // consecutive counter and let us hammer for 20+ minutes). With only ~2
    // retries per offer (below), a handful of failures means the wall is up —
    // bail within seconds. Whatever we DID fetch is marked seen upstream, so
    // the backfill self-spreads over a few days.
    const MAX_FAILURES = 6;
    const OFFER_RETRIES = 2;
    let failures = 0;
    const listings: ScrapedListing[] = [];
    for (const id of newIds) {
      const offer = await this.fetchOffer(id, OFFER_RETRIES);
      if (offer) {
        listings.push(offer);
      } else if (++failures >= MAX_FAILURES) {
        this.logger.warn(
          `Aborting EURAXESS scan after ${failures} rate-limit failures (burst quota hit) — ` +
            `${listings.length} fetched this run, the rest retry next run.`,
        );
        break;
      }
      await this.sleep(delayMs);
    }
    this.logger.log(`Scraped ${listings.length} offers from ${newIds.length} new ids`);
    return listings;
  }

  /**
   * Parse named PI/supervisor contacts from prose like
   * "contact Isel Grau (i.c.grau.garcia@tue.nl)" or
   * "Prof. Jane Doe (jane.doe@uni.de)". Falls back to nothing if the offer
   * only exposes bare emails. First match is treated as the primary contact.
   */
  private parseContacts(text: string): ScrapedContact[] {
    const re =
      /(?:Prof\.?|Dr\.?|Mr\.?|Ms\.?|Mrs\.?|Professor)?\s*([A-ZÀ-Þ][a-zà-ÿ'’-]+(?:\s+[A-ZÀ-Þ][a-zà-ÿ'’.-]+){0,3})\s*\(\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\s*\)/g;
    const seen = new Set<string>();
    const out: ScrapedContact[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const name = m[1].trim().replace(/\s+/g, ' ');
      const email = m[2].toLowerCase();
      // Skip if the "name" is really a leading sentence word glued on, or dup.
      if (seen.has(email)) continue;
      if (name.split(' ').length < 2) continue; // require at least first + last
      seen.add(email);
      out.push({ name, email });
    }
    return out;
  }

  private parseDeadline(raw?: string): string | null {
    if (!raw) return null;
    // e.g. "30 Jul 2026 - 21:59 (UTC)"
    const m = raw.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
    if (!m) return null;
    const day = m[1].padStart(2, '0');
    const mon = MONTHS[m[2].toLowerCase().slice(0, 3)];
    if (!mon) return null;
    return `${m[3]}-${mon}-${day}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
