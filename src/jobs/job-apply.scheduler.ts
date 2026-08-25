import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobRunsService } from '../job-runs/job-runs.service';
import { JobApplyService } from './apply/job-apply.service';
import { JobPrepareService } from './documents/job-prepare.service';
import { JobsService } from './jobs.service';

const JOB = 'job-prepare';

/**
 * Behind-the-scenes job pipeline that builds and (optionally) works a
 * review-ready queue on its own, on an hourly tick:
 *   1. AUTO-PREP (JOB_AUTOPREP): tailor CVs for matched leads → READY.
 *   2. AUTO-APPLY (JOB_AUTOAPPLY): for READY leads, fill the form headless and
 *      submit ONLY the ones that complete 100% cleanly — the same conservative
 *      "auto-submit clean" policy the user chose. Forms that need a human step
 *      (CAPTCHA, unanswerable required field, no reachable form) are cancelled
 *      to free the browser and left for assisted review; nothing incomplete or
 *      fabricated is ever sent (submit() verifies before marking APPLIED).
 *      A daily cap (JOB_APPLY_DAILY_MAX) bounds how many go out per day.
 *
 * Runs headless when APPLY_HEADFUL=false — no browser window appears. Both
 * auto steps are OFF by default; toggle via env or POST /jobs/autoprep.
 */
@Injectable()
export class JobApplyScheduler implements OnModuleInit {
  private readonly logger = new Logger(JobApplyScheduler.name);
  private enabled: boolean;
  private autoApply: boolean;
  private readonly perTickMax: number;
  private readonly applyPerTick: number;
  private readonly dailyCap: number;
  private ticking = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prepare: JobPrepareService,
    private readonly apply: JobApplyService,
    private readonly jobs: JobsService,
    private readonly jobRuns: JobRunsService,
  ) {
    this.enabled = /^true$/i.test(this.config.get<string>('JOB_AUTOPREP') ?? 'false');
    this.autoApply = /^true$/i.test(this.config.get<string>('JOB_AUTOAPPLY') ?? 'false');
    this.perTickMax = Number(this.config.get('JOB_PREP_PER_TICK_MAX') ?? 3);
    this.applyPerTick = Number(this.config.get('JOB_APPLY_PER_TICK_MAX') ?? 3);
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
      dailyCap: this.dailyCap,
    };
  }

  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    if (this.ticking) return;
    if (!this.enabled && !this.autoApply) return;
    this.ticking = true;
    try {
      await this.jobRuns.markRunning(JOB);
      let summary = '';
      if (this.enabled) {
        const res = await this.prepare.preparePending(this.perTickMax);
        if (res.processed > 0) this.logger.log(`Prepare tick: ${res.ok}/${res.processed} prepared`);
        summary += `prepared ${res.ok}/${res.processed}`;
      }
      if (this.autoApply) {
        const applied = await this.autoApplyClean();
        summary += `${summary ? '; ' : ''}applied ${applied}`;
      }
      await this.jobRuns.markSuccess(JOB, summary || 'noop');
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`Job tick failed: ${msg}`);
      await this.jobRuns.markError(JOB, msg);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Fill + submit READY leads headless, sending only the ones that complete
   * cleanly. Bounded by the remaining daily cap and the per-tick limit. Returns
   * how many were actually submitted this tick.
   */
  private async autoApplyClean(): Promise<number> {
    const submittedToday = await this.jobs.countSubmittedToday().catch(() => 0);
    let budget = Math.max(0, this.dailyCap - submittedToday);
    if (budget <= 0) {
      this.logger.log(`Auto-apply: daily cap reached (${submittedToday}/${this.dailyCap}).`);
      return 0;
    }
    const ready = await this.jobs.findReadyToApply(Math.min(this.applyPerTick, budget));
    let submitted = 0;
    for (const lead of ready) {
      if (budget <= 0) break;
      try {
        const started = await this.apply.start(lead.id);
        if (started?.status !== 'pending_review' || !started.sessionId) {
          // No reachable/fillable form — start() already recorded it; move on.
          continue;
        }
        const result = await this.apply.submit(started.sessionId);
        if (result?.submitted) {
          submitted++;
          budget--;
          this.logger.log(`Auto-apply: submitted "${lead.title}" @ ${lead.company}`);
        } else {
          // Not clean (CAPTCHA / required judgment field). Free the browser and
          // leave it for assisted review rather than sending something partial.
          await this.apply.cancel(started.sessionId).catch(() => undefined);
          this.logger.log(`Auto-apply: held "${lead.title}" for review (not clean).`);
        }
      } catch (err) {
        this.logger.warn(`Auto-apply failed for "${lead.title}": ${(err as Error).message}`);
      }
    }
    if (submitted > 0) this.logger.log(`Auto-apply tick: ${submitted} submitted (cap ${this.dailyCap}/day).`);
    return submitted;
  }
}
