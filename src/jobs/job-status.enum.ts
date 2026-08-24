/**
 * Lifecycle of a scraped job listing (parallel to ProfessorStatus).
 *
 *   new      — just scraped, not yet matched/scored
 *   matched  — passed the matcher (a real software role that fits Umer)
 *   rejected — not a fit (non-dev role, junk, or below threshold)
 *   ready    — matched + documents prepared → queued for assisted apply
 *   applied  — an application was submitted
 *   skipped  — deliberately parked (e.g. duplicate, expired, user-parked)
 */
export enum JobListingStatus {
  NEW = 'new',
  MATCHED = 'matched',
  REJECTED = 'rejected',
  READY = 'ready',
  APPLIED = 'applied',
  SKIPPED = 'skipped',
}

export const JOB_LISTING_STATUSES = Object.values(JobListingStatus);

/**
 * Role family Umer applies as. Chosen per listing by the matcher; drives which
 * of the three base CVs is tailored.
 */
export enum RoleType {
  BACKEND = 'backend',
  FULLSTACK = 'fullstack',
  MOBILE = 'mobile',
  OTHER = 'other',
}

export const ROLE_TYPES = Object.values(RoleType);

/**
 * Lifecycle of a single application attempt (parallel to OutreachStatus).
 *
 *   prepared       — tailored CV (+ cover letter if required) generated
 *   pending_review — form filled in a held-open browser, awaiting human submit
 *   submitted      — the application was submitted
 *   failed         — an error occurred while preparing/filling/submitting
 *   cancelled      — the pending session was discarded without submitting
 */
export enum JobApplicationStatus {
  PREPARED = 'prepared',
  PENDING_REVIEW = 'pending_review',
  SUBMITTED = 'submitted',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export const JOB_APPLICATION_STATUSES = Object.values(JobApplicationStatus);
