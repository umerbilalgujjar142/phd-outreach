import { Injectable, Logger } from '@nestjs/common';
import { JobsService } from '../jobs.service';
import { JobApplication } from '../job-application.model';
import { JobListing } from '../job-listing.model';
import { JobApplicationStatus, JobListingStatus } from '../job-status.enum';
import { CoverLetterService } from './cover-letter.service';
import { CvTailorService } from './cv-tailor.service';

/**
 * Turns a MATCHED lead into a READY one: tailors the CV (+ a cover letter when
 * the JD asks for one), records a JobApplication (status PREPARED), and flips
 * the listing to READY so the apply scheduler can pick it up. Mirrors the
 * personalization step on the professor side.
 */
@Injectable()
export class JobPrepareService {
  private readonly logger = new Logger(JobPrepareService.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly cv: CvTailorService,
    private readonly coverLetter: CoverLetterService,
  ) {}

  /** Prepare documents for one listing. Idempotent-ish: re-tailors on demand. */
  async prepareOne(listing: JobListing): Promise<JobApplication> {
    const { path: cvPath, variant } = await this.cv.tailor(listing);

    let coverLetterPath: string | null = null;
    if (CoverLetterService.isRequired(listing)) {
      coverLetterPath = (await this.coverLetter.generate(listing)).path;
    }

    const application = await this.jobs.createApplication({
      jobListingId: listing.id,
      roleType: listing.roleType,
      cvVariant: variant,
      cvPath,
      coverLetterPath: coverLetterPath ?? undefined,
      status: JobApplicationStatus.PREPARED,
      notes: coverLetterPath ? 'CV + cover letter prepared' : 'CV prepared (no cover letter required)',
    } as Partial<JobApplication>);

    await this.jobs.setStatus(listing.id, JobListingStatus.READY);
    return application;
  }

  /** Prepare a batch of matched leads that still need documents. */
  async preparePending(limit = 5): Promise<{ processed: number; ok: number; failed: number }> {
    const batch = await this.jobs.findMatchedNeedingDocs(limit);
    let ok = 0;
    for (const listing of batch) {
      try {
        await this.prepareOne(listing);
        ok++;
      } catch (err) {
        this.logger.warn(`Prepare failed for ${listing.id}: ${(err as Error).message}`);
      }
    }
    if (batch.length) this.logger.log(`Prepared ${ok}/${batch.length} job document set(s)`);
    return { processed: batch.length, ok, failed: batch.length - ok };
  }
}
