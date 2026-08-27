import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { BrowserContext, Frame, Page } from 'playwright';
import { FormAnalyzer } from '../../apply/form-analyzer';
import { FillPlanItem, FormField } from '../../apply/apply.types';
import { adapterFor } from './ats-adapters';
import { PlaywrightService } from '../../discovery/playwright.service';
import { GmailService } from '../../gmail/gmail.service';
import { PersonalizationService } from '../../personalization/personalization.service';
import { CoverLetterService } from '../documents/cover-letter.service';
import { JobPrepareService } from '../documents/job-prepare.service';
import { JobsService } from '../jobs.service';
import { JOB_APPLICANT, JOB_OWNER_PROFILE, JOB_SCREENING, jobSalaryExpectation } from '../job-profile';
import { JobApplication } from '../job-application.model';
import { JobListing } from '../job-listing.model';
import { JobApplicationStatus, JobListingStatus } from '../job-status.enum';

interface JobApplySession {
  id: string;
  listingId: string;
  applicationId: string;
  title: string;
  company: string;
  applyUrl: string;
  context: BrowserContext;
  page: Page;
  /** The Page or iframe the form actually lives in (where we fill + submit). */
  root: Page | Frame;
  screenshotPath: string;
  filled: string[];
  skipped: string[];
}

/** Deterministic identity/contact field rules (label/name → value). */
const TEXT_RULES: { test: RegExp; value: () => string }[] = [
  { test: /first\s*name|given\s*name|forename/i, value: () => JOB_APPLICANT.firstName },
  { test: /last\s*name|surname|family\s*name/i, value: () => JOB_APPLICANT.lastName },
  { test: /full\s*name|^name$|your\s*name|applicant\s*name/i, value: () => JOB_APPLICANT.fullName },
  { test: /e-?mail/i, value: () => JOB_APPLICANT.email },
  { test: /phone|mobile|tel(ephone)?|contact\s*number/i, value: () => JOB_APPLICANT.phone },
  { test: /linkedin/i, value: () => JOB_APPLICANT.linkedin },
  { test: /city|town/i, value: () => JOB_APPLICANT.city },
  { test: /nationality|citizenship/i, value: () => JOB_APPLICANT.nationality },
  { test: /country|location|residence|address/i, value: () => JOB_APPLICANT.currentLocation },
  { test: /github|portfolio/i, value: () => `https://${JOB_APPLICANT.github}` },
  { test: /notice period/i, value: () => JOB_APPLICANT.noticePeriod },
  { test: /earliest start|start date|when can you (start|join)|availab/i, value: () => JOB_APPLICANT.earliestStart },
  { test: /years? of experience|experience/i, value: () => JOB_APPLICANT.yearsExperience },
];

/** Salary fields are handled separately (country-aware), so exclude here. */
const SALARY_RE = /salary|compensation|expected pay|desired (salary|pay)|remuneration|gehalt/i;

/**
 * Assisted-apply for jobs (human-in-the-loop). Opens the application form,
 * fills identity/contact fields, uploads the tailored CV (+ cover letter),
 * answers open questions via Claude, screenshots, and HOLDS the browser open
 * for review — never auto-submits. Mirrors ApplyService on the professor side.
 */
@Injectable()
export class JobApplyService {
  private readonly logger = new Logger(JobApplyService.name);
  private readonly sessions = new Map<string, JobApplySession>();
  private readonly outDir: string;
  private readonly headful: boolean;
  private readonly saveShots: boolean;
  private readonly loginEmail: string;
  private readonly loginPassword: string;

  constructor(
    private readonly jobs: JobsService,
    private readonly prepare: JobPrepareService,
    private readonly coverLetter: CoverLetterService,
    private readonly playwright: PlaywrightService,
    private readonly analyzer: FormAnalyzer,
    private readonly personalization: PersonalizationService,
    private readonly gmail: GmailService,
    private readonly config: ConfigService,
  ) {
    this.outDir = join(this.config.get<string>('APPLY_DIR') ?? './applications', 'job-sessions');
    this.headful = !/^false$/i.test(this.config.get<string>('APPLY_HEADFUL') ?? 'true');
    // Screenshots are OFF by default — in hands-off mode nobody reviews them and
    // they pile up fast. Set APPLY_SAVE_SCREENSHOTS=true to keep them for debugging.
    this.saveShots = /^true$/i.test(this.config.get<string>('APPLY_SAVE_SCREENSHOTS') ?? 'false');
    this.loginEmail =
      this.config.get<string>('APPLICANT_EMAIL') ?? JOB_APPLICANT.email;
    this.loginPassword = this.config.get<string>('APPLICANT_PASSWORD') ?? '';
  }

  /**
   * Take a full-page screenshot only when screenshots are enabled, creating the
   * output dir lazily so nothing is written (and no folder recreated) when off.
   * Returns the saved path, or '' when disabled/failed.
   */
  private async snap(target: Page, name: string): Promise<string> {
    if (!this.saveShots) return '';
    if (!existsSync(this.outDir)) mkdirSync(this.outDir, { recursive: true });
    const p = join(this.outDir, name);
    await target.screenshot({ path: p, fullPage: true }).catch(() => undefined);
    return p;
  }

  /** Fill the form for a listing and hold it open for review. Does NOT submit. */
  async start(listingId: string): Promise<any> {
    const listing = await this.jobs.findOne(listingId);
    const applyUrl = listing.applyUrl || listing.url;

    // Ensure documents exist (prepare on the fly if this lead was never prepped).
    let application = await this.jobs.findApplicationForListing(listingId);
    if (!application || !application.cvPath) {
      application = await this.prepare.prepareOne(listing);
    }

    // Bot-walled boards (IrishJobs = Akamai) reset a COLD request straight to a
    // protected job/apply URL. Warming the session on the homepage + a listing
    // page first gets the sensor to validate us, and the target then loads.
    const warmup = this.warmupFor(applyUrl);

    let session: { context: BrowserContext; page: Page };
    try {
      session = await this.playwright.openSession(applyUrl, { headful: this.headful, warmup });
    } catch (err) {
      // The page never loaded — almost always a bot wall (Akamai/DataDome/
      // Cloudflare) resetting or stalling the request from an automated/
      // datacenter context. Report it honestly instead of a raw 500.
      const reason = `Could not load ${applyUrl}: ${(err as Error).message}. ` +
        `The site is likely blocking automated access (bot manager). ` +
        `Set JOB_BROWSER_PROFILE and sign in once by hand so the session is reused.`;
      await this.jobs.updateApplication(application.id, {
        status: JobApplicationStatus.FAILED,
        error: reason,
      } as Partial<JobApplication>);
      return { status: 'needs_manual', listingId, applyUrl, message: reason };
    }
    const { context, page } = session;
    try {
      // Board pages are descriptions fronted by a cookie banner, with the real
      // form one "Apply" click deeper (often on an external ATS). Clear the
      // banner, hop to the form, then analyse — same as the professor side.
      await this.dismissCookieBanner(page);

      // Some boards disable "Apply" for logged-out / geo-ineligible / closed
      // postings (IrishJobs renders `ineligible-apply-button` → "Unavailable").
      // Detect that up front and report it honestly — no form exists to fill.
      const ineligible = await page
        .locator('[data-testid="ineligible-apply-button"], [data-at="ineligible-apply-button"]')
        .count()
        .catch(() => 0);
      if (ineligible > 0) {
        const shot = await this.snap(page, `${randomUUID()}.png`);
        const reason =
          'The board shows Apply as "Unavailable" for this session — usually a logged-out session ' +
          'or a posting that has stopped accepting applications. Warm a logged-in profile ' +
          '(scripts/warm-irishjobs-profile.js) so the Apply button is active, then retry.';
        await context.close().catch(() => undefined);
        await this.jobs.updateApplication(application.id, {
          status: JobApplicationStatus.FAILED,
          screenshotPath: shot,
          error: reason,
        } as Partial<JobApplication>);
        return { status: 'needs_manual', listingId, applyUrl, landedUrl: page.url(), screenshotPath: shot, message: reason };
      }

      const formPage = await this.navigateToForm(page);

      // Draft-first ATS guard (e.g. JOIN.com). These create a half-finished
      // application and email the applicant "complete your application" the moment
      // Submit is clicked, because a hidden required question always blocks the
      // final submit — spamming the inbox with drafts we never complete. Bail out
      // BEFORE filling anything (no email entered → no draft → no email). The
      // autonomous processor parks this as SKIPPED.
      if (this.isSkippedAts(formPage.url())) {
        const reason =
          'Skipped JOIN.com (draft-first ATS): it emails "complete your application" the instant ' +
          'Submit is clicked but a hidden required question blocks the real submit — so it only ' +
          'creates inbox spam, never a real application. Parked before entering any data.';
        await context.close().catch(() => undefined);
        await this.jobs.updateApplication(application.id, {
          status: JobApplicationStatus.FAILED,
          error: reason,
        } as Partial<JobApplication>);
        this.logger.log(`Skipped draft-first ATS for "${listing.title}" @ ${listing.company}: ${formPage.url()}`);
        return { status: 'needs_manual', listingId, applyUrl, landedUrl: formPage.url(), message: reason };
      }

      // Frame-aware: search the top page AND any iframes for the richest form.
      const { analysis, root } = await this.analyzer.analyzeBest(formPage);

      // Refuse to fill anything that isn't a genuine application form — this is
      // what stops us typing into a newsletter/"jobs by email" box when the real
      // ATS wasn't reached. But a CAPTCHA is NOT a blocker here: in assisted mode
      // YOU review and submit, so you solve any CAPTCHA yourself — and nearly
      // every modern ATS embeds a background reCAPTCHA. So we still fill, and only
      // hand off for a login/account wall or a genuinely absent form.
      const isForm =
        analysis.fields.some((f) => f.type === 'file') ||
        analysis.fields.filter((f) => f.type !== 'hidden').length >= 4;
      const blocking = analysis.hardBlockers.filter((b) => !/captcha/i.test(b));
      const hasCaptcha = analysis.hardBlockers.some((b) => /captcha/i.test(b));
      if (blocking.length || !isForm) {
        const shot = await this.snap(formPage, `${randomUUID()}.png`);
        const reason = blocking.length
          ? blocking.join('; ')
          : 'No real application form reached (likely an external ATS behind an "Apply" redirect).';
        await context.close().catch(() => undefined);
        await this.jobs.updateApplication(application.id, {
          status: JobApplicationStatus.FAILED,
          screenshotPath: shot,
          error: reason,
        } as Partial<JobApplication>);
        return {
          status: 'needs_manual',
          listingId,
          applyUrl,
          landedUrl: formPage.url(),
          hardBlockers: analysis.hardBlockers,
          screenshotPath: shot,
          message: `Could not reach a fillable form automatically (${reason}). Open ${formPage.url()} and finish it yourself; the tailored CV is at ${application.cvPath}.`,
        };
      }

      const plan = await this.planFill(analysis.fields, listing, application);
      const { filled, skipped } = await this.execute(root, plan, application);

      const sessionId = randomUUID();
      const screenshotPath = await this.snap(formPage, `${sessionId}.png`);

      this.sessions.set(sessionId, {
        id: sessionId,
        listingId,
        applicationId: application.id,
        title: listing.title,
        company: listing.company,
        applyUrl,
        context,
        page: formPage,
        root,
        screenshotPath,
        filled: filled.map((f) => f.label),
        skipped: skipped.map((f) => f.label),
      });

      await this.jobs.updateApplication(application.id, {
        status: JobApplicationStatus.PENDING_REVIEW,
        screenshotPath,
      } as Partial<JobApplication>);

      this.logger.log(`Job apply session ${sessionId} ready: ${filled.length} filled (${listing.title})`);
      const warnings = [...analysis.warnings];
      if (hasCaptcha) warnings.push('CAPTCHA present — solve it yourself when you review & submit.');
      return {
        sessionId,
        status: 'pending_review',
        listingId,
        applyUrl,
        filled: filled.map((f) => ({ label: f.label, value: f.value })),
        skipped: skipped.map((f) => ({ label: f.label, reason: f.reason })),
        warnings,
        screenshotPath,
        message:
          `Form filled and awaiting review${hasCaptcha ? ' (CAPTCHA on the form — you solve it at submit)' : ''}. ` +
          `Check the browser or ${screenshotPath}, then POST /jobs/apply/session/${sessionId}/submit or /cancel.`,
      };
    } catch (err) {
      await context.close().catch(() => undefined);
      throw err;
    }
  }

  /**
   * Approve + submit. Ticks any REQUIRED consent boxes (the submit endpoint is
   * the human's approval), clicks submit, then VERIFIES the form actually
   * advanced before marking APPLIED — so we never record a false success. If it
   * cannot confirm submission, it leaves the browser open and reports honestly.
   */
  async submit(sessionId: string): Promise<any> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new NotFoundException(`No open job apply session ${sessionId}.`);

    const ticked = await this.tickConsents(s.root);
    const clicked = await this.clickSubmit(s.root);
    if (!clicked) {
      return {
        sessionId,
        ok: false,
        submitted: false,
        message: 'No submit button found. Submit manually in the open browser, then mark it applied.',
      };
    }
    await s.page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
    await s.page.waitForTimeout(1800);
    const resultShot = await this.snap(s.page, `${sessionId}-result.png`);

    const confirmed = await this.verifySubmitted(s);
    if (!confirmed) {
      // Do NOT mark applied on an unconfirmed submit. Keep the session open so
      // the user can finish it by hand or we can retry.
      await this.jobs.updateApplication(s.applicationId, {
        screenshotPath: resultShot,
        error: 'Clicked submit but no confirmation detected — a required field/consent may still be blocking.',
      } as Partial<JobApplication>);
      this.logger.warn(`Submit not confirmed for ${s.title} @ ${s.company} (ticked ${ticked} consent box(es)).`);
      return {
        sessionId,
        ok: false,
        submitted: false,
        resultScreenshotPath: resultShot,
        message:
          'Clicked submit but could NOT confirm the form advanced (a required field/consent may still be blocking). ' +
          'The browser is still open — check it, then retry submit or finish manually.',
      };
    }

    await this.jobs.updateApplication(s.applicationId, {
      status: JobApplicationStatus.SUBMITTED,
      submittedAt: new Date(),
      screenshotPath: resultShot,
    } as Partial<JobApplication>);
    await this.jobs.setStatus(s.listingId, JobListingStatus.APPLIED);
    // Append to the clean "jobs I actually applied to" log (idempotent per listing).
    await this.jobs
      .recordApplied({
        jobListingId: s.listingId,
        applicationId: s.applicationId,
        screenshotPath: resultShot,
      })
      .catch((err) =>
        this.logger.warn(`Applied-log write failed for ${s.title}: ${(err as Error).message}`),
      );
    this.cleanup(sessionId);

    this.logger.log(`Submitted + confirmed job application for ${s.title} @ ${s.company}`);
    return { sessionId, ok: true, submitted: true, resultScreenshotPath: resultShot };
  }

  /**
   * Tick REQUIRED consent/terms/privacy checkboxes. Consent boxes are usually
   * visually-hidden custom inputs, so we do NOT gate on visibility: we
   * force-check the input and, if that doesn't take, click its label. Returns
   * how many we confirmed as checked.
   */
  private async tickConsents(root: Page | Frame): Promise<number> {
    let ticked = 0;
    const boxes = root.locator('input[type="checkbox"]');
    const n = await boxes.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const box = boxes.nth(i);
      const info = await box
        .evaluate((el) => {
          const id = el.getAttribute('id') || '';
          let label = '';
          if (id) {
            const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
            if (l?.textContent) label = l.textContent;
          }
          if (!label) {
            const wrap = (el as HTMLElement).closest('label');
            label = wrap?.textContent || el.parentElement?.textContent || '';
          }
          return { id, label };
        })
        .catch(() => ({ id: '', label: '' }));
      if (!/agree|terms|consent|privacy|gdpr|confirm|declaration|datenschutz|einverstanden/i.test(info.label)) {
        continue;
      }
      const checked = () => box.isChecked().catch(() => false);
      if (await checked()) {
        ticked++;
        continue;
      }
      // Custom consent widgets resist .check(); try force-check, then a forced
      // click on the input, then clicking its <label>.
      await box.check({ force: true, timeout: 4000 }).catch(() => undefined);
      if (!(await checked())) await box.click({ force: true, timeout: 4000 }).catch(() => undefined);
      if (!(await checked()) && info.id) {
        await root.locator(`label[for="${info.id}"]`).click({ timeout: 4000 }).catch(() => undefined);
      }
      if (await checked()) ticked++;
    }
    return ticked;
  }

  /**
   * Confirm the submission REALLY went through. Conservative on purpose — the
   * priority is never recording a false "applied":
   *   • any validation-error text  → definitely NOT submitted
   *   • an explicit success message → submitted
   *   • otherwise                   → treated as unconfirmed (NOT submitted)
   */
  private async verifySubmitted(s: JobApplySession): Promise<boolean> {
    // Read text from the top page AND every iframe — the form, its validation
    // errors, and any success message usually live inside the ATS iframe, not
    // the top document.
    const roots: (Page | Frame)[] = [s.page, ...s.page.frames()];
    const texts = await Promise.all(
      roots.map((r) => r.evaluate(() => document.body?.innerText || '').catch(() => '')),
    );
    const body = texts.join('\n');
    const error =
      /must be accepted|must accept|is required|required field|this field is required|please (accept|complete|fill|enter)|bitte.*(akzeptieren|ausfüllen|angeben)|erforderlich|invalid/i.test(
        body,
      );
    if (error) return false;
    const success =
      /thank you|thanks for applying|application (has been |was )?(received|submitted|sent|complete)|sent successfully|submitted successfully|successfully (applied|submitted|sent)|we'?ll be in touch|received your application|good luck!|bewerbung.*(erhalten|gesendet|erfolgreich)|erfolgreich (gesendet|übermittelt|beworben)/i.test(
        body,
      );
    return success;
  }

  async cancel(sessionId: string): Promise<{ ok: boolean; message: string }> {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, message: `No open job apply session ${sessionId}.` };
    await this.jobs.updateApplication(s.applicationId, {
      status: JobApplicationStatus.CANCELLED,
    } as Partial<JobApplication>);
    this.cleanup(sessionId);
    return { ok: true, message: `Session ${sessionId} cancelled and browser closed.` };
  }

  getSession(sessionId: string): JobApplySession {
    const s = this.sessions.get(sessionId);
    if (!s) throw new NotFoundException(`No open job apply session ${sessionId}.`);
    return s;
  }

  // ---- fill planning ---------------------------------------------------

  private async planFill(
    fields: FormField[],
    listing: JobListing,
    application: JobApplication,
  ): Promise<FillPlanItem[]> {
    const items: FillPlanItem[] = [];
    const proseFields: FormField[] = [];

    const noiseRe = /newsletter|subscribe|jobs? by email|job alert|search|promo|coupon|discount/i;
    // Track whether the CV has been placed yet, so a generically-labelled file
    // input ("Attach", "Upload", empty) gets the CV — but only the FIRST one, so
    // we never dump the CV into every slot.
    let cvAssigned = false;
    for (const f of fields) {
      const fieldText = `${f.label} ${f.name}`;
      if (noiseRe.test(fieldText)) {
        items.push({ ref: f.ref, label: f.label, action: 'skip', reason: 'newsletter/search field — not part of the application' });
        continue;
      }
      // Choice fields (checkbox / radio): answer the standard screening +
      // consent questions from Umer's stated profile so clean forms can submit;
      // anything we don't recognize is left unchecked for safety.
      if (f.type === 'checkbox' || f.type === 'radio') {
        const decided = this.screeningForChoice(f);
        items.push(
          decided
            ? { ref: f.ref, label: f.label, action: 'check', reason: decided }
            : { ref: f.ref, label: f.label, action: 'skip', reason: 'option — leave for human' },
        );
        continue;
      }
      // <select> dropdowns: pick the screening answer, or map an identity option
      // (country / nationality) by text; else leave for a human.
      if (f.tag === 'select') {
        const chosen = this.screeningForSelect(f);
        if (chosen) {
          items.push({ ref: f.ref, label: f.label, action: 'select', value: chosen.value, reason: chosen.reason });
          continue;
        }
        const rule = TEXT_RULES.find((r) => r.test.test(f.label) || r.test.test(f.name));
        const mapped = rule?.value() ? this.pickOptionByText(f.options, rule.value()) : undefined;
        items.push(
          mapped
            ? { ref: f.ref, label: f.label, action: 'select', value: mapped, reason: 'mapped from profile' }
            : { ref: f.ref, label: f.label, action: 'skip', reason: 'dropdown — leave for human' },
        );
        continue;
      }
      if (f.type === 'file') {
        const label = `${f.label} ${f.name}`.toLowerCase().trim();
        if (/cover|motivation|covering letter|anschreiben/.test(label)) {
          // Cover-letter slot: use the prepared one, or generate it now.
          let cl = application.coverLetterPath;
          if (!cl) {
            try {
              cl = (await this.coverLetter.generate(listing)).path;
              await this.jobs.updateApplication(application.id, { coverLetterPath: cl } as Partial<JobApplication>);
            } catch (err) {
              this.logger.warn(`Cover letter generation failed: ${(err as Error).message}`);
            }
          }
          items.push(
            cl
              ? { ref: f.ref, label: f.label, action: 'upload', value: cl, reason: 'tailored cover letter' }
              : { ref: f.ref, label: f.label, action: 'skip', reason: 'no cover letter available' },
          );
        } else if (
          /cv|resume|résumé|curriculum|lebenslauf/.test(label) ||
          (!cvAssigned && (label === '' || /attach|upload|choose file|document|drag|drop|file/.test(label)))
        ) {
          // CV/resume field, an unlabeled dropzone, or the first generic
          // "Attach"/"Upload" file input — all almost always the CV slot.
          items.push({ ref: f.ref, label: f.label, action: 'upload', value: application.cvPath, reason: 'tailored CV' });
          cvAssigned = true;
        } else {
          // Portfolio / work sample / certificate / photo — don't dump the CV here.
          items.push({ ref: f.ref, label: f.label, action: 'skip', reason: 'non-CV document — leave for human' });
        }
        continue;
      }
      // Salary is country-aware (UAE range vs. "negotiable" elsewhere).
      if (SALARY_RE.test(fieldText)) {
        items.push({
          ref: f.ref,
          label: f.label,
          action: 'fill',
          value: jobSalaryExpectation(listing.country ?? null),
          reason: 'country-aware salary',
        });
        continue;
      }
      const rule = TEXT_RULES.find((r) => r.test.test(f.label) || r.test.test(f.name));
      if (rule?.value()) {
        items.push({ ref: f.ref, label: f.label, action: 'fill', value: rule.value(), reason: 'mapped from profile' });
        continue;
      }
      if (f.tag === 'textarea' || this.looksLikeQuestion(f.label)) {
        proseFields.push(f);
        continue;
      }
      items.push({ ref: f.ref, label: f.label, action: 'skip', reason: 'unrecognized — leave for human' });
    }

    if (proseFields.length) {
      const answers = await this.answerProse(proseFields, listing);
      for (const f of proseFields) {
        const a = answers[f.ref];
        items.push(
          a
            ? { ref: f.ref, label: f.label, action: 'fill', value: a, reason: 'claude-written answer' }
            : { ref: f.ref, label: f.label, action: 'skip', reason: 'no answer generated' },
        );
      }
    }
    return items;
  }

  /**
   * Classify a screening question from its label/name and return the answer
   * Umer wants, or null if it isn't one we recognize. Order matters: the
   * "without sponsorship" phrasing must beat the generic "sponsor" rule.
   */
  private detectScreening(text: string): 'yes' | 'no' | 'male' | 'decline' | null {
    const t = text.toLowerCase();
    // "Can you work WITHOUT sponsorship?" → No (Umer needs sponsorship).
    if (/without (visa )?sponsorship|not require sponsorship|no sponsorship|work without/.test(t)) {
      return JOB_SCREENING.requiresSponsorship ? 'no' : 'yes';
    }
    if (/sponsor/.test(t)) return JOB_SCREENING.requiresSponsorship ? 'yes' : 'no';
    if (/authori[sz]ed to work|eligible to work|right to work|permission to work|legally.*(work|authori)|work (permit|authori)/.test(t)) {
      return JOB_SCREENING.authorizedToWork ? 'yes' : 'no';
    }
    if (/relocat|willing to move|open to (a )?move/.test(t)) {
      return JOB_SCREENING.willingToRelocate ? 'yes' : 'no';
    }
    if (/\bgender\b|\bsex\b/.test(t)) return 'male';
    if (/race|ethnic|hispanic|latino|veteran|disabilit|self-?identif/.test(t)) return 'decline';
    return null;
  }

  /** Does an option's visible text represent the desired answer token? */
  private optionMatches(text: string, want: 'yes' | 'no' | 'male' | 'decline'): boolean {
    const t = text.trim().toLowerCase();
    if (!t) return false;
    if (want === 'yes') return /^y(es)?\b/.test(t) || t === 'true';
    if (want === 'no') return /^no?\b/.test(t) || t === 'false';
    if (want === 'male') return /\bmale\b/.test(t) && !/female/.test(t);
    return /decline|prefer not|do(n'?| no)t wish|not to (say|answer|identif)|choose not|rather not/.test(t);
  }

  /**
   * Decide whether to CHECK a checkbox/radio. Consent/terms boxes are agreed;
   * a screening radio is checked only when its own option is the answer Umer
   * wants (the other options in the group return null → left unchecked).
   */
  private screeningForChoice(f: FormField): string | null {
    const text = `${f.label} ${f.name}`;
    if (
      f.type === 'checkbox' &&
      /agree|terms|consent|privacy|gdpr|data protection|policy|declaration|i confirm|i understand|process my/i.test(text)
    ) {
      return 'consent/terms — agreed';
    }
    const want = this.detectScreening(text);
    if (!want) return null;
    // A standalone checkbox asserting a statement (e.g. "I require sponsorship"):
    // check it when the answer is affirmative.
    if (f.type === 'checkbox') return want === 'yes' ? `screening: ${want}` : null;
    // Radio: check only the option matching the desired answer.
    return this.optionMatches(f.label, want) ? `screening: ${want}` : null;
  }

  /** Pick the <select> option value for a screening question, if recognized. */
  private screeningForSelect(f: FormField): { value: string; reason: string } | null {
    const want = this.detectScreening(`${f.label} ${f.name}`);
    if (!want || !f.options?.length) return null;
    const opt = f.options.find((o) => this.optionMatches(o.text, want));
    return opt ? { value: opt.value, reason: `screening: ${want}` } : null;
  }

  /** Pick the option whose visible text best matches a target string. */
  private pickOptionByText(
    options: { value: string; text: string }[] | undefined,
    target: string,
  ): string | undefined {
    if (!options?.length || !target) return undefined;
    const t = target.trim().toLowerCase();
    const exact = options.find((o) => o.text.trim().toLowerCase() === t);
    if (exact) return exact.value;
    const partial = options.find(
      (o) => o.text.toLowerCase().includes(t) || t.includes(o.text.trim().toLowerCase()),
    );
    return partial?.value;
  }

  private looksLikeQuestion(label: string): boolean {
    return /why|describe|explain|motivat|cover|experience|tell us|about you|salary|notice period|available/i.test(label);
  }

  private async answerProse(
    fields: FormField[],
    listing: { title: string; company: string; matchedSkills: string[]; description: string },
  ): Promise<Record<string, string>> {
    const questions = fields
      .map((f) => `- ref "${f.ref}": ${f.label || f.name}${f.required ? ' (required)' : ''}`)
      .join('\n');
    const prompt = `
You are helping a software engineer fill a job application form. For EACH
question, write a concise, professional, first-person answer grounded ONLY in
the applicant's real background — never invent facts or numbers. Short inputs get
1-2 sentences; a motivation/why textarea gets one tight paragraph (~110 words).

JOB: ${listing.title} @ ${listing.company}. Relevant skills: ${(listing.matchedSkills || []).join(', ') || 'general software engineering'}.
APPLICANT:
${JOB_OWNER_PROFILE}

FORM QUESTIONS:
${questions}

Output ONLY a JSON object mapping each ref to its answer, wrapped exactly between
<answers> and </answers>.`.trim();

    try {
      const raw = await this.personalization.completeRaw(prompt);
      const tagged = raw.match(/<answers>([\s\S]*?)<\/answers>/i);
      const json = tagged ? tagged[1] : raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
      return JSON.parse(json) as Record<string, string>;
    } catch (err) {
      this.logger.warn(`Prose answer generation failed: ${(err as Error).message}`);
      return {};
    }
  }

  private async execute(
    root: Page | Frame,
    plan: FillPlanItem[],
    _application: JobApplication,
  ): Promise<{ filled: FillPlanItem[]; skipped: FillPlanItem[] }> {
    const filled: FillPlanItem[] = [];
    const skipped: FillPlanItem[] = [];
    for (const item of plan) {
      if (item.action === 'skip') {
        skipped.push(item);
        continue;
      }
      const selector = `[data-apply-ref="${item.ref}"]`;
      try {
        if (item.action === 'fill') await root.fill(selector, item.value ?? '');
        else if (item.action === 'select') await root.selectOption(selector, item.value ?? '');
        else if (item.action === 'check') await root.check(selector, { force: true });
        else if (item.action === 'upload') {
          if (!item.value || !existsSync(item.value)) {
            skipped.push({ ...item, reason: `document not found: ${item.value}` });
            continue;
          }
          await root.setInputFiles(selector, item.value);
        }
        filled.push(item);
      } catch (err) {
        skipped.push({ ...item, reason: (err as Error).message });
      }
    }
    return { filled, skipped };
  }

  private async clickSubmit(root: Page | Frame): Promise<boolean> {
    const candidates = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Submit")',
      'button:has-text("Apply")',
      'button:has-text("Send application")',
      'button:has-text("Send")',
    ];
    for (const sel of candidates) {
      const el = root.locator(sel).first();
      if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) {
        await el.click({ timeout: 10_000 }).catch(() => undefined);
        return true;
      }
    }
    return false;
  }

  private cleanup(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.context.close().catch(() => undefined);
    this.sessions.delete(sessionId);
  }

  /** Dismiss a cookie-consent banner/modal if present (prefers "Accept all"). */
  private async dismissCookieBanner(page: Page): Promise<void> {
    // Common one-click handlers (OneTrust etc.) first.
    for (const sel of ['#onetrust-accept-btn-handler', '[data-testid="uc-accept-all-button"]', '#didomi-notice-agree-button']) {
      const el = page.locator(sel).first();
      if ((await el.count().catch(() => 0)) > 0 && (await el.isVisible().catch(() => false))) {
        await el.click({ timeout: 3000 }).catch(() => undefined);
        await page.waitForTimeout(500);
        return;
      }
    }
    const labels = [
      /accept all/i, /allow all/i, /accept all cookies/i, /accept cookies/i,
      /i agree/i, /^agree$/i, /^accept$/i, /got it/i, /^ok$/i, /^allow$/i,
      /reject all/i, /^decline all$/i, /only necessary/i, /just necessary/i,
    ];
    for (const re of labels) {
      try {
        const btn = page.getByRole('button', { name: re }).first();
        if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
          await btn.click({ timeout: 3000 }).catch(() => undefined);
          await page.waitForTimeout(600);
          return;
        }
      } catch {
        /* try next label */
      }
    }
  }

  /**
   * Walk from a board/description page to the real application form, which on
   * aggregators (Arbeitnow/RemoteOK) lives on an external ATS that is itself
   * often multi-step (e.g. Recruitee: description → "Apply" → form). Iterates up
   * to 3 hops: each hop, if it isn't already a form, follow the best "Apply"
   * control (prefer an <a href> → navigate directly; else click a button/new
   * tab), wait for it to settle, and re-check.
   */
  /**
   * Same-origin URLs to visit BEFORE a bot-walled target so its sensor JS runs
   * and validates the session. Empty for sites without a known wall.
   */
  private warmupFor(url: string): string[] {
    if (/irishjobs\.ie/i.test(url)) {
      return ['https://www.irishjobs.ie/', 'https://www.irishjobs.ie/jobs/software-developer'];
    }
    return [];
  }

  /**
   * ATS hosts we deliberately never auto-apply to because they create a
   * half-finished draft + "complete your application" email on Submit-click
   * (a hidden required question always blocks the real submit). Env-extendable
   * via SKIP_ATS_HOSTS (comma-separated substrings).
   */
  private isSkippedAts(url: string): boolean {
    const extra = (this.config.get<string>('SKIP_ATS_HOSTS') ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const hosts = ['join.com', ...extra];
    const u = url.toLowerCase();
    return hosts.some((h) => u.includes(h));
  }

  private async navigateToForm(page: Page): Promise<Page> {
    let current = page;
    await current.waitForTimeout(1000); // let a late cookie modal render first
    let authTried = false;
    for (let hop = 0; hop < 5; hop++) {
      // Re-dismiss cookie modals each hop — some (e.g. IrishJobs) render a beat
      // after load and would otherwise cover the page / block form detection.
      await this.dismissCookieBanner(current);
      if (await this.looksLikeForm(current)) return current;

      // Auth wall (login/registration, e.g. IrishJobs' email-first flow) — sign
      // in / register with the global credentials + email-code verification,
      // once, then re-evaluate.
      if (!authTried && this.loginPassword && (await this.looksLikeAuth(current))) {
        authTried = true;
        await this.handleAuthWall(current);
        await current.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
        await current.waitForTimeout(1200);
        continue;
      }

      // If we've reached a known ATS, let its adapter reveal the form (reliable
      // per-ATS handling for Recruitee/Greenhouse/Lever/Ashby).
      const adapter = adapterFor(current.url());
      if (adapter) {
        await adapter.reachForm(current);
        this.logger.log(`ATS adapter ${adapter.name} → ${current.url()}`);
        if (await this.looksLikeForm(current)) return current;
      }

      const next = await this.followApply(current);
      if (!next) break;
      current = next;
      await current.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      await current.waitForTimeout(1200);
      await this.dismissCookieBanner(current);
      this.logger.log(`Apply hop ${hop + 1} → ${current.url()}`);
    }
    return current;
  }

  private async hasPasswordField(page: Page): Promise<boolean> {
    return (await page.locator('input[type="password"]:visible').count().catch(() => 0)) > 0;
  }

  /** Does this page look like a sign-in / account-creation wall? */
  private async looksLikeAuth(page: Page): Promise<boolean> {
    if (/authentication|\/login|\/signin|sign-in|\/auth\b|account/i.test(page.url())) return true;
    if (await this.hasPasswordField(page)) return true;
    const hint = await page
      .getByText(/continue with email|account already exists|create an account|sign in to apply|log in to apply/i)
      .count()
      .catch(() => 0);
    return hint > 0;
  }

  private async fillIfPresent(page: Page, selector: string, value: string): Promise<void> {
    const el = page.locator(selector + ':visible').first();
    if ((await el.count().catch(() => 0)) > 0 && !(await el.inputValue().catch(() => 'x'))) {
      await el.fill(value).catch(() => undefined);
    }
  }

  /** Click the first visible button/link whose name matches any regex. */
  private async clickAny(page: Page, res: RegExp[]): Promise<boolean> {
    for (const re of res) {
      const loc = page.getByRole('button', { name: re }).or(page.getByRole('link', { name: re }));
      const n = await loc.count().catch(() => 0);
      for (let i = 0; i < n; i++) {
        const c = loc.nth(i);
        if (!(await c.isVisible().catch(() => false))) continue;
        await c.click({ timeout: 6000 }).catch(() => undefined);
        return true;
      }
    }
    return false;
  }

  /**
   * Handle a login / account-creation wall using the global credentials
   * (APPLICANT_EMAIL / APPLICANT_PASSWORD). Tries sign-in first, then register,
   * then completes any email-code verification via the Gmail OTP reader. Assisted
   * mode: if it can't get through, the human finishes in the open browser.
   */
  private async handleAuthWall(page: Page): Promise<void> {
    try {
      this.logger.log(`Auth wall at ${page.url()} — attempting sign-in/registration.`);
      const emailSel = 'input[type="email"]:visible, input[name*="email" i]:visible, input[autocomplete="username"]:visible';

      // Step 1 — email-first screen (IrishJobs): fill email, Continue, WAIT for
      // the password field to render before proceeding (the missing wait was why
      // it previously stalled).
      const emailFirst = page.locator(emailSel).first();
      if ((await emailFirst.count().catch(() => 0)) > 0 && !(await this.hasPasswordField(page))) {
        await emailFirst.fill(this.loginEmail).catch(() => undefined);
        await page.waitForTimeout(400);
        await this.clickAny(page, [/continue with email/i, /^continue$/i, /^next$/i]);
        await page
          .waitForSelector('input[type="password"]', { state: 'visible', timeout: 12_000 })
          .catch(() => undefined);
      }

      // Step 2 — password / registration screen: fill creds, tick consent, submit
      // and WAIT for the navigation to the application form.
      if (await this.hasPasswordField(page)) {
        const em = page.locator(emailSel).first();
        if ((await em.count().catch(() => 0)) > 0 && !(await em.inputValue().catch(() => 'x'))) {
          await em.fill(this.loginEmail).catch(() => undefined);
        }
        await page.locator('input[type="password"]:visible').first().fill(this.loginPassword).catch(() => undefined);
        await this.fillIfPresent(page, 'input[name*="first" i], input[id*="first" i]', JOB_APPLICANT.firstName);
        await this.fillIfPresent(page, 'input[name*="last" i], input[id*="last" i]', JOB_APPLICANT.lastName);
        await this.tickConsents(page);
        await page.waitForTimeout(500); // let the field's change event settle
        const beforeUrl = page.url();
        await this.clickAny(page, [
          /continue application/i, /^sign in$/i, /^log ?in$/i, /sign in/i, /log ?in/i,
          /create account/i, /register/i, /^continue$/i, /\bcontinue\b/i, /^submit$/i,
        ]);
        // SPA login: wait for the URL to actually change (more reliable than networkidle).
        await page
          .waitForFunction((u) => location.href !== u, beforeUrl, { timeout: 20_000 })
          .catch(() => undefined);
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
        await page.waitForTimeout(2000);
        await this.handleEmailVerification(page);
      }
    } catch (err) {
      this.logger.warn(`Auth wall handling failed: ${(err as Error).message}`);
    }
  }

  /** If an email verification-code step appears, read the code from Gmail and enter it. */
  private async handleEmailVerification(page: Page): Promise<void> {
    const codeField = page
      .locator(
        'input[autocomplete="one-time-code"]:visible, input[name*="code" i]:visible, input[id*="otp" i]:visible, input[name*="otp" i]:visible',
      )
      .first();
    if (!(await codeField.count().catch(() => 0))) return;
    if (!this.gmail.isConnected()) {
      this.logger.warn('Email verification needed but Gmail not connected — leaving for human.');
      return;
    }
    this.logger.log('Email verification step — polling Gmail for the code...');
    for (let i = 0; i < 8; i++) {
      const otp = await this.gmail.readLatestOtp({ withinMinutes: 10 }).catch(() => null);
      if (otp?.code) {
        await codeField.fill(otp.code).catch(() => undefined);
        await this.clickAny(page, [/verify/i, /confirm/i, /continue/i, /submit/i]);
        await page.waitForTimeout(1500);
        this.logger.log('Entered email verification code from Gmail.');
        return;
      }
      await page.waitForTimeout(5000);
    }
    this.logger.warn('No verification code arrived within ~40s — leaving for human.');
  }

  /** Follow the single best "Apply" control on a page; null if none found. */
  private async followApply(page: Page): Promise<Page | null> {
    const applyRe = /\bapply\b/i;
    const skipRe =
      /alert|filter|search|newsletter|subscribe|sign\s?up|log\s?in|save job|share|with xing|with linkedin|with indeed/i;

    // 1) Prefer an <a href> apply link — navigate straight to it.
    const linkLoc = page.getByRole('link', { name: applyRe });
    const nl = await linkLoc.count().catch(() => 0);
    for (let i = 0; i < nl; i++) {
      const c = linkLoc.nth(i);
      if (!(await c.isVisible().catch(() => false))) continue;
      const name = (await c.textContent().catch(() => '')) || '';
      if (skipRe.test(name)) continue;
      const href = await c.getAttribute('href').catch(() => null);
      if (href && /^https?:\/\//i.test(href)) {
        await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => undefined);
        return page;
      }
      const [popup] = await Promise.all([
        page.context().waitForEvent('page', { timeout: 8000 }).catch(() => null),
        c.click({ timeout: 8000 }).catch(() => undefined),
      ]);
      return popup ?? page;
    }

    // 2) Otherwise click an apply button in-page.
    const btnLoc = page.getByRole('button', { name: applyRe });
    const nb = await btnLoc.count().catch(() => 0);
    for (let i = 0; i < nb; i++) {
      const c = btnLoc.nth(i);
      if (!(await c.isVisible().catch(() => false))) continue;
      const name = (await c.textContent().catch(() => '')) || '';
      if (skipRe.test(name)) continue;
      await c.click({ timeout: 8000 }).catch(() => undefined);
      return page;
    }
    return null;
  }

  /**
   * Heuristic: does this page (or any of its iframes) hold a real application
   * form (not a newsletter)? Frame-aware so ATS forms embedded in an iframe are
   * detected and the hop loop stops on them.
   */
  async looksLikeForm(page: Page): Promise<boolean> {
    for (const root of [page, ...page.frames()]) {
      const fileCount = await root.locator('input[type="file"]').count().catch(() => 0);
      if (fileCount > 0) return true;
      const inputCount = await root
        .locator('input:visible, textarea:visible, select:visible')
        .count()
        .catch(() => 0);
      if (inputCount >= 4) return true;
    }
    return false;
  }
}
