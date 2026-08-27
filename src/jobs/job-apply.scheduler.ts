import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { JOB_APPLY_JOB, JOB_APPLY_QUEUE } from '../queue/queue.constants';

/**
 * Behind-the-scenes job pipeline. This class is now only the ENQUEUE trigger:
 * an hourly Cron pushes a job onto the `job-apply` BullMQ queue (visible in Bull
 * Board), and JobApplyProcessor does the work with concurrency 1:
 *   1. AUTO-PREP (JOB_AUTOPREP): tailor CVs for matched leads → READY.
 *   2. AUTO-APPLY (JOB_AUTOAPPLY): for READY leads, fill the form headless and
 *      submit ONLY the ones that complete 100% cleanly. A daily cap
 *      (JOB_APPLY_DAILY_MAX) bounds how many go out per day.
 *
 * Both auto steps are OFF by default; toggle via env or POST /jobs/autoprep.
 * The runtime toggles and status still live here (used by JobsController).
 */
@Injectable()
export class JobApplyScheduler implements OnModuleInit {
  private readonly logger = new Logger(JobApplyScheduler.name);
  private enabled: boolean;
  private autoApply: boolean;
  private readonly perTickMax: number;
  private readonly applyPerTick: number;
  private readonly attemptsPerTick: number;
  private readonly dailyCap: number;

  constructor(
    @InjectQueue(JOB_APPLY_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {
    this.enabled = /^true$/i.test(this.config.get<string>('JOB_AUTOPREP') ?? 'false');
    this.autoApply = /^true$/i.test(this.config.get<string>('JOB_AUTOAPPLY') ?? 'false');
    this.perTickMax = Number(this.config.get('JOB_PREP_PER_TICK_MAX') ?? 3);
    this.applyPerTick = Number(this.config.get('JOB_APPLY_PER_TICK_MAX') ?? 3);
    // How many READY leads to *try* per tick. Most attempts on aggregator boards
    // fail fast (redirect / no form) and get parked, so we try more than we'll
    // submit to actually drain the backlog rather than re-poke the same top leads.
    this.attemptsPerTick = Number(this.config.get('JOB_APPLY_ATTEMPTS_PER_TICK') ?? 12);
    this.dailyCap = Number(this.config.get('JOB_APPLY_DAILY_MAX') ?? 10);
  }

  onModuleInit(): void {
    this.logger.log(
      `Job scheduler ready. auto-prep=${this.enabled ? 'ON' : 'OFF'} ` +
        `auto-apply=${this.autoApply ? 'ON' : 'OFF'} ` +
        `prep<=${this.perTickMax}/tick apply<=${this.applyPerTick}/tick cap=${this.dailyCap}/day`,
    );
  }

  setEnabled(on: boolean): boolean {
    this.enabled = on;
    this.logger.log(`Auto-prep ${on ? 'ENABLED' : 'DISABLED'} at runtime.`);
    return this.enabled;
  }

  setAutoApply(on: boolean): boolean {
    this.autoApply = on;
    this.logger.log(`Auto-apply ${on ? 'ENABLED' : 'DISABLED'} at runtime.`);
    return this.autoApply;
  }

  status() {
    return {
      autoPrep: this.enabled,
      autoApply: this.autoApply,
      perTickMax: this.perTickMax,
      applyPerTick: this.applyPerTick,
      attemptsPerTick: this.attemptsPerTick,
      dailyCap: this.dailyCap,
    };
  }

  /**
   * Enqueue an apply run immediately (used by POST /jobs/apply/run) instead of
   * waiting for the top of the hour. Forces the apply step on regardless of the
   * autoApply toggle; a unique jobId means it is never de-duped against the
   * hourly tick.
   */
  async runNow(): Promise<{ enqueued: boolean; jobId: string }> {
    const jobId = `${JOB_APPLY_JOB}-run-${Date.now()}`;
    await this.queue.add(
      JOB_APPLY_JOB,
      {
        prep: this.enabled,
        apply: true,
        perTickMax: this.perTickMax,
        applyPerTick: this.applyPerTick,
        attemptsPerTick: this.attemptsPerTick,
        dailyCap: this.dailyCap,
      },
      { jobId },
    );
    this.logger.log(`Manual apply run enqueued (${jobId}).`);
    return { enqueued: true, jobId };
  }

  /**
   * Hourly trigger. Enqueues a single prepare-and-apply job carrying the current
   * toggles/limits. A per-hour jobId de-dupes so a long apply run (browser work)
   * is never piled on by the next tick.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    if (!this.enabled && !this.autoApply) return;
    await this.queue.add(
      JOB_APPLY_JOB,
      {
        prep: this.enabled,
        apply: this.autoApply,
        perTickMax: this.perTickMax,
        applyPerTick: this.applyPerTick,
        attemptsPerTick: this.attemptsPerTick,
        dailyCap: this.dailyCap,
      },
      { jobId: `${JOB_APPLY_JOB}-${new Date().toISOString().slice(0, 13)}` },
    );
  }
}
