import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { MastersService } from './masters.service';
import { MastersLetterService } from './masters-letter.service';
import { MastersRecService } from './masters-rec.service';
import { DocumentStatus, ProgramStatus, RecRequestStatus } from './masters-enums';

/**
 * HTTP surface for the Erasmus Mundus master's tracker. Everything is manual /
 * on-demand. The only email-sending endpoint (rec-request send) requires an
 * explicit call and an existing professor email — nothing sends on its own.
 */
@Controller('masters')
export class MastersController {
  constructor(
    private readonly masters: MastersService,
    private readonly letters: MastersLetterService,
    private readonly rec: MastersRecService,
  ) {}

  /** Insert/refresh the seed programmes (CYBERSURE, CYBERUS, CyberMACS). */
  @Post('seed')
  seed() {
    return this.masters.seed();
  }

  @Get('programs')
  listPrograms() {
    return this.masters.findAll();
  }

  @Get('deadlines')
  deadlines(@Query('windowDays') windowDays?: string) {
    return this.masters.upcoming(windowDays ? Number(windowDays) : undefined);
  }

  @Get('programs/:code')
  getProgram(@Param('code') code: string) {
    return this.masters.findByCode(code);
  }

  @Patch('programs/:id')
  updateProgram(
    @Param('id') id: string,
    @Body()
    body: Partial<{
      status: ProgramStatus;
      notes: string;
      opensAt: string | null;
      closesAt: string | null;
      resultsAt: string | null;
      datesVerified: boolean;
      datesSource: string;
      eligibilityNotes: string;
      eligibilityVerified: boolean;
      portalUrl: string;
    }>,
  ) {
    return this.masters.updateProgram(id, body);
  }

  /** Materialise + return the document checklist for a programme. */
  @Get('programs/:id/checklist')
  checklist(@Param('id') id: string) {
    return this.masters.ensureChecklist(id);
  }

  @Patch('documents/:id')
  updateDocument(
    @Param('id') id: string,
    @Body() body: Partial<{ status: DocumentStatus; filePath: string; notes: string }>,
  ) {
    return this.masters.updateDocument(id, body);
  }

  /** Draft (and save) a motivation-letter for a programme. Review before use. */
  @Post('programs/:id/motivation-letter')
  motivationLetter(
    @Param('id') id: string,
    @Body() body?: { maxWords?: number; angle?: string },
  ) {
    return this.letters.generate(id, body);
  }

  // --- Recommendation-letter requests -------------------------------------

  @Get('rec-requests')
  listRec() {
    return this.rec.findAll();
  }

  @Post('rec-requests')
  createRec(
    @Body()
    body: {
      professorName: string;
      professorEmail?: string;
      university?: string;
      programId?: string;
      notes?: string;
    },
  ) {
    return this.rec.create(body);
  }

  /** Preview the request email — does NOT send. */
  @Get('rec-requests/:id/draft')
  draftRec(@Param('id') id: string) {
    return this.rec.draft(id);
  }

  /**
   * Send the request email. Only hit this after deciding to go ahead — it emails
   * the professor and marks the request as requested.
   */
  @Post('rec-requests/:id/send')
  sendRec(@Param('id') id: string) {
    return this.rec.send(id);
  }

  @Patch('rec-requests/:id/status')
  setRecStatus(@Param('id') id: string, @Body() body: { status: RecRequestStatus }) {
    return this.rec.updateStatus(id, body.status);
  }
}
