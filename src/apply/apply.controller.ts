import {
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
import { ApplyService } from './apply.service';

/**
 * Assisted-apply endpoints (human-in-the-loop). Flow:
 *   POST /apply/:professorId/start   → fills the form, holds it open for review
 *   GET  /apply/session/:id          → the fill plan / results
 *   GET  /apply/session/:id/screenshot → PNG of the filled form
 *   POST /apply/session/:id/submit   → approve + submit + mark APPLIED
 *   POST /apply/session/:id/cancel   → discard without submitting
 */
@Controller('apply')
export class ApplyController {
  constructor(private readonly apply: ApplyService) {}

  @Post(':professorId/start')
  start(@Param('professorId') professorId: string, @Query('force') force?: string) {
    return this.apply.start(professorId, { force: /^(1|true)$/i.test(force ?? '') });
  }

  @Get('session/:id')
  session(@Param('id') id: string) {
    return this.apply.getSession(id);
  }

  @Get('session/:id/screenshot')
  screenshot(@Param('id') id: string, @Res() res: Response) {
    const { screenshotPath } = this.apply.getSession(id);
    if (!screenshotPath || !existsSync(screenshotPath)) {
      throw new NotFoundException('Screenshot not available.');
    }
    res.setHeader('Content-Type', 'image/png');
    res.sendFile(resolve(screenshotPath));
  }

  @Post('session/:id/submit')
  submit(@Param('id') id: string) {
    return this.apply.submit(id);
  }

  @Post('session/:id/cancel')
  cancel(@Param('id') id: string) {
    return this.apply.cancel(id);
  }
}
