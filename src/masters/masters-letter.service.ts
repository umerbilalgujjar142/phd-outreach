import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PersonalizationService } from '../personalization/personalization.service';
import { OWNER_PROFILE } from '../personalization/owner-profile';
import { MastersService } from './masters.service';
import { MastersProgram } from './masters-program.model';

/**
 * Drafts a tailored motivation letter for an Erasmus Mundus programme using the
 * existing `claude -p` pipeline. SAME integrity rules as the PhD CV/letters:
 * only Umer's REAL background (OWNER_PROFILE) is used — no invented experience,
 * publications, or skills. Output is a DRAFT for Umer to review and edit before
 * anything is uploaded; the file is saved under MASTERS_DOCS_DIR and recorded
 * on the programme's checklist.
 */
@Injectable()
export class MastersLetterService {
  private readonly logger = new Logger(MastersLetterService.name);
  private readonly docsDir: string;

  constructor(
    private readonly personalization: PersonalizationService,
    private readonly masters: MastersService,
    private readonly config: ConfigService,
  ) {
    this.docsDir = this.config.get<string>('MASTERS_DOCS_DIR') ?? './masters';
  }

  /** Generate + save a motivation-letter draft for one programme. */
  async generate(
    programId: string,
    opts?: { maxWords?: number; angle?: string },
  ): Promise<{ programCode: string; path: string; text: string }> {
    const program = await this.masters.findOne(programId);
    const maxWords = opts?.maxWords ?? 500;
    const text = await this.draft(program, maxWords, opts?.angle);

    mkdirSync(this.docsDir, { recursive: true });
    const file = `motivation-${program.code.toLowerCase()}-${Date.now()}.md`;
    const path = join(this.docsDir, file);
    const header =
      `# Motivation letter — ${program.code}\n` +
      `<!-- DRAFT generated ${new Date().toISOString()} · max ${maxWords} words · REVIEW & EDIT before uploading -->\n\n`;
    writeFileSync(path, header + text + '\n');

    // Record on the checklist (status stays in_progress — it's a draft).
    const doc = await this.masters.getOrCreateDocument(program.id, 'motivation_letter', 'Motivation letter');
    await doc.update({ status: 'in_progress', filePath: path });

    this.logger.log(`Drafted motivation letter for ${program.code} → ${path}`);
    return { programCode: program.code, path, text };
  }

  private async draft(program: MastersProgram, maxWords: number, angle?: string): Promise<string> {
    const prompt = `
Write a motivation letter for a scholarship application to the Erasmus Mundus
Joint Master's programme below. Write in the first person AS THE APPLICANT.

STRICT RULES:
- Use ONLY the applicant facts given below. Do NOT invent experience, job
  titles, publications, grades, awards, or skills that are not stated.
- Be specific about why THIS programme and its focus fit the applicant.
- Professional, sincere tone. No clichés, no filler, no flattery.
- Target length: about ${maxWords} words. Do not exceed it.
- No greeting header and no signature block — body paragraphs only.
${angle ? `- Emphasis requested by the applicant: ${angle}` : ''}

Output ONLY the letter body, wrapped exactly between <snippet> and </snippet>.

PROGRAMME: ${program.name}
COORDINATING UNIVERSITY: ${program.coordinatingUniversity}
PARTNER COUNTRIES: ${(program.partnerCountries ?? []).join(', ') || 'n/a'}

APPLICANT:
${OWNER_PROFILE}
`.trim();

    const out = await this.personalization.complete(prompt);
    if (!out) throw new Error('claude returned an empty motivation letter');
    return out;
  }
}
