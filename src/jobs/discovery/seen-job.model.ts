import {
  Column,
  CreatedAt,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

/**
 * Every job posting URL we have already evaluated (matched or not), so a source
 * skips re-fetching + re-matching it on later runs. Mirrors SeenOffer on the
 * professor side. Self-cleaning: rows older than ~60 days are pruned (a posting
 * is delisted long before then, so it will never re-appear).
 */
@Table({ tableName: 'seen_jobs', underscored: true })
export class SeenJob extends Model<SeenJob> {
  @PrimaryKey
  @Column({ type: DataType.STRING, allowNull: false })
  url: string;

  @Column({ type: DataType.STRING, allowNull: false })
  source: string;

  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  matched: boolean;

  @CreatedAt
  @Column({ field: 'created_at' })
  createdAt: Date;
}
