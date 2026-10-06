import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import { REC_REQUEST_STATUSES, RecRequestStatus } from './masters-enums';
import { MastersProgram } from './masters-program.model';

/**
 * A recommendation-letter request to a professor for a specific program.
 * The request EMAIL is only ever sent after Umer explicitly confirms in chat —
 * the service exposes a draft/preview step and a separate send step, and never
 * sends autonomously.
 */
@Table({
  tableName: 'masters_rec_requests',
  underscored: true,
  indexes: [
    { name: 'masters_rec_requests_program_ix', fields: ['program_id'] },
    { name: 'masters_rec_requests_status_ix', fields: ['status'] },
  ],
})
export class MastersRecRequest extends Model<MastersRecRequest> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  id: string;

  /** Nullable: a recommender may be tracked before being tied to a program. */
  @ForeignKey(() => MastersProgram)
  @Column({ type: DataType.UUID, allowNull: true, field: 'program_id' })
  programId: string | null;

  @BelongsTo(() => MastersProgram)
  program: MastersProgram;

  @Column({ type: DataType.STRING, allowNull: false, field: 'professor_name' })
  professorName: string;

  @Column({ type: DataType.STRING, allowNull: true, field: 'professor_email' })
  professorEmail: string;

  @Column({ type: DataType.STRING, allowNull: true })
  university: string;

  @Default('not_requested')
  @Column({ type: DataType.ENUM(...REC_REQUEST_STATUSES), allowNull: false })
  status: RecRequestStatus;

  /** Gmail thread id once a request email is sent (for reply tracking later). */
  @Column({ type: DataType.STRING, allowNull: true, field: 'thread_id' })
  threadId: string;

  @Column({ type: DataType.DATE, allowNull: true, field: 'requested_at' })
  requestedAt: Date | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  notes: string;

  @CreatedAt
  @Column({ field: 'created_at' })
  createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  updatedAt: Date;
}
