import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GmailService } from '../gmail/gmail.service';
import { MastersService, ProgramWithTiming } from './masters.service';

/**
 * Milestone-only notifier for the Erasmus Mundus tracker. It does NOT email
 * every day — it emails Umer ONLY on real, actionable dates:
 *   - the day a programme's application window OPENS (once, with the apply link),
 *   - a short heads-up before it opens, and
 *   - a couple of reminders as the deadline approaches.
 * Programmes with unverified/unknown dates are never emailed (nothing to act on
 * — they're just logged). Each milestone fires exactly once (tracked in memory),
 * so the hourly catch-up can't re-send. The only side effect is one email to
 * Umer himself — never a professor or any third party.
 */
@Injectable()
export class MastersScheduler implements OnModuleInit {
  private readonly logger = new Logger(MastersScheduler.name);
  private readonly emailEnabled: boolean;
  private readonly notifyTo: string;

  /** Heads-up these many days BEFORE a programme opens. */
  private readonly openHeadsupDays = [7];
  /** Reminders these many days BEFORE a deadline (plus the close day, 0). */
  private readonly closeReminderDays = [7, 1, 0];

  /** Fired-once guards (in memory; a restart may re-send at most one per type). */
  private readonly notifiedOpen = new Set<string>(); // programId
  private readonly sentOpenHeadsup = new Set<string>(); // `${id}:${T}`
  private readonly sentCloseReminder = new Set<string>(); // `${id}:${T}`

  private static readonly TERMINAL = ['submitted', 'accepted', 'rejected', 'withdrawn'];

  constructor(
    private readonly masters: MastersService,
    private readonly gmail: GmailService,
    private readonly config: ConfigService,
  ) {
    this.emailEnabled = /^true$/i.test(this.config.get<string>('MASTERS_REMINDERS_EMAIL') ?? 'false');
    this.notifyTo =
      this.config.get<string>('MASTERS_NOTIFY_TO') ??
      this.config.get<string>('GMAIL_SENDER') ??
      '';
  }

  onModuleInit(): void {
    this.logger.log(
      `Masters milestone notifier ready. email=${this.emailEnabled ? 'ON' : 'OFF'} ` +
        `notifyTo=${this.notifyTo || '(unset)'} — fires only on open/close dates, not daily.`,
    );
  }

  /** Check once a day at 09:00 local. */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async dailyCheck(): Promise<void> {
    await this.run('daily');
  }

  /** Catch-up: machines sleep, so re-check hourly — but only unfired milestones email. */
  @Cron(CronExpression.EVERY_HOUR)
  async hourlyCatchUp(): Promise<void> {
    await this.run('hourly');
  }

  private async run(trigger: string): Promise<void> {
    if (!this.emailEnabled) return; // reminders switched off — stay silent

    let programs: ProgramWithTiming[];
    try {
      programs = await this.masters.findAll();
    } catch (err) {
      this.logger.warn(`Masters milestone check failed: ${(err as Error).message}`);
      return;
    }
    const active = programs.filter((p) => !MastersScheduler.TERMINAL.includes(p.status));

    // Collect only milestones that haven't fired yet.
    const lines: string[] = [];
    const marks: Array<() => void> = [];
    const opened: ProgramWithTiming[] = [];

    for (const p of active) {
      const dOpen = p.daysUntilOpen;
      const dClose = p.daysUntilClose;

      // 1) OPEN NOW — window is open and we haven't announced it yet. Keyed on
      //    "first time seen open" (not the exact day) so a slept-through open
      //    day still fires once when the machine wakes.
      const isOpen = dOpen != null && dOpen <= 0 && (dClose == null || dClose >= 0);
      if (isOpen && !this.notifiedOpen.has(p.id)) {
        const left = dClose != null ? `, ${dClose}d left` : '';
        lines.push(`🚀 OPEN NOW — ${p.code}: APPLY HERE → ${p.portalUrl}` +
          (p.closesAt ? ` (apply before ${p.closesAt}${left})` : ''));
        marks.push(() => this.notifiedOpen.add(p.id));
        opened.push(p);
      } else if (dOpen != null && dOpen > 0) {
        // 2) Heads-up before opening.
        for (const T of this.openHeadsupDays) {
          const key = `${p.id}:${T}`;
          if (dOpen <= T && !this.sentOpenHeadsup.has(key)) {
            lines.push(`🟢 OPENS in ${dOpen}d — ${p.code}: ${p.opensAt} → ${p.portalUrl}`);
            marks.push(() => this.sentOpenHeadsup.add(key));
            break;
          }
        }
      }

      // 3) Deadline reminders (independent of open state).
      if (dClose != null && dClose >= 0) {
        for (const T of this.closeReminderDays) {
          const key = `${p.id}:${T}`;
          if (dClose <= T && !this.sentCloseReminder.has(key)) {
            const label = dClose === 0 ? 'CLOSES TODAY' : `CLOSES in ${dClose}d`;
            lines.push(`⏳ ${label} — ${p.code}: deadline ${p.closesAt} → ${p.portalUrl}`);
            marks.push(() => this.sentCloseReminder.add(key));
          }
        }
      }
    }

    if (!lines.length) return; // no new milestone today — no email

    const body =
      `Erasmus Mundus master's — ${lines.length} update(s):\n\n${lines.join('\n')}\n\n` +
      `You apply yourself — just click the link(s) above.\n`;
    this.logger.log(`[${trigger}] ${lines.length} milestone(s):\n${body}`);

    if (!this.notifyTo || !this.gmail.isConnected()) {
      // Can't send yet (e.g. Gmail token expired). Do NOT mark — retry next run.
      this.logger.warn('Masters milestone email pending: Gmail not connected / no recipient.');
      return;
    }

    try {
      const openCodes = opened.map((p) => p.code);
      const subject = openCodes.length
        ? `🚀 Erasmus Mundus OPEN NOW: ${openCodes.join(', ')} — apply`
        : `Erasmus Mundus master's — ${lines.length} update(s)`;
      await this.gmail.send({ to: this.notifyTo, subject, text: body });
      this.logger.log(`Milestone email sent to ${this.notifyTo}`);
    } catch (err) {
      this.logger.warn(`Milestone email failed (will retry): ${(err as Error).message}`);
      return; // don't mark — so it retries and isn't lost
    }

    // Sent successfully — mark everything fired and flip newly-open programmes.
    marks.forEach((m) => m());
    for (const p of opened) {
      if (p.status !== 'open') {
        try {
          await this.masters.updateProgram(p.id, { status: 'open' });
        } catch {
          /* non-fatal */
        }
      }
    }
  }
}
