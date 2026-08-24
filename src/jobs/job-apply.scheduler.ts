import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobRunsService } from '../job-runs/job-runs.service';
import { JobPrepareService } from './documents/job-prepare.service';

const JOB = 'job-prepare';

/**
 * Auto-prepares documents for matched leads so a review-ready queue builds up
 * on its own. It NEVER opens a browser or submits — actual applying is always
 * human-triggered (POST /jobs/apply/:listingId/start) and human-submitted.
 * OFF by default; toggle via POST /jobs/autoprep or JOB_AUTOPREP=true.
 */
@Injectable()
export class JobApplyScheduler implements OnModuleInit {
  private readonly logger = new Logger(JobApplyScheduler.name);
  private enabled: boolean;
  private readonly perTickMax: number;
  private ticking = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prepare: JobPrepareService,
    private readonly jobRuns: JobRunsService,
  ) {
    this.enabled = /^true$/i.test(this.config.get<string>('JOB_AUTOPREP') ?? 'false');
    this.perTickMax = Number(this.config.get('JOB_PREP_PER_TICK_MAX') ?? 3);
  }

  onModuleInit(): void {
    this.logger.log(`Job prepare scheduler ready. auto-prep=${this.enabled ? 'ON' : 'OFF'} perTick<=${this.perTickMax}`);
  }

  setEnabled(on: boolean): boolean {
    this.enabled = on;
    this.logger.log(`Auto-prep ${on ? 'ENABLED' : 'DISABLED'} at runtime.`);
    return this.enabled;
  }

  status() {
    return { enabled: this.enabled, perTickMax: this.perTickMax };
  }

  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    if (!this.enabled || this.ticking) return;
    this.ticking = true;
    try {
      await this.jobRuns.markRunning(JOB);
      const res = await this.prepare.preparePending(this.perTickMax);
      if (res.processed > 0) this.logger.log(`Prepare tick: ${res.ok}/${res.processed} prepared`);
      await this.jobRuns.markSuccess(JOB, `prepared ${res.ok}/${res.processed}`);
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`Prepare tick failed: ${msg}`);
      await this.jobRuns.markError(JOB, msg);
    } finally {
      this.ticking = false;
    }
  }
}
