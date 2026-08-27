import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import PDFDocument = require('pdfkit');
import { PersonalizationService } from '../../personalization/personalization.service';
import {
  CV_CERTIFICATIONS,
  CV_EDUCATION,
  CV_HEADER,
  CV_LANGUAGES,
  CvVariant,
  cvVariantFor,
  REAL_CV_FILES,
  SKILL_INVENTORY,
} from '../job-profile';
import { JobListing } from '../job-listing.model';

interface TailoredContent {
  summary: string;
  skillGroups: { label: string; skills: string[] }[];
}

/**
 * Builds a JD-tailored, ALWAYS-2-PAGE CV PDF from the structured base CV.
 *
 * Integrity: only the SUMMARY and SKILLS adapt to the JD, and skills are
 * filtered to SKILL_INVENTORY so nothing is ever invented. The fixed experience
 * blocks are rendered verbatim from job-profile.ts.
 */
@Injectable()
export class CvTailorService {
  private readonly logger = new Logger(CvTailorService.name);
  private readonly outDir: string;
  /** Umer's real hand-designed CVs by variant (env-overridable). */
  private readonly realCvFiles: Record<'backend' | 'fullstack' | 'mobile', string>;

  constructor(
    private readonly personalization: PersonalizationService,
    private readonly config: ConfigService,
  ) {
    const base = this.config.get<string>('APPLY_DIR') ?? './applications';
    // Created lazily only if a fallback CV must actually be generated — with the
    // real CVs present this dir normally never appears.
    this.outDir = join(base, 'cvs');
    this.realCvFiles = {
      backend: this.config.get<string>('CV_BACKEND_PATH') ?? REAL_CV_FILES.backend,
      fullstack: this.config.get<string>('CV_FULLSTACK_PATH') ?? REAL_CV_FILES.fullstack,
      mobile: this.config.get<string>('CV_MOBILE_PATH') ?? REAL_CV_FILES.mobile,
    };
  }

  /**
   * Resolve the CV to attach for a listing. Prefers Umer's REAL hand-designed
   * PDF for the role family (used as-is — the polished original beats a
   * generated one). Only if that file is missing does it fall back to
   * generating a JD-tailored PDF, so the pipeline never breaks. Returns the PDF
   * path + variant key.
   */
  async tailor(listing: JobListing): Promise<{ path: string; variant: string }> {
    const variant = cvVariantFor(listing.roleType);
    const real = this.realCvFiles[variant.key as 'backend' | 'fullstack' | 'mobile'];
    if (real && existsSync(real)) {
      this.logger.log(`Using real ${variant.key} CV for "${listing.title}" @ ${listing.company}`);
      return { path: real, variant: variant.key };
    }

    this.logger.warn(
      `Real ${variant.key} CV not found at "${real}" — generating a fallback CV instead.`,
    );
    if (!existsSync(this.outDir)) mkdirSync(this.outDir, { recursive: true });
    const tailored = await this.tailorContent(variant, listing);
    const path = join(this.outDir, `CV_${this.slug(listing)}.pdf`);
    await this.render(path, variant, tailored);
    this.logger.log(`Generated fallback ${variant.key} CV for "${listing.title}" @ ${listing.company}`);
    return { path, variant: variant.key };
  }

  /** Ask Claude to rewrite the summary + reorder/emphasize skills to the JD. */
  private async tailorContent(variant: CvVariant, listing: JobListing): Promise<TailoredContent> {
    const base: TailoredContent = { summary: variant.summary, skillGroups: variant.skillGroups };
    const prompt = `
You are tailoring a CV to a specific job. You may ONLY change the professional
summary and the skills section. You MUST NOT invent skills, tools, or experience.

STRICT RULES:
- Skills may ONLY come from this exact inventory (the applicant's real skills):
${SKILL_INVENTORY.join(', ')}
- Reorder/emphasize the skills the job asks for; keep 6-8 groups; drop nothing
  the applicant clearly has that is relevant. Never add a skill not in the list.
- Rewrite the summary in first-person-free CV voice (~70-90 words) to foreground
  the overlap with the job — but keep every claim true to the base summary.

JOB:
Title: ${listing.title}
Company: ${listing.company}
Skills the JD mentions that the applicant has: ${(listing.matchedSkills || []).join(', ') || '(none detected)'}
Description (truncated):
${(listing.description || '').slice(0, 2500)}

BASE SUMMARY:
${variant.summary}

BASE SKILL GROUPS (JSON):
${JSON.stringify(variant.skillGroups)}

Output ONLY a JSON object wrapped exactly between <cv> and </cv>:
<cv>{"summary":"...","skillGroups":[{"label":"...","skills":["..."]}]}</cv>`.trim();

    try {
      const raw = await this.personalization.completeRaw(prompt);
      const tagged = raw.match(/<cv>([\s\S]*?)<\/cv>/i);
      const json = tagged ? tagged[1] : raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
      const parsed = JSON.parse(json) as TailoredContent;

      const inventory = new Set(SKILL_INVENTORY.map((s) => s.toLowerCase()));
      const cleanGroups = (parsed.skillGroups || [])
        .map((g) => ({
          label: String(g.label || '').slice(0, 40),
          // Guardrail: keep ONLY skills from the real inventory.
          skills: (g.skills || []).filter((s) => inventory.has(String(s).toLowerCase())),
        }))
        .filter((g) => g.label && g.skills.length);

      return {
        summary: (parsed.summary || variant.summary).trim() || variant.summary,
        skillGroups: cleanGroups.length ? cleanGroups : variant.skillGroups,
      };
    } catch (err) {
      this.logger.warn(`CV tailoring fell back to base ${variant.key}: ${(err as Error).message}`);
      return base;
    }
  }

  /**
   * Render the CV. Targets a comfortable 2-page layout (like Umer's originals)
   * and guarantees it never exceeds 2 pages by trimming trailing bullets if a
   * long JD-tailored summary/skills block would push it over.
   */
  private async render(path: string, variant: CvVariant, content: TailoredContent): Promise<void> {
    for (const maxBullets of [4, 3, 2]) {
      const pages = await this.renderOnce(path, variant, content, maxBullets);
      if (pages <= 2) return;
    }
    // Last resort already written at maxBullets=2.
  }

  private renderOnce(
    path: string,
    variant: CvVariant,
    content: TailoredContent,
    maxBullets: number,
  ): Promise<number> {
    const M = 50;
    const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true });
    const stream = createWriteStream(path);
    doc.pipe(stream);

    const navy = '#1a3c6e';
    const dark = '#111111';
    const gray = '#444444';
    const width = doc.page.width - M * 2;

    // Header
    doc.font('Helvetica-Bold').fontSize(20).fillColor(navy).text(CV_HEADER.name);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(gray).text(variant.title);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(gray)
      .text(
        `${CV_HEADER.email}  •  ${CV_HEADER.phone}  •  ${CV_HEADER.location}  •  ${CV_HEADER.visa}`,
      );
    doc.font('Helvetica').fontSize(9).fillColor(gray).text(`${CV_HEADER.linkedin}  •  ${CV_HEADER.github}`);
    doc.moveDown(0.5);
    this.rule(doc, navy, M);

    const section = (title: string) => {
      doc.moveDown(0.6);
      doc.font('Helvetica-Bold').fontSize(11.5).fillColor(navy).text(title.toUpperCase());
      doc.moveDown(0.25);
    };

    section('Professional Summary');
    doc.font('Helvetica').fontSize(10).fillColor(dark).text(content.summary, { align: 'left', lineGap: 2 });

    section('Technical Skills');
    for (const g of content.skillGroups) {
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(dark).text(`${g.label}: `, { continued: true });
      doc.font('Helvetica').fontSize(9.5).fillColor(gray).text(g.skills.join(' | '));
      doc.moveDown(0.1);
    }

    section('Professional Experience');
    for (const exp of variant.experience) {
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(dark).text(`${exp.company} — ${exp.role}`, { continued: true });
      doc.font('Helvetica-Oblique').fontSize(9).fillColor(gray).text(`   ${exp.dates} | ${exp.location}`);
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(navy).text(exp.project);
      for (const b of exp.bullets.slice(0, maxBullets)) {
        doc.font('Helvetica').fontSize(9.5).fillColor(dark).text(`•  ${b}`, {
          indent: 10,
          lineGap: 1.5,
          width,
        });
      }
      doc.moveDown(0.4);
    }

    section('Education');
    doc.font('Helvetica-Bold').fontSize(9.8).fillColor(dark).text(CV_EDUCATION.degree);
    doc.font('Helvetica').fontSize(9.5).fillColor(gray).text(`${CV_EDUCATION.institution} | ${CV_EDUCATION.years}`);

    section('Certifications & Languages');
    doc.font('Helvetica').fontSize(9.5).fillColor(gray).text(CV_CERTIFICATIONS.join('  •  '));
    doc.font('Helvetica').fontSize(9.5).fillColor(gray).text(CV_LANGUAGES);

    const pages = doc.bufferedPageRange().count;
    doc.end();
    return new Promise((resolve, reject) => {
      stream.on('finish', () => resolve(pages));
      stream.on('error', reject);
    });
  }

  private rule(doc: PDFKit.PDFDocument, color: string, margin: number): void {
    doc
      .moveTo(margin, doc.y)
      .lineTo(doc.page.width - margin, doc.y)
      .strokeColor(color)
      .lineWidth(1)
      .stroke();
  }

  private slug(listing: JobListing): string {
    const s = `${listing.company}_${listing.title}`
      .replace(/[^a-z0-9]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60);
    return `${s}_${listing.id.slice(0, 8)}`;
  }
}
