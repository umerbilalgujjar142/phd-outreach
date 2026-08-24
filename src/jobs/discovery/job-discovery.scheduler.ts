import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { JobRunsService } from '../../job-runs/job-runs.service';
import { JOB_DISCOVERY_JOB, JOB_DISCOVERY_QUEUE } from '../../queue/queue.constants';

// Fixed daily anchor: 09:00 Dubai (= 05:00 UTC, no DST) — an hour before the
// PhD sweep so the two don't contend for the browser.
const RUN_HOUR_UTC = 5;

/**
 * Runs the job-board discovery sweep once per day (09:00 Dubai), with the same
 * hibernation-safe boot + hourly catch-up as DiscoveryScheduler: if today's
 * anchor has passed and we haven't succeeded since, enqueue now.
 */
@Injectable()
export class JobDiscoveryScheduler implements OnModuleInit {
  private readonly logger = new Logger(JobDiscoveryScheduler.name);

  constructor(
    @InjectQueue(JOB_DISCOVERY_QUEUE) private readonly queue: Queue,
    private readonly jobRuns: JobRunsService,
  ) {}

  async onModuleInit() {
    await this.enqueueIfMissed('boot catch-up');
  }

  @Cron('0 9 * * *', { timeZone: 'Asia/Dubai' })
  async dailyRun() {
    await this.enqueueIfMissed('daily 09:00 Dubai');
  }

  @Cron(CronExpression.EVERY_HOUR)
  async catchUpTick() {
    await this.enqueueIfMissed('hourly catch-up');
  }

  private async enqueueIfMissed(trigger: string) {
    if (!(await this.missedTodaysRun())) return;
    await this.queue.add(
      JOB_DISCOVERY_JOB,
      {},
      { jobId: `job-discovery-${new Date().toISOString().slice(0, 10)}` },
    );
    this.logger.log(`Enqueued job-discovery sweep (${trigger})`);
  }

  private async missedTodaysRun(): Promise<boolean> {
    const now = Date.now();
    const anchor = this.todaysAnchorUtcMs();
    if (now < anchor) return false;
    const row = await this.jobRuns.get('job-discovery');
    const lastSuccess = row?.lastSuccessAt ? new Date(row.lastSuccessAt).getTime() : 0;
    return lastSuccess < anchor;
  }

  private todaysAnchorUtcMs(): number {
    const d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), RUN_HOUR_UTC, 0, 0, 0);
  }
}
