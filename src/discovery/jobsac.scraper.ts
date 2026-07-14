import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { DiscoverySource } from './discovery-source.interface';
import { ScrapedContact, ScrapedListing } from './discovery.types';

const BASE = 'https://www.jobs.ac.uk';

// jobs.ac.uk's SEO `/search/{discipline}-jobs/...` routes do NOT actually
// filter by discipline (a CS route and a biology route return the identical
// "latest 25 PhDs" set). The real filter is the keyword search combined with
// the `jobTypeFacet[]=phds` job-type facet.
//
// We deliberately use SECURITY-focused keywords, NOT broad "machine learning"/
// "artificial intelligence". On a general academic board those broad terms are
// a firehose of applied-AI-in-every-engineering-field PhDs (mechanical+AI,
// CFD+AI, packaging+AI, sport-science+AI), which the user does not want — and
// jobs.ac.uk lets employers over-tag "Computer Sciences" on any AI posting, so
// the discipline field can't reliably separate them. Security topics are
// inherently CS/security, matching the user's real interest (cybersecurity
// first, plus ML *within* security: adversarial ML, federated learning, …).
const KEYWORDS = [
  'cyber security',
  'network security',
  'information security',
  'cryptography',
  'hardware security',
  'adversarial machine learning',
  'malware',
  'intrusion detection',
  'privacy preserving',
  'trusted computing',
  'vulnerability',
  'formal verification security',
];

// Bound per-run detail fetches so a daily scan stays fast and polite.
const MAX_DETAILS = 60;

/**
 * jobs.ac.uk — the UK's main academic job board (EURAXESS is weak on the UK,
 * so this is our primary UK coverage). Each posting server-renders a JSON-LD
 * `JobPosting` block (title/org/deadline/description) plus an inline advert
 * JSON carrying the discipline `subject_areas`, the external `apply_url`, and
 * the supervisor's `mailto` — so Axios is sufficient (no Playwright, no
 * Cloudflare wall, unlike FindAPhD / academicpositions.com).
 */
@Injectable()
export class JobsAcScraper implements DiscoverySource {
  readonly name = 'jobsac';
  private readonly logger = new Logger(JobsAcScraper.name);
  private readonly http: AxiosInstance = axios.create({
    timeout: 25_000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'Accept-Language': 'en',
    },
    maxRedirects: 5,
  });

  /** Collect distinct `/job/<ref>/<slug>` PhD detail paths for one keyword. */
  private async fetchKeywordPaths(keyword: string): Promise<string[]> {
    const url =
      `${BASE}/search/?keywords=${encodeURIComponent(keyword)}` +
      `&jobTypeFacet%5B%5D=phds&pageSize=25`;
    const { data } = await this.http.get<string>(url);
    const paths = new Set<string>();
    for (const m of data.matchAll(/href="(\/job\/[^"?#]+)"/g)) {
      paths.add(m[1]);
    }
    return [...paths];
  }

  /** Fetch + parse a single posting (JSON-LD JobPosting + inline advert JSON). */
  async fetchOffer(path: string): Promise<ScrapedListing | null> {
    const url = path.startsWith('http') ? path : `${BASE}${path}`;
    try {
      const { data: html } = await this.http.get<string>(url);
      const jp = this.extractJobPosting(html);

      const descHtml = (jp?.description as string) || '';
      const descText = descHtml
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const title =
        (jp?.title as string) ||
        (html.match(/<meta property="og:title" content="([^"]+)"/) || [])[1] ||
        'Untitled position';

      const organisation =
        jp?.hiringOrganization?.name ||
        this.inlineString(html, 'employer_name') ||
        'Unknown (jobs.ac.uk)';

      const emails = this.extractEmails(html);
      const applyUrl =
        this.inlineString(html, 'apply_url') || (jp?.url as string) || url;

      // jobs.ac.uk rarely fills jobLocation.addressCountry and carries some
      // international jobs, so infer from an academic ccTLD (email or apply
      // host) before defaulting to the UK (where most listings originate).
      const country =
        this.ldCountry(jp) ||
        this.countryFromHosts([...emails, applyUrl]) ||
        'United Kingdom';

      // Discipline signal the matcher gates on. jobs.ac.uk tags each posting
      // with a LONG list of subject areas (a biology PhD is often cross-tagged
      // "Computer Sciences"/"Artificial Intelligence"), which would defeat the
      // field-authoritative gate. So we take only the PRIMARY (first top-level)
      // discipline — the posting's real home faculty.
      const researchField = this.primaryDiscipline(html);

      const deadline = jp?.validThrough ? String(jp.validThrough).slice(0, 10) : null;

      const contacts = this.parseContacts(descText, emails);

      return {
        source: this.name,
        sourceId: (path.match(/\/job\/([^/]+)/) || [])[1] || url,
        url,
        title,
        organisation,
        country,
        researchField,
        applicationDeadline: deadline,
        city: null,
        description: `${title}. ${descText}`.slice(0, 8000),
        emails,
        contacts,
        applyUrl,
      };
    } catch (err) {
      this.logger.warn(`Failed to fetch ${url}: ${(err as Error).message}`);
      return null;
    }
  }

  async scrape(opts: { maxPages?: number; delayMs?: number } = {}): Promise<ScrapedListing[]> {
    const delayMs = opts.delayMs ?? 400;

    // Sweep every keyword; dedupe the resulting detail paths across topics.
    const paths = new Set<string>();
    for (const kw of KEYWORDS) {
      try {
        (await this.fetchKeywordPaths(kw)).forEach((p) => paths.add(p));
      } catch (err) {
        this.logger.warn(`jobs.ac.uk search "${kw}" failed: ${(err as Error).message}`);
      }
      await this.sleep(delayMs);
    }
    const unique = [...paths].slice(0, MAX_DETAILS);
    this.logger.log(
      `jobs.ac.uk: ${paths.size} unique PhD links across ${KEYWORDS.length} keywords` +
        (paths.size > MAX_DETAILS ? ` (capped at ${MAX_DETAILS})` : ''),
    );

    const listings: ScrapedListing[] = [];
    for (const path of unique) {
      const offer = await this.fetchOffer(path);
      if (offer) listings.push(offer);
      await this.sleep(delayMs);
    }
    this.logger.log(`jobs.ac.uk scraped ${listings.length} offers from ${unique.length} links`);
    return listings;
  }

  /** Pull the JSON-LD JobPosting (may be an array or a @graph). */
  private extractJobPosting(html: string): any | null {
    const blocks = [...html.matchAll(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(
      (m) => m[1].trim(),
    );
    for (const b of blocks) {
      try {
        const parsed = JSON.parse(b);
        const flat = (Array.isArray(parsed) ? parsed : [parsed, parsed?.['@graph']])
          .flat()
          .filter(Boolean);
        for (const c of flat) {
          if (c && c['@type'] === 'JobPosting') return c;
        }
      } catch {
        /* ignore malformed block */
      }
    }
    return null;
  }

  /**
   * The posting's home discipline = the first top-level (`parent_category_id`
   * === 0) entry in the inline `subject_areas` object. Falls back to the first
   * `category_name` found, then null. This single authoritative field is what
   * keeps a biology/materials PhD cross-tagged with "Computer Sciences" from
   * sneaking past the discipline gate.
   */
  private primaryDiscipline(html: string): string | null {
    const start = html.indexOf('"subject_areas":');
    if (start !== -1) {
      const open = html.indexOf('{', start);
      let depth = 0;
      let end = open;
      for (let i = open; i < html.length && i < open + 20_000; i++) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}' && --depth === 0) {
          end = i;
          break;
        }
      }
      try {
        const obj = JSON.parse(html.slice(open, end + 1));
        const cats = Object.values(obj) as any[];
        const primary =
          cats.find((c) => c && c.parent_category_id === 0) ?? cats[0];
        if (primary?.category_name) return String(primary.category_name).trim();
      } catch {
        /* fall through */
      }
    }
    const m = html.match(/"category_name":"([^"]+)"/);
    return m ? m[1].trim() : null;
  }

  private ldCountry(jp: any): string | null {
    const c = jp?.jobLocation?.address?.addressCountry;
    if (!c) return null;
    return typeof c === 'string' ? c : c.name || null;
  }

  // Academic ccTLD → country, so an Aarhus (.dk) / ETH (.ch) posting on this
  // UK-centric board isn't mislabelled "United Kingdom" (which would skew
  // timezone-aware sending). Returns the first host that maps to a country.
  private static readonly CCTLD: Record<string, string> = {
    uk: 'United Kingdom', ie: 'Ireland', dk: 'Denmark', de: 'Germany',
    nl: 'Netherlands', se: 'Sweden', no: 'Norway', fi: 'Finland',
    ch: 'Switzerland', fr: 'France', be: 'Belgium', at: 'Austria',
    it: 'Italy', es: 'Spain', pt: 'Portugal', pl: 'Poland', cz: 'Czechia',
  };

  private countryFromHosts(values: (string | null | undefined)[]): string | null {
    for (const v of values) {
      if (!v) continue;
      const host = (v.includes('@') ? v.split('@')[1] : v).toLowerCase();
      // Prefer the compound ".ac.uk"-style academic tld, else the bare tld.
      const acuk = host.match(/\.(ac|edu|gov)\.([a-z]{2})(?:$|[/:?])/);
      const bare = host.match(/\.([a-z]{2})(?:$|[/:?])/);
      const cc = (acuk && acuk[2]) || (bare && bare[1]);
      if (cc && JobsAcScraper.CCTLD[cc]) return JobsAcScraper.CCTLD[cc];
    }
    return null;
  }

  /** Read a top-level string field from the inline advert JSON in the HTML. */
  private inlineString(html: string, key: string): string | null {
    const m = html.match(new RegExp(`"${key}":"([^"]*)"`));
    if (!m || !m[1]) return null;
    return m[1].replace(/\\\//g, '/').trim() || null;
  }

  private extractEmails(html: string): string[] {
    const raw = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    return [
      ...new Set(
        raw
          .map((e) => e.toLowerCase())
          .filter(
            (e) =>
              !/jobs\.ac\.uk|\.png|\.jpg|\.jpeg|\.gif|sentry|example|w3\.org|civiccomputing|sharethis|googleadservices/.test(
                e,
              ),
          ),
      ),
    ];
  }

  /**
   * jobs.ac.uk descriptions usually say "contact Dr First Last via email
   * first.last@uni.ac.uk". Pair a titled name with the nearest matching email
   * so downstream gets a real greeting name; fall back to none (deriveName
   * then reconstructs a name from the email local-part).
   */
  private parseContacts(text: string, emails: string[]): ScrapedContact[] {
    if (!emails.length) return [];
    const out: ScrapedContact[] = [];
    const seen = new Set<string>();
    const re =
      /(?:Prof\.?|Professor|Dr\.?)\s+([A-ZÀ-Þ][a-zà-ÿ'’-]+(?:\s+[A-ZÀ-Þ][a-zà-ÿ'’.-]+){1,2})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const name = m[1].trim().replace(/\s+/g, ' ');
      const surname = name.split(' ').pop()!.toLowerCase().replace(/[^a-z]/g, '');
      // Prefer an email whose local-part contains the surname (e.g. m.t.esposito@).
      const email =
        emails.find((e) => surname.length > 2 && e.split('@')[0].includes(surname)) ??
        undefined;
      if (!email || seen.has(email)) continue;
      seen.add(email);
      out.push({ name, email });
    }
    return out;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
