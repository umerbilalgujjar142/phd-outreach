/** A normalized job posting scraped from a job board. */
export interface ScrapedJob {
  source: string;
  sourceId: string;
  url: string;
  title: string;
  company: string;
  location: string | null;
  country: string | null;
  remote: boolean;
  description: string;
  salary: string | null;
  /** External "apply" URL if the posting redirects off-board. */
  applyUrl: string | null;
  tags: string[];
  /** Set only when the source explicitly states sponsorship is offered. */
  sponsorshipOffered?: boolean;
  /** When the job was posted, if the source exposes it (drives the age filter). */
  postedAt?: Date | null;
}

/** Parse a relative age string ("2 days ago", "3d", "1 week", "30+ days") to a Date. */
export function parseRelativeAge(text: string | null | undefined, now: number): Date | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/just now|today|hour|min|\bnew\b/.test(t)) return new Date(now);
  const m = t.match(/(\d+)\s*\+?\s*(day|week|month|d|w|mo|yr|year)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const days =
    unit.startsWith('w') ? n * 7 : unit.startsWith('mo') || unit === 'month' ? n * 30 : unit.startsWith('y') || unit === 'yr' ? n * 365 : n;
  return new Date(now - days * 24 * 60 * 60 * 1000);
}

/** Summary returned after a job-discovery run for one source. */
export interface JobDiscoveryRunResult {
  source: string;
  scanned: number;
  matched: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}
