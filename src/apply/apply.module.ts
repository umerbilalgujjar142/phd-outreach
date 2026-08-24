import { Module } from '@nestjs/common';
import { DiscoveryModule } from '../discovery/discovery.module';
import { PersonalizationModule } from '../personalization/personalization.module';
import { ProfessorsModule } from '../professors/professors.module';
import { ApplyController } from './apply.controller';
import { ApplyService } from './apply.service';
import { FillPlanner } from './fill-planner';
import { FormAnalyzer } from './form-analyzer';

/**
 * Assisted-apply feature (human-in-the-loop form submission for JS-based
 * application portals that expose no contact email). Reuses PlaywrightService
 * (browser) from DiscoveryModule and PersonalizationService (claude -p) for
 * free-text answers.
 */
@Module({
  imports: [ProfessorsModule, PersonalizationModule, DiscoveryModule],
  controllers: [ApplyController],
  providers: [ApplyService, FormAnalyzer, FillPlanner],
  exports: [ApplyService, FormAnalyzer],
})
export class ApplyModule {}
