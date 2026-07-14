import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { JobRun } from './job-run.model';
import { JobRunsService } from './job-runs.service';

@Module({
  imports: [SequelizeModule.forFeature([JobRun])],
  providers: [JobRunsService],
  exports: [JobRunsService],
})
export class JobRunsModule {}
