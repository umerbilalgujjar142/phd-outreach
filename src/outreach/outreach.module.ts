import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { GmailModule } from '../gmail/gmail.module';
import { JobRunsModule } from '../job-runs/job-runs.module';
import { PersonalizationModule } from '../personalization/personalization.module';
import { ProfessorsModule } from '../professors/professors.module';
import { MotivationLetterService } from './motivation-letter.service';
import { OutreachEmail } from './outreach-email.model';
import { OutreachController } from './outreach.controller';
import { OutreachService } from './outreach.service';
import { SendScheduler } from './send.scheduler';

@Module({
  imports: [
    SequelizeModule.forFeature([OutreachEmail]),
    GmailModule,
    ProfessorsModule,
    PersonalizationModule,
    JobRunsModule,
  ],
  controllers: [OutreachController],
  providers: [OutreachService, SendScheduler, MotivationLetterService],
  exports: [OutreachService],
})
export class OutreachModule {}
