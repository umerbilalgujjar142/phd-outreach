/**
 * Approximate UTC offsets (summer / current-season) per target country, used to
 * send each professor an email during THEIR local working hours — so it arrives
 * while they're at the university, not at 3 a.m. their time.
 *
 * Offsets are representative (some countries span zones, e.g. US/Canada — we use
 * a central-ish value). Good enough for "send during their daytime" gating.
 */
const COUNTRY_OFFSET: Record<string, number> = {
  // Central Europe (CEST, UTC+2 in summer)
  Sweden: 2, Norway: 2, Denmark: 2, Belgium: 2, France: 2, Austria: 2,
  Netherlands: 2, Germany: 2, Luxembourg: 2, Switzerland: 2, Italy: 2,
  Poland: 2, 'Czech Republic': 2, Spain: 2,
  // Eastern Europe (EEST, UTC+3)
  Finland: 3, Estonia: 3,
  // Western Europe (UTC+1 in summer)
  Ireland: 1, 'United Kingdom': 1, Portugal: 1,
  // North America (use Eastern-ish daylight time)
  'United States': -4, Canada: -4,
  // Oceania (AEST, UTC+10 — no DST in July)
  Australia: 10,
};

// Professor-local working window: send only when it's 9:00–17:00, Mon–Fri THERE.
const LOCAL_START_HOUR = 9;
const LOCAL_END_HOUR = 17;

/** Current {hour, day} in the professor's local time, or null if unknown country. */
function professorLocal(
  country: string | undefined,
  now: Date,
): { hour: number; day: number } | null {
  if (!country) return null;
  const offset = COUNTRY_OFFSET[country];
  if (offset === undefined) return null;
  const shifted = new Date(now.getTime() + offset * 3600_000);
  return { hour: shifted.getUTCHours(), day: shifted.getUTCDay() };
}

/**
 * True if it's currently the professor's local working hours (Mon–Fri 9–17).
 * Unknown countries default to TRUE (don't block the pipeline over a missing
 * mapping — those are rare and better sent than never).
 */
export function isProfessorWorkingHours(country: string | undefined, now = new Date()): boolean {
  const local = professorLocal(country, now);
  if (!local) return true;
  if (local.day === 0 || local.day === 6) return false; // their weekend
  return local.hour >= LOCAL_START_HOUR && local.hour < LOCAL_END_HOUR;
}
