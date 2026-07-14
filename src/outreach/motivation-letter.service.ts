import { Injectable, Logger } from '@nestjs/common';
import { createWriteStream } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import PDFDocument = require('pdfkit');
import { PersonalizationService } from '../personalization/personalization.service';
import { Professor } from '../professors/professor.model';
import { OWNER_PROFILE } from '../personalization/owner-profile';

const HEADER_NAME = 'Muhammad Umer Bilal';
const HEADER_CONTACT =
  'mumerbilal142@gmail.com  •  +971 55 969 5281  •  Dubai, UAE  •  linkedin.com/in/muhammad-umer-bilal-b1a9391a2';

/**
 * Generates a per-professor "Statement of Motivation" PDF (PROJECT.md §13):
 * the fixed prose is genuine, while the professor name, university, research
 * area, and one custom paragraph are filled in per professor (the custom
 * paragraph via `claude -p`). Renders a fresh PDF to a temp file at send time.
 */
@Injectable()
export class MotivationLetterService {
  private readonly logger = new Logger(MotivationLetterService.name);

  constructor(private readonly personalization: PersonalizationService) {}

  /** Build + render the letter; returns the temp PDF path (caller deletes it). */
  async generate(professor: Professor): Promise<{ path: string; filename: string }> {
    const surname = this.surname(professor.professorName);
    const university = professor.university || 'your university';
    const researchArea = this.researchArea(professor);
    const custom = await this.customParagraph(professor, researchArea);

    const filename = 'Umer_Bilal_Motivation_Letter.pdf';
    const path = join(tmpdir(), `motivation-${professor.id}-${Date.now()}.pdf`);
    await this.render(path, { surname, university, researchArea, custom });
    this.logger.log(`Generated motivation letter for ${professor.professorName}`);
    return { path, filename };
  }

  /** Ask claude for the one paragraph that must change per professor. */
  private async customParagraph(professor: Professor, researchArea: string): Promise<string> {
    const prompt = `
Write ONE paragraph (2-3 sentences, ~60 words) for a PhD statement of motivation.
It must state specifically what the applicant would want to research in this
professor's group and how it connects to or extends their work. Be concrete and
grounded in the facts below; do not invent papers or results. First person, as
the applicant. No greeting, no sign-off.

Output ONLY the paragraph, wrapped exactly between <snippet> and </snippet>.

PROFESSOR: ${professor.professorName}, ${professor.university}.
THEIR AREA: ${researchArea}.
APPLICANT:
${OWNER_PROFILE}
`.trim();
    try {
      const p = await this.personalization.complete(prompt);
      if (p) return p;
    } catch (err) {
      this.logger.warn(`Custom paragraph failed, using fallback: ${(err as Error).message}`);
    }
    // Fallback keeps the letter valid even if claude is unavailable.
    return `Within your group, I would like to build on my thesis work by extending machine-learning methods for network-security detection toward ${researchArea}, combining rigorous evaluation with the systems engineering needed to make such methods deployable in practice.`;
  }

  /** Derive a readable research-area phrase from the matched position/tags. */
  private researchArea(professor: Professor): string {
    const m = (professor.matchReason || '').match(/Position:\s*"([^"]+)"/i);
    if (m) return m[1].replace(/^phd (position )?(in|on)\s+/i, '').trim();
    if (professor.matchedTags?.length) return professor.matchedTags.join(' and ').toLowerCase();
    return 'machine learning for network security';
  }

  private surname(name: string): string {
    const n = (name || '').trim();
    if (!n || /^contact\b/i.test(n)) return '';
    return n.split(/\s+/).pop() as string;
  }

  private render(
    path: string,
    v: { surname: string; university: string; researchArea: string; custom: string },
  ): Promise<void> {
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const stream = createWriteStream(path);
    doc.pipe(stream);

    // Header
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#1a3c6e').text(HEADER_NAME);
    doc.font('Helvetica').fontSize(9).fillColor('#333333').text(HEADER_CONTACT);
    doc.moveDown(0.4);
    doc
      .moveTo(56, doc.y)
      .lineTo(doc.page.width - 56, doc.y)
      .strokeColor('#1a3c6e')
      .lineWidth(1)
      .stroke();
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(12).fillColor('#1a3c6e').text('Statement of Motivation');
    doc.moveDown(0.6);

    const body = doc.font('Helvetica').fontSize(10.5).fillColor('#111111');
    const greeting = v.surname ? `Dear Professor ${v.surname},` : 'Dear Professor,';
    const paras = [
      greeting,
      `I am writing to express my interest in pursuing a PhD under your supervision at ${v.university}, having read about your work on ${v.researchArea}. My background combines a research foundation in machine learning for network security with over six years of hands-on experience building production backend and cloud systems, and I believe this combination would let me contribute meaningfully to your group's work.`,
      `I completed my MS in Computer Networks & Security at the National University of Computer & Emerging Sciences (NUCES-FAST), Islamabad, where my thesis proposed a dynamic window-sizing approach for detecting low-rate DDoS attacks using an ensemble of machine learning classifiers (RNN, MLP, LSTM, Random Forest), evaluated on the UNSW-NB15 dataset. This work is attached, along with my CV, as a writing sample.`,
      `Alongside this research background, I have spent the past six years working as a software engineer in Dubai, building backend systems, APIs, and cloud infrastructure for production applications. More recently, I have been deepening my practical security skills through hands-on web application penetration testing (PortSwigger Web Security Academy, Burp Suite) and am currently preparing for the eJPT certification. I see this practical, systems-level experience as a genuine complement to academic research — it lets me implement and stress-test ideas, not just model them theoretically.`,
      v.custom,
      `I would welcome the opportunity to discuss how my background might fit into your current research, and whether a funded PhD position or research assistantship may be available in your group. My CV and thesis writing sample are attached, and I would be glad to provide my degree certificate and reference letters (from my thesis supervisor and course instructors) on request.`,
      'Thank you very much for your time and consideration.',
    ];
    for (const p of paras) {
      body.text(p, { align: 'left', lineGap: 2 });
      doc.moveDown(0.7);
    }
    doc.moveDown(0.3);
    body.text('Sincerely,');
    body.text('Muhammad Umer Bilal');

    doc.end();
    return new Promise((resolve, reject) => {
      stream.on('finish', () => resolve());
      stream.on('error', reject);
    });
  }
}
