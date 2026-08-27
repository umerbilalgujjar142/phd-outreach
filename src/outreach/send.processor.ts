import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { JobRunsService } from '../job-runs/job-runs.service';
import { PersonalizationService } from '../personalization/personalization.service';
import { OUTREACH_QUEUE, OUTREACH_REPLY_JOB, OUTREACH_SEND_JOB } from '../queue/queue.constants';
import { OutreachService } from './outreach.service';

const JOB = 'outreach-send';

/**
 * Worker for the `outreach-send` queue. Does the actual PhD outreach sending
 * that SendScheduler enqueues. Concurrency 1 keeps sends strictly serialized so
 * the quota and per-professor local-hour gating are never raced. Two job types:
 *   send-batch      — personalize a few pending, then send the jittered batch.
 *   reply-followup  — always check replies; send due follow-ups when enabled.
 */
@Processor(OUTREACH_QUEUE, {
  concurrency: 1,
  lockDuration: 600_000,
  stalledInterval: 600_000,
  maxStalledCount: 1,
})
export class SendProcessor extends WorkerHost {
  private readonly logger = new Logger(SendProcessor.name);

  constructor(
    private readonly outreach: OutreachService,
    private readonly personalization: PersonalizationService,
    private readonly jobRuns: JobRunsService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case OUTREACH_SEND_JOB:
        return this.sendBatch(job.data as SendData);
      case OUTREACH_REPLY_JOB:
        return this.replyFollowup(job.data as ReplyData);
      default:
        this.logger.warn(`Unknown outreach job "${job.name}" — skipping.`);
        return undefined;
    }
  }

  private async sendBatch({ perTickMax, limit, delayMs }: SendData) {
    await this.jobRuns.markRunning(JOB);
    try {
      // Keep the pool flowing: personalize a few pending before sending.
      await this.personalization.personalizePending(perTickMax);
      const res = await this.outreach.sendDailyBatch({ limit, delayMs });
      if (res.attempted > 0) {
        this.logger.log(
          `Tick: sent ${res.sent}/${res.attempted} (today=${res.sentToday + res.sent}, ` +
            `quota left=${res.remainingQuota - res.sent})`,
        );
      }
      await this.jobRuns.markSuccess(JOB, `sent ${res.sent}, quota left ${res.remainingQuota - res.sent}`);
      return res;
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`Send job failed: ${msg}`);
      await this.jobRuns.markError(JOB, msg);
      throw err;
    }
  }

  private async replyFollowup({ enabled, perTickMax, delayMs }: ReplyData) {
    const replies = await this.outreach.checkReplies();
    if (replies.newReplies > 0) {
      this.logger.log(`Reply check: ${replies.newReplies} new repl${replies.newReplies === 1 ? 'y' : 'ies'}`);
    }
    if (enabled) {
      const f = await this.outreach.sendDueFollowups({ limit: perTickMax, delayMs });
      if (f.sent > 0) this.logger.log(`Follow-ups: sent ${f.sent}/${f.due}`);
    }
    return replies;
  }
}

interface SendData {
  perTickMax: number;
  limit: number;
  delayMs: number;
}

interface ReplyData {
  enabled: boolean;
  perTickMax: number;
  delayMs: number;
}
