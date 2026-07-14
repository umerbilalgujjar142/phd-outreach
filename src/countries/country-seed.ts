/**
 * Initial target countries (PROJECT.md Section 6). This is only a STARTING
 * set — the list lives in the DB and is meant to be extended at runtime.
 * Weights follow the Section 6 tier split (~50 / 15 / 25 / 10) spread evenly
 * within each tier; tune later from real reply-rate data.
 */
export interface CountrySeed {
  name: string;
  iso2: string;
  region: string;
  tier: number | null;
  weight: number | null;
  active: boolean;
  notes?: string;
}

export const COUNTRY_SEED: CountrySeed[] = [
  // Tier 1 — funded / professor-driven hiring
  { name: 'Sweden', iso2: 'SE', region: 'Nordics', tier: 1, weight: 7, active: true },
  { name: 'Norway', iso2: 'NO', region: 'Nordics', tier: 1, weight: 7, active: true },
  { name: 'Denmark', iso2: 'DK', region: 'Nordics', tier: 1, weight: 7, active: true },
  { name: 'Belgium', iso2: 'BE', region: 'CET/CEST Europe', tier: 1, weight: 7, active: true },
  { name: 'France', iso2: 'FR', region: 'CET/CEST Europe', tier: 1, weight: 7, active: true },
  { name: 'Austria', iso2: 'AT', region: 'CET/CEST Europe', tier: 1, weight: 7, active: true },
  { name: 'Ireland', iso2: 'IE', region: 'Western Europe', tier: 1, weight: 8, active: true },
  { name: 'Netherlands', iso2: 'NL', region: 'CET/CEST Europe', tier: 1, weight: 8, active: true, notes: 'PhDs are salaried employee contracts; dense security scene, professor hires directly' },
  { name: 'Germany', iso2: 'DE', region: 'CET/CEST Europe', tier: 1, weight: 8, active: true, notes: 'Funded RA positions (TV-L E13); CISPA, TU Darmstadt, RUB Bochum, KIT. GPA-flexible for RA' },
  { name: 'Luxembourg', iso2: 'LU', region: 'CET/CEST Europe', tier: 1, weight: 7, active: true, notes: 'Uni Luxembourg SnT — security/networking powerhouse, well funded (~€40k salaried)' },
  { name: 'Finland', iso2: 'FI', region: 'Nordics', tier: 1, weight: 7, active: true, notes: 'Nordic funded model; Aalto, Tampere, Oulu security/networking labs' },
  { name: 'Switzerland', iso2: 'CH', region: 'CET/CEST Europe', tier: 1, weight: 7, active: true, notes: 'Salaried (~CHF 50k). ETH/EPFL competitive; many mid-tier labs hire on fit' },
  // Tier 2 — secondary
  { name: 'Italy', iso2: 'IT', region: 'Southern Europe', tier: 2, weight: 7, active: true, notes: 'Funded via national competitive exam; more bureaucratic' },
  { name: 'Poland', iso2: 'PL', region: 'Central Europe', tier: 2, weight: 8, active: true, notes: 'Growing doctoral-school stipends; verify lab quality individually' },
  { name: 'Estonia', iso2: 'EE', region: 'Baltics', tier: 2, weight: 7, active: true, notes: 'European cyber hub (TalTech, Tartu, NATO CCDCOE); funded, welcoming to internationals' },
  { name: 'Czech Republic', iso2: 'CZ', region: 'Central Europe', tier: 2, weight: 7, active: true, notes: 'Masaryk (crypto/security), CTU Prague; lower cost, stipend-based' },
  { name: 'Spain', iso2: 'ES', region: 'Southern Europe', tier: 2, weight: 6, active: true, notes: 'FPI-funded positions exist; more bureaucratic' },
  { name: 'Portugal', iso2: 'PT', region: 'Southern Europe', tier: 2, weight: 6, active: true, notes: 'FCT funding; growing scene' },
  // Tier 3 — committee-based admissions
  { name: 'United Kingdom', iso2: 'GB', region: 'Western Europe', tier: 3, weight: 8, active: true },
  { name: 'Canada', iso2: 'CA', region: 'North America', tier: 3, weight: 8, active: true },
  { name: 'United States', iso2: 'US', region: 'North America', tier: 3, weight: 9, active: true, notes: 'Target mid-tier state universities with active security/networking labs, not T20 CS' },
  // Tier 4 — smallest batch
  { name: 'Australia', iso2: 'AU', region: 'Oceania', tier: 4, weight: 10, active: true, notes: 'Stricter GPA floors typically apply' },
  // Excluded for now
  { name: 'Ukraine', iso2: 'UA', region: 'Eastern Europe', tier: null, weight: 0, active: false, notes: 'Excluded: active war conditions. Revisit if situation changes.' },
];
