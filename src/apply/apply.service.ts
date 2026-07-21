import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { readdir, stat, unlink } from 'fs/promises';
import { join, resolve } from 'path';
import type { BrowserContext, Page } from 'playwright';
import { PlaywrightService } from '../discovery/playwright.service';
import { ProfessorStatus } from '../professors/professor-status.enum';
import { ProfessorsService } from '../professors/professors.service';
import { buildApplicantProfile, DOCUMENT_CATALOG } from './applicant-profile';
import {
  FillPlanItem,
  FillResult,
  StartApplicationResult,
  SubmitApplicationResult,
} from './apply.types';
import { FillPlanner } from './fill-planner';
import { FormAnalyzer } from './form-analyzer';

/** A held-open browser session awaiting the user's review/approval. */
interface ApplySession {
  id: string;
  professorId: string;
  professorName: string;
  applyUrl: string;
  context: BrowserContext;
  page: Page;
  screenshotPath: string;
  filled: FillResult[];
  skipped: FillResult[];
  timer: NodeJS.Timeout;
}

/**
 * Assisted-apply orchestrator (human-in-the-loop). For JS-based application
 * portals that expose no email, it opens the form, fills every field it safely
 * can, uploads the matching documents, screenshots the result, then HOLDS the
 * browser open awaiting an explicit approval before submitting. Hard blockers
 * (CAPTCHA, account-creation walls) are reported instead of attempted.
 */
@Injectable()
export class ApplyService implements OnModuleInit {
  private readonly logger = new Logger(ApplyService.name);
  private readonly sessions = new Map<string, ApplySession>();
  private readonly docsDir: string;
  private readonly outDir: string;
  private readonly headful: boolean;
  private readonly sessionTtlMs: number;
  private readonly applicantEmail: string;
  private readonly screenshotTtlDays: number;

  constructor(
    private readonly professors: ProfessorsService,
    private readonly playwright: PlaywrightService,
    private readonly analyzer: FormAnalyzer,
    private readonly planner: FillPlanner,
    private readonly config: ConfigService,
  ) {
    this.docsDir = this.config.get<string>('DOCS_DIR') ?? './pdf';
    this.outDir = this.config.get<string>('APPLY_DIR') ?? './applications';
    this.headful = !/^false$/i.test(this.config.get<string>('APPLY_HEADFUL') ?? 'true');
    this.sessionTtlMs = Number(this.config.get('APPLY_SESSION_TTL_MS') ?? 30 * 60 * 1000);
    this.applicantEmail =
      this.config.get<string>('APPLICANT_EMAIL') ??
      this.config.get<string>('GMAIL_SENDER') ??
      '';
    this.screenshotTtlDays = Number(this.config.get('APPLY_SCREENSHOT_TTL_DAYS') ?? 2);
    if (!existsSync(this.outDir)) mkdirSync(this.outDir, { recursive: true });
  }

  /** Prune leftover screenshots on boot (covers a laptop asleep at 3am). */
  async onModuleInit(): Promise<void> {
    await this.pruneOldScreenshots();
  }

  /**
   * Delete review/confirmation screenshots older than APPLY_SCREENSHOT_TTL_DAYS
   * (default 2). They're only needed while a session is being reviewed; keeping
   * them longer just clutters ./applications. Runs daily + on boot.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async pruneOldScreenshots(): Promise<void> {
    const cutoff = Date.now() - this.screenshotTtlDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    try {
      for (const f of await readdir(this.outDir)) {
        if (!f.endsWith('.png')) continue;
        const full = join(this.outDir, f);
        try {
          if ((await stat(full)).mtimeMs < cutoff) {
            await unlink(full);
            removed++;
          }
        } catch {
          /* file vanished between readdir and stat — ignore */
        }
      }
    } catch {
      /* outDir missing — nothing to prune */
    }
    if (removed) {
      this.logger.log(
        `Pruned ${removed} apply screenshot(s) older than ${this.screenshotTtlDays}d`,
      );
    }
  }

  /**
   * Open the professor's application portal, auto-fill it, and hold it open for
   * review. Does NOT submit. Returns a session id used to approve/cancel.
   */
  async start(
    professorId: string,
    opts: { force?: boolean } = {},
  ): Promise<StartApplicationResult> {
    const professor = await this.professors.findOne(professorId);
    const applyUrl = professor.socialLinks?.apply || professor.sourceUrl;
    if (!applyUrl) {
      throw new NotFoundException(
        `Professor ${professorId} has no application URL (social_links.apply / source_url).`,
      );
    }
    if (professor.status === ProfessorStatus.APPLIED && !opts.force) {
      return {
        sessionId: '',
        professorId,
        professorName: professor.professorName,
        applyUrl,
        status: 'needs_manual',
        filled: [],
        skipped: [],
        hardBlockers: [],
        warnings: [],
        message: 'Already marked APPLIED. Pass force=true to apply again.',
      };
    }

    const profile = buildApplicantProfile({ email: this.applicantEmail });
    const { context, page } = await this.playwright.openSession(applyUrl, {
      headful: this.headful,
    });

    try {
      // Real "apply" URLs are usually description pages fronted by a cookie
      // banner, with the actual form one click deeper. Clear the banner, then
      // hop to the form before analysing (learned from live testing).
      await this.dismissCookieBanner(page);
      const page2 = await this.navigateToForm(page);
      const analysis = await this.analyzer.analyze(page2);

      // Hard blockers: don't attempt — screenshot, close, report.
      if (analysis.hardBlockers.length) {
        const shot = join(this.outDir, `${randomUUID()}.png`);
        await page2.screenshot({ path: shot, fullPage: true }).catch(() => undefined);
        await context.close().catch(() => undefined);
        return {
          sessionId: '',
          professorId,
          professorName: professor.professorName,
          applyUrl,
          status: 'needs_manual',
          screenshotPath: shot,
          filled: [],
          skipped: [],
          hardBlockers: analysis.hardBlockers,
          warnings: analysis.warnings,
          message:
            'This portal needs manual handling (see hardBlockers). Open the link ' +
            'and complete it yourself; the browser window is available.',
        };
      }

      const plan = await this.planner.plan(analysis.fields, professor, profile);
      const { filled, skipped } = await this.execute(page2, plan);

      const sessionId = randomUUID();
      const screenshotPath = join(this.outDir, `${sessionId}.png`);
      await page2.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);

      const timer = setTimeout(() => {
        this.logger.warn(`Apply session ${sessionId} expired — closing browser.`);
        this.cleanup(sessionId);
      }, this.sessionTtlMs);

      this.sessions.set(sessionId, {
        id: sessionId,
        professorId,
        professorName: professor.professorName,
        applyUrl,
        context,
        page: page2,
        screenshotPath,
        filled,
        skipped,
        timer,
      });

      this.logger.log(
        `Apply session ${sessionId} ready for review: ${filled.length} filled, ` +
          `${skipped.length} skipped (${professor.professorName}).`,
      );
      return {
        sessionId,
        professorId,
        professorName: professor.professorName,
        applyUrl,
        status: 'pending_review',
        screenshotPath,
        filled,
        skipped,
        hardBlockers: [],
        warnings: analysis.warnings,
        message:
          `Form filled and awaiting your review. Check ${screenshotPath} (or the ` +
          `open browser), then POST /apply/session/${sessionId}/submit to send, ` +
          `or /cancel to discard. Expires in ${Math.round(this.sessionTtlMs / 60000)} min.`,
      };
    } catch (err) {
      await context.close().catch(() => undefined);
      throw err;
    }
  }

  /** Approve a pending session: click submit, confirm, mark professor APPLIED. */
  async submit(sessionId: string): Promise<SubmitApplicationResult> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new NotFoundException(`No open apply session ${sessionId}.`);

    const clicked = await this.clickSubmit(s.page);
    if (!clicked) {
      return {
        sessionId,
        professorId: s.professorId,
        ok: false,
        submitted: false,
        needsManualSubmit: true,
        message:
          'Could not find a submit button. The filled form is still open in the ' +
          'browser — submit it manually, then PATCH the professor status to "applied".',
      };
    }

    // Let the submission settle, then capture the result page.
    await s.page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
    const resultShot = join(this.outDir, `${sessionId}-result.png`);
    await s.page.screenshot({ path: resultShot, fullPage: true }).catch(() => undefined);

    await this.professors.markApplied(
      s.professorId,
      `Applied via assisted form submission to ${s.applyUrl}`,
    );
    this.cleanup(sessionId);

    this.logger.log(`Submitted application for ${s.professorName} (${s.professorId}).`);
    return {
      sessionId,
      professorId: s.professorId,
      ok: true,
      submitted: true,
      resultScreenshotPath: resultShot,
      message: `Submitted and marked APPLIED. Confirmation screenshot: ${resultShot}`,
    };
  }

  /** Discard a pending session without submitting. */
  async cancel(sessionId: string): Promise<{ ok: boolean; message: string }> {
    if (!this.sessions.has(sessionId)) {
      return { ok: false, message: `No open apply session ${sessionId}.` };
    }
    this.cleanup(sessionId);
    return { ok: true, message: `Session ${sessionId} cancelled and browser closed.` };
  }

  /**
   * Triage every not-yet-contacted professor into an `apply_path` so the DB
   * shows at a glance how each is reached. Read-only: opens each apply page
   * headless, dismisses cookies, follows the apply link, and inspects the form
   * — never logs in, fills, or submits. Professors that already have an email
   * are labelled 'email' without any browsing.
   */
  async classifyAll(): Promise<{
    total: number;
    counts: Record<string, number>;
    rows: { id: string; university: string; applyPath: string }[];
  }> {
    const professors = await this.professors.findAll({
      status: ProfessorStatus.NOT_CONTACTED,
    });
    const counts: Record<string, number> = {};
    const rows: { id: string; university: string; applyPath: string }[] = [];

    for (const p of professors) {
      let path: string;
      if (p.email) {
        path = 'email';
      } else if (p.socialLinks?.apply || p.sourceUrl) {
        path = await this.classifyOne(p.socialLinks?.apply || p.sourceUrl);
      } else {
        path = 'no_form';
      }
      await this.professors.update(p.id, { applyPath: path } as never);
      counts[path] = (counts[path] ?? 0) + 1;
      rows.push({ id: p.id, university: p.university, applyPath: path });
      this.logger.log(`Classified ${p.university}: ${path}`);
    }
    return { total: professors.length, counts, rows };
  }

  /** Probe a single apply URL and return its path label. Always closes up. */
  private async classifyOne(applyUrl: string): Promise<string> {
    let context: BrowserContext | undefined;
    try {
      const opened = await this.playwright.openSession(applyUrl, { headful: false });
      context = opened.context;
      await this.dismissCookieBanner(opened.page);
      const page = await this.navigateToForm(opened.page);
      const hasPassword =
        (await page.locator('input[type="password"]').count().catch(() => 0)) > 0;
      const analysis = await this.analyzer.analyze(page);
      const fillable = analysis.fields.filter(
        (f) => !['checkbox', 'radio', ''].includes(f.type) || f.tag === 'textarea',
      );

      if (analysis.hardBlockers.some((b) => /captcha/i.test(b))) return 'blocked';
      if (hasPassword || analysis.hardBlockers.some((b) => /login|account|sign/i.test(b))) {
        return 'login_required';
      }
      if (fillable.length >= 2) return 'form';
      return 'no_form';
    } catch (err) {
      this.logger.warn(`Classify failed for ${applyUrl}: ${(err as Error).message}`);
      return 'no_form';
    } finally {
      await context?.close().catch(() => undefined);
    }
  }

  /** Read-only view of a pending session (for the review UI). */
  getSession(sessionId: string): {
    sessionId: string;
    professorId: string;
    professorName: string;
    applyUrl: string;
    screenshotPath: string;
    filled: FillResult[];
    skipped: FillResult[];
  } {
    const s = this.sessions.get(sessionId);
    if (!s) throw new NotFoundException(`No open apply session ${sessionId}.`);
    return {
      sessionId: s.id,
      professorId: s.professorId,
      professorName: s.professorName,
      applyUrl: s.applyUrl,
      screenshotPath: s.screenshotPath,
      filled: s.filled,
      skipped: s.skipped,
    };
  }

  /** Execute the fill plan against the live page, field by field. */
  private async execute(
    page: Page,
    plan: FillPlanItem[],
  ): Promise<{ filled: FillResult[]; skipped: FillResult[] }> {
    const filled: FillResult[] = [];
    const skipped: FillResult[] = [];

    for (const item of plan) {
      if (item.action === 'skip') {
        skipped.push({ ...item, ok: true });
        continue;
      }
      const selector = `[data-apply-ref="${item.ref}"]`;
      try {
        if (item.action === 'fill') {
          await page.fill(selector, item.value ?? '');
        } else if (item.action === 'select') {
          await page.selectOption(selector, item.value ?? '');
        } else if (item.action === 'upload') {
          const doc = DOCUMENT_CATALOG[item.value ?? ''];
          const path = doc ? resolve(join(this.docsDir, doc.filename)) : '';
          if (!doc || !existsSync(path)) {
            skipped.push({ ...item, ok: false, error: `document not found: ${item.value}` });
            continue;
          }
          await page.setInputFiles(selector, path);
        }
        filled.push({ ...item, ok: true });
      } catch (err) {
        skipped.push({ ...item, ok: false, error: (err as Error).message });
      }
    }
    return { filled, skipped };
  }

  /**
   * Dismiss a cookie-consent banner if present (learned from live testing:
   * banners masked the whole page and polluted field detection with consent
   * checkboxes). Prefers "Accept all" so the site stays fully functional.
   */
  private async dismissCookieBanner(page: Page): Promise<void> {
    const labels = [
      /accept all/i, /allow all/i, /accept all cookies/i, /accept cookies/i,
      /i agree/i, /^agree$/i, /^accept$/i, /got it/i, /^ok$/i, /^allow$/i,
      /^decline all$/i, /reject all/i,
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
   * If the current page isn't already a form, follow a prominent "Apply" link
   * to reach the real application form (apply URLs are typically description
   * pages one hop above the form). Handles links that open a new tab. Hops at
   * most once; returns the page the form lives on.
   */
  private async navigateToForm(page: Page): Promise<Page> {
    const fileCount = await page.locator('input[type="file"]').count().catch(() => 0);
    const inputCount = await page
      .locator('input:visible, textarea:visible, select:visible')
      .count()
      .catch(() => 0);
    // Already looks like a fillable form — don't hop.
    if (fileCount > 0 || inputCount >= 4) return page;

    // Broad "apply" match (covers "Apply on website", "Apply for this job"…)
    // minus obvious non-application CTAs (job alerts, filters, search, login).
    const applyRe = /\bapply\b/i;
    const skipRe = /alert|filter|search|newsletter|sign\s?up|log\s?in|save job/i;
    const locators = [
      page.getByRole('link', { name: applyRe }),
      page.getByRole('button', { name: applyRe }),
    ];
    for (const loc of locators) {
      const n = await loc.count().catch(() => 0);
      // Find the first visible candidate whose name isn't a non-apply CTA.
      let el: import('playwright').Locator | undefined;
      for (let idx = 0; idx < n; idx++) {
        const cand = loc.nth(idx);
        if (!(await cand.isVisible().catch(() => false))) continue;
        const name = (await cand.textContent().catch(() => '')) || '';
        if (skipRe.test(name)) continue;
        el = cand;
        break;
      }
      if (!el) continue;
      const [popup] = await Promise.all([
        page.context().waitForEvent('page', { timeout: 8000 }).catch(() => null),
        el.click({ timeout: 8000 }).catch(() => undefined),
      ]);
      const target = popup ?? page;
      await target.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined);
      await this.dismissCookieBanner(target);
      this.logger.log(`Followed apply link to ${target.url()}`);
      return target;
    }
    return page;
  }

  /** Find and click the form's submit control. Returns whether one was found. */
  private async clickSubmit(page: Page): Promise<boolean> {
    const candidates = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Submit")',
      'button:has-text("Apply")',
      'button:has-text("Send application")',
      'button:has-text("Send")',
    ];
    for (const sel of candidates) {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) {
        await el.click({ timeout: 10_000 }).catch(() => undefined);
        return true;
      }
    }
    return false;
  }

  /** Close a session's browser context and clear its timer. */
  private cleanup(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    clearTimeout(s.timer);
    s.context.close().catch(() => undefined);
    this.sessions.delete(sessionId);
  }
}
