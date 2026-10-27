// apps/server/src/models/repository.model.ts
import mongoose, { Schema, Document } from 'mongoose';
import { ArchitectureGraph } from '@codelens/shared';

export interface IRepository extends Document {
  userId?: mongoose.Types.ObjectId | null;
  owner: string;
  name: string;
  repoUrl: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  summary?: string;
  description?: string;
  isSample?: boolean;
  webhookId?: string | null;
  webhookActive?: boolean;
  architectureGraph: ArchitectureGraph;
  createdAt: Date;
  updatedAt: Date;
}

const RepositorySchema = new Schema<IRepository>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    owner: { type: String, required: true },
    name: { type: String, required: true },
    repoUrl: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
      default: 'PENDING',
    },
    summary: { type: String },
    description: { type: String },
    isSample: { type: Boolean, default: false, index: true },
    webhookId: { type: String, default: null },
    webhookActive: { type: Boolean, default: false },
    architectureGraph: {
      nodes: { type: Array, default: [] },
      edges: { type: Array, default: [] },
    },
  },
  { timestamps: true }
);

export const RepositoryModel = mongoose.model<IRepository>('Repository', RepositorySchema);
