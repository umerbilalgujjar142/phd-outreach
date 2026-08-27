import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { JobRunsService } from '../job-runs/job-runs.service';
import { JOB_APPLY_QUEUE } from '../queue/queue.constants';
import { JobApplyService } from './apply/job-apply.service';
import { JobPrepareService } from './documents/job-prepare.service';
import { JobsService } from './jobs.service';
import { JobListingStatus } from './job-status.enum';

const JOB = 'job-prepare';

/**
 * Worker for the `job-apply` queue. Runs the two behind-the-scenes steps that
 * JobApplyScheduler enqueues. Concurrency 1 with a long lock because the apply
 * step drives a headless browser and can run for minutes:
 *   1. AUTO-PREP: tailor CVs for matched leads → READY.
 *   2. AUTO-APPLY: fill READY leads headless, submit ONLY the ones that complete
 *      100% cleanly; anything needing a human step (CAPTCHA, judgment field, no
 *      reachable form) is cancelled and left for assisted review. Bounded by the
 *      remaining daily cap and the per-tick limit — nothing partial is ever sent.
 */
@Processor(JOB_APPLY_QUEUE, {
  concurrency: 1,
  lockDuration: 1_800_000,
  stalledInterval: 1_800_000,
  maxStalledCount: 1,
})
export class JobApplyProcessor extends WorkerHost {
  private readonly logger = new Logger(JobApplyProcessor.name);

  constructor(
    private readonly prepare: JobPrepareService,
    private readonly apply: JobApplyService,
    private readonly jobs: JobsService,
    private readonly jobRuns: JobRunsService,
  ) {
    super();
  }

  async process(job: Job<TickData>): Promise<string> {
    const { prep, apply, perTickMax, applyPerTick, attemptsPerTick, dailyCap } = job.data;
    await this.jobRuns.markRunning(JOB);
    try {
      let summary = '';
      if (prep) {
        const res = await this.prepare.preparePending(perTickMax);
        if (res.processed > 0) this.logger.log(`Prepare tick: ${res.ok}/${res.processed} prepared`);
        summary += `prepared ${res.ok}/${res.processed}`;
      }
      if (apply) {
        const applied = await this.autoApplyClean(applyPerTick, dailyCap, attemptsPerTick);
        summary += `${summary ? '; ' : ''}applied ${applied}`;
      }
      await this.jobRuns.markSuccess(JOB, summary || 'noop');
      return summary || 'noop';
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`Job tick failed: ${msg}`);
      await this.jobRuns.markError(JOB, msg);
      throw err;
    }
  }

  /**
   * Fill + submit READY leads headless, sending only the ones that complete
   * 100% cleanly. Two bounds:
   *   • submitBudget — how many may actually be SUBMITTED this run (min of the
   *     per-tick cap and the remaining daily cap). Nothing partial is ever sent.
   *   • attemptsPerTick — how many READY leads we may TRY. We try more than we'll
   *     submit because most aggregator leads fail fast (redirect / no form).
   *
   * Crucially, any lead we CANNOT auto-submit — no reachable form, CAPTCHA, a
   * login wall, a required human-judgment field, or a hard error — is PARKED
   * (status → skipped, with a reason). This is what drains the backlog: without
   * it the next tick just re-tries the same top-fit stuck leads forever. Fully
   * hands-off mode: we never wait on a human, we move on. Returns how many were
   * actually submitted this run.
   */
  private async autoApplyClean(
    applyPerTick: number,
    dailyCap: number,
    attemptsPerTick: number,
  ): Promise<number> {
    const submittedToday = await this.jobs.countSubmittedToday().catch(() => 0);
    const dayBudget = Math.max(0, dailyCap - submittedToday);
    if (dayBudget <= 0) {
      this.logger.log(`Auto-apply: daily cap reached (${submittedToday}/${dailyCap}).`);
      return 0;
    }
    let submitBudget = Math.min(applyPerTick, dayBudget);
    const ready = await this.jobs.findReadyToApply(Math.max(attemptsPerTick, applyPerTick));
    let submitted = 0;
    let parked = 0;
    for (const lead of ready) {
      if (submitBudget <= 0) break; // per-tick / daily submit cap hit — stop for now.
      try {
        const started = await this.apply.start(lead.id);
        if (started?.status !== 'pending_review' || !started.sessionId) {
          // No reachable/fillable form (redirect, bot wall, login). start()
          // already recorded the FAILED reason; park so we don't retry it.
          await this.park(lead.id, 'auto-apply: no reachable/fillable form');
          parked++;
          continue;
        }
        const result = await this.apply.submit(started.sessionId);
        if (result?.submitted) {
          submitted++;
          submitBudget--;
          this.logger.log(`Auto-apply: submitted "${lead.title}" @ ${lead.company}`);
        } else {
          // Not clean (CAPTCHA / required judgment field). Free the browser and,
          // since no human is in the loop, park it rather than re-trying forever.
          await this.apply.cancel(started.sessionId).catch(() => undefined);
          await this.park(lead.id, 'auto-apply: needs a human step (CAPTCHA / login / judgment field)');
          parked++;
          this.logger.log(`Auto-apply: parked "${lead.title}" (not clean).`);
        }
      } catch (err) {
        await this.park(lead.id, `auto-apply error: ${(err as Error).message}`).catch(() => undefined);
        parked++;
        this.logger.warn(`Auto-apply failed for "${lead.title}": ${(err as Error).message}`);
      }
    }
    if (submitted > 0 || parked > 0) {
      this.logger.log(`Auto-apply tick: ${submitted} submitted, ${parked} parked (cap ${dailyCap}/day).`);
    }
    return submitted;
  }

  /** Move a lead out of READY so it stops clogging the apply queue. */
  private async park(listingId: string, reason: string): Promise<void> {
    await this.jobs.setStatus(listingId, JobListingStatus.SKIPPED, reason);
  }
}

interface TickData {
  prep: boolean;
  apply: boolean;
  perTickMax: number;
  applyPerTick: number;
  attemptsPerTick: number;
  dailyCap: number;
}
