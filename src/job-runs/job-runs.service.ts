import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { JobRun } from './job-run.model';

@Injectable()
export class JobRunsService {
  private readonly logger = new Logger(JobRunsService.name);

  constructor(@InjectModel(JobRun) private readonly model: typeof JobRun) {}

  get(jobType: string): Promise<JobRun | null> {
    return this.model.findByPk(jobType);
  }

  /**
   * Self-healing check: is this job due? True if it has never succeeded or
   * its last success is older than `intervalMs`.
   */
  async isDue(jobType: string, intervalMs: number): Promise<boolean> {
    const row = await this.get(jobType);
    if (!row?.lastSuccessAt) return true;
    return Date.now() - new Date(row.lastSuccessAt).getTime() >= intervalMs;
  }

  async markRunning(jobType: string): Promise<void> {
    await this.model.upsert({
      jobType,
      lastRunAt: new Date(),
      lastStatus: 'running',
    } as any);
  }

  async markSuccess(jobType: string, detail?: string): Promise<void> {
    const row = await this.get(jobType);
    await this.model.upsert({
      jobType,
      lastRunAt: new Date(),
      lastSuccessAt: new Date(),
      lastStatus: 'success',
      lastDetail: detail ?? null,
      runCount: (row?.runCount ?? 0) + 1,
    } as any);
  }

  async markError(jobType: string, detail: string): Promise<void> {
    await this.model.upsert({
      jobType,
      lastRunAt: new Date(),
      lastStatus: 'error',
      lastDetail: detail?.slice(0, 1000),
    } as any);
    this.logger.error(`Job ${jobType} failed: ${detail}`);
  }
}
