import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Workbook } from 'exceljs';
import { CreateProfessorDto } from './dto/create-professor.dto';
import { Professor } from './professor.model';
import { ProfessorStatus } from './professor-status.enum';

@Injectable()
export class ProfessorsService {
  private readonly logger = new Logger(ProfessorsService.name);

  constructor(
    @InjectModel(Professor) private readonly professorModel: typeof Professor,
  ) {}

  /**
   * Insert or update by dedup identity (Section 8, Step 3):
   * matches on email first, otherwise on professorName + university.
   * Returns { professor, created }.
   */
  async upsert(
    dto: CreateProfessorDto,
  ): Promise<{ professor: Professor; created: boolean }> {
    // sourceUrl is the stable identity of a job-board posting: the SAME posting
    // re-scraped on another day can yield a different (or missing) contact
    // email/name, which — when keyed on email/name — silently created a
    // duplicate row (e.g. Aarhus DRY094: "Daniel Lucani" on day 1, "Contact —
    // Aarhus University" on day 3). Prefer the URL; fall back to email, then
    // name+university, for the rare source with no stable URL.
    const where = dto.sourceUrl
      ? { sourceUrl: dto.sourceUrl }
      : dto.email
        ? { email: dto.email }
        : { professorName: dto.professorName, university: dto.university };

    const existing = await this.professorModel.findOne({ where });
    if (existing) {
      // Merge non-null incoming fields; never clobber existing data with undefined.
      const patch = this.stripUndefined(dto);
      // Guard against downgrade: a re-scrape that failed to extract the PI must
      // not overwrite a real name we already captured with a generic
      // "Contact — <org>" placeholder. (Missing email is already dropped above.)
      if (
        this.isPlaceholderName(patch.professorName) &&
        !this.isPlaceholderName(existing.professorName)
      ) {
        delete patch.professorName;
      }
      await existing.update(patch);
      this.logger.log(`Updated professor ${existing.id} (${existing.professorName})`);
      return { professor: existing, created: false };
    }

    const professor = await this.professorModel.create(dto as any);
    this.logger.log(`Created professor ${professor.id} (${dto.professorName})`);
    return { professor, created: true };
  }

  findAll(filter?: {
    status?: ProfessorStatus;
    country?: string;
  }): Promise<Professor[]> {
    const where: Record<string, unknown> = {};
    if (filter?.status) where.status = filter.status;
    if (filter?.country) where.country = filter.country;
    return this.professorModel.findAll({
      where,
      order: [['dateDiscovered', 'DESC']],
    });
  }

  async findOne(id: string): Promise<Professor> {
    const professor = await this.professorModel.findByPk(id);
    if (!professor) throw new NotFoundException(`Professor ${id} not found`);
    return professor;
  }

  async update(id: string, patch: Partial<CreateProfessorDto>): Promise<Professor> {
    const professor = await this.findOne(id);
    await professor.update(this.stripUndefined(patch));
    return professor;
  }

  async remove(id: string): Promise<void> {
    const professor = await this.findOne(id);
    await professor.destroy();
  }

  count(): Promise<number> {
    return this.professorModel.count();
  }

  /**
   * Professors ready for personalization (Step 4): contactable (has an email),
   * not yet contacted, and without a snippet unless `force` re-generates.
   */
  findNeedingPersonalization(
    limit = 25,
    force = false,
  ): Promise<Professor[]> {
    const where: Record<string, unknown> = {
      email: { [Op.ne]: null },
      status: ProfessorStatus.NOT_CONTACTED,
    };
    if (!force) where.personalizedSnippet = { [Op.is]: null };
    return this.professorModel.findAll({
      where,
      order: [['dateDiscovered', 'DESC']],
      limit,
    });
  }

  /** Persist the Claude-written snippet (Step 4) with a timestamp. */
  async savePersonalization(
    id: string,
    snippet: string,
    at: Date,
  ): Promise<Professor> {
    const professor = await this.findOne(id);
    await professor.update({ personalizedSnippet: snippet, personalizedAt: at });
    return professor;
  }

  /** Professors ready to email: personalized, contactable, not yet contacted. */
  findReadyToEmail(limit = 20): Promise<Professor[]> {
    return this.professorModel.findAll({
      where: {
        email: { [Op.ne]: null },
        personalizedSnippet: { [Op.ne]: null },
        status: ProfessorStatus.NOT_CONTACTED,
      },
      order: [['dateDiscovered', 'DESC']],
      limit,
    });
  }

  /** Mark a professor emailed (Step 7): set status, dateEmailed, followupDate. */
  async markEmailed(id: string, followupDate: string): Promise<Professor> {
    const professor = await this.findOne(id);
    await professor.update({
      status: ProfessorStatus.EMAILED,
      dateEmailed: new Date(),
      followupDate,
    });
    return professor;
  }

  /**
   * Mark that a form-based application was submitted (assisted-apply flow).
   * These listings have no email, so they never enter the email pipeline;
   * APPLIED records them as done and appends an audit note.
   */
  async markApplied(id: string, note: string): Promise<Professor> {
    const professor = await this.findOne(id);
    const stamp = new Date().toISOString().slice(0, 10);
    const prior = professor.replyNotes ? `${professor.replyNotes}\n` : '';
    await professor.update({
      status: ProfessorStatus.APPLIED,
      replyNotes: `${prior}[${stamp}] ${note}`,
    });
    return professor;
  }

  /** Mark replied (Step 8): stop follow-ups; note when. */
  async markReplied(id: string): Promise<Professor> {
    const professor = await this.findOne(id);
    const stamp = new Date().toISOString().slice(0, 10);
    await professor.update({
      status: ProfessorStatus.REPLIED,
      replyNotes: professor.replyNotes ?? `Reply detected ${stamp}`,
    });
    return professor;
  }

  /** Mark that the follow-up has been sent (Step 9). */
  async markFollowupSent(id: string): Promise<Professor> {
    const professor = await this.findOne(id);
    await professor.update({ status: ProfessorStatus.FOLLOW_UP_SENT });
    return professor;
  }

  /**
   * Professors due for a follow-up (Step 9): emailed, no reply yet, and their
   * followupDate has arrived. (status EMAILED already excludes replied ones.)
   */
  findDueFollowups(today: string, limit = 20): Promise<Professor[]> {
    return this.professorModel.findAll({
      where: {
        status: ProfessorStatus.EMAILED,
        followupDate: { [Op.ne]: null, [Op.lte]: today },
      },
      order: [['followupDate', 'ASC']],
      limit,
    });
  }

  /**
   * Excel snapshot generated on demand from Postgres (Section 8, Step 10).
   * Postgres remains the source of truth; this mirrors the reference
   * PhD_Professor_Tracker.xlsx column layout (Section 9).
   */
  async exportToWorkbook(): Promise<Workbook> {
    const rows = await this.findAll();
    const wb = new Workbook();
    wb.creator = 'phd-outreach';
    const ws = wb.addWorksheet('Professors');

    ws.columns = [
      { header: 'Professor Name', key: 'professorName', width: 26 },
      { header: 'University', key: 'university', width: 30 },
      { header: 'Country', key: 'country', width: 14 },
      { header: 'Department / Lab', key: 'departmentLab', width: 28 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'LinkedIn', key: 'linkedinUrl', width: 30 },
      { header: 'Website', key: 'personalWebsite', width: 30 },
      { header: 'Matched Tags', key: 'matchedTags', width: 34 },
      { header: 'Source', key: 'source', width: 16 },
      { header: 'Source URL', key: 'sourceUrl', width: 34 },
      { header: 'Match Reason', key: 'matchReason', width: 40 },
      { header: 'Funding Type', key: 'fundingType', width: 18 },
      { header: 'Application Deadline', key: 'applicationDeadline', width: 18 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Date Discovered', key: 'dateDiscovered', width: 18 },
      { header: 'Date Emailed', key: 'dateEmailed', width: 18 },
      { header: 'Follow-up Date', key: 'followupDate', width: 16 },
      { header: 'Reply Notes', key: 'replyNotes', width: 40 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    for (const p of rows) {
      ws.addRow({
        ...p.toJSON(),
        matchedTags: (p.matchedTags ?? []).join(', '),
      });
    }

    this.logger.log(`Exported ${rows.length} professor rows to workbook`);
    return wb;
  }

  /** A derived fallback identity ("Contact — <org>"), not a real PI name. */
  private isPlaceholderName(name?: string): boolean {
    return !name || name.startsWith('Contact — ');
  }

  private stripUndefined<T extends object>(obj: T): Partial<T> {
    return Object.fromEntries(
      Object.entries(obj).filter(([, v]) => v !== undefined),
    ) as Partial<T>;
  }
}
