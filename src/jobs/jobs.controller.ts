import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { JobApplyService } from './apply/job-apply.service';
import { JobDiscoveryService } from './discovery/job-discovery.service';
import { JobPrepareService } from './documents/job-prepare.service';
import { JobApplyScheduler } from './job-apply.scheduler';
import { JobsService } from './jobs.service';
import { JobApplicationStatus, JobListingStatus, RoleType } from './job-status.enum';

@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly discovery: JobDiscoveryService,
    private readonly prepare: JobPrepareService,
    private readonly apply: JobApplyService,
    private readonly scheduler: JobApplyScheduler,
  ) {}

  // ---- listings & stats ----------------------------------------------

  @Get()
  list(
    @Query('status') status?: JobListingStatus,
    @Query('roleType') roleType?: RoleType,
    @Query('withinDays') withinDays?: string,
  ) {
    return this.jobs.findAll({ status, roleType, withinDays: withinDays ? Number(withinDays) : undefined });
  }

  @Get('stats')
  stats() {
    return this.jobs.stats();
  }

  @Get('scheduler')
  schedulerStatus() {
    return this.scheduler.status();
  }

  // ---- pipeline triggers ---------------------------------------------

  /** Run a discovery sweep now (all sources). */
  @Post('discovery/run')
  runDiscovery() {
    return this.discovery.runDiscovery();
  }

  /** Re-score all stored listings with the current matching rules. */
  @Post('rematch')
  rematch() {
    return this.discovery.rematchAll();
  }

  /** Prepare documents for a batch of matched leads now. */
  @Post('prepare/run')
  runPrepare(@Body('limit') limit?: number) {
    return this.prepare.preparePending(limit ?? 5);
  }

  /** Toggle the auto-prepare scheduler. */
  @Post('autoprep')
  autoprep(@Body('enabled') enabled: boolean) {
    return { enabled: this.scheduler.setEnabled(!!enabled) };
  }

  /** Toggle the auto-apply scheduler (submits clean forms without review). */
  @Post('autoapply')
  autoapply(@Body('enabled') enabled: boolean) {
    return { autoApply: this.scheduler.setAutoApply(!!enabled) };
  }

  /** Kick an apply run right now instead of waiting for the hourly tick. */
  @Post('apply/run')
  runApply() {
    return this.scheduler.runNow();
  }

  // ---- tracker --------------------------------------------------------

  /** Flat application tracker (one row per application, everything snapshotted). */
  @Get('tracker')
  tracker(
    @Query('status') status?: JobApplicationStatus,
    @Query('country') country?: string,
    @Query('portal') portal?: string,
  ) {
    return this.jobs.trackerRows({ status, country, portal });
  }

  /** Rollup counts: totals by status / country / portal / role. */
  @Get('tracker/summary')
  trackerSummary() {
    return this.jobs.trackerSummary();
  }

  // ---- applied log (clean "what I actually applied to" table) ---------

  /** Clean log of jobs actually applied to (one row per listing), newest first. */
  @Get('applied')
  applied(@Query('country') country?: string, @Query('portal') portal?: string) {
    return this.jobs.appliedLog({ country, portal });
  }

  /** Just what was applied to today (since local midnight). */
  @Get('applied/today')
  appliedToday() {
    return this.jobs.appliedToday();
  }

  /** Applied rollup: total, today, and counts by country / portal / role. */
  @Get('applied/summary')
  appliedSummary() {
    return this.jobs.appliedSummary();
  }

  // ---- assisted apply -------------------------------------------------

  @Post('apply/:listingId/start')
  startApply(@Param('listingId') listingId: string) {
    return this.apply.start(listingId);
  }

  @Get('apply/session/:id')
  applySession(@Param('id') id: string) {
    const s = this.apply.getSession(id);
    return {
      sessionId: s.id,
      listingId: s.listingId,
      title: s.title,
      company: s.company,
      applyUrl: s.applyUrl,
      filled: s.filled,
      skipped: s.skipped,
      screenshotPath: s.screenshotPath,
    };
  }

  @Get('apply/session/:id/screenshot')
  applyScreenshot(@Param('id') id: string, @Res() res: Response) {
    const { screenshotPath } = this.apply.getSession(id);
    if (!screenshotPath || !existsSync(screenshotPath)) {
      throw new NotFoundException('Screenshot not available.');
    }
    res.setHeader('Content-Type', 'image/png');
    res.sendFile(resolve(screenshotPath));
  }

  @Post('apply/session/:id/submit')
  submitApply(@Param('id') id: string) {
    return this.apply.submit(id);
  }

  @Post('apply/session/:id/cancel')
  cancelApply(@Param('id') id: string) {
    return this.apply.cancel(id);
  }

  // ---- single listing (keep LAST: ':id' is a catch-all param) --------

  @Get(':id')
  get(@Param('id') id: string) {
    return this.jobs.findOne(id);
  }

  @Post(':id/prepare')
  prepareOne(@Param('id') id: string) {
    return this.jobs.findOne(id).then((l) => this.prepare.prepareOne(l));
  }

  @Post(':id/park')
  park(@Param('id') id: string) {
    return this.jobs.setStatus(id, JobListingStatus.SKIPPED);
  }
}
