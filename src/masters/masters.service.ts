import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { literal } from 'sequelize';
import { MastersProgram } from './masters-program.model';
import { MastersDocument } from './masters-document.model';
import { SEED_PROGRAMS } from './masters-seed';
import { DocumentStatus, ProgramStatus } from './masters-enums';

export interface ProgramWithTiming extends MastersProgram {
  daysUntilOpen?: number | null;
  daysUntilClose?: number | null;
}

/** Whole-day difference between a YYYY-MM-DD date and today (UTC midnight). */
function daysFromToday(dateOnly: string | null): number | null {
  if (!dateOnly) return null;
  const target = new Date(`${dateOnly}T00:00:00Z`).getTime();
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - todayUtc) / 86_400_000);
}

/**
 * CRUD + checklist logic for the Erasmus Mundus master's tracker. No scraping,
 * no auto-submission — this is a tracker and document-prep helper.
 */
@Injectable()
export class MastersService {
  private readonly logger = new Logger(MastersService.name);

  constructor(
    @InjectModel(MastersProgram) private readonly programModel: typeof MastersProgram,
    @InjectModel(MastersDocument) private readonly documentModel: typeof MastersDocument,
  ) {}

  /**
   * Insert the seed programmes (idempotent). Existing rows are REFRESHED only
   * for reference fields (name/urls/required-docs/dates) and never clobber our
   * own progress fields (status, notes, eligibilityVerified). Verified dates on
   * a row are not overwritten by an unverified seed.
   */
  async seed(): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;
    for (const s of SEED_PROGRAMS) {
      const existing = await this.programModel.findOne({ where: { code: s.code } });
      if (!existing) {
        await this.programModel.create({
          code: s.code,
          name: s.name,
          coordinatingUniversity: s.coordinatingUniversity,
          portalUrl: s.portalUrl,
          infoUrl: s.infoUrl,
          partnerCountries: s.partnerCountries,
          opensAt: s.opensAt,
          closesAt: s.closesAt,
          resultsAt: s.resultsAt,
          datesVerified: s.datesVerified,
          datesSource: s.datesSource,
          requiredDocs: s.requiredDocs,
          eligibilityNotes: s.eligibilityNotes,
        } as any);
        created += 1;
        continue;
      }
      const patch: Record<string, unknown> = {
        name: s.name,
        coordinatingUniversity: s.coordinatingUniversity,
        portalUrl: s.portalUrl,
        infoUrl: s.infoUrl,
        partnerCountries: s.partnerCountries,
        requiredDocs: s.requiredDocs,
      };
      // Only let the seed set dates when the stored row isn't already verified.
      if (!existing.datesVerified) {
        patch.opensAt = s.opensAt;
        patch.closesAt = s.closesAt;
        patch.resultsAt = s.resultsAt;
        patch.datesVerified = s.datesVerified;
        patch.datesSource = s.datesSource;
      }
      await existing.update(patch);
      updated += 1;
    }
    this.logger.log(`Seed complete: ${created} created, ${updated} refreshed.`);
    return { created, updated };
  }

  /** All programmes with days-until-open/close computed. */
  async findAll(): Promise<ProgramWithTiming[]> {
    const rows = await this.programModel.findAll({ order: [literal('closes_at ASC NULLS LAST')] });
    return rows.map((r) => this.withTiming(r));
  }

  async findByCode(code: string): Promise<MastersProgram> {
    const row = await this.programModel.findOne({
      where: { code: code.toUpperCase() },
      include: [MastersDocument],
    });
    if (!row) throw new NotFoundException(`No masters programme with code ${code}`);
    return row;
  }

  async findOne(id: string): Promise<MastersProgram> {
    const row = await this.programModel.findByPk(id, { include: [MastersDocument] });
    if (!row) throw new NotFoundException(`No masters programme ${id}`);
    return row;
  }

  /** Patch progress/reference fields on a programme (manual curation). */
  async updateProgram(
    id: string,
    patch: Partial<{
      status: ProgramStatus;
      notes: string;
      opensAt: string | null;
      closesAt: string | null;
      resultsAt: string | null;
      datesVerified: boolean;
      datesSource: string;
      eligibilityNotes: string;
      eligibilityVerified: boolean;
      portalUrl: string;
    }>,
  ): Promise<MastersProgram> {
    const row = await this.findOne(id);
    await row.update(patch);
    return row;
  }

  /**
   * Materialise the checklist: create a MastersDocument row for each entry in
   * the programme's requiredDocs template that doesn't exist yet. Idempotent.
   */
  async ensureChecklist(programId: string): Promise<MastersDocument[]> {
    const program = await this.findOne(programId);
    for (const doc of program.requiredDocs ?? []) {
      const [row, created] = await this.documentModel.findOrCreate({
        where: { programId, docKey: doc.key },
        defaults: { programId, docKey: doc.key, label: doc.label, required: doc.required } as any,
      });
      if (!created && row.label !== doc.label) await row.update({ label: doc.label });
    }
    return this.documentModel.findAll({ where: { programId }, order: [['required', 'DESC'], ['doc_key', 'ASC']] });
  }

  async updateDocument(
    id: string,
    patch: Partial<{ status: DocumentStatus; filePath: string; notes: string }>,
  ): Promise<MastersDocument> {
    const row = await this.documentModel.findByPk(id);
    if (!row) throw new NotFoundException(`No masters document ${id}`);
    await row.update(patch);
    return row;
  }

  /** Find or create the single checklist row for a (program, docKey). */
  async getOrCreateDocument(programId: string, docKey: string, label: string): Promise<MastersDocument> {
    const [row] = await this.documentModel.findOrCreate({
      where: { programId, docKey },
      defaults: { programId, docKey, label } as any,
    });
    return row;
  }

  /**
   * Programmes with an imminent open or close within `windowDays`, plus any
   * whose dates are still unverified (so we're nudged to go confirm them).
   */
  async upcoming(windowDays = 30): Promise<{
    openingSoon: ProgramWithTiming[];
    closingSoon: ProgramWithTiming[];
    needsVerification: MastersProgram[];
  }> {
    const all = await this.findAll();
    const active = all.filter((p) => !['submitted', 'accepted', 'rejected', 'withdrawn'].includes(p.status));
    const openingSoon = active.filter(
      (p) => p.daysUntilOpen != null && p.daysUntilOpen >= 0 && p.daysUntilOpen <= windowDays,
    );
    const closingSoon = active.filter(
      (p) => p.daysUntilClose != null && p.daysUntilClose >= 0 && p.daysUntilClose <= windowDays,
    );
    const needsVerification = active.filter((p) => !p.datesVerified);
    return { openingSoon, closingSoon, needsVerification };
  }

  private withTiming(row: MastersProgram): ProgramWithTiming {
    const out = row as ProgramWithTiming;
    out.daysUntilOpen = daysFromToday(row.opensAt);
    out.daysUntilClose = daysFromToday(row.closesAt);
    return out;
  }
}
