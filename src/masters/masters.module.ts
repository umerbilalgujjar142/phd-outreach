import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { GmailModule } from '../gmail/gmail.module';
import { PersonalizationModule } from '../personalization/personalization.module';
import { MastersProgram } from './masters-program.model';
import { MastersDocument } from './masters-document.model';
import { MastersRecRequest } from './masters-rec-request.model';
import { MastersService } from './masters.service';
import { MastersLetterService } from './masters-letter.service';
import { MastersRecService } from './masters-rec.service';
import { MastersScheduler } from './masters.scheduler';
import { MastersController } from './masters.controller';

/**
 * ISOLATED FEATURE — Erasmus Mundus Joint Master scholarship tracker.
 * Self-contained: one import line in app.module.ts, `masters_*` tables,
 * `MASTERS_*` env vars, generated docs under MASTERS_DOCS_DIR. To remove the
 * feature entirely: delete `src/masters/`, drop this import, drop the
 * `masters_*` tables, and delete the MASTERS_* lines from .env. Reuses the
 * existing Gmail + personalization (claude -p) infrastructure read-only.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([MastersProgram, MastersDocument, MastersRecRequest]),
    GmailModule,
    PersonalizationModule,
  ],
  controllers: [MastersController],
  providers: [MastersService, MastersLetterService, MastersRecService, MastersScheduler],
  exports: [MastersService],
})
export class MastersModule {}
