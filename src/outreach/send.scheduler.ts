import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GmailService } from '../gmail/gmail.service';
import { JobRunsService } from '../job-runs/job-runs.service';
import { PersonalizationService } from '../personalization/personalization.service';
import { OutreachService } from './outreach.service';

const JOB = 'outreach-send';

/**
 * Step 6 (PROJECT.md Section 8): rate-limited automated sending. Instead of one
 * daily burst (spam-flag risk), a light hourly tick sends only a few emails at
 * a time, spread across working hours, capped at the daily quota. Auto-send is
 * OFF by default so restarts never fire emails unexpectedly — toggle it on via
 * POST /outreach/autosend once you're ready to go live.
 */
@Injectable()
export class SendScheduler implements OnModuleInit {
  private readonly logger = new Logger(SendScheduler.name);
  private enabled: boolean;
  private readonly perTickMax: number;
  private ticking = false;

  constructor(
    private readonly config: ConfigService,
    private readonly outreach: OutreachService,
    private readonly personalization: PersonalizationService,
    private readonly gmail: GmailService,
    private readonly jobRuns: JobRunsService,
  ) {
    this.enabled = /^true$/i.test(this.config.get<string>('OUTREACH_AUTOSEND') ?? 'false');
    this.perTickMax = Number(this.config.get('SEND_PER_TICK_MAX') ?? 3);
  }

  onModuleInit(): void {
    this.logger.log(
      `Send scheduler ready. auto-send=${this.enabled ? 'ON' : 'OFF'} ` +
        `timing=per-professor local hours (Mon-Fri 9-17 THEIR time) perTick<=${this.perTickMax}`,
    );
  }

  setEnabled(on: boolean): boolean {
    this.enabled = on;
    this.logger.log(`Auto-send ${on ? 'ENABLED' : 'DISABLED'} at runtime.`);
    return this.enabled;
  }

  status() {
    return {
      enabled: this.enabled,
      gmailConnected: this.gmail.isConnected(),
      timing: 'per-professor local working hours (Mon-Fri 09:00-17:00 in their country)',
      perTickMax: this.perTickMax,
    };
  }

  /**
   * Hourly increment — runs around the clock (each professor is emailed only
   * during THEIR local daytime, decided per-professor in the send batch), small,
   * jittered, quota-bounded.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    if (!this.enabled) return;
    if (this.ticking) return; // avoid overlap if a tick runs long
    if (!this.gmail.isConnected()) {
      this.logger.warn('Auto-send on but Gmail not connected — skipping tick.');
      return;
    }

    this.ticking = true;
    try {
      await this.jobRuns.markRunning(JOB);
      // Keep the pool flowing: personalize a few pending before sending.
      await this.personalization.personalizePending(this.perTickMax);

      const limit = this.randomInt(1, this.perTickMax);
      const delayMs = this.randomInt(3000, 9000);
      const res = await this.outreach.sendDailyBatch({ limit, delayMs });

      if (res.attempted > 0) {
        this.logger.log(
          `Tick: sent ${res.sent}/${res.attempted} (today=${res.sentToday + res.sent}, quota left=${res.remainingQuota - res.sent})`,
        );
      }
      await this.jobRuns.markSuccess(JOB, `sent ${res.sent}, quota left ${res.remainingQuota - res.sent}`);
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`Send tick failed: ${msg}`);
      await this.jobRuns.markError(JOB, msg);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Steps 8-9: every 3 hours, always check for replies (read-only, harmless),
   * and — when auto-send is on — send any follow-ups now due (each still gated
   * to the professor's local working hours inside sendDueFollowups).
   */
  @Cron(CronExpression.EVERY_3_HOURS)
  async replyTick(): Promise<void> {
    if (!this.gmail.isConnected()) return;
    try {
      const replies = await this.outreach.checkReplies();
      if (replies.newReplies > 0) {
        this.logger.log(`Reply check: ${replies.newReplies} new repl${replies.newReplies === 1 ? 'y' : 'ies'}`);
      }
      if (this.enabled) {
        const f = await this.outreach.sendDueFollowups({
          limit: this.perTickMax,
          delayMs: this.randomInt(3000, 9000),
        });
        if (f.sent > 0) this.logger.log(`Follow-ups: sent ${f.sent}/${f.due}`);
      }
    } catch (err) {
      this.logger.error(`Reply/follow-up tick failed: ${(err as Error).message}`);
    }
  }

  private randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
