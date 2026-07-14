import {
  AutoIncrement,
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
 * Target-country reference list (PROJECT.md Section 6). Kept in the DB — NOT
 * hardcoded — so the search scope can be widened over time by adding rows.
 * `tier` and `weight` drive the send-quota weighting; `active=false` excludes
 * a country without deleting it (e.g. Ukraine, revisit later).
 */
@Table({ tableName: 'countries', underscored: true })
export class Country extends Model<Country> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  name: string;

  @Column({ type: DataType.STRING(2), allowNull: true, field: 'iso2' })
  iso2: string;

  /** e.g. "Nordics", "CET/CEST Europe", "North America". */
  @Column({ type: DataType.STRING, allowNull: true })
  region: string;

  /** Priority tier 1 (highest) … 4 (lowest); null = untiered/other. */
  @Column({ type: DataType.INTEGER, allowNull: true })
  tier: number;

  /** Relative send-quota weight (tunable; Section 6 default ~50/15/25/10). */
  @Column({ type: DataType.INTEGER, allowNull: true })
  weight: number;

  @Default(true)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  active: boolean;

  @Column({ type: DataType.TEXT, allowNull: true })
  notes: string;

  @CreatedAt
  @Column({ field: 'created_at' })
  createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  updatedAt: Date;
}
