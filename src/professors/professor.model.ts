import {
  Column,
  CreatedAt,
  DataType,
  Default,
  Index,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import { PROFESSOR_STATUSES, ProfessorStatus } from './professor-status.enum';

/**
 * Core Professor Tracker table (PROJECT.md Section 9).
 *
 * Dedup strategy (Section 8, Step 3): identity = sourceUrl, then email, then
 * name+university (see ProfessorsService.upsert).
 *   - `email` has a unique index (nullable — Postgres treats NULLs as distinct,
 *     so professors discovered without an email don't collide).
 *   - (`professorName`, `university`) is a NON-unique lookup index only. It must
 *     NOT be unique: position-centric sources yield several no-email offers from
 *     the same org that all share the "Contact — <Org>" placeholder name, and a
 *     unique index would reject the 2nd+ (they're distinct positions, deduped by
 *     sourceUrl instead).
 */
@Table({
  tableName: 'professors',
  underscored: true, // camelCase attrs → snake_case columns (Section 9 field names)
  indexes: [
    { name: 'professors_email_uq', unique: true, fields: ['email'] },
    {
      name: 'professors_name_university_ix',
      fields: ['professor_name', 'university'],
    },
    { name: 'professors_status_ix', fields: ['status'] },
    { name: 'professors_country_ix', fields: ['country'] },
  ],
})
export class Professor extends Model<Professor> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  id: string;

  @Column({ type: DataType.STRING, allowNull: false, field: 'professor_name' })
  professorName: string;

  @Column({ type: DataType.STRING, allowNull: false })
  university: string;

  @Column({ type: DataType.STRING, allowNull: true })
  country: string;

  @Column({ type: DataType.STRING, allowNull: true, field: 'department_lab' })
  departmentLab: string;

  @Column({ type: DataType.STRING, allowNull: true })
  email: string;

  /** LinkedIn profile URL (populated later via enrichment). */
  @Column({ type: DataType.STRING, allowNull: true, field: 'linkedin_url' })
  linkedinUrl: string;

  /** Personal / academic homepage. */
  @Column({ type: DataType.STRING, allowNull: true, field: 'personal_website' })
  personalWebsite: string;

  /** Any other social/professional links, e.g. { scholar, twitter, github }. */
  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {}, field: 'social_links' })
  socialLinks: Record<string, string>;

  /** Matched research tags (Section 7). Sorted/filterable by match strength. */
  @Column({
    type: DataType.ARRAY(DataType.STRING),
    allowNull: false,
    defaultValue: [],
    field: 'matched_tags',
  })
  matchedTags: string[];

  /** Discovery source, e.g. "euraxess", "academictransfer", "findaphd". */
  @Column({ type: DataType.STRING, allowNull: true })
  source: string;

  /** Link back to the original posting/offer (extension beyond Section 9). */
  @Column({ type: DataType.STRING, allowNull: true, field: 'source_url' })
  sourceUrl: string;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'match_reason' })
  matchReason: string;

  @Column({ type: DataType.STRING, allowNull: true, field: 'funding_type' })
  fundingType: string;

  @Column({ type: DataType.DATEONLY, allowNull: true, field: 'application_deadline' })
  applicationDeadline: string;

  @Index('professors_status_ix')
  @Default(ProfessorStatus.NOT_CONTACTED)
  @Column({
    type: DataType.ENUM(...PROFESSOR_STATUSES),
    allowNull: false,
  })
  status: ProfessorStatus;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'date_discovered' })
  dateDiscovered: Date;

  @Column({ type: DataType.DATE, allowNull: true, field: 'date_emailed' })
  dateEmailed: Date;

  @Column({ type: DataType.DATEONLY, allowNull: true, field: 'followup_date' })
  followupDate: string;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'reply_notes' })
  replyNotes: string;

  /**
   * 2–3 tailored opening sentences written by `claude -p` (Section 8, Step 4).
   * Stored for human review before it is folded into an outgoing email.
   */
  @Column({ type: DataType.TEXT, allowNull: true, field: 'personalized_snippet' })
  personalizedSnippet: string;

  @Column({ type: DataType.DATE, allowNull: true, field: 'personalized_at' })
  personalizedAt: Date;

  @CreatedAt
  @Column({ field: 'created_at' })
  createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  updatedAt: Date;
}
