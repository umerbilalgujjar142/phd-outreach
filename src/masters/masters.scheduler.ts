import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GmailService } from '../gmail/gmail.service';
import { MastersService } from './masters.service';

/**
 * Daily deadline watch for the Erasmus Mundus tracker. Once a day it checks for
 * programmes opening/closing soon (and any with still-unverified dates) and, if
 * reminder email is enabled, sends Umer a single digest. Read-only over the
 * data; the only side effect is one notification email to Umer himself — never
 * to a professor or any third party.
 */
@Injectable()
export class MastersScheduler implements OnModuleInit {
  private readonly logger = new Logger(MastersScheduler.name);
  private readonly emailEnabled: boolean;
  private readonly windowDays: number;
  private readonly notifyTo: string;
  private lastDigestKey = '';

  constructor(
    private readonly masters: MastersService,
    private readonly gmail: GmailService,
    private readonly config: ConfigService,
  ) {
    this.emailEnabled = /^true$/i.test(this.config.get<string>('MASTERS_REMINDERS_EMAIL') ?? 'false');
    this.windowDays = Number(this.config.get('MASTERS_REMINDER_WINDOW_DAYS') ?? 30);
    this.notifyTo =
      this.config.get<string>('MASTERS_NOTIFY_TO') ??
      this.config.get<string>('GMAIL_SENDER') ??
      '';
  }

  onModuleInit(): void {
    this.logger.log(
      `Masters deadline watch ready. email-reminders=${this.emailEnabled ? 'ON' : 'OFF'} ` +
        `window=${this.windowDays}d notifyTo=${this.notifyTo || '(unset)'}`,
    );
  }

  /** 09:00 local daily. Also catches up on boot via the second cron below. */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async dailyCheck(): Promise<void> {
    await this.run('daily');
  }

  /** Boot catch-up: machines sleep, so re-check shortly after startup too. */
  @Cron(CronExpression.EVERY_HOUR)
  async hourlyCatchUp(): Promise<void> {
    await this.run('hourly');
  }

  private async run(trigger: string): Promise<void> {
    let summary;
    try {
      summary = await this.masters.upcoming(this.windowDays);
    } catch (err) {
      this.logger.warn(`Masters deadline check failed: ${(err as Error).message}`);
      return;
    }
    const { openingSoon, closingSoon, needsVerification } = summary;
    if (!openingSoon.length && !closingSoon.length && !needsVerification.length) return;

    // One digest per calendar day — the hourly catch-up won't re-send.
    const dayKey = new Date().toISOString().slice(0, 10);
    if (this.lastDigestKey === dayKey) return;

    const lines: string[] = [];
    for (const p of closingSoon) {
      lines.push(`⏳ CLOSES in ${p.daysUntilClose}d — ${p.code}: deadline ${p.closesAt} (${p.portalUrl})`);
    }
    for (const p of openingSoon) {
      lines.push(`🟢 OPENS in ${p.daysUntilOpen}d — ${p.code}: opens ${p.opensAt} (${p.portalUrl})`);
    }
    for (const p of needsVerification) {
      lines.push(`❓ VERIFY dates — ${p.code}: ${p.datesSource}`);
    }
    const body = `Erasmus Mundus master's — deadline watch (${dayKey}):\n\n${lines.join('\n')}\n`;
    this.logger.log(`[${trigger}] ${lines.length} deadline item(s):\n${body}`);

    if (this.emailEnabled && this.notifyTo && this.gmail.isConnected()) {
      try {
        await this.gmail.send({
          to: this.notifyTo,
          subject: `Erasmus Mundus deadlines — ${closingSoon.length} closing, ${openingSoon.length} opening`,
          text: body,
        });
        this.logger.log(`Deadline digest emailed to ${this.notifyTo}`);
      } catch (err) {
        this.logger.warn(`Deadline digest email failed: ${(err as Error).message}`);
      }
    }
    this.lastDigestKey = dayKey;
  }
}
