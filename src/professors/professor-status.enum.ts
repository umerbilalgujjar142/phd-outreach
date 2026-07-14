/**
 * Professor outreach lifecycle status (PROJECT.md Section 9).
 * Ordered roughly by pipeline progression.
 */
export enum ProfessorStatus {
  NOT_CONTACTED = 'not_contacted',
  // Manually applied via the position's application portal (used for no-email
  // apply-link listings that are never auto-emailed).
  APPLIED = 'applied',
  EMAILED = 'emailed',
  FOLLOW_UP_SENT = 'follow_up_sent',
  REPLIED = 'replied',
  REJECTED = 'rejected',
  INTERVIEW = 'interview',
  ACCEPTED = 'accepted',
}

export const PROFESSOR_STATUSES = Object.values(ProfessorStatus);
