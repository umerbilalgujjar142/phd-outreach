/** Kind of outreach email (initial cold email vs a later follow-up). */
export enum OutreachType {
  INITIAL = 'initial',
  FOLLOW_UP = 'follow_up',
}

/** Lifecycle of a single outreach email row. */
export enum OutreachStatus {
  QUEUED = 'queued',
  SENT = 'sent',
  FAILED = 'failed',
  REPLIED = 'replied',
}

export const OUTREACH_TYPES = Object.values(OutreachType);
export const OUTREACH_STATUSES = Object.values(OutreachStatus);
