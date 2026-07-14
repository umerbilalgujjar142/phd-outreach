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
 * Every job-offer URL we have already fetched + evaluated, whether or not it
 * matched. Lets the daily sweep SKIP re-fetching offers seen on previous runs
 * so we only pull the handful that are genuinely new — which keeps us well
 * under EURAXESS's aggressive rate limit (otherwise re-fetching ~200 known
 * offers each day triggers a 429 storm and drops real matches).
 */
@Table({ tableName: 'seen_offers', underscored: true })
export class SeenOffer extends Model<SeenOffer> {
  @PrimaryKey
  @Column({ type: DataType.STRING(512), field: 'url' })
  url: string;

  @Column({ type: DataType.STRING, field: 'source' })
  source: string; // 'euraxess' | 'jobsac' | 'academictransfer'

  @Default(false)
  @Column({ type: DataType.BOOLEAN, field: 'matched' })
  matched: boolean; // did it qualify (become a professor row)?

  @CreatedAt
  @Column({ field: 'created_at' })
  createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  updatedAt: Date;
}
