import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { GmailService } from '../gmail/gmail.service';
import { OUTREACH_QUEUE, OUTREACH_REPLY_JOB, OUTREACH_SEND_JOB } from '../queue/queue.constants';

/**
 * Step 6 (PROJECT.md Section 8): rate-limited automated sending. Instead of one
 * daily burst (spam-flag risk), a light hourly tick sends only a few emails at
 * a time, spread across working hours, capped at the daily quota. Auto-send is
 * OFF by default so restarts never fire emails unexpectedly — toggle it on via
 * POST /outreach/autosend once you're ready to go live.
 *
 * This class is now only the ENQUEUE trigger: the Cron ticks push a job onto the
 * `outreach-send` BullMQ queue (visible in Bull Board), and SendProcessor does
 * the actual sending with concurrency 1. The runtime on/off toggle and status
 * still live here (used by OutreachController).
 */
@Injectable()
export class SendScheduler implements OnModuleInit {
  private readonly logger = new Logger(SendScheduler.name);
  private enabled: boolean;
  private readonly perTickMax: number;

  constructor(
    @InjectQueue(OUTREACH_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService,
    private readonly gmail: GmailService,
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
   * Hourly increment — enqueues a small, jittered, quota-bounded send job (each
   * professor is emailed only during THEIR local daytime, decided per-professor
   * inside the send batch). A per-hour jobId de-dupes so a long-running send is
   * never piled on by the next tick.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    if (!this.enabled) return;
    if (!this.gmail.isConnected()) {
      this.logger.warn('Auto-send on but Gmail not connected — skipping tick.');
      return;
    }
    await this.queue.add(
      OUTREACH_SEND_JOB,
      {
        perTickMax: this.perTickMax,
        limit: this.randomInt(1, this.perTickMax),
        delayMs: this.randomInt(3000, 9000),
      },
      { jobId: `${OUTREACH_SEND_JOB}-${this.hourBucket()}` },
    );
  }

  /**
   * Steps 8-9: every 3 hours, always check for replies (read-only, harmless),
   * and — when auto-send is on — send any follow-ups now due. The processor
   * enforces both; we pass the current toggle so the read-only reply check still
   * runs even while sending is paused.
   */
  @Cron(CronExpression.EVERY_3_HOURS)
  async replyTick(): Promise<void> {
    if (!this.gmail.isConnected()) return;
    await this.queue.add(
      OUTREACH_REPLY_JOB,
      { enabled: this.enabled, perTickMax: this.perTickMax, delayMs: this.randomInt(3000, 9000) },
      { jobId: `${OUTREACH_REPLY_JOB}-${this.hourBucket()}` },
    );
  }

  private randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /** `YYYY-MM-DDTHH` — a stable id per calendar hour for jobId de-duplication. */
  private hourBucket(): string {
    return new Date().toISOString().slice(0, 13);
  }
}
