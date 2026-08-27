import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { GmailModule } from '../gmail/gmail.module';
import { JobRunsModule } from '../job-runs/job-runs.module';
import { PersonalizationModule } from '../personalization/personalization.module';
import { ProfessorsModule } from '../professors/professors.module';
import { OUTREACH_QUEUE } from '../queue/queue.constants';
import { MotivationLetterService } from './motivation-letter.service';
import { OutreachEmail } from './outreach-email.model';
import { OutreachController } from './outreach.controller';
import { OutreachService } from './outreach.service';
import { SendProcessor } from './send.processor';
import { SendScheduler } from './send.scheduler';

@Module({
  imports: [
    BullModule.registerQueue({ name: OUTREACH_QUEUE }),
    BullBoardModule.forFeature({ name: OUTREACH_QUEUE, adapter: BullMQAdapter }),
    SequelizeModule.forFeature([OutreachEmail]),
    GmailModule,
    ProfessorsModule,
    PersonalizationModule,
    JobRunsModule,
  ],
  controllers: [OutreachController],
  providers: [OutreachService, SendScheduler, SendProcessor, MotivationLetterService],
  exports: [OutreachService],
})
export class OutreachModule {}
