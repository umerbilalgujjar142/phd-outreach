import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { JobRunsModule } from '../job-runs/job-runs.module';
import { MatchingModule } from '../matching/matching.module';
import { ProfessorsModule } from '../professors/professors.module';
import { DISCOVERY_QUEUE } from '../queue/queue.constants';
import { SeenOffer } from './seen-offer.model';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryProcessor } from './discovery.processor';
import { DiscoveryScheduler } from './discovery.scheduler';
import { DiscoveryService } from './discovery.service';
import { AcademicTransferScraper } from './academictransfer.scraper';
import { EuraxessScraper } from './euraxess.scraper';
import { JobsAcScraper } from './jobsac.scraper';
import { PlaywrightService } from './playwright.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: DISCOVERY_QUEUE }),
    BullBoardModule.forFeature({ name: DISCOVERY_QUEUE, adapter: BullMQAdapter }),
    SequelizeModule.forFeature([SeenOffer]),
    ProfessorsModule,
    MatchingModule,
    JobRunsModule,
  ],
  controllers: [DiscoveryController],
  providers: [
    EuraxessScraper,
    AcademicTransferScraper,
    JobsAcScraper,
    PlaywrightService,
    DiscoveryService,
    DiscoveryProcessor,
    DiscoveryScheduler,
  ],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
