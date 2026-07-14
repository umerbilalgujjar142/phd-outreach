/** A named person tied to an email, parsed from the offer's prose. */
export interface ScrapedContact {
  name: string;
  email: string;
}

/** A normalized posting scraped from a discovery source. */
export interface ScrapedListing {
  source: string;
  sourceId: string;
  url: string;
  title: string;
  organisation: string;
  country: string | null;
  researchField: string | null;
  applicationDeadline: string | null; // YYYY-MM-DD
  city: string | null;
  description: string;
  emails: string[];
  /** Named PI/supervisor contacts parsed from "Name (email)" prose. */
  contacts: ScrapedContact[];
  /** External "Apply now" URL (institution ATS), for manual submission. */
  applyUrl: string | null;
}

/** Summary returned after a discovery run. */
export interface DiscoveryRunResult {
  source: string;
  scanned: number;
  matched: number;
  created: number;
  updated: number;
  skippedNoMatch: number;
  errors: number;
}
