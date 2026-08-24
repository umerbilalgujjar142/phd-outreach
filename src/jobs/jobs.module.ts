import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ApplyModule } from '../apply/apply.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { GmailModule } from '../gmail/gmail.module';
import { JobRunsModule } from '../job-runs/job-runs.module';
import { PersonalizationModule } from '../personalization/personalization.module';
import { JOB_DISCOVERY_QUEUE } from '../queue/queue.constants';
import { JobApplyService } from './apply/job-apply.service';
import { ArbeitnowScraper } from './discovery/arbeitnow.scraper';
import { BaytScraper } from './discovery/bayt.scraper';
import { IndeedScraper } from './discovery/indeed.scraper';
import { IrishJobsScraper } from './discovery/irishjobs.scraper';
import { JobDiscoveryProcessor } from './discovery/job-discovery.processor';
import { JobDiscoveryScheduler } from './discovery/job-discovery.scheduler';
import { JobDiscoveryService } from './discovery/job-discovery.service';
import { NaukriGulfScraper } from './discovery/naukrigulf.scraper';
import { RemoteOkScraper } from './discovery/remoteok.scraper';
import { SeenJob } from './discovery/seen-job.model';
import { CoverLetterService } from './documents/cover-letter.service';
import { CvTailorService } from './documents/cv-tailor.service';
import { JobPrepareService } from './documents/job-prepare.service';
import { JobApplyScheduler } from './job-apply.scheduler';
import { JobApplication } from './job-application.model';
import { JobListing } from './job-listing.model';
import { JobMatchingService } from './matching/job-matching.service';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

/**
 * Software-engineering job-application automation. Mirrors the professor
 * outreach pipeline (discovery → match/rank → prepare docs → assisted apply)
 * on a separate set of tables, reusing PlaywrightService (DiscoveryModule),
 * FormAnalyzer (ApplyModule), and PersonalizationService (claude -p).
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: JOB_DISCOVERY_QUEUE }),
    BullBoardModule.forFeature({ name: JOB_DISCOVERY_QUEUE, adapter: BullMQAdapter }),
    SequelizeModule.forFeature([JobListing, JobApplication, SeenJob]),
    JobRunsModule,
    PersonalizationModule,
    DiscoveryModule,
    ApplyModule,
    GmailModule,
  ],
  controllers: [JobsController],
  providers: [
    JobsService,
    JobMatchingService,
    RemoteOkScraper,
    ArbeitnowScraper,
    NaukriGulfScraper,
    BaytScraper,
    IrishJobsScraper,
    IndeedScraper,
    JobDiscoveryService,
    JobDiscoveryProcessor,
    JobDiscoveryScheduler,
    CvTailorService,
    CoverLetterService,
    JobPrepareService,
    JobApplyService,
    JobApplyScheduler,
  ],
  exports: [JobsService],
})
export class JobsModule {}
