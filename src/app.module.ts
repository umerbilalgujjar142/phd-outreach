import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ApplyModule } from './apply/apply.module';
import { CountriesModule } from './countries/countries.module';
import { DatabaseModule } from './database/database.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { GmailModule } from './gmail/gmail.module';
import { JobRunsModule } from './job-runs/job-runs.module';
import { MastersModule } from './masters/masters.module';
import { OutreachModule } from './outreach/outreach.module';
import { PersonalizationModule } from './personalization/personalization.module';
import { ProfessorsModule } from './professors/professors.module';
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // Visual BullMQ dashboard at http://localhost:5001/admin/queues
    BullBoardModule.forRoot({ route: '/admin/queues', adapter: ExpressAdapter }),
    DatabaseModule,
    QueueModule,
    JobRunsModule,
    CountriesModule,
    ProfessorsModule,
    DiscoveryModule,
    PersonalizationModule,
    GmailModule,
    OutreachModule,
    ApplyModule,
    // Isolated feature — Erasmus Mundus master's scholarship tracker.
    // Remove this one line (+ src/masters, masters_* tables, MASTERS_* env) to drop it.
    MastersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
