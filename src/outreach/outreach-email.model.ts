import {
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
import { Professor } from '../professors/professor.model';
import {
  OUTREACH_STATUSES,
  OUTREACH_TYPES,
  OutreachStatus,
  OutreachType,
} from './outreach-enums';

/**
 * One row per outreach email (PROJECT.md Section 8, Steps 5-9). Lets us:
 *  - count today's sends for the daily quota,
 *  - avoid double-emailing the same professor,
 *  - thread follow-ups (gmail_thread_id), and
 *  - detect replies later (Step 8).
 */
@Table({
  tableName: 'outreach_emails',
  underscored: true,
  indexes: [
    { name: 'outreach_emails_professor_ix', fields: ['professor_id'] },
    { name: 'outreach_emails_status_ix', fields: ['status'] },
    { name: 'outreach_emails_sent_at_ix', fields: ['sent_at'] },
  ],
})
export class OutreachEmail extends Model<OutreachEmail> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  id: string;

  @ForeignKey(() => Professor)
  @Column({ type: DataType.UUID, allowNull: false, field: 'professor_id' })
  professorId: string;

  @Default(OutreachType.INITIAL)
  @Column({ type: DataType.ENUM(...OUTREACH_TYPES), allowNull: false })
  type: OutreachType;

  @Column({ type: DataType.STRING, allowNull: false })
  recipient: string;

  @Column({ type: DataType.STRING, allowNull: false })
  subject: string;

  /** Exact body text we sent, kept for the audit trail / follow-up context. */
  @Column({ type: DataType.TEXT, allowNull: false })
  body: string;

  @Column({ type: DataType.STRING, allowNull: true, field: 'gmail_message_id' })
  gmailMessageId: string;

  @Column({ type: DataType.STRING, allowNull: true, field: 'gmail_thread_id' })
  gmailThreadId: string;

  @Index('outreach_emails_status_ix')
  @Default(OutreachStatus.QUEUED)
  @Column({ type: DataType.ENUM(...OUTREACH_STATUSES), allowNull: false })
  status: OutreachStatus;

  @Column({ type: DataType.DATE, allowNull: true, field: 'sent_at' })
  sentAt: Date;

  @Column({ type: DataType.DATE, allowNull: true, field: 'replied_at' })
  repliedAt: Date;

  @Column({ type: DataType.TEXT, allowNull: true })
  error: string;

  @CreatedAt
  @Column({ field: 'created_at' })
  createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  updatedAt: Date;
}
