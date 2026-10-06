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
import { DOCUMENT_STATUSES, DocumentStatus } from './masters-enums';
import { MastersProgram } from './masters-program.model';

/**
 * One concrete document in a program's package (an instance of a RequiredDoc
 * template entry), tracking Umer's real progress preparing it. Generated
 * artifacts (e.g. the motivation letter draft) record their file path here.
 */
@Table({
  tableName: 'masters_documents',
  underscored: true,
  indexes: [
    {
      name: 'masters_documents_program_key_uq',
      unique: true,
      fields: ['program_id', 'doc_key'],
    },
    { name: 'masters_documents_status_ix', fields: ['status'] },
  ],
})
export class MastersDocument extends Model<MastersDocument> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  id: string;

  @ForeignKey(() => MastersProgram)
  @Column({ type: DataType.UUID, allowNull: false, field: 'program_id' })
  programId: string;

  @BelongsTo(() => MastersProgram)
  program: MastersProgram;

  /** Matches a RequiredDoc.key on the program template. */
  @Column({ type: DataType.STRING, allowNull: false, field: 'doc_key' })
  docKey: string;

  @Column({ type: DataType.STRING, allowNull: false })
  label: string;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  required: boolean;

  @Default('todo')
  @Column({ type: DataType.ENUM(...DOCUMENT_STATUSES), allowNull: false })
  status: DocumentStatus;

  /** Local path to the prepared/generated file, if any. */
  @Column({ type: DataType.STRING, allowNull: true, field: 'file_path' })
  filePath: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  notes: string;

  @CreatedAt
  @Column({ field: 'created_at' })
  createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  updatedAt: Date;
}
