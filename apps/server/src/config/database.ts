// apps/server/src/config/database.ts
import mongoose from 'mongoose';

/**
 * Đảm bảo MongoDB Atlas Search Index cho Vector Search (vector_code_index) tồn tại
 */
export async function ensureVectorIndex(): Promise<void> {
  try {
    const db = mongoose.connection.db;
    if (!db) return;

    const collection = db.collection('codechunks');
    const existingIndexes = await collection.listSearchIndexes().toArray().catch(() => []);
    const hasVectorIndex = existingIndexes.some((idx: any) => idx.name === 'vector_code_index');

    if (!hasVectorIndex) {
      console.log('🔍 [MongoDB Atlas] Đang tạo Search Index "vector_code_index" cho code_chunks...');
      await collection.createSearchIndex({
        name: 'vector_code_index',
        type: 'vectorSearch',
        definition: {
          fields: [
            {
              type: 'vector',
              path: 'embedding',
              numDimensions: 768,
              similarity: 'cosine',
            },
            {
              type: 'filter',
              path: 'repoId',
            },
            {
              type: 'filter',
              path: 'filePath',
            },
            {
              type: 'filter',
              path: 'symbolType',
            },
          ],
        },
      });
      console.log('✅ [MongoDB Atlas] Đã tạo thành công Search Index "vector_code_index".');
    } else {
      console.log('✅ [MongoDB Atlas] Search Index "vector_code_index" đã sẵn sàng.');
    }
  } catch (error: any) {
    // Không crash server nếu đang chạy MongoDB local không có tính năng Search Index
    console.warn(`⚠️ [MongoDB Atlas Index] Không thể kiểm tra/tạo Search Index: ${error.message}`);
  }
}

export const connectDB = async () => {
  try {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/codelens_db';
    await mongoose.connect(uri);
    console.log('✅ [MongoDB] Connected successfully');
    await ensureVectorIndex();
  } catch (error) {
    console.error('❌ [MongoDB] Connection error:', error);
    process.exit(1);
  }
};
