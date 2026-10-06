import {
  Column,
  CreatedAt,
  DataType,
  Default,
  HasMany,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import { PROGRAM_STATUSES, ProgramStatus } from './masters-enums';
import { MastersDocument } from './masters-document.model';
import { MastersRecRequest } from './masters-rec-request.model';

/** One entry in a program's required-documents checklist template. */
export interface RequiredDoc {
  key: string; // stable id, e.g. 'motivation_letter'
  label: string; // human label, e.g. 'Motivation letter (max 500 words)'
  required: boolean; // false = recommended/optional
}

/**
 * A target Erasmus Mundus Joint Master programme (CYBERSURE, CYBERUS,
 * CyberMACS, ...). Registry row holding verified deadlines, the required-docs
 * template, eligibility notes, and our progress status.
 *
 * Deadlines carry `datesVerified` + `datesSource` because the public
 * aggregator sites contradict each other and the official portals are
 * JS-rendered — an UNVERIFIED date must never be treated as fact. The scheduler
 * will still remind on verified dates and nudge us to verify the rest.
 */
@Table({
  tableName: 'masters_programs',
  underscored: true,
  indexes: [
    { name: 'masters_programs_code_uq', unique: true, fields: ['code'] },
    { name: 'masters_programs_status_ix', fields: ['status'] },
    { name: 'masters_programs_closes_at_ix', fields: ['closes_at'] },
  ],
})
export class MastersProgram extends Model<MastersProgram> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  id: string;

  /** Short stable code, e.g. 'CYBERSURE'. Unique. */
  @Column({ type: DataType.STRING, allowNull: false })
  code: string;

  @Column({ type: DataType.STRING, allowNull: false })
  name: string;

  @Column({ type: DataType.STRING, allowNull: true, field: 'coordinating_university' })
  coordinatingUniversity: string;

  /** Where the application is actually submitted. */
  @Column({ type: DataType.STRING, allowNull: true, field: 'portal_url' })
  portalUrl: string;

  /** EACEA catalogue / official info page (reference only, not for applying). */
  @Column({ type: DataType.STRING, allowNull: true, field: 'info_url' })
  infoUrl: string;

  @Column({
    type: DataType.ARRAY(DataType.STRING),
    allowNull: false,
    defaultValue: [],
    field: 'partner_countries',
  })
  partnerCountries: string[];

  @Column({ type: DataType.DATEONLY, allowNull: true, field: 'opens_at' })
  opensAt: string | null;

  @Column({ type: DataType.DATEONLY, allowNull: true, field: 'closes_at' })
  closesAt: string | null;

  @Column({ type: DataType.DATEONLY, allowNull: true, field: 'results_at' })
  resultsAt: string | null;

  /** TRUE only when the dates were confirmed from the official portal. */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'dates_verified' })
  datesVerified: boolean;

  /** Where the dates came from (URL + date checked), so we can re-verify. */
  @Column({ type: DataType.TEXT, allowNull: true, field: 'dates_source' })
  datesSource: string;

  /** Required-documents template for this program's package. */
  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: [], field: 'required_docs' })
  requiredDocs: RequiredDoc[];

  /** Eligibility notes — esp. the "already hold a master's" rule. */
  @Column({ type: DataType.TEXT, allowNull: true, field: 'eligibility_notes' })
  eligibilityNotes: string;

  /** TRUE once eligibility for Umer's case was confirmed with the consortium. */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'eligibility_verified' })
  eligibilityVerified: boolean;

  @Default('watching')
  @Column({ type: DataType.ENUM(...PROGRAM_STATUSES), allowNull: false })
  status: ProgramStatus;

  @Column({ type: DataType.TEXT, allowNull: true })
  notes: string;

  @HasMany(() => MastersDocument)
  documents: MastersDocument[];

  @HasMany(() => MastersRecRequest)
  recRequests: MastersRecRequest[];

  @CreatedAt
  @Column({ field: 'created_at' })
  createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  updatedAt: Date;
}
