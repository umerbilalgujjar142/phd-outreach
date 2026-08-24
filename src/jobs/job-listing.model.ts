import {
  Column,
  CreatedAt,
  DataType,
  Default,
  HasMany,
  Index,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import { JOB_LISTING_STATUSES, JobListingStatus, ROLE_TYPES, RoleType } from './job-status.enum';
import { JobApplication } from './job-application.model';

/**
 * A software-engineering job posting scraped from a job board (RemoteOK,
 * Arbeitnow, Indeed, …). The jobs-side counterpart of the Professor table.
 *
 * Dedup identity = `url` (unique). The same posting re-scraped on another day
 * updates the existing row rather than creating a duplicate (see
 * JobsService.upsertListing). `(source, source_id)` is a non-unique lookup index.
 */
@Table({
  tableName: 'job_listings',
  underscored: true,
  indexes: [
    { name: 'job_listings_url_uq', unique: true, fields: ['url'] },
    { name: 'job_listings_source_ix', fields: ['source', 'source_id'] },
    { name: 'job_listings_status_ix', fields: ['status'] },
    { name: 'job_listings_country_ix', fields: ['country'] },
  ],
})
export class JobListing extends Model<JobListing> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  id: string;

  /** Discovery source, e.g. "remoteok", "arbeitnow", "indeed". */
  @Column({ type: DataType.STRING, allowNull: false })
  source: string;

  /** The board's own id for the posting (for dedup + traceability). */
  @Column({ type: DataType.STRING, allowNull: true, field: 'source_id' })
  sourceId: string;

  /** Canonical posting URL — the dedup identity. */
  @Column({ type: DataType.STRING, allowNull: false })
  url: string;

  @Column({ type: DataType.STRING, allowNull: false })
  title: string;

  @Column({ type: DataType.STRING, allowNull: true })
  company: string;

  /** Free-text location as posted (e.g. "Dublin (Hybrid)", "Remote"). */
  @Column({ type: DataType.STRING, allowNull: true })
  location: string;

  /** Best-effort country, for the sponsorship + working-hours logic. */
  @Column({ type: DataType.STRING, allowNull: true })
  country: string;

  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  remote: boolean;

  @Column({ type: DataType.TEXT, allowNull: true })
  description: string;

  @Column({ type: DataType.STRING, allowNull: true })
  salary: string;

  /** External "apply" URL if the posting redirects off-board (ATS etc.). */
  @Column({ type: DataType.STRING, allowNull: true, field: 'apply_url' })
  applyUrl: string;

  /** Raw tags/keywords supplied by the source. */
  @Column({
    type: DataType.ARRAY(DataType.STRING),
    allowNull: false,
    defaultValue: [],
  })
  tags: string[];

  /** Role family the matcher assigned → picks the base CV. */
  @Default(RoleType.OTHER)
  @Column({ type: DataType.ENUM(...ROLE_TYPES), allowNull: false, field: 'role_type' })
  roleType: RoleType;

  /** Which of Umer's real skills the JD asks for (drives CV skill emphasis). */
  @Column({
    type: DataType.ARRAY(DataType.STRING),
    allowNull: false,
    defaultValue: [],
    field: 'matched_skills',
  })
  matchedSkills: string[];

  /** 0–100 heuristic fit (set by the matcher; may be refined by Claude). */
  @Column({ type: DataType.INTEGER, allowNull: true, field: 'fit_score' })
  fitScore: number;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'fit_reason' })
  fitReason: string;

  /**
   * Whether Umer would need visa sponsorship for THIS job.
   * false = no sponsorship needed (UAE/GCC or remote); true = needs sponsorship;
   * null = unknown.
   */
  @Column({ type: DataType.BOOLEAN, allowNull: true, field: 'needs_sponsorship' })
  needsSponsorship: boolean;

  /** Whether the posting explicitly says it offers visa sponsorship. */
  @Column({ type: DataType.BOOLEAN, allowNull: true, field: 'sponsorship_offered' })
  sponsorshipOffered: boolean;

  @Index('job_listings_status_ix')
  @Default(JobListingStatus.NEW)
  @Column({ type: DataType.ENUM(...JOB_LISTING_STATUSES), allowNull: false })
  status: JobListingStatus;

  @Column({ type: DataType.TEXT, allowNull: true })
  reason: string;

  /** When the posting was published (from the source), for the freshness filter. */
  @Column({ type: DataType.DATE, allowNull: true, field: 'posted_at' })
  postedAt: Date;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'date_discovered' })
  dateDiscovered: Date;

  @HasMany(() => JobApplication)
  applications: JobApplication[];

  @CreatedAt
  @Column({ field: 'created_at' })
  createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  updatedAt: Date;
}
