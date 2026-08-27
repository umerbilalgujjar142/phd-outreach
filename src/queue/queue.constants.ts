// BullMQ queue names. Worker concurrency is 1 across the app (Section 3).
// The display strings are deliberately prefixed so each queue's pipeline is
// obvious in Bull Board: `phd-*` = professor PhD outreach, `job-*` = SWE jobs.

/** PhD: find professor positions (EURAXESS / AcademicTransfer / jobs.ac.uk). */
export const DISCOVERY_QUEUE = 'phd-discovery';

export const DISCOVERY_JOB = 'scan-sources';

/** PhD: send outreach emails to professors (initial batch + reply-check / follow-ups). */
export const OUTREACH_QUEUE = 'phd-send-emails';

export const OUTREACH_SEND_JOB = 'send-batch';
export const OUTREACH_REPLY_JOB = 'reply-followup';

/** Job: find software-engineering job postings across the job boards. */
export const JOB_DISCOVERY_QUEUE = 'job-discovery';

export const JOB_DISCOVERY_JOB = 'scan-job-boards';

/** Job: apply to SWE jobs (tailor CVs → prepare, then assisted apply). */
export const JOB_APPLY_QUEUE = 'job-apply';

export const JOB_APPLY_JOB = 'prepare-and-apply';
