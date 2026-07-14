import { ProfessorStatus } from '../professor-status.enum';

/**
 * Shape accepted when inserting/upserting a professor.
 * `professorName` + `university` are the minimum required identity.
 */
export class CreateProfessorDto {
  professorName: string;
  university: string;
  country?: string;
  departmentLab?: string;
  email?: string;
  linkedinUrl?: string;
  personalWebsite?: string;
  socialLinks?: Record<string, string>;
  matchedTags?: string[];
  source?: string;
  sourceUrl?: string;
  matchReason?: string;
  fundingType?: string;
  applicationDeadline?: string;
  status?: ProfessorStatus;
  followupDate?: string;
  replyNotes?: string;
}
