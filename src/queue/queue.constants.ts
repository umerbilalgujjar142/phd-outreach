// BullMQ queue names. Worker concurrency is 1 across the app (Section 3).
// The display strings are prefixed `phd-*` so each queue's pipeline is obvious
// in Bull Board.

/** PhD: find professor positions (EURAXESS / AcademicTransfer / jobs.ac.uk). */
export const DISCOVERY_QUEUE = 'phd-discovery';

export const DISCOVERY_JOB = 'scan-sources';

/** PhD: send outreach emails to professors (initial batch + reply-check / follow-ups). */
export const OUTREACH_QUEUE = 'phd-send-emails';

export const OUTREACH_SEND_JOB = 'send-batch';
export const OUTREACH_REPLY_JOB = 'reply-followup';
