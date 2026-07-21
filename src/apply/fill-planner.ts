import { Injectable, Logger } from '@nestjs/common';
import { PersonalizationService } from '../personalization/personalization.service';
import { Professor } from '../professors/professor.model';
import { OWNER_PROFILE } from '../personalization/owner-profile';
import {
  ApplicantProfile,
  DOCUMENT_CATALOG,
} from './applicant-profile';
import { FillPlanItem, FormField } from './apply.types';

/** Keyword → applicant-profile value rules for standard text/select fields. */
type Rule = { test: RegExp; value: (p: ApplicantProfile) => string };

const TEXT_RULES: Rule[] = [
  { test: /first\s*name|given\s*name|forename/i, value: (p) => p.firstName },
  { test: /last\s*name|surname|family\s*name/i, value: (p) => p.lastName },
  { test: /full\s*name|^name$|your\s*name|applicant\s*name/i, value: (p) => p.fullName },
  { test: /e-?mail/i, value: (p) => p.email },
  { test: /phone|mobile|tel(ephone)?|contact\s*number/i, value: (p) => p.phone },
  { test: /linkedin/i, value: (p) => p.linkedin ?? '' },
  { test: /city|town/i, value: (p) => p.city },
  { test: /nationality|citizenship/i, value: (p) => p.nationality },
  { test: /country of residence|current country|country/i, value: (p) => p.country },
  { test: /current location|location|residence|address/i, value: (p) => p.currentLocation },
  { test: /highest (degree|qualification)|qualification|degree/i, value: (p) => p.highestDegree },
  { test: /institution|university|college|alma\s*mater|school attended/i, value: (p) => p.degreeInstitution },
  { test: /graduat\w+ year|year of (graduation|completion)|completion year/i, value: (p) => p.graduationYear },
  { test: /field of (study|interest|research)|research (area|interest)|discipline/i, value: (p) => p.researchInterest },
];

@Injectable()
export class FillPlanner {
  private readonly logger = new Logger(FillPlanner.name);

  constructor(private readonly personalization: PersonalizationService) {}

  /**
   * Produce a per-field action plan. Standard identity/contact/education fields
   * are mapped deterministically; file uploads matched to the document catalog;
   * free-text questions (textareas / open prompts) are answered by `claude -p`
   * in a single batched call using the applicant + position context.
   */
  async plan(
    fields: FormField[],
    professor: Professor,
    profile: ApplicantProfile,
  ): Promise<FillPlanItem[]> {
    const items: FillPlanItem[] = [];
    const proseFields: FormField[] = [];

    for (const f of fields) {
      // Skip things we should never auto-touch.
      if (f.type === 'checkbox' || f.type === 'radio') {
        items.push({ ref: f.ref, label: f.label, action: 'skip', reason: 'consent/option — leave for human' });
        continue;
      }
      if (f.type === 'file') {
        const docKey = this.matchDocument(f.label);
        items.push(
          docKey
            ? { ref: f.ref, label: f.label, action: 'upload', value: docKey, reason: `matched ${docKey}` }
            : { ref: f.ref, label: f.label, action: 'skip', reason: 'no matching document' },
        );
        continue;
      }
      if (f.tag === 'select') {
        const opt = this.matchSelect(f, profile);
        items.push(
          opt
            ? { ref: f.ref, label: f.label, action: 'select', value: opt, reason: 'matched option' }
            : { ref: f.ref, label: f.label, action: 'skip', reason: 'no confident option match' },
        );
        continue;
      }

      // Text-like inputs & textareas.
      const rule = TEXT_RULES.find((r) => r.test.test(f.label) || r.test.test(f.name));
      const heuristic = rule?.value(profile);
      if (heuristic) {
        items.push({ ref: f.ref, label: f.label, action: 'fill', value: heuristic, reason: 'mapped from profile' });
        continue;
      }
      // Textareas, or unmatched text fields that look like open questions,
      // go to Claude for a written answer.
      if (f.tag === 'textarea' || this.looksLikeQuestion(f.label)) {
        proseFields.push(f);
        continue;
      }
      items.push({ ref: f.ref, label: f.label, action: 'skip', reason: 'unrecognized field — leave for human' });
    }

    if (proseFields.length) {
      const answers = await this.answerProse(proseFields, professor, profile);
      for (const f of proseFields) {
        const a = answers[f.ref];
        items.push(
          a
            ? { ref: f.ref, label: f.label, action: 'fill', value: a, reason: 'claude-written answer' }
            : { ref: f.ref, label: f.label, action: 'skip', reason: 'no answer generated' },
        );
      }
    }

    return items;
  }

  /** Score the field label against each document's description; best wins. */
  private matchDocument(label: string): string | undefined {
    const l = label.toLowerCase();
    let best: { key: string; score: number } | undefined;
    for (const [key, doc] of Object.entries(DOCUMENT_CATALOG)) {
      const words = doc.description.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
      const score = words.reduce((s, w) => (l.includes(w) ? s + 1 : s), 0);
      if (score > 0 && (!best || score > best.score)) best = { key, score };
    }
    return best?.key;
  }

  /** Pick a <select> option only when we can match it with confidence. */
  private matchSelect(f: FormField, p: ApplicantProfile): string | undefined {
    const want =
      /nationality|citizenship/i.test(f.label) ? p.nationality
      : /country/i.test(f.label) ? p.country
      : /title|salutation/i.test(f.label) ? 'Mr'
      : undefined;
    if (!want || !f.options) return undefined;
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
    const target = norm(want);
    const hit = f.options.find((o) => norm(o.text) === target || norm(o.value) === target)
      ?? f.options.find((o) => norm(o.text).includes(target) && target.length > 3);
    // Return the option VALUE (Playwright selectOption prefers value; text also works).
    return hit?.value || hit?.text;
  }

  private looksLikeQuestion(label: string): boolean {
    return /why|describe|explain|motivat|statement|tell us|interest|proposal|experience|background|research|goal|about yourself/i.test(
      label,
    );
  }

  /** One batched Claude call: write answers for every open-text field. */
  private async answerProse(
    fields: FormField[],
    professor: Professor,
    profile: ApplicantProfile,
  ): Promise<Record<string, string>> {
    const questions = fields
      .map((f) => `- ref "${f.ref}": ${f.label || f.name}${f.required ? ' (required)' : ''}`)
      .join('\n');

    const prompt = `
You are helping a PhD applicant fill an online application form for a specific
position. For EACH form question below, write a concise, professional,
first-person answer grounded ONLY in the applicant's real background — never
invent facts, publications, or numbers. Match the likely expected length: a
short input gets 1-2 sentences; a "motivation"/"statement" textarea gets one
tight paragraph (~120 words max). Use "I"/"my" for the applicant.

POSITION:
Professor/Group: ${professor.professorName}
University: ${professor.university}${professor.country ? ` (${professor.country})` : ''}
${professor.matchReason || 'General security/ML research match.'}

APPLICANT:
${OWNER_PROFILE}
Current location: ${profile.currentLocation}. Highest degree: ${profile.highestDegree}, ${profile.degreeInstitution} (${profile.graduationYear}).

FORM QUESTIONS:
${questions}

Output ONLY a JSON object mapping each ref to its answer string, wrapped exactly
between <answers> and </answers>. Example:
<answers>{"f3":"...","f7":"..."}</answers>
Put no text outside those tags.`.trim();

    try {
      const raw = await this.personalization.completeRaw(prompt);
      const tagged = raw.match(/<answers>([\s\S]*?)<\/answers>/i);
      const json = tagged ? tagged[1] : raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
      const parsed = JSON.parse(json) as Record<string, string>;
      return parsed;
    } catch (err) {
      this.logger.warn(`Prose answer generation failed: ${(err as Error).message}`);
      return {};
    }
  }
}
