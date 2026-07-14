import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { JobRunsService } from '../job-runs/job-runs.service';
import { DISCOVERY_JOB, DISCOVERY_QUEUE } from '../queue/queue.constants';
import { DiscoveryService } from './discovery.service';

// Fixed daily anchor: 10:00 in Dubai. Dubai (Asia/Dubai) is UTC+4 with NO DST,
// so 10:00 Dubai is always 06:00 UTC — used by the catch-up math below.
const RUN_HOUR_UTC = 6;

// Depth of the daily sweep: ~20 listing pages ≈ the 200 newest postings, which
// comfortably covers a full previous day (incl. late-night posts) plus margin.
// Overlap with already-stored positions is harmless — the upsert dedupes on
// sourceUrl. (Scanning ALL of EURAXESS would be thousands of pages: slow and
// rate-limit-prone for no gain, since a day never produces that many.)
const DISCOVERY_PAGES = 20;

/**
 * Runs the discovery sweep once per day, anchored to 10:00 Dubai time (Section
 * 2/4). A fixed-time cron alone would silently skip a day whenever the laptop
 * is hibernating at 10:00, so we ALSO catch up on boot and on an hourly safety
 * tick: if today's 10:00 anchor has passed and we haven't succeeded since, run
 * now. This gives a predictable daily time on a machine that's up, and a
 * guaranteed run on the next wake when it isn't.
 */
@Injectable()
export class DiscoveryScheduler implements OnModuleInit {
  private readonly logger = new Logger(DiscoveryScheduler.name);

  constructor(
    @InjectQueue(DISCOVERY_QUEUE) private readonly queue: Queue,
    private readonly jobRuns: JobRunsService,
    private readonly discovery: DiscoveryService,
  ) {}

  /** On startup, run today's sweep if 10:00 Dubai has passed and it's still due. */
  async onModuleInit() {
    await this.enqueueIfMissed('boot catch-up');
  }

  /** Primary trigger: fire at 10:00 Dubai every day. */
  @Cron('0 10 * * *', { timeZone: 'Asia/Dubai' })
  async dailyRun() {
    await this.enqueueIfMissed('daily 10:00 Dubai');
  }

  /**
   * Safety net for hibernation: if the machine was asleep at 10:00 (so the cron
   * above never fired) and later resumes while the process is still alive, this
   * hourly check runs the missed sweep at the next top-of-hour.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async catchUpTick() {
    await this.enqueueIfMissed('hourly catch-up');
  }

  /** Enqueue the daily sweep only if today's 10:00 run hasn't happened yet. */
  private async enqueueIfMissed(trigger: string) {
    if (!(await this.missedTodaysRun())) return;
    // De-dupe: a date-stamped jobId prevents piling up multiple pending scans
    // if several triggers fire close together (cron + hourly + boot).
    await this.queue.add(
      DISCOVERY_JOB,
      { maxPages: DISCOVERY_PAGES },
      { jobId: `discovery-${new Date().toISOString().slice(0, 10)}` },
    );
    this.logger.log(`Enqueued daily discovery sweep (${trigger})`);
  }

  /**
   * True when today's 10:00-Dubai anchor has already passed AND we have not had
   * a successful discovery run since that anchor. Before 10:00 Dubai this is
   * false (yesterday's run already covered yesterday's posts).
   */
  private async missedTodaysRun(): Promise<boolean> {
    const now = Date.now();
    const anchor = this.todaysAnchorUtcMs();
    if (now < anchor) return false; // 10:00 Dubai not reached yet today
    const row = await this.jobRuns.get('discovery');
    const lastSuccess = row?.lastSuccessAt ? new Date(row.lastSuccessAt).getTime() : 0;
    return lastSuccess < anchor;
  }

  /** Epoch ms of today's 10:00 Dubai (= 06:00 UTC) anchor. */
  private todaysAnchorUtcMs(): number {
    const d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), RUN_HOUR_UTC, 0, 0, 0);
  }
}
