import { Module } from '@nestjs/common';
import { ProfessorsModule } from '../professors/professors.module';
import { PersonalizationController } from './personalization.controller';
import { PersonalizationService } from './personalization.service';

@Module({
  imports: [ProfessorsModule],
  controllers: [PersonalizationController],
  providers: [PersonalizationService],
  exports: [PersonalizationService],
})
export class PersonalizationModule {}
