import { ScrapedListing } from './discovery.types';

/**
 * A discovery source (EURAXESS, AcademicTransfer, university pages, …).
 * DiscoveryService runs every registered source and merges the results, so
 * adding a platform is just implementing this interface + registering it.
 */
export interface DiscoverySource {
  /** Stable id stored on each professor row's `source` field. */
  readonly name: string;
  scrape(opts?: {
    maxPages?: number;
    delayMs?: number;
    /** Offer URLs already evaluated on previous runs — skip re-fetching them. */
    knownUrls?: Set<string>;
  }): Promise<ScrapedListing[]>;
}

/** DI token for the array of registered sources. */
export const DISCOVERY_SOURCES = Symbol('DISCOVERY_SOURCES');
