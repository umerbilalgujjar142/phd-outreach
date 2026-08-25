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

/**
 * The search terms every source queries with — derived from Umer's CV stack
 * (JS/TS, React/Next/React Native, Node/Express/NestJS, MERN, AWS, LLM/RAG).
 * Deliberately NO off-stack terms (Python/.NET/Java/etc.) so we don't pull
 * irrelevant postings; the matcher rejects those anyway, but not querying them
 * keeps the sweep focused. Boards fuzzy-match, so these cover the field.
 */
export const JOB_QUERIES = [
  // core roles
  'software engineer',
  'full stack developer',
  'full stack engineer',
  'backend developer',
  'frontend developer',
  // JavaScript / TypeScript
  'javascript developer',
  'typescript developer',
  // Node ecosystem
  'node.js developer',
  'nestjs developer',
  'express developer',
  // React ecosystem
  'react developer',
  'next.js developer',
  'mern stack developer',
  // Mobile (React Native)
  'react native developer',
  // AI / LLM (RAG, OpenAI/Claude integration)
  'ai engineer',
  'llm engineer',
];
