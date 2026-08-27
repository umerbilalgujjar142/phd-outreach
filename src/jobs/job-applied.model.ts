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
import { ROLE_TYPES, RoleType } from './job-status.enum';

/**
 * Clean, append-only log of jobs you ACTUALLY applied to.
 *
 * Unlike `job_applications` (which holds every attempt in every state —
 * prepared / pending_review / failed / cancelled / submitted), this table gets
 * exactly ONE row the moment a submit is confirmed (JobApplyService.submit).
 * So it answers, at a glance and with no filtering: "which jobs did I apply to,
 * in which country, which position, and how many today?".
 *
 * One row per listing (job_listing_id is unique) so a re-submit updates rather
 * than duplicating — keeping the daily/country counts honest.
 */
@Table({
  tableName: 'job_applied',
  underscored: true,
  indexes: [
    { name: 'job_applied_listing_uq', unique: true, fields: ['job_listing_id'] },
    { name: 'job_applied_country_ix', fields: ['country'] },
    { name: 'job_applied_portal_ix', fields: ['portal'] },
    { name: 'job_applied_applied_at_ix', fields: ['applied_at'] },
  ],
})
export class JobApplied extends Model<JobApplied> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  id: string;

  /** The listing this application was sent for (traceability + dedup identity). */
  @Column({ type: DataType.UUID, allowNull: false, field: 'job_listing_id' })
  jobListingId: string;

  /** The job_applications row that produced this (for the full attempt trail). */
  @Column({ type: DataType.UUID, allowNull: true, field: 'application_id' })
  applicationId: string;

  /** Job title / position applied to. */
  @Column({ type: DataType.STRING, allowNull: false })
  position: string;

  /** Employer / company name. */
  @Column({ type: DataType.STRING, allowNull: true })
  company: string;

  /** Country of the role — the "how many per country" axis. */
  @Index('job_applied_country_ix')
  @Column({ type: DataType.STRING, allowNull: true })
  country: string;

  /** City / free-text location, when known. */
  @Column({ type: DataType.STRING, allowNull: true })
  location: string;

  /** Whether the role is remote. */
  @Column({ type: DataType.BOOLEAN, allowNull: true })
  remote: boolean;

  /** Which board/portal the job came from (e.g. irishjobs, arbeitnow, bayt). */
  @Index('job_applied_portal_ix')
  @Column({ type: DataType.STRING, allowNull: true })
  portal: string;

  /** Canonical posting / apply URL. */
  @Column({ type: DataType.TEXT, allowNull: true, field: 'job_url' })
  jobUrl: string;

  /** Role family this application presented as (which CV was tailored). */
  @Default(RoleType.OTHER)
  @Column({ type: DataType.ENUM(...ROLE_TYPES), allowNull: false, field: 'role_type' })
  roleType: RoleType;

  /** Base CV variant tailored, e.g. "backend" | "fullstack" | "mobile". */
  @Column({ type: DataType.STRING, allowNull: true, field: 'cv_variant' })
  cvVariant: string;

  /** Path to the tailored CV PDF that was actually submitted. */
  @Column({ type: DataType.STRING, allowNull: true, field: 'cv_path' })
  cvPath: string;

  /** Screenshot of the confirmation / result page. */
  @Column({ type: DataType.STRING, allowNull: true, field: 'screenshot_path' })
  screenshotPath: string;

  /** When the application was submitted — the axis for "how many today". */
  @Index('job_applied_applied_at_ix')
  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'applied_at' })
  appliedAt: Date;

  @CreatedAt
  @Column({ field: 'created_at' })
  createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  updatedAt: Date;
}
