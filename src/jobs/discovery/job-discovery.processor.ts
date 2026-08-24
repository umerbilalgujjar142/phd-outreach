import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { JobRunsService } from '../../job-runs/job-runs.service';
import { JOB_DISCOVERY_QUEUE } from '../../queue/queue.constants';
import { JobDiscoveryService } from './job-discovery.service';

@Processor(JOB_DISCOVERY_QUEUE, {
  concurrency: 1,
  lockDuration: 600_000,
  stalledInterval: 600_000,
  maxStalledCount: 1,
})
export class JobDiscoveryProcessor extends WorkerHost {
  private readonly logger = new Logger(JobDiscoveryProcessor.name);

  constructor(
    private readonly discovery: JobDiscoveryService,
    private readonly jobRuns: JobRunsService,
  ) {
    super();
  }

  async process(job: Job) {
    this.logger.log(`Processing job-discovery ${job.id} (${job.name})`);
    await this.jobRuns.markRunning('job-discovery');
    try {
      const results = await this.discovery.runDiscovery();
      const totals = results.reduce(
        (a, r) => ({
          scanned: a.scanned + r.scanned,
          matched: a.matched + r.matched,
          created: a.created + r.created,
        }),
        { scanned: 0, matched: 0, created: 0 },
      );
      await this.jobRuns.markSuccess(
        'job-discovery',
        results.map((r) => `${r.source}:${r.created}c/${r.matched}m/${r.scanned}s`).join(' '),
      );
      this.logger.log(
        `Job discovery totals: scanned=${totals.scanned} matched=${totals.matched} created=${totals.created}`,
      );
      return results;
    } catch (err) {
      await this.jobRuns.markError('job-discovery', (err as Error).message);
      throw err;
    }
  }
}
