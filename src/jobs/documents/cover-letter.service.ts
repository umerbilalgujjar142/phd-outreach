import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import PDFDocument = require('pdfkit');
import { PersonalizationService } from '../../personalization/personalization.service';
import { CV_HEADER, JOB_OWNER_PROFILE } from '../job-profile';
import { JobListing } from '../job-listing.model';

/** JD phrases that indicate a cover letter / motivation is expected. */
const COVER_LETTER_RE =
  /cover letter|motivation letter|letter of motivation|why (do )?you|tell us why|statement of|covering letter/i;

/**
 * Generates a JD-tailored cover-letter PDF — ONLY when the posting asks for one.
 * Same honesty rule as the CV: grounded strictly in Umer's real background.
 */
@Injectable()
export class CoverLetterService {
  private readonly logger = new Logger(CoverLetterService.name);
  private readonly outDir: string;

  constructor(
    private readonly personalization: PersonalizationService,
    private readonly config: ConfigService,
  ) {
    const base = this.config.get<string>('APPLY_DIR') ?? './applications';
    this.outDir = join(base, 'cover-letters');
    if (!existsSync(this.outDir)) mkdirSync(this.outDir, { recursive: true });
  }

  /** True if the listing's description requests a cover letter. */
  static isRequired(listing: JobListing): boolean {
    return COVER_LETTER_RE.test(listing.description || '');
  }

  async generate(listing: JobListing): Promise<{ path: string }> {
    const body = await this.body(listing);
    const path = join(this.outDir, `CoverLetter_${this.slug(listing)}.pdf`);
    await this.render(path, listing, body);
    this.logger.log(`Generated cover letter for "${listing.title}" @ ${listing.company}`);
    return { path };
  }

  private async body(listing: JobListing): Promise<string[]> {
    const sponsorLine = listing.needsSponsorship
      ? 'The applicant is based in Dubai (UAE visa) and would require visa sponsorship for this role — mention openness to relocation, briefly and positively.'
      : 'No visa sponsorship is required for this role.';
    const prompt = `
Write a concise, professional cover letter body (3 short paragraphs, ~180 words
total) for a specific software job. First person ("I"). Ground EVERY claim in the
applicant's real background below — never invent employers, projects, or numbers.
Foreground the overlap with this job's stack and responsibilities. No greeting,
no sign-off, no address block — body paragraphs only, separated by blank lines.

JOB:
Title: ${listing.title}
Company: ${listing.company}
Relevant skills the applicant has that the JD mentions: ${(listing.matchedSkills || []).join(', ') || '(general software engineering)'}
Description (truncated): ${(listing.description || '').slice(0, 2000)}
Sponsorship: ${sponsorLine}

APPLICANT:
${JOB_OWNER_PROFILE}

Output ONLY the paragraphs wrapped exactly between <letter> and </letter>.`.trim();

    try {
      const raw = await this.personalization.completeRaw(prompt);
      const tagged = raw.match(/<letter>([\s\S]*?)<\/letter>/i);
      const text = (tagged ? tagged[1] : raw).trim();
      const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
      if (paras.length) return paras;
    } catch (err) {
      this.logger.warn(`Cover-letter generation fell back: ${(err as Error).message}`);
    }
    // Fallback keeps the letter valid if Claude is unavailable.
    return [
      `I am writing to apply for the ${listing.title} role at ${listing.company}. With six years of experience building production web and mobile systems in Node.js, NestJS, React, and React Native, I believe my background maps closely to what this role needs.`,
      `In my current role at SoftBuilders in Dubai I build and ship full-stack products end to end — REST APIs on NestJS/PostgreSQL, React and React Native clients, and cloud/CI-CD infrastructure — and I would bring that same delivery focus to your team.`,
      `I would welcome the chance to discuss how I can contribute. Thank you for your consideration.`,
    ];
  }

  private render(path: string, listing: JobListing, paras: string[]): Promise<void> {
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const stream = createWriteStream(path);
    doc.pipe(stream);
    const navy = '#1a3c6e';

    doc.font('Helvetica-Bold').fontSize(16).fillColor(navy).text(CV_HEADER.name);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#333333')
      .text(`${CV_HEADER.email}  •  ${CV_HEADER.phone}  •  ${CV_HEADER.location}`);
    doc.moveDown(0.4);
    doc.moveTo(56, doc.y).lineTo(doc.page.width - 56, doc.y).strokeColor(navy).lineWidth(1).stroke();
    doc.moveDown(1);

    const body = doc.font('Helvetica').fontSize(10.5).fillColor('#111111');
    body.text(`Dear ${listing.company} Hiring Team,`, { lineGap: 2 });
    doc.moveDown(0.7);
    for (const p of paras) {
      body.text(p, { align: 'left', lineGap: 2 });
      doc.moveDown(0.6);
    }
    doc.moveDown(0.3);
    body.text('Sincerely,');
    body.text(CV_HEADER.name);

    doc.end();
    return new Promise((resolve, reject) => {
      stream.on('finish', () => resolve());
      stream.on('error', reject);
    });
  }

  private slug(listing: JobListing): string {
    const s = `${listing.company}_${listing.title}`
      .replace(/[^a-z0-9]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60);
    return `${s}_${listing.id.slice(0, 8)}`;
  }
}
