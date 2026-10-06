import { RequiredDoc } from './masters-program.model';

/**
 * Seed definitions for the target Erasmus Mundus cybersecurity master's
 * programmes. Dates verified 2026-10-06 from official sources where possible;
 * aggregator sites contradict each other, so anything not confirmed on the
 * official portal is left `datesVerified: false` and the scheduler will flag it
 * for re-verification rather than treat it as fact.
 *
 * ELIGIBILITY WARNING (applies to all three): the general EMJM rule — enforced
 * by many consortia — is that an applicant must NOT already hold a master's
 * degree in the SAME field of study, and must NOT have previously received an
 * Erasmus+ EMJM/EMJMD scholarship. Umer already holds an MS in Computer
 * Networks & Security (NUCES-FAST, 2021-2023), which is the same field. This is
 * a real risk and MUST be confirmed with each consortium before investing
 * effort. `eligibilityVerified` stays false until that confirmation.
 */
export interface SeedProgram {
  code: string;
  name: string;
  coordinatingUniversity: string;
  portalUrl: string;
  infoUrl: string;
  partnerCountries: string[];
  opensAt: string | null;
  closesAt: string | null;
  resultsAt: string | null;
  datesVerified: boolean;
  datesSource: string;
  requiredDocs: RequiredDoc[];
  eligibilityNotes: string;
}

/** Shared baseline document checklist for an Erasmus Mundus master's package. */
const BASE_DOCS: RequiredDoc[] = [
  { key: 'bachelor_degree', label: "Bachelor's degree certificate (colour scan)", required: true },
  { key: 'transcripts', label: 'Official transcripts of records (colour scan)', required: true },
  { key: 'translations', label: 'Authorised English translations (if applicable)', required: false },
  { key: 'cv', label: 'Curriculum vitae (Europass format recommended)', required: true },
  { key: 'motivation_letter', label: 'Motivation letter', required: true },
  { key: 'passport', label: 'Valid passport or government ID', required: true },
  { key: 'english_test', label: 'English language proficiency test score (IELTS/TOEFL)', required: true },
  { key: 'rec_letter_1', label: 'Recommendation letter #1', required: false },
  { key: 'rec_letter_2', label: 'Recommendation letter #2', required: false },
];

export const SEED_PROGRAMS: SeedProgram[] = [
  {
    code: 'CYBERSURE',
    name: "Master's Programme in Cybersecurity and Assurance (CYBERSURE)",
    coordinatingUniversity: 'Norwegian University of Science and Technology (NTNU), Norway',
    portalUrl: 'https://cybersure-master.eu/admission',
    infoUrl: 'https://www.cybersure-master.eu/',
    partnerCountries: ['Norway', 'Finland', 'Sweden', 'France'],
    opensAt: '2026-11-16',
    closesAt: '2027-01-04',
    resultsAt: '2027-03-15',
    datesVerified: true,
    datesSource:
      'cybersure-master.eu/admission, checked 2026-10-06: opens 2026-11-16 09:00 GMT+1, closes 2027-01-04 23:59 GMT+1; English-test deadline 2027-01-18; results mid-March 2027',
    requiredDocs: [
      ...BASE_DOCS,
      { key: 'motivation_video', label: 'Motivation video (max 1 min, 100 MB)', required: true },
      { key: 'proof_residence', label: 'Proof of current residence', required: true },
    ],
    eligibilityNotes:
      'Official page lists bachelor-based entry; silent on prior-master holders and prior EMJM recipients. MUST email admissions to confirm whether Umer\'s existing MS (Computer Networks & Security, same field) affects eligibility. Two recommendation letters are recommended, not mandatory.',
  },
  {
    code: 'CYBERUS',
    name: 'Erasmus Mundus Joint Master in Cybersecurity (CYBERUS)',
    coordinatingUniversity: 'Université Bretagne Sud, France',
    portalUrl: 'https://master-cyberus.eu/admission/apply',
    infoUrl: 'https://master-cyberus.eu/',
    partnerCountries: ['France', 'Belgium', 'Luxembourg', 'Estonia'],
    opensAt: null,
    closesAt: null,
    resultsAt: null,
    datesVerified: false,
    datesSource:
      'UNVERIFIED (2026-10-06): historically opens ~December, closes ~February, interviews ~March. Aggregators report CYBERUS may be pausing/relaunching under a revised programme for the 2027 cycle — confirm on master-cyberus.eu before relying on any date.',
    requiredDocs: [...BASE_DOCS],
    eligibilityNotes:
      'Same EMJM eligibility question as above (prior same-field master / prior EMJM scholarship). UNCONFIRMED for 2027 — verify the programme is still running and its rules on master-cyberus.eu.',
  },
  {
    code: 'CYBERMACS',
    name: 'Erasmus Mundus Joint Master in Applied Cybersecurity (CyberMACS)',
    coordinatingUniversity: 'Kadir Has University, Türkiye',
    portalUrl: 'https://cybermacs.eu/apply/',
    infoUrl: 'https://cybermacs.eu/',
    partnerCountries: ['Türkiye', 'Germany', 'North Macedonia'],
    opensAt: null,
    closesAt: null,
    resultsAt: null,
    datesVerified: false,
    datesSource:
      'UNVERIFIED (2026-10-06): the published "15 Dec 2025" deadline is the PAST 2026-2028 cohort, not the 2027 intake. 2027-intake dates not yet announced — expect the portal to open in late 2026. Re-check cybermacs.eu/apply.',
    requiredDocs: [...BASE_DOCS],
    eligibilityNotes:
      'Same EMJM eligibility question as above. ~15 scholarships/year, €1,400/month for 24 months. Confirm 2027 dates and prior-master rule on cybermacs.eu.',
  },
];
