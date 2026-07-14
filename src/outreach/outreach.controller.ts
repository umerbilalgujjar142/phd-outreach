import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { OutreachService } from './outreach.service';
import { SendScheduler } from './send.scheduler';

@Controller('outreach')
export class OutreachController {
  constructor(
    private readonly outreach: OutreachService,
    private readonly scheduler: SendScheduler,
  ) {}

  /** Auto-send scheduler status (enabled, window, gmail connection). */
  @Get('scheduler')
  schedulerStatus() {
    return this.scheduler.status();
  }

  /** Turn the automated daily sending on/off at runtime. Body: { enabled }. */
  @Post('autosend')
  setAutosend(@Body() body: { enabled?: boolean } = {}) {
    return { enabled: this.scheduler.setEnabled(!!body.enabled) };
  }

  /** All outreach email rows, newest first. */
  @Get()
  list() {
    return this.outreach.list();
  }

  /** PROJECT.md Step 5 gate: send a test email to Umer's own address first. */
  @Post('test-self')
  testSelf() {
    return this.outreach.sendTestToSelf();
  }

  /** Daily batch send (respects the remaining daily quota). */
  @Post('run')
  run(@Body() body: { limit?: number; delayMs?: number } = {}) {
    return this.outreach.sendDailyBatch(body);
  }

  /** Send the initial email to one professor by id. */
  @Post('send/:professorId')
  send(@Param('professorId') professorId: string) {
    return this.outreach.sendToProfessor(professorId);
  }

  /** Re-send a CORRECTED initial email (fixed template/snippet) in-thread. */
  @Post('resend-corrected/:professorId')
  resendCorrected(@Param('professorId') professorId: string) {
    return this.outreach.resendCorrectedInitial(professorId);
  }

  /** Step 8: scan threads and mark any that received a reply. */
  @Post('check-replies')
  checkReplies() {
    return this.outreach.checkReplies();
  }

  /** Step 9: send follow-ups to professors now due (quota-bounded). */
  @Post('followups/run')
  runFollowups(@Body() body: { limit?: number; delayMs?: number } = {}) {
    return this.outreach.sendDueFollowups(body);
  }

  /** Step 9: send a follow-up to one professor by id. */
  @Post('followups/:professorId')
  followup(@Param('professorId') professorId: string) {
    return this.outreach.sendFollowup(professorId);
  }
}
