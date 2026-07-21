/**
 * Structured applicant data for filling application forms (the form-filling
 * counterpart to personalization/owner-profile.ts, which is prose for emails).
 * Field values here are typed into form inputs verbatim, so keep them clean.
 */
export interface ApplicantProfile {
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  nationality: string;
  currentLocation: string;
  linkedin?: string;
  /** Highest degree, for "education"/"qualification" fields. */
  highestDegree: string;
  degreeInstitution: string;
  degreeCountry: string;
  graduationYear: string;
  /** One-line research interest summary for short "field of interest" inputs. */
  researchInterest: string;
}

/**
 * Semantic document catalog: maps a stable key to the PDF filename in DOCS_DIR.
 * The fill-planner picks a key per file-upload field by matching the field's
 * label; the service resolves the key to `<DOCS_DIR>/<filename>`.
 */
export const DOCUMENT_CATALOG: Record<string, { filename: string; description: string }> = {
  cv: { filename: 'Umer_Bilal_CV.pdf', description: 'CV / resume / curriculum vitae' },
  coverLetter: { filename: 'Umer_Bilal_Cover_Letter.pdf', description: 'cover letter' },
  motivationLetter: {
    filename: 'Umer_Bilal_Motivation_Letter.pdf',
    description: 'motivation letter / statement of purpose / personal statement',
  },
  researchProposal: {
    filename: 'Umer_Bilal_DDoS_Paper_Research_Proposal.pdf',
    description: 'research proposal / research statement / writing sample (ML-based low-rate DDoS detection)',
  },
  mastersDegree: {
    filename: 'Umer_Bilal_Masters_Degree_Attested.pdf',
    description: "master's degree certificate / diploma / transcript / academic record",
  },
  englishCertificate: {
    filename: 'Umer_Bilal_English_Medium_Certificate.pdf',
    description: 'English language / medium of instruction certificate / proof of English',
  },
  referenceLetter1: {
    filename: 'Umer_Bilal_RefLetter_DrQaisarShafi.pdf',
    description: 'reference / recommendation letter (Dr Qaisar Shafi)',
  },
  referenceLetter2: {
    filename: 'Umer_Bilal_RefLetter_DrSubhanUllah.pdf',
    description: 'reference / recommendation letter (Dr Subhan Ullah)',
  },
  referenceLetter3: {
    filename: 'Umer_Bilal_RefLetter_HinaBinteHaq.pdf',
    description: 'reference / recommendation letter (Hina Binte Haq)',
  },
};

/**
 * Build the applicant profile. Contact email defaults to the configured
 * applications inbox (APPLICANT_EMAIL), falling back to the Gmail sender.
 */
export function buildApplicantProfile(opts: { email: string }): ApplicantProfile {
  return {
    firstName: 'Muhammad Umer',
    lastName: 'Bilal',
    fullName: 'Muhammad Umer Bilal',
    email: opts.email,
    phone: '+971 55 969 5281',
    city: 'Dubai',
    country: 'United Arab Emirates',
    nationality: 'Pakistani',
    currentLocation: 'Dubai, United Arab Emirates',
    highestDegree: 'MS in Computer Networks & Security',
    degreeInstitution: 'FAST-NUCES, Islamabad',
    degreeCountry: 'Pakistan',
    graduationYear: '2023',
    researchInterest:
      'Network security, intrusion/anomaly detection, and machine learning for security (application security)',
  };
}
