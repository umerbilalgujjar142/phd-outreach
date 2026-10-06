/**
 * Enums for the Masters module (Erasmus Mundus Joint Master scholarship
 * tracker). ISOLATED FEATURE — everything masters-related lives under
 * `src/masters/`, is wired via a single import in app.module.ts, uses
 * `MASTERS_*` env vars and `masters_*` tables, so it can be removed in one
 * clean sweep (mirrors how the SWE-jobs feature was removed). Not part of the
 * core PhD professor-outreach flow.
 */

/** Where a target program is in its lifecycle, from our side. */
export const PROGRAM_STATUSES = [
  'watching', // on our radar, portal not open yet
  'open', // portal is accepting applications now
  'preparing', // we are assembling the document package
  'submitted', // application sent on the portal (Umer clicked submit)
  'accepted',
  'rejected',
  'withdrawn', // we decided not to pursue (e.g. eligibility ruled it out)
] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

/** Status of one required document for a program's package. */
export const DOCUMENT_STATUSES = [
  'todo',
  'in_progress',
  'ready', // drafted/collected and good to upload
  'submitted', // uploaded on the portal
  'not_applicable',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** Lifecycle of a recommendation-letter request to a professor. */
export const REC_REQUEST_STATUSES = [
  'not_requested',
  'requested', // we emailed the professor asking (with Umer's explicit OK)
  'received', // the letter/confirmation came back
  'declined',
] as const;
export type RecRequestStatus = (typeof REC_REQUEST_STATUSES)[number];
