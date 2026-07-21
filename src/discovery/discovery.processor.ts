import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { JobRunsService } from '../job-runs/job-runs.service';
import { DISCOVERY_QUEUE } from '../queue/queue.constants';
import { DiscoveryService } from './discovery.service';

@Processor(DISCOVERY_QUEUE, {
  concurrency: 1,
  lockDuration: 600_000,
  stalledInterval: 600_000,
  maxStalledCount: 1,
})
export class DiscoveryProcessor extends WorkerHost {
  private readonly logger = new Logger(DiscoveryProcessor.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly jobRuns: JobRunsService,
  ) {
    super();
  }

  async process(job: Job<{ maxPages?: number }>) {
    this.logger.log(`Processing discovery job ${job.id} (${job.name})`);
    await this.jobRuns.markRunning('discovery');
    try {
      const results = await this.discovery.runDiscovery({
        maxPages: job.data?.maxPages,
      });
      const totals = results.reduce(
        (a, r) => ({
          scanned: a.scanned + r.scanned,
          matched: a.matched + r.matched,
          created: a.created + r.created,
        }),
        { scanned: 0, matched: 0, created: 0 },
      );
      await this.jobRuns.markSuccess(
        'discovery',
        results
          .map((r) => `${r.source}:${r.created}c/${r.matched}m/${r.scanned}s`)
          .join(' '),
      );
      this.logger.log(
        `Discovery totals: scanned=${totals.scanned} matched=${totals.matched} created=${totals.created}`,
      );
      return results;
    } catch (err) {
      await this.jobRuns.markError('discovery', (err as Error).message);
      throw err;
    }
  }
}
