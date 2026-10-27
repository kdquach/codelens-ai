import mongoose, { Schema, Document } from 'mongoose';

export interface ICodeChunk extends Document {
  repoId: mongoose.Types.ObjectId;
  filePath: string;
  symbolName: string;
  symbolType: 'FUNCTION' | 'CLASS' | 'COMPONENT' | 'FILE';
  startLine: number;
  endLine: number;
  content: string;
  dependencies: string[];
  embedding: number[];
}

const CodeChunkSchema = new Schema<ICodeChunk>({
  repoId: { type: Schema.Types.ObjectId, ref: 'Repository', required: true, index: true },
  filePath: { type: String, required: true, index: true },
  symbolName: { type: String, required: true },
  symbolType: { type: String, enum: ['FUNCTION', 'CLASS', 'COMPONENT', 'FILE'], default: 'FUNCTION' },
  startLine: { type: Number, required: true },
  endLine: { type: Number, required: true },
  content: { type: String, required: true },
  dependencies: [{ type: String }],
  embedding: [{ type: Number }], // Mảng 768 chiều cho Atlas Vector Search
});

export const CodeChunkModel = mongoose.model<ICodeChunk>('CodeChunk', CodeChunkSchema);