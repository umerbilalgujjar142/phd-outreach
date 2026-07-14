import { InjectQueue } from '@nestjs/bullmq';
import { Body, Controller, Get, Post } from '@nestjs/common';
import { Queue } from 'bullmq';
import { JobRunsService } from '../job-runs/job-runs.service';
import { DISCOVERY_JOB, DISCOVERY_QUEUE } from '../queue/queue.constants';
import { DiscoveryService } from './discovery.service';

@Controller('discovery')
export class DiscoveryController {
  constructor(
    @InjectQueue(DISCOVERY_QUEUE) private readonly queue: Queue,
    private readonly discovery: DiscoveryService,
    private readonly jobRuns: JobRunsService,
  ) {}

  /** Enqueue a discovery scan onto the BullMQ queue (async). */
  @Post('run')
  async run(@Body() body: { maxPages?: number }) {
    const job = await this.queue.add(DISCOVERY_JOB, {
      maxPages: body?.maxPages ?? 3,
    });
    return { enqueued: true, jobId: job.id };
  }

  /** Run ALL job-board sources synchronously and return per-source results. */
  @Post('run-now')
  runNow(@Body() body: { maxPages?: number }) {
    return this.discovery.runDiscovery({ maxPages: body?.maxPages ?? 2 });
  }

  /**
   * Re-check stored EURAXESS rows against the tightened matching rules.
   * Dry-run by default; pass { "delete": true } to remove off-topic rows.
   */
  @Post('revalidate')
  revalidate(@Body() body: { delete?: boolean } = {}) {
    return this.discovery.revalidateStored({ deleteOffTopic: body?.delete });
  }

  /** Last run info for the discovery job. */
  @Get('status')
  async status() {
    const [row, counts] = await Promise.all([
      this.jobRuns.get('discovery'),
      this.queue.getJobCounts('waiting', 'active', 'completed', 'failed'),
    ]);
    return { lastRun: row, queue: counts };
  }
}
