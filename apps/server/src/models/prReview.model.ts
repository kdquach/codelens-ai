// apps/server/src/models/prReview.model.ts
import mongoose, { Schema, Document } from 'mongoose';
import { PRIssue } from '@codelens/shared';

export interface IPRReview extends Document {
  repoId: mongoose.Types.ObjectId;
  prNumber: number;
  title: string;
  author: string;
  riskScore: number;
  status: 'REVIEWING' | 'COMMENTED' | 'FAILED';
  summary?: string;
  mermaidSummary?: string;
  issues: PRIssue[];
  impactedFiles: string[];
  githubCommentUrl?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PRIssueSchema = new Schema<PRIssue>(
  {
    filePath: { type: String, required: true },
    lineNumber: { type: Number, required: true },
    severity: {
      type: String,
      enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
      required: true,
    },
    message: { type: String, required: true },
    suggestedFix: { type: String },
  },
  { _id: false }
);

const PRReviewSchema = new Schema<IPRReview>(
  {
    repoId: { type: Schema.Types.ObjectId, ref: 'Repository', required: true, index: true },
    prNumber: { type: Number, required: true, index: true },
    title: { type: String, required: true },
    author: { type: String, required: true },
    riskScore: { type: Number, default: 0, min: 0, max: 100 },
    status: {
      type: String,
      enum: ['REVIEWING', 'COMMENTED', 'FAILED'],
      default: 'REVIEWING',
      index: true,
    },
    summary: { type: String },
    mermaidSummary: { type: String },
    issues: [PRIssueSchema],
    impactedFiles: [{ type: String }],
    githubCommentUrl: { type: String },
    errorMessage: { type: String },
  },
  { timestamps: true }
);

// Compound index tìm nhanh PR theo repoId và prNumber
PRReviewSchema.index({ repoId: 1, prNumber: 1 });

export const PRReviewModel = mongoose.model<IPRReview>('PRReview', PRReviewSchema);

