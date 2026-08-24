import { ScrapedJob } from './job-discovery.types';

/**
 * A job-discovery source (RemoteOK, Arbeitnow, Indeed, …). JobDiscoveryService
 * runs every registered source and merges the results, so adding a board is
 * just implementing this interface + registering it in the module.
 */
export interface JobSource {
  /** Stable id stored on each job_listings row's `source` field. */
  readonly name: string;
  scrape(opts?: {
    /** Search terms to query the board with (roles Umer targets). */
    queries?: string[];
    /** Posting URLs already stored on previous runs — skip re-fetching. */
    knownUrls?: Set<string>;
    /** Politeness delay between HTTP requests. */
    delayMs?: number;
    maxPerQuery?: number;
  }): Promise<ScrapedJob[]>;
}

/** The search terms every source queries with (Umer's target roles). */
export const JOB_QUERIES = [
  'backend developer',
  'node.js developer',
  'full stack developer',
  'react native developer',
  'software engineer',
];
