import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { Op } from 'sequelize';
import { MatchingService } from '../matching/matching.service';
import { PersonalizationService } from '../personalization/personalization.service';
import { ProfessorStatus } from '../professors/professor-status.enum';
import { ProfessorsService } from '../professors/professors.service';
import { AcademicTransferScraper } from './academictransfer.scraper';
import { DiscoverySource } from './discovery-source.interface';
import { EuraxessScraper } from './euraxess.scraper';
import { JobsAcScraper } from './jobsac.scraper';
import { PlaywrightService } from './playwright.service';
import { SeenOffer } from './seen-offer.model';
import {
  DiscoveryRunResult,
  ScrapedContact,
  ScrapedListing,
} from './discovery.types';

// Emails that are clearly not a specific researcher/PI: HR/admin boxes and
// institutional role accounts (works councils, disability reps, deans' offices…).
const GENERIC_EMAIL =
  /^(hr|hrservices|jobs?|recruit\w*|info\w*|information|admin\w*|admission\w*|enquir\w*|inquir\w*|general|reception|office|career\w*|vacature|vacancy|application|apply|contact|secretariat|sekretariat|personnel|personal|noreply|no-reply|betriebsrat|behinderten\w*|works?council|dekanat|gradschool\w*|graduate|postgrad\w*|studien\w*|studierende|studies|verwaltung|webmaster|support|helpdesk|it-\w*)([._-]|@)/i;

// Role tokens that disqualify an email regardless of position in the local-part.
const ROLE_TOKEN = /(^|[._-])(br\d|works?council|betriebsrat|behinderten|dekanat)([._-]|@|$)/i;

// Generic (non-security) tags. A match on ONLY these — with no genuine security
// tag — is almost always an applied-AI PhD from another field: a posting that
// merely mentions "artificial intelligence"/"data" in passing (plant-chemistry
// "…using AI to decipher molecular signatures", a "Full Stack Software Engineer"
// role, mechanical+AI, CFD+AI). This is noise on EVERY source — jobs.ac.uk
// over-tags "Computer Sciences", and EURAXESS/university feeds surface the same
// pattern — so we require at least one real security tag to qualify, everywhere.
// (Trade-off accepted by the user: this also drops pure-ML CS PhDs that carry
// only generic tags, in exchange for maximum precision under auto-send.)
const GENERIC_TAGS = new Set<string>([
  'Machine learning / AI',
  'Data science / big data',
  'Software engineering (security/reliability)',
]);

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);
  private readonly sources: DiscoverySource[];

  constructor(
    private readonly euraxess: EuraxessScraper,
    private readonly academicTransfer: AcademicTransferScraper,
    private readonly jobsAc: JobsAcScraper,
    private readonly matching: MatchingService,
    private readonly professors: ProfessorsService,
    private readonly playwright: PlaywrightService,
    private readonly personalization: PersonalizationService,
    @InjectModel(SeenOffer) private readonly seenOffers: typeof SeenOffer,
  ) {
    // Position-centric job-board sources. (A Playwright university faculty
    // crawler was removed — it yielded no qualifying leads; PlaywrightService
    // remains available for future heavier scraping.)
    this.sources = [this.euraxess, this.academicTransfer, this.jobsAc];
  }

  /** Run ALL fast (job-board) sources: scrape → OR-match → upsert. */
  async runDiscovery(opts?: { maxPages?: number }): Promise<DiscoveryRunResult[]> {
    await this.pruneOldSeenOffers();
    const results: DiscoveryRunResult[] = [];
    for (const source of this.sources) {
      results.push(await this.runSource(source, opts));
    }
    return results;
  }

  /**
   * Trim the seen-offers table: delete records older than `days`. Postings are
   * almost never listed longer than ~2 months (deadlines pass, they're
   * delisted), so an old record will never re-appear in a listing — dropping it
   * keeps the table small and self-cleaning. If one somehow does re-appear, we
   * just re-fetch it once (harmless).
   */
  async pruneOldSeenOffers(days = 60): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const removed = await this.seenOffers.destroy({
      where: { createdAt: { [Op.lt]: cutoff } },
    });
    if (removed) this.logger.log(`Pruned ${removed} seen-offer record(s) older than ${days}d`);
    return removed;
  }

  /** Backwards-compatible single-source run (EURAXESS only). */
  runEuraxess(opts?: { maxPages?: number }): Promise<DiscoveryRunResult> {
    return this.runSource(this.euraxess, opts);
  }

  private async runSource(
    source: DiscoverySource,
    opts?: { maxPages?: number },
  ): Promise<DiscoveryRunResult> {
    const result: DiscoveryRunResult = {
      source: source.name,
      scanned: 0,
      matched: 0,
      created: 0,
      updated: 0,
      skippedNoMatch: 0,
      errors: 0,
    };

    // Offers already fetched + judged on previous runs — the scraper skips
    // re-fetching these, so we only pull genuinely new ones (keeps us under
    // EURAXESS's rate limit and avoids re-processing the whole listing daily).
    const knownUrls = await this.getSeenUrls(source.name);

    let listings: ScrapedListing[];
    try {
      listings = await source.scrape({ maxPages: opts?.maxPages, knownUrls });
    } catch (err) {
      result.errors++;
      this.logger.error(`${source.name} scrape failed: ${(err as Error).message}`);
      return result;
    }
    result.scanned = listings.length;

    for (const listing of listings) {
      try {
        await this.processListing(listing, result);
      } catch (err) {
        result.errors++;
        this.logger.warn(`Upsert failed for ${listing.url}: ${(err as Error).message}`);
      }
    }

    this.logger.log(
      `${source.name}: scanned=${result.scanned} matched=${result.matched} ` +
        `created=${result.created} updated=${result.updated} ` +
        `skipped=${result.skippedNoMatch} errors=${result.errors}`,
    );
    return result;
  }

  /** Match one listing and upsert it if it qualifies (shared by all sources). */
  private async processListing(
    listing: ScrapedListing,
    result: DiscoveryRunResult,
  ): Promise<void> {
    const match = this.matching.match({
      title: listing.title,
      researchField: listing.researchField ?? undefined,
      description: listing.description,
    });
    if (!match.qualifies) {
      result.skippedNoMatch++;
      await this.markSeen(listing.source, listing.url, false);
      return;
    }
    // Precision guard (ALL sources): a match on only generic ML/data/software
    // tags, with no genuine security tag, is almost always an applied-AI PhD
    // from another field. Require at least one real (non-generic) security tag.
    if (!match.tags.some((t) => !GENERIC_TAGS.has(t))) {
      result.skippedNoMatch++;
      await this.markSeen(listing.source, listing.url, false);
      return;
    }
    result.matched++;

    // Prefer a named PI contact; only then fall back to a bare picked email.
    const contact = this.pickContact(listing);
    let email = contact?.email ?? this.pickContactEmail(listing.emails);
    let recoveredName: string | undefined = contact?.name;

    // No email on the listing itself — it only offers an external "apply now"
    // link. Institution ATS/job pages frequently show a supervisor email even
    // when the board summary didn't, so follow it once before giving up: this
    // is the only way these ever become auto-emailable instead of sitting in
    // not_contacted forever waiting for a manual application.
    if (!email && listing.applyUrl) {
      const found = await this.extractContactFromApplyUrl(listing.applyUrl);
      email = found.email;
      recoveredName = recoveredName ?? found.name;
    }

    const professorName = recoveredName ?? this.deriveName(listing, email);
    const socialLinks = listing.applyUrl ? { apply: listing.applyUrl } : undefined;

    const { created } = await this.professors.upsert({
      professorName,
      university: listing.organisation || `Unknown (${listing.source})`,
      country: listing.country ?? undefined,
      email,
      matchedTags: match.tags,
      source: listing.source,
      sourceUrl: listing.url,
      matchReason: `${match.reason}. Position: "${listing.title}"`,
      applicationDeadline: listing.applicationDeadline ?? undefined,
      socialLinks,
    });
    created ? result.created++ : result.updated++;
    await this.markSeen(listing.source, listing.url, true);
  }

  /** URLs already fetched + judged for a source (so we don't re-fetch them). */
  private async getSeenUrls(source: string): Promise<Set<string>> {
    const rows = await this.seenOffers.findAll({
      where: { source },
      attributes: ['url'],
    });
    return new Set(rows.map((r) => r.url));
  }

  /** Record an offer URL as evaluated (idempotent), matched or not. */
  private async markSeen(source: string, url: string, matched: boolean): Promise<void> {
    if (!url) return;
    try {
      await this.seenOffers.upsert({ url, source, matched } as any);
    } catch (err) {
      // Non-fatal: a failure to record just means we may re-fetch it next time.
      this.logger.warn(`markSeen failed for ${url}: ${(err as Error).message}`);
    }
  }

  /**
   * Re-check already-stored EURAXESS rows against the (tightened) matching
   * rules by re-fetching their source offer. Dry-run by default: lists rows
   * that no longer qualify (off-domain) so the user can approve deletion.
   * Offers that 404 (expired) are left untouched — we can't re-judge them.
   */
  async revalidateStored(opts?: {
    deleteOffTopic?: boolean;
    delayMs?: number;
  }): Promise<{
    checked: number;
    offTopic: number;
    deleted: number;
    skippedGone: number;
    rows: { id: string; name: string; university: string; field: string | null; reason: string }[];
  }> {
    const delayMs = opts?.delayMs ?? 400;
    const all = await this.professors.findAll();
    const euraxess = all.filter((p) => p.source === 'euraxess' && p.sourceUrl);

    const rows: { id: string; name: string; university: string; field: string | null; reason: string }[] = [];
    let deleted = 0;
    let skippedGone = 0;

    for (const p of euraxess) {
      const idm = (p.sourceUrl || '').match(/\/jobs\/(\d+)/);
      if (!idm) continue;
      const offer = await this.euraxess.fetchOffer(idm[1]);
      await this.sleep(delayMs);
      if (!offer) {
        skippedGone++;
        continue;
      }
      const match = this.matching.match({
        title: offer.title,
        researchField: offer.researchField ?? undefined,
        description: offer.description,
      });
      if (!match.qualifies) {
        rows.push({
          id: p.id,
          name: p.professorName,
          university: p.university,
          field: offer.researchField,
          reason: match.excludedReason ?? match.reason,
        });
        if (opts?.deleteOffTopic) {
          await this.professors.remove(p.id);
          deleted++;
        }
      }
    }

    this.logger.log(
      `Revalidate: checked=${euraxess.length} offTopic=${rows.length} ` +
        `deleted=${deleted} skippedGone=${skippedGone}`,
    );
    return { checked: euraxess.length, offTopic: rows.length, deleted, skippedGone, rows };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Follow an external "apply now" link once to recover the supervisor's
   * contact (name + email) that the source listing didn't expose. Most
   * institution ATS/job pages are plain HTML (axios+cheerio is enough); a few
   * only render via JS, so a Playwright fallback covers those. When the page
   * exposes candidate emails, Claude picks the academic supervisor's — NOT a
   * generic HR/admissions/info box — and its name. Best-effort: any failure
   * leaves the professor email-less (filed for the form-apply path instead).
   */
  async extractContactFromApplyUrl(
    url: string,
  ): Promise<{ email?: string; name?: string }> {
    const harvest = (html: string): { emails: string[]; text: string } => {
      const $ = cheerio.load(html);
      $('script, style, noscript').remove();
      const mailto = $('a[href^="mailto:"]')
        .map((_, el) =>
          ($(el).attr('href') || '').replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase(),
        )
        .get()
        .filter(Boolean);
      const scraped = (html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])
        .map((e) => e.toLowerCase())
        .filter((e) => !/sentry|example|w3\.org|\.png|\.jpg|\.gif|\.svg|@\dx|@media/.test(e));
      const emails = [...new Set([...mailto, ...scraped])];
      const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 6000);
      return { emails, text };
    };

    let harvested: { emails: string[]; text: string } | undefined;
    try {
      const { data } = await axios.get<string>(url, {
        timeout: 15_000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; phd-outreach/1.0; academic PhD search)',
        },
        maxRedirects: 5,
      });
      harvested = harvest(data);
    } catch (err) {
      this.logger.warn(`applyUrl fetch (axios) failed for ${url}: ${(err as Error).message}`);
    }
    if (!harvested?.emails.length) {
      try {
        harvested = await this.playwright.withPage(url, async (page) =>
          harvest(await page.content()),
        );
      } catch (err) {
        this.logger.warn(`applyUrl fetch (playwright) failed for ${url}: ${(err as Error).message}`);
      }
    }
    if (!harvested?.emails.length) return {};

    return this.selectSupervisorContact(harvested.emails, harvested.text);
  }

  /**
   * Given candidate emails + surrounding page text, identify the academic
   * supervisor/PI to write to. Asks Claude to reject generic HR/admissions/info
   * boxes; falls back to the local heuristic if Claude is unavailable or unsure.
   */
  private async selectSupervisorContact(
    emails: string[],
    text: string,
  ): Promise<{ email?: string; name?: string }> {
    const prompt = `
From an academic job/apply page, pick the SUPERVISOR / principal investigator to
email. Choose the personal academic contact — NEVER a generic box (HR, admissions,
info, recruitment, "apply", secretariat, no-reply). If NO personal academic email
is present, return null for both fields.

Candidate emails: ${emails.join(', ')}

Page text (truncated):
${text}

Output ONLY JSON wrapped exactly between <contact> and </contact>, e.g.
<contact>{"name":"Jane Doe","email":"jane.doe@uni.edu"}</contact>
or <contact>{"name":null,"email":null}</contact>. Nothing outside the tags.`.trim();

    const isGeneric = (e: string) => GENERIC_EMAIL.test(e) || ROLE_TOKEN.test(e);
    try {
      const raw = await this.personalization.completeRaw(prompt);
      const m = raw.match(/<contact>([\s\S]*?)<\/contact>/i);
      const json = m ? m[1] : raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
      const parsed = JSON.parse(json) as { name?: string | null; email?: string | null };
      const email = parsed.email?.trim().toLowerCase();
      // Trust Claude only if it returned one of the actual candidates AND it's
      // not a generic box (final gate — never auto-email an info/HR/admissions
      // address; those go to the form-apply path instead).
      if (email && emails.includes(email) && !isGeneric(email)) {
        return { email, name: parsed.name?.trim() || undefined };
      }
    } catch (err) {
      this.logger.warn(`Supervisor extraction (claude) failed: ${(err as Error).message}`);
    }
    // Heuristic fallback: a personal-looking, non-generic address (or nothing).
    const fallback = this.pickContactEmail(emails);
    return fallback && !isGeneric(fallback) ? { email: fallback } : {};
  }

  /**
   * Backfill: for every no-email professor that still has an application link,
   * follow it and try to recover a supervisor email (Tier 1 of the apply flow).
   * Recovered rows get their email + name saved, which drops them straight into
   * the normal personalize→email pipeline. Rows where no email is found are
   * reported as needing the form-apply path (Tier 2). Read-only by default;
   * pass { apply: true } to persist the recovered contacts.
   */
  async recoverEmailsFromApplyLinks(opts: { apply?: boolean; delayMs?: number } = {}): Promise<{
    scanned: number;
    recovered: number;
    needsForm: number;
    rows: {
      id: string;
      university: string;
      applyUrl: string;
      recoveredEmail?: string;
      recoveredName?: string;
      outcome: 'recovered' | 'needs_form';
    }[];
  }> {
    const delayMs = opts.delayMs ?? 800;
    const all = await this.professors.findAll({ status: ProfessorStatus.NOT_CONTACTED });
    const targets = all.filter(
      (p) => !p.email && (p.socialLinks?.apply || p.sourceUrl),
    );

    const rows: {
      id: string;
      university: string;
      applyUrl: string;
      recoveredEmail?: string;
      recoveredName?: string;
      outcome: 'recovered' | 'needs_form';
    }[] = [];
    let recovered = 0;

    for (const p of targets) {
      const applyUrl = p.socialLinks?.apply || p.sourceUrl;
      const found = await this.extractContactFromApplyUrl(applyUrl);
      await this.sleep(delayMs);
      if (found.email) {
        recovered++;
        if (opts.apply) {
          const patch: Record<string, string> = { email: found.email };
          // Only upgrade a placeholder "Contact — <org>" name, never clobber a real one.
          if (found.name && /^contact\b/i.test(p.professorName)) {
            patch.professorName = found.name;
          }
          await this.professors.update(p.id, patch);
        }
        rows.push({
          id: p.id,
          university: p.university,
          applyUrl,
          recoveredEmail: found.email,
          recoveredName: found.name,
          outcome: 'recovered',
        });
      } else {
        rows.push({ id: p.id, university: p.university, applyUrl, outcome: 'needs_form' });
      }
    }

    this.logger.log(
      `Email recovery: scanned=${targets.length} recovered=${recovered} ` +
        `needsForm=${targets.length - recovered} (apply=${!!opts.apply})`,
    );
    return {
      scanned: targets.length,
      recovered,
      needsForm: targets.length - recovered,
      rows,
    };
  }

  /**
   * Prefer a named PI/supervisor contact whose email is not a generic HR/role
   * box. This gives us a real greeting name (fixes the EURAXESS PI-name gap).
   */
  private pickContact(listing: ScrapedListing): ScrapedContact | undefined {
    const isGeneric = (e: string) => GENERIC_EMAIL.test(e) || ROLE_TOKEN.test(e);
    return (
      listing.contacts.find((c) => !isGeneric(c.email)) ?? listing.contacts[0]
    );
  }

  /** Prefer a personal-looking (PI) email over generic HR/role addresses. */
  private pickContactEmail(emails: string[]): string | undefined {
    if (!emails.length) return undefined;
    const isGeneric = (e: string) => GENERIC_EMAIL.test(e) || ROLE_TOKEN.test(e);
    // Personal address whose local-part looks like a name (has a dot).
    const named = emails.find((e) => !isGeneric(e) && /\./.test(e.split('@')[0]));
    const personal = emails.find((e) => !isGeneric(e));
    const nonRole = emails.find((e) => !ROLE_TOKEN.test(e));
    return named ?? personal ?? nonRole;
  }

  /**
   * EURAXESS is position-centric and rarely names the PI cleanly, so derive a
   * readable identity from the contact email local-part; fall back to the org.
   */
  private deriveName(listing: ScrapedListing, email?: string): string {
    if (email && !GENERIC_EMAIL.test(email)) {
      const local = email.split('@')[0];
      const pretty = local
        .split(/[._-]+/)
        .filter(Boolean)
        .map((p) => (p.length <= 3 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
        .join(' ');
      if (pretty) return pretty;
    }
    return `Contact — ${listing.organisation || 'position'}`;
  }
}
