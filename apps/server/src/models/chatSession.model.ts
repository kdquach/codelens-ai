// apps/server/src/models/chatSession.model.ts
import mongoose, { Schema, Document } from 'mongoose';
import { CodeCitation } from '@codelens/shared';

export interface IChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: CodeCitation[];
  mermaidCode?: string;
  createdAt: Date;
}

export interface IChatSession extends Document {
  repoId: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId | null;
  title: string;
  messages: IChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const CodeCitationSchema = new Schema<CodeCitation>(
  {
    filePath: { type: String, required: true },
    symbolName: { type: String, required: true },
    startLine: { type: Number, required: true },
    endLine: { type: Number, required: true },
  },
  { _id: false }
);

const ChatMessageSchema = new Schema<IChatMessage>(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    citations: [CodeCitationSchema],
    mermaidCode: { type: String },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const ChatSessionSchema = new Schema<IChatSession>(
  {
    repoId: { type: Schema.Types.ObjectId, ref: 'Repository', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    title: { type: String, default: 'Đoạn hội thoại mới' },
    messages: [ChatMessageSchema],
  },
  { timestamps: true }
);

// Compound index hỗ trợ tìm nhanh session của một user trên một repo
ChatSessionSchema.index({ repoId: 1, userId: 1 });

export const ChatSessionModel = mongoose.model<IChatSession>('ChatSession', ChatSessionSchema);

