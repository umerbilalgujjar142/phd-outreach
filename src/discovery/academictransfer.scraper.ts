import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { DiscoverySource } from './discovery-source.interface';
import { ScrapedContact, ScrapedListing } from './discovery.types';

const BASE = 'https://www.academictransfer.com';

/**
 * AcademicTransfer (Netherlands' main academic job portal). It is a Nuxt app
 * but server-renders each posting, including a JSON-LD `JobPosting` block with
 * clean structured fields — so Axios + Cheerio is sufficient (no Playwright).
 * We restrict listing queries to PhD/research roles that fit the tag engine.
 */
@Injectable()
export class AcademicTransferScraper implements DiscoverySource {
  readonly name = 'academictransfer';
  private readonly logger = new Logger(AcademicTransferScraper.name);
  private readonly http: AxiosInstance = axios.create({
    timeout: 25_000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'Accept-Language': 'en',
    },
    maxRedirects: 5,
  });

  /**
   * Collect distinct job detail paths from one listing page. AcademicTransfer's
   * `?query=` is not applied server-side, so we scan the latest postings and
   * let MatchingService filter — same strategy as EURAXESS.
   */
  private async fetchListingPage(page: number): Promise<string[]> {
    const url = `${BASE}/en/jobs/?page=${page}`;
    const { data } = await this.http.get<string>(url);
    const $ = cheerio.load(data);
    const paths = new Set<string>();
    $('a[href*="/en/jobs/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      // Detail pages look like /en/jobs/<id>/<slug>/
      if (/\/en\/jobs\/\d+\//.test(href)) {
        paths.add(href.startsWith('http') ? href.replace(BASE, '') : href);
      }
    });
    return [...paths];
  }

  /** Fetch + parse a single posting via its JSON-LD JobPosting. */
  async fetchOffer(path: string): Promise<ScrapedListing | null> {
    const url = path.startsWith('http') ? path : `${BASE}${path}`;
    try {
      const { data } = await this.http.get<string>(url);
      const $ = cheerio.load(data);
      const job = this.extractJobPosting(data);

      // mailto contacts (preferred) captured before stripping chrome.
      const mailtoEmails = $('a[href^="mailto:"], a[href*="mailto:"]')
        .map((_, el) =>
          ($(el).attr('href') || '').trim().replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase(),
        )
        .get()
        .filter(Boolean);

      const proseText = $('main').text().replace(/\s+/g, ' ').trim() || $('body').text();
      const contacts = this.parseContacts(proseText);

      const descHtml = job?.description || '';
      const descText = descHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const title =
        job?.title ||
        ($('meta[property="og:title"]').attr('content') || '').trim() ||
        'Untitled position';

      const scraped = (
        (descHtml + ' ' + proseText).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []
      )
        .map((e) => e.toLowerCase())
        .filter((e) => !/sentry|example|w3\.org|\.png|\.jpg|academictransfer\.com/.test(e));
      // Normalise: strip any stray "mailto:" prefix/whitespace and keep only
      // well-formed addresses (a leading space earlier defeated the anchor strip).
      const emails = [...new Set([...mailtoEmails, ...scraped])]
        .map((e) => e.replace(/^\s*mailto:/i, '').trim())
        .filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e));

      return {
        source: this.name,
        sourceId: (path.match(/\/jobs\/(\d+)/) || [])[1] || url,
        url,
        title,
        organisation: this.orgName(job),
        country: this.country(job),
        researchField: job?.occupationalCategory || null,
        applicationDeadline: job?.validThrough ? job.validThrough.slice(0, 10) : null,
        city: null,
        description: `${title}. ${descText}`.slice(0, 8000),
        emails,
        contacts,
        applyUrl: url,
      };
    } catch (err) {
      this.logger.warn(`Failed to fetch ${url}: ${(err as Error).message}`);
      return null;
    }
  }

  async scrape(opts: { maxPages?: number; delayMs?: number } = {}): Promise<ScrapedListing[]> {
    const maxPages = opts.maxPages ?? 3;
    const delayMs = opts.delayMs ?? 400;

    const paths = new Set<string>();
    for (let p = 1; p <= maxPages; p++) {
      try {
        const pagePaths = await this.fetchListingPage(p);
        pagePaths.forEach((x) => paths.add(x));
        if (pagePaths.length === 0) break;
      } catch (err) {
        this.logger.warn(`AT listing page ${p} failed: ${(err as Error).message}`);
        break;
      }
      await this.sleep(delayMs);
    }
    this.logger.log(`AcademicTransfer: ${paths.size} distinct links across ${maxPages} pages`);

    const listings: ScrapedListing[] = [];
    for (const path of paths) {
      const offer = await this.fetchOffer(path);
      if (offer) listings.push(offer);
      await this.sleep(delayMs);
    }
    this.logger.log(`AcademicTransfer scraped ${listings.length} offers from ${paths.size} links`);
    return listings;
  }

  /** Pull the JSON-LD JobPosting object (nested under a WebPage mainEntity). */
  private extractJobPosting(html: string): any | null {
    const blocks = [...html.matchAll(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(
      (m) => m[1].trim(),
    );
    for (const b of blocks) {
      try {
        const parsed = JSON.parse(b);
        const candidates = Array.isArray(parsed) ? parsed : [parsed, parsed?.mainEntity];
        for (const c of candidates) {
          if (c && c['@type'] === 'JobPosting') return c;
        }
      } catch {
        /* ignore malformed block */
      }
    }
    return null;
  }

  private orgName(job: any): string {
    return job?.hiringOrganization?.name || 'Unknown (AcademicTransfer)';
  }

  private country(job: any): string | null {
    const c = job?.jobLocation?.address?.addressCountry;
    if (!c) return null;
    return typeof c === 'string' ? c : c.name || null;
  }

  private parseContacts(text: string): ScrapedContact[] {
    const re =
      /(?:Prof\.?|Dr\.?|Mr\.?|Ms\.?|Mrs\.?|Professor)?\s*([A-ZÀ-Þ][a-zà-ÿ'’-]+(?:\s+[A-ZÀ-Þ][a-zà-ÿ'’.-]+){0,3})\s*\(\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\s*\)/g;
    const seen = new Set<string>();
    const out: ScrapedContact[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const name = m[1].trim().replace(/\s+/g, ' ');
      const email = m[2].toLowerCase();
      if (seen.has(email) || name.split(' ').length < 2) continue;
      seen.add(email);
      out.push({ name, email });
    }
    return out;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
