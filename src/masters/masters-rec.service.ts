import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { GmailService } from '../gmail/gmail.service';
import { MastersService } from './masters.service';
import { MastersRecRequest } from './masters-rec-request.model';

const APPLICANT = 'Muhammad Umer Bilal';

/**
 * Tracks recommendation-letter requests to professors and composes the request
 * email. SAFETY: drafting and sending are SEPARATE. `draft()` only returns a
 * preview; `send()` actually emails and is only ever invoked after Umer
 * explicitly confirms — it is never called autonomously or on a schedule.
 */
@Injectable()
export class MastersRecService {
  private readonly logger = new Logger(MastersRecService.name);

  constructor(
    @InjectModel(MastersRecRequest) private readonly recModel: typeof MastersRecRequest,
    private readonly gmail: GmailService,
    private readonly masters: MastersService,
  ) {}

  async create(input: {
    professorName: string;
    professorEmail?: string;
    university?: string;
    programId?: string;
    notes?: string;
  }): Promise<MastersRecRequest> {
    return this.recModel.create({
      professorName: input.professorName,
      professorEmail: input.professorEmail,
      university: input.university,
      programId: input.programId ?? null,
      notes: input.notes,
    } as any);
  }

  findAll(): Promise<MastersRecRequest[]> {
    return this.recModel.findAll({ order: [['created_at', 'DESC']] });
  }

  private async findOne(id: string): Promise<MastersRecRequest> {
    const row = await this.recModel.findByPk(id);
    if (!row) throw new NotFoundException(`No rec request ${id}`);
    return row;
  }

  /** Build the request email (subject + body) WITHOUT sending it. */
  async draft(id: string): Promise<{ to: string; subject: string; body: string }> {
    const rec = await this.findOne(id);
    const programName = rec.programId
      ? (await this.masters.findOne(rec.programId)).name
      : 'Erasmus Mundus Joint Master scholarships in cybersecurity';
    const deadlineLine = await this.deadlineLine(rec.programId);
    const subject = `Request for a recommendation letter — ${APPLICANT}`;
    const body = [
      `Dear ${this.salutation(rec.professorName)},`,
      '',
      `I hope you are well. I am applying to ${programName}, and I would be very`,
      `grateful if you would be willing to write a letter of recommendation in`,
      `support of my application.`,
      '',
      `You know my work from my studies/research, and your perspective on my`,
      `background in network and application security would carry real weight`,
      `with the selection committee.`,
      deadlineLine,
      `If you are willing, I can send you my CV, a short summary of my goals, and`,
      `any submission details (portal link or address) at your convenience.`,
      '',
      `Thank you very much for considering this.`,
      '',
      `Best regards,`,
      APPLICANT,
    ]
      .filter((l) => l !== null)
      .join('\n');

    return { to: rec.professorEmail ?? '', subject, body };
  }

  /**
   * Actually send the request email. CALLER MUST have Umer's explicit OK.
   * Persists the thread id and marks the request as `requested`.
   */
  async send(id: string): Promise<MastersRecRequest> {
    const rec = await this.findOne(id);
    if (!rec.professorEmail) {
      throw new BadRequestException('No professor email on this request — add one before sending.');
    }
    if (!this.gmail.isConnected()) {
      throw new BadRequestException('Gmail not connected — authorize at /gmail/connect first.');
    }
    const { subject, body } = await this.draft(id);
    const sent = await this.gmail.send({ to: rec.professorEmail, subject, text: body });
    await rec.update({ status: 'requested', requestedAt: new Date(), threadId: sent.gmailThreadId });
    this.logger.log(`Rec-letter request sent to ${rec.professorName} <${rec.professorEmail}>`);
    return rec;
  }

  async updateStatus(id: string, status: MastersRecRequest['status']): Promise<MastersRecRequest> {
    const rec = await this.findOne(id);
    await rec.update({ status });
    return rec;
  }

  private async deadlineLine(programId: string | null): Promise<string> {
    if (!programId) return '';
    const p = await this.masters.findOne(programId);
    if (p.closesAt && p.datesVerified) {
      return `\nThe application deadline is ${p.closesAt}, so a letter any time before then would be a great help.\n`;
    }
    return '';
  }

  private salutation(name: string): string {
    const clean = (name || '').trim();
    if (!clean) return 'Professor';
    const last = clean.split(/\s+/).pop();
    return `Prof. ${last}`;
  }
}
