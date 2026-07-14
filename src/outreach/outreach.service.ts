import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { unlink } from 'fs/promises';
import { Op } from 'sequelize';
import { GmailService } from '../gmail/gmail.service';
import { Professor } from '../professors/professor.model';
import { ProfessorsService } from '../professors/professors.service';
import { assembleEmail, assembleFollowup } from './email-template';
import { MotivationLetterService } from './motivation-letter.service';
import { PersonalizationService } from '../personalization/personalization.service';
import { OutreachEmail } from './outreach-email.model';
import { OutreachStatus, OutreachType } from './outreach-enums';
import { isProfessorWorkingHours } from './timezones';

export interface SendOutcome {
  professorId: string;
  professorName: string;
  recipient?: string;
  ok: boolean;
  gmailMessageId?: string;
  error?: string;
}

@Injectable()
export class OutreachService {
  private readonly logger = new Logger(OutreachService.name);
  private readonly docsDir: string;
  private readonly dailyMax: number;
  private readonly followupDays: number;
  private readonly attachMotivation: boolean;

  constructor(
    @InjectModel(OutreachEmail) private readonly outreachModel: typeof OutreachEmail,
    private readonly gmail: GmailService,
    private readonly professors: ProfessorsService,
    private readonly motivationLetter: MotivationLetterService,
    private readonly personalization: PersonalizationService,
    private readonly config: ConfigService,
  ) {
    this.docsDir = this.config.get<string>('DOCS_DIR') ?? './pdf';
    this.dailyMax = Number(this.config.get('DAILY_SEND_MAX') ?? 20);
    this.followupDays = Number(this.config.get('FOLLOWUP_DAYS') ?? 14);
    this.attachMotivation = !/^false$/i.test(
      this.config.get<string>('ATTACH_MOTIVATION_LETTER') ?? 'true',
    );
  }

  /**
   * PROJECT.md Section 12, Step 5: prove sending works by emailing Umer's OWN
   * address first. Uses a sample snippet; does NOT touch the professors table.
   */
  async sendTestToSelf(): Promise<SendOutcome> {
    const to = this.gmail.senderAddress;
    // A realistic GENERIC-match professor (only broad ML/data tags, no specific
    // project) — this is exactly the case that used to make the personalizer
    // misattribute Umer's own thesis to the professor, so it verifies the fix.
    const sample = {
      id: 'self-test',
      professorName: 'Dr. Arezoo Sarkheyli-Haegele',
      university: 'Malmö University',
      country: 'Sweden',
      departmentLab: 'Faculty of Technology and Society',
      matchedTags: ['Machine learning / AI', 'Data science / big data'],
      matchReason:
        'Matched research tags: Machine learning / AI, Data science / big data. Position: "PhD position in applied AI and data-driven systems"',
    } as Professor;

    // Generate a REAL snippet with the live prompt (fall back to a correct
    // sample if Claude is unavailable) so the test reflects a genuine send.
    let snippet: string;
    try {
      snippet = await this.personalization.previewSnippet(sample);
    } catch (err) {
      this.logger.warn(`Self-test snippet generation failed, using fallback: ${(err as Error).message}`);
      snippet =
        "Your group's work on applied AI and data-driven systems connects closely with my MS thesis, in which I trained RNN, LSTM, and Random Forest models on the UNSW-NB15 dataset to detect low-rate DDoS attacks. I would be keen to bring that ML-for-security background, together with six years of production software engineering, to your research.";
    }

    let letterPath: string | undefined;
    const extraAttachments: { filename: string; path: string }[] = [];
    if (this.attachMotivation) {
      try {
        const letter = await this.motivationLetter.generate(sample);
        letterPath = letter.path;
        extraAttachments.push(letter);
      } catch (err) {
        this.logger.warn(`Self-test letter generation failed: ${(err as Error).message}`);
      }
    }

    const email = assembleEmail(sample, snippet, {
      senderEmail: to,
      docsDir: this.docsDir,
      extraAttachments,
    });
    try {
      const sent = await this.gmail.send({
        to,
        subject: `[SELF-TEST] ${email.subject}`,
        text: email.text,
        attachments: email.attachments,
      });
      this.logger.log(
        `Self-test sent to ${to} (msg ${sent.gmailMessageId}); ` +
          `attachments: ${email.attachments.map((a) => a.filename).join(', ') || 'none'}` +
          (email.missingAttachments.length
            ? `; MISSING: ${email.missingAttachments.join(', ')}`
            : ''),
      );
      return { professorId: 'self-test', professorName: to, recipient: to, ok: true, gmailMessageId: sent.gmailMessageId };
    } catch (err) {
      const error = (err as Error).message;
      this.logger.error(`Self-test failed: ${error}`);
      return { professorId: 'self-test', professorName: to, recipient: to, ok: false, error };
    } finally {
      if (letterPath) await unlink(letterPath).catch(() => undefined);
    }
  }

  /**
   * Re-send a corrected initial email to a professor who already received one
   * built from a faulty template/snippet. Regenerates the snippet with the
   * CURRENT prompt, replies in the original thread, and opens with a brief
   * correction note. Bypasses the normal double-send guard on purpose.
   */
  async resendCorrectedInitial(professorId: string): Promise<SendOutcome> {
    const professor = await this.professors.findOne(professorId);
    const base = { professorId, professorName: professor.professorName };
    if (!professor.email) return { ...base, ok: false, error: 'no email on record' };

    const initial = await this.outreachModel.findOne({
      where: { professorId, type: OutreachType.INITIAL, status: OutreachStatus.SENT },
      order: [['sentAt', 'DESC']],
    });

    // Regenerate the opening with the current (fixed) prompt.
    const p = await this.personalization.personalizeOne(professorId, true);
    if (!p.ok || !p.snippet)
      return { ...base, ok: false, error: `re-personalization failed: ${p.error ?? 'empty snippet'}` };
    const fresh = await this.professors.findOne(professorId);

    let letterPath: string | undefined;
    const extraAttachments: { filename: string; path: string }[] = [];
    if (this.attachMotivation) {
      try {
        const letter = await this.motivationLetter.generate(fresh);
        letterPath = letter.path;
        extraAttachments.push(letter);
      } catch (err) {
        this.logger.warn(`Resend letter generation failed: ${(err as Error).message}`);
      }
    }

    const preface =
      'Apologies — my earlier message contained an editing error in the opening line. Please find a corrected version below.';
    const email = assembleEmail(fresh, fresh.personalizedSnippet as string, {
      senderEmail: this.gmail.senderAddress,
      docsDir: this.docsDir,
      extraAttachments,
      preface,
    });

    const subject =
      initial && /^re:/i.test(initial.subject) ? initial.subject : `Re: ${email.subject}`;
    const inReplyTo = initial?.gmailMessageId
      ? await this.gmail.getRfcMessageId(initial.gmailMessageId).catch(() => undefined)
      : undefined;

    const row = await this.outreachModel.create({
      professorId,
      type: OutreachType.INITIAL,
      recipient: professor.email,
      subject,
      body: email.text,
      status: OutreachStatus.QUEUED,
    } as any);

    try {
      const sent = await this.gmail.send({
        to: professor.email,
        subject,
        text: email.text,
        attachments: email.attachments,
        threadId: initial?.gmailThreadId,
        inReplyTo,
      });
      await row.update({
        status: OutreachStatus.SENT,
        sentAt: new Date(),
        gmailMessageId: sent.gmailMessageId,
        gmailThreadId: sent.gmailThreadId,
      });
      // Reset the follow-up clock so it counts from the corrected send.
      await this.professors.markEmailed(professorId, this.followupDate());
      this.logger.log(
        `Corrected email re-sent to ${professor.professorName} <${professor.email}> ` +
          `(${email.attachments.length} attachments, threaded)`,
      );
      return { ...base, recipient: professor.email, ok: true, gmailMessageId: sent.gmailMessageId };
    } catch (err) {
      const error = (err as Error).message;
      await row.update({ status: OutreachStatus.FAILED, error });
      this.logger.warn(`Corrected resend failed for ${professor.professorName}: ${error}`);
      return { ...base, recipient: professor.email, ok: false, error };
    } finally {
      if (letterPath) await unlink(letterPath).catch(() => undefined);
    }
  }

  /** Send the initial email to one professor, logging + status update. */
  async sendToProfessor(professorId: string): Promise<SendOutcome> {
    const professor = await this.professors.findOne(professorId);
    const base = { professorId, professorName: professor.professorName };

    if (!professor.email) return { ...base, ok: false, error: 'no email on record' };
    if (!professor.personalizedSnippet)
      return { ...base, ok: false, error: 'not personalized yet (run Step 4)' };

    // Guard against double-sending an initial email.
    const already = await this.outreachModel.findOne({
      where: { professorId, type: OutreachType.INITIAL, status: OutreachStatus.SENT },
    });
    if (already) return { ...base, ok: false, error: 'initial email already sent' };

    // Per-professor motivation letter (generated fresh, attached, then deleted).
    let letterPath: string | undefined;
    const extraAttachments: { filename: string; path: string }[] = [];
    if (this.attachMotivation) {
      try {
        const letter = await this.motivationLetter.generate(professor);
        letterPath = letter.path;
        extraAttachments.push(letter);
      } catch (err) {
        this.logger.warn(
          `Motivation letter generation failed for ${professor.professorName}, ` +
            `sending without it: ${(err as Error).message}`,
        );
      }
    }

    const email = assembleEmail(professor, professor.personalizedSnippet, {
      senderEmail: this.gmail.senderAddress,
      docsDir: this.docsDir,
      extraAttachments,
    });

    const row = await this.outreachModel.create({
      professorId,
      type: OutreachType.INITIAL,
      recipient: professor.email,
      subject: email.subject,
      body: email.text,
      status: OutreachStatus.QUEUED,
    } as any);

    try {
      const sent = await this.gmail.send({
        to: professor.email,
        subject: email.subject,
        text: email.text,
        attachments: email.attachments,
      });
      await row.update({
        status: OutreachStatus.SENT,
        sentAt: new Date(),
        gmailMessageId: sent.gmailMessageId,
        gmailThreadId: sent.gmailThreadId,
      });
      await this.professors.markEmailed(professorId, this.followupDate());
      this.logger.log(
        `Emailed ${professor.professorName} <${professor.email}> ` +
          `(${email.attachments.length} attachments)`,
      );
      return { ...base, recipient: professor.email, ok: true, gmailMessageId: sent.gmailMessageId };
    } catch (err) {
      const error = (err as Error).message;
      await row.update({ status: OutreachStatus.FAILED, error });
      this.logger.warn(`Send failed for ${professor.professorName}: ${error}`);
      return { ...base, recipient: professor.email, ok: false, error };
    } finally {
      if (letterPath) await unlink(letterPath).catch(() => undefined);
    }
  }

  /**
   * Daily batch (Step 6): send up to the remaining daily quota to personalized,
   * not-yet-contacted professors. Sequential, with a small polite delay.
   */
  async sendDailyBatch(opts?: { limit?: number; delayMs?: number }): Promise<{
    sentToday: number;
    remainingQuota: number;
    attempted: number;
    sent: number;
    failed: number;
    outcomes: SendOutcome[];
  }> {
    const delayMs = opts?.delayMs ?? 4000;
    const sentToday = await this.countSentToday();
    const remainingQuota = Math.max(0, this.dailyMax - sentToday);
    const limit = Math.min(opts?.limit ?? remainingQuota, remainingQuota);

    const outcomes: SendOutcome[] = [];
    if (limit > 0) {
      // Pull a wider pool, then email only professors whose LOCAL time is
      // working hours right now (so it lands during their day, not their night).
      const candidates = await this.professors.findReadyToEmail(50);
      const eligible = candidates.filter((p) => isProfessorWorkingHours(p.country));
      for (const professor of eligible.slice(0, limit)) {
        outcomes.push(await this.sendToProfessor(professor.id));
        if (delayMs) await this.sleep(delayMs);
      }
    }
    const sent = outcomes.filter((o) => o.ok).length;
    this.logger.log(
      `Daily batch: sentToday=${sentToday} quota=${remainingQuota} ` +
        `attempted=${outcomes.length} sent=${sent}`,
    );
    return {
      sentToday,
      remainingQuota,
      attempted: outcomes.length,
      sent,
      failed: outcomes.length - sent,
      outcomes,
    };
  }

  /**
   * Step 8: scan sent-but-not-yet-replied threads; if the professor has posted
   * in the thread, flip the email + professor to "replied" (stops follow-ups).
   */
  async checkReplies(): Promise<{ checked: number; newReplies: number }> {
    const rows = await this.outreachModel.findAll({
      where: { status: OutreachStatus.SENT, repliedAt: { [Op.is]: null } },
    });
    let newReplies = 0;
    for (const row of rows) {
      if (!row.gmailThreadId) continue;
      try {
        if (await this.gmail.threadHasReply(row.gmailThreadId)) {
          await row.update({ status: OutreachStatus.REPLIED, repliedAt: new Date() });
          await this.professors.markReplied(row.professorId);
          newReplies++;
          this.logger.log(`Reply detected for professor ${row.professorId}`);
        }
      } catch (err) {
        this.logger.warn(
          `Reply check failed for thread ${row.gmailThreadId}: ${(err as Error).message}`,
        );
      }
    }
    return { checked: rows.length, newReplies };
  }

  /** Step 9: send a single follow-up in the original thread. */
  async sendFollowup(professorId: string): Promise<SendOutcome> {
    const professor = await this.professors.findOne(professorId);
    const base = { professorId, professorName: professor.professorName };
    if (!professor.email) return { ...base, ok: false, error: 'no email on record' };

    const initial = await this.outreachModel.findOne({
      where: { professorId, type: OutreachType.INITIAL, status: OutreachStatus.SENT },
      order: [['sentAt', 'DESC']],
    });
    if (!initial) return { ...base, ok: false, error: 'no initial email to follow up on' };

    const already = await this.outreachModel.findOne({
      where: { professorId, type: OutreachType.FOLLOW_UP, status: OutreachStatus.SENT },
    });
    if (already) return { ...base, ok: false, error: 'follow-up already sent' };

    const { text } = assembleFollowup(professor, { senderEmail: this.gmail.senderAddress });
    const subject = /^re:/i.test(initial.subject) ? initial.subject : `Re: ${initial.subject}`;
    const inReplyTo = initial.gmailMessageId
      ? await this.gmail.getRfcMessageId(initial.gmailMessageId).catch(() => undefined)
      : undefined;

    const row = await this.outreachModel.create({
      professorId,
      type: OutreachType.FOLLOW_UP,
      recipient: professor.email,
      subject,
      body: text,
      status: OutreachStatus.QUEUED,
    } as any);

    try {
      const sent = await this.gmail.send({
        to: professor.email,
        subject,
        text,
        threadId: initial.gmailThreadId,
        inReplyTo,
      });
      await row.update({
        status: OutreachStatus.SENT,
        sentAt: new Date(),
        gmailMessageId: sent.gmailMessageId,
        gmailThreadId: sent.gmailThreadId,
      });
      await this.professors.markFollowupSent(professorId);
      this.logger.log(`Follow-up sent to ${professor.professorName} <${professor.email}>`);
      return { ...base, recipient: professor.email, ok: true, gmailMessageId: sent.gmailMessageId };
    } catch (err) {
      const error = (err as Error).message;
      await row.update({ status: OutreachStatus.FAILED, error });
      this.logger.warn(`Follow-up failed for ${professor.professorName}: ${error}`);
      return { ...base, recipient: professor.email, ok: false, error };
    }
  }

  /** Step 9 batch: check replies first, then follow up those now due (quota-bounded). */
  async sendDueFollowups(opts?: { limit?: number; delayMs?: number }): Promise<{
    due: number;
    sent: number;
    failed: number;
    outcomes: SendOutcome[];
  }> {
    const delayMs = opts?.delayMs ?? 4000;
    const today = new Date().toISOString().slice(0, 10);
    const sentToday = await this.countSentToday();
    const remaining = Math.max(0, this.dailyMax - sentToday);
    const limit = Math.min(opts?.limit ?? remaining, remaining);

    const outcomes: SendOutcome[] = [];
    if (limit > 0) {
      const due = await this.professors.findDueFollowups(today, 50);
      const eligible = due.filter((p) => isProfessorWorkingHours(p.country));
      for (const professor of eligible.slice(0, limit)) {
        outcomes.push(await this.sendFollowup(professor.id));
        if (delayMs) await this.sleep(delayMs);
      }
    }
    const sent = outcomes.filter((o) => o.ok).length;
    return { due: outcomes.length, sent, failed: outcomes.length - sent, outcomes };
  }

  list(): Promise<OutreachEmail[]> {
    return this.outreachModel.findAll({ order: [['createdAt', 'DESC']] });
  }

  /** Count emails actually sent since local midnight (for the daily quota). */
  private async countSentToday(): Promise<number> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return this.outreachModel.count({
      where: { status: OutreachStatus.SENT, sentAt: { [Op.gte]: start } },
    });
  }

  private followupDate(): string {
    const d = new Date();
    d.setDate(d.getDate() + this.followupDays);
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
