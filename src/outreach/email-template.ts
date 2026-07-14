import { existsSync } from 'fs';
import { join } from 'path';
import { Professor } from '../professors/professor.model';

/** Default documents attached to every initial email (PROJECT.md Section 13). */
const DEFAULT_ATTACHMENTS = [
  'Umer_Bilal_CV.pdf', // primary CV
  'Umer_Bilal_DDoS_Paper_Research_Proposal.pdf', // DDoS thesis paper
];

/** Umer's phone number for the signature. Set this to enable the phone line. */
const PHONE = '+971 55 969 5281';

const SIGNATURE = (senderEmail: string) =>
  [
    'Warm regards,',
    'Muhammad Umer Bilal',
    'MS Computer Networks & Security, FAST-NUCES, Islamabad (Pakistan)',
    'Currently in Dubai, UAE',
    senderEmail,
    PHONE,
  ]
    .filter(Boolean)
    .join('\n');

export interface AssembledEmail {
  subject: string;
  text: string;
  attachments: { filename: string; path: string }[];
  missingAttachments: string[];
}

/** Best-effort surname for the greeting; falls back to a neutral salutation. */
function greeting(professorName: string): string {
  const name = (professorName || '').trim();
  if (!name || /^contact\b/i.test(name)) return 'Dear Professor,';
  const parts = name.split(/\s+/);
  const surname = parts[parts.length - 1];
  return `Dear Dr. ${surname},`;
}

function primaryTopic(p: Professor): string {
  return p.matchedTags?.[0] ?? 'security and machine learning';
}

/**
 * Assemble the full outreach email: fixed template + the Claude-written
 * personalized opening (Section 8, Step 5). Plain text — better cold-email
 * deliverability than HTML.
 */
export function assembleEmail(
  professor: Professor,
  snippet: string,
  opts: {
    senderEmail: string;
    docsDir: string;
    attachmentNames?: string[];
    /** Dynamically-generated files (e.g. per-professor motivation letter). */
    extraAttachments?: { filename: string; path: string }[];
    /** Optional short note inserted after the greeting (e.g. a correction). */
    preface?: string;
  },
): AssembledEmail {
  const subject = `Prospective PhD applicant — ${primaryTopic(professor)} (Umer Bilal)`;

  const names = opts.attachmentNames ?? DEFAULT_ATTACHMENTS;
  const attachments: { filename: string; path: string }[] = [];
  const missingAttachments: string[] = [];
  for (const filename of names) {
    const path = join(opts.docsDir, filename);
    if (existsSync(path)) attachments.push({ filename, path });
    else missingAttachments.push(filename);
  }
  for (const extra of opts.extraAttachments ?? []) attachments.push(extra);

  // Only claim documents that are actually attached, so the body never
  // references a missing file (e.g. the CV before it's dropped into DOCS_DIR).
  const hasCv = attachments.some((a) => /_CV[_.]/i.test(a.filename));
  const hasSample = attachments.some((a) => /WritingSample|Paper|Proposal/i.test(a.filename));
  const hasMotivation = attachments.some((a) => /Motivation/i.test(a.filename));
  // The DDoS document is a short research proposal drawn from the MS thesis —
  // NOT a full published paper — so describe it as a proposal, not a "paper".
  const proposalDesc = 'a research proposal based on my MS thesis on ML-based low-rate DDoS detection';

  const docs: string[] = [];
  if (hasCv) docs.push('my CV');
  if (hasMotivation) docs.push('a statement of motivation');
  if (hasSample) docs.push(proposalDesc);
  const listed = docs.length > 1
    ? `${docs.slice(0, -1).join(', ')}, and ${docs[docs.length - 1]}`
    : docs[0] ?? '';
  const attachSentence = docs.length
    ? `${listed[0].toUpperCase()}${listed.slice(1)} ${docs.length > 1 ? 'are' : 'is'} attached.`
    : 'I would be glad to send my CV, a statement of motivation, and a research proposal on request.';
  // Only offer documents that are NOT already attached — never re-offer the
  // research proposal, which is attached above.
  const offerSentence =
    'I would also be glad to provide my academic transcripts or reference letters on request.';

  // A warm, professional opening before the personalized research connection.
  const opener =
    'I hope this email finds you well. My name is Muhammad Umer Bilal — a software engineer with a research background in machine learning for network security — and I am reaching out about the possibility of joining your research group as a fully funded PhD student.';

  const body = [
    greeting(professor.professorName),
    '',
    ...(opts.preface ? [opts.preface.trim(), ''] : []),
    opener,
    '',
    snippet.trim(),
    '',
    `I completed my MS in Computer Networks & Security at FAST-NUCES, Islamabad (Pakistan) in July 2023, and I am currently based in Dubai, UAE, where six years of professional software engineering have given me strong hands-on experience building reliable, real-world systems. I would be glad to bring this combination of research and engineering to your group.`,
    '',
    `${attachSentence} ${offerSentence}`,
    '',
    'I would welcome the opportunity to discuss how my background could contribute to your research. Thank you for your time and consideration.',
    '',
    SIGNATURE(opts.senderEmail),
  ].join('\n');

  return { subject, text: body, attachments, missingAttachments };
}

/**
 * A short, polite follow-up (Step 9), sent in the same thread ~14 days after
 * the initial email when there's been no reply. No attachments — they're
 * already in the thread.
 */
export function assembleFollowup(
  professor: Professor,
  opts: { senderEmail: string },
): { text: string } {
  const text = [
    greeting(professor.professorName),
    '',
    'I hope you are doing well. I recently wrote to you about the possibility of joining your research group as a PhD student, and I wanted to gently follow up in case my earlier email was missed.',
    '',
    'I remain very interested in contributing to your work, and even a brief note on whether funded PhD or research-assistant positions may be available would mean a great deal.',
    '',
    'Thank you again for your time and consideration.',
    '',
    SIGNATURE(opts.senderEmail),
  ].join('\n');
  return { text };
}
