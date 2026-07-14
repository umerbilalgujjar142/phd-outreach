import {
  Column,
  CreatedAt,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';

/**
 * Tracks the last run of each recurring job type (PROJECT.md Section 2/4).
 * One row per jobType. Powers self-healing catch-up: on boot / cron tick we
 * check `lastSuccessAt` and run if overdue, instead of relying on an exact
 * clock time being hit while the machine was up.
 */
@Table({ tableName: 'job_runs', underscored: true })
export class JobRun extends Model<JobRun> {
  @PrimaryKey
  @Column({ type: DataType.STRING, field: 'job_type' })
  jobType: string; // e.g. 'discovery', 'send', 'followup', 'reply-check'

  @Column({ type: DataType.DATE, allowNull: true, field: 'last_run_at' })
  lastRunAt: Date;

  @Column({ type: DataType.DATE, allowNull: true, field: 'last_success_at' })
  lastSuccessAt: Date;

  @Column({ type: DataType.STRING, allowNull: true, field: 'last_status' })
  lastStatus: string; // 'success' | 'error' | 'running'

  @Column({ type: DataType.TEXT, allowNull: true, field: 'last_detail' })
  lastDetail: string; // summary or error message

  @Default(0)
  @Column({ type: DataType.INTEGER, field: 'run_count' })
  runCount: number;

  @CreatedAt
  @Column({ field: 'created_at' })
  createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  updatedAt: Date;
}
