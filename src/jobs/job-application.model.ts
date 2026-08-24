import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  Default,
  ForeignKey,
  Index,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import {
  JOB_APPLICATION_STATUSES,
  JobApplicationStatus,
  ROLE_TYPES,
  RoleType,
} from './job-status.enum';
import { JobListing } from './job-listing.model';

/**
 * One application attempt against a JobListing (the jobs-side counterpart of
 * OutreachEmail). Records which base CV variant was used, the tailored document
 * paths, and how far the assisted-apply flow got.
 */
@Table({
  tableName: 'job_applications',
  underscored: true,
  indexes: [
    { name: 'job_applications_listing_ix', fields: ['job_listing_id'] },
    { name: 'job_applications_status_ix', fields: ['status'] },
  ],
})
export class JobApplication extends Model<JobApplication> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  id: string;

  @ForeignKey(() => JobListing)
  @Column({ type: DataType.UUID, allowNull: false, field: 'job_listing_id' })
  jobListingId: string;

  @BelongsTo(() => JobListing)
  listing: JobListing;

  /** Role family this application presented as (which CV was tailored). */
  @Default(RoleType.OTHER)
  @Column({ type: DataType.ENUM(...ROLE_TYPES), allowNull: false, field: 'role_type' })
  roleType: RoleType;

  /** Base CV variant tailored, e.g. "backend" | "fullstack" | "mobile". */
  @Column({ type: DataType.STRING, allowNull: true, field: 'cv_variant' })
  cvVariant: string;

  /** Path to the tailored CV PDF that was generated for this application. */
  @Column({ type: DataType.STRING, allowNull: true, field: 'cv_path' })
  cvPath: string;

  /** Path to the tailored cover-letter PDF, when the job required one. */
  @Column({ type: DataType.STRING, allowNull: true, field: 'cover_letter_path' })
  coverLetterPath: string;

  @Index('job_applications_status_ix')
  @Default(JobApplicationStatus.PREPARED)
  @Column({ type: DataType.ENUM(...JOB_APPLICATION_STATUSES), allowNull: false })
  status: JobApplicationStatus;

  /** Screenshot of the filled form / confirmation page (assisted apply). */
  @Column({ type: DataType.STRING, allowNull: true, field: 'screenshot_path' })
  screenshotPath: string;

  @Column({ type: DataType.DATE, allowNull: true, field: 'submitted_at' })
  submittedAt: Date;

  @Column({ type: DataType.TEXT, allowNull: true })
  notes: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  error: string;

  @CreatedAt
  @Column({ field: 'created_at' })
  createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  updatedAt: Date;
}
