// apps/server/src/workers/ingest.worker.ts
import { Worker, Job } from 'bullmq';
import { IngestProgressEvent } from '@codelens/shared';
import { createRedisClient, redisPublisher } from '../config/redis';
import { INGEST_QUEUE_NAME, IngestJobData } from '../queues/ingest.queue';
import { RepositoryModel } from '../models/repository.model';
import { CodeChunkModel } from '../models/codeChunk.model';
import { GitHubService } from '../services/github.service';
import { AstParserService } from '../services/astParser.service';
import { GeminiService } from '../services/gemini.service';

/**
 * Trả về channel Redis Pub/Sub cho tiến độ của từng Repo
 */
export const getRepoProgressChannel = (repoId: string) => `repo-progress:${repoId}`;

/**
 * Phát sự kiện tiến độ qua Redis Pub/Sub và cập nhật BullMQ Job Progress
 */
export async function emitProgress(job: Job<IngestJobData>, event: IngestProgressEvent) {
  try {
    const payload = JSON.stringify(event);
    await redisPublisher.publish(getRepoProgressChannel(event.repoId), payload);
    await job.updateProgress(event.progress);
    console.log(`📡 [SSE Progress] [${event.repoId}] ${event.progress}% [${event.step}] - ${event.message}`);
  } catch (err: any) {
    console.warn(`⚠️ [emitProgress Error] Không thể gửi tiến độ: ${err.message}`);
  }
}

/**
 * Logic xử lý nạp mã nguồn Repository, phân tích AST và tạo Embeddings
 */
export async function processIngestJob(job: Job<IngestJobData>): Promise<void> {
  const { repoId, repoUrl } = job.data;
  console.log(`\n⚙️ [IngestWorker] Bắt đầu xử lý Job #${job.id} cho Repo ID: ${repoId} (${repoUrl})`);

  try {
    // ── Bước 0: Khởi tạo và cập nhật trạng thái PROCESSING ──
    const repoDoc = await RepositoryModel.findById(repoId);
    if (!repoDoc) {
      throw new Error(`Repository với ID "${repoId}" không tồn tại trong cơ sở dữ liệu.`);
    }

    repoDoc.status = 'PROCESSING';
    await repoDoc.save();

    await emitProgress(job, {
      repoId,
      progress: 5,
      step: 'FETCHING',
      message: 'Khởi động worker và chuẩn bị quét repository...',
    });

    // ── Bước 1: Quét cây thư mục & Tải mã nguồn từ GitHub API (5% -> 40%) ──
    await emitProgress(job, {
      repoId,
      progress: 10,
      step: 'FETCHING',
      message: 'Đang kết nối GitHub API và quét cây thư mục mã nguồn...',
    });

    const files = await GitHubService.fetchRepoSourceFiles(
      repoUrl,
      60,
      async (ghProgress, ghMsg) => {
        // Ánh xạ tiến trình GitHub (0.05 -> 1.0) sang thang đo 10% -> 40%
        const scaledProgress = Math.round(10 + ghProgress * 30);
        await emitProgress(job, {
          repoId,
          progress: scaledProgress,
          step: 'FETCHING',
          message: ghMsg,
        });
      }
    );

    if (!files || files.length === 0) {
      throw new Error('Không tìm thấy file mã nguồn hợp lệ (.ts, .tsx, .js, .jsx) trong repository.');
    }

    // ── Bước 2: Phân tích AST bằng ts-morph trên RAM (40% -> 70%) ──
    await emitProgress(job, {
      repoId,
      progress: 42,
      step: 'PARSING_AST',
      message: `Đã tải ${files.length} files. Khởi tạo ts-morph và phân tích cấu trúc cú pháp AST...`,
    });

    const { graph, chunks } = AstParserService.parseRepository(files);

    await emitProgress(job, {
      repoId,
      progress: 68,
      step: 'PARSING_AST',
      message: `Đồ thị kiến trúc hoàn tất: ${graph.nodes.length} nodes, ${graph.edges.length} liên kết, ${chunks.length} code chunks.`,
    });

    // ── Bước 3: Tạo Vector Embeddings cho Code Chunks (70% -> 90%) ──
    await emitProgress(job, {
      repoId,
      progress: 70,
      step: 'EMBEDDING',
      message: 'Đang chuẩn bị Vector Embeddings (Gemini text-embedding-004)...',
    });

    // Xóa các chunk cũ của repo này nếu có
    await CodeChunkModel.deleteMany({ repoId: repoDoc._id });

    // Giới hạn số chunk xử lý embedding để tối ưu thời gian & hạn mức Gemini API
    const targetChunks = chunks.slice(0, 60);
    const chunksWithVectors: any[] = [];
    const batchSize = 10;

    for (let i = 0; i < targetChunks.length; i += batchSize) {
      const batch = targetChunks.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (chunk) => {
          let embedding: number[] = [];
          if (process.env.GEMINI_API_KEY) {
            try {
              const textToEmbed = `${chunk.filePath} ${chunk.symbolName} (${chunk.symbolType})\n${chunk.content}`;
              embedding = await GeminiService.createEmbedding(textToEmbed);
            } catch (err: any) {
              console.warn(`⚠️ [Gemini Embedding Warning] Chunk "${chunk.symbolName}": ${err.message}`);
            }
          }
          return {
            ...chunk,
            repoId: repoDoc._id,
            embedding,
          };
        })
      );

      chunksWithVectors.push(...batchResults);

      const embedProgress = Math.round(70 + ((i + batch.length) / targetChunks.length) * 18);
      await emitProgress(job, {
        repoId,
        progress: embedProgress,
        step: 'EMBEDDING',
        message: `Đang tạo embeddings: ${chunksWithVectors.length}/${targetChunks.length} chunks...`,
      });
    }

    // Bulk insert các chunks đã có vectors vào MongoDB
    if (chunksWithVectors.length > 0) {
      await CodeChunkModel.insertMany(chunksWithVectors);
    }

    // ── Bước 4: Lưu Đồ thị vào MongoDB & Hoàn tất (90% -> 100%) ──
    await emitProgress(job, {
      repoId,
      progress: 92,
      step: 'COMPLETED',
      message: 'Đang lưu đồ thị kiến trúc và metadata vào cơ sở dữ liệu...',
    });

    repoDoc.architectureGraph = graph;
    repoDoc.status = 'COMPLETED';
    await repoDoc.save();

    await emitProgress(job, {
      repoId,
      progress: 100,
      step: 'COMPLETED',
      message: 'Nạp và phân tích repository hoàn tất thành công!',
    });

    console.log(`✅ [IngestWorker] Đã hoàn thành xử lý Job #${job.id} cho Repo ID: ${repoId}\n`);
  } catch (error: any) {
    console.error(`❌ [IngestWorker] Thất bại tại Job #${job.id}:`, error);

    // Cập nhật trạng thái FAILED vào MongoDB
    try {
      await RepositoryModel.findByIdAndUpdate(repoId, { status: 'FAILED' });
    } catch (dbErr: any) {
      console.error(`⚠️ [IngestWorker] Không thể cập nhật trạng thái FAILED: ${dbErr.message}`);
    }

    // Phát sự kiện FAILED qua SSE
    await emitProgress(job, {
      repoId,
      progress: 0,
      step: 'FAILED',
      message: error.message || 'Lỗi không xác định trong quá trình phân tích repository',
    });

    throw error;
  }
}

/**
 * Khởi tạo BullMQ Ingestion Worker
 */
export function startIngestWorker() {
  const worker = new Worker<IngestJobData>(INGEST_QUEUE_NAME, processIngestJob, {
    connection: createRedisClient(),
    concurrency: 2, // Xử lý song song tối đa 2 repository cùng lúc
  });

  worker.on('ready', () => {
    console.log(`👷 [IngestWorker] Sẵn sàng lắng nghe jobs trên hàng đợi "${INGEST_QUEUE_NAME}"`);
  });

  worker.on('completed', (job) => {
    console.log(`🎉 [IngestWorker] Job #${job.id} hoàn thành thành công.`);
  });

  worker.on('failed', (job, err) => {
    console.error(`💥 [IngestWorker] Job #${job?.id} thất bại: ${err.message}`);
  });

  worker.on('error', (err) => {
    console.warn(`⚠️ [IngestWorker Error] ${err.message}`);
  });

  return worker;
}

// Nếu file được gọi chạy trực tiếp: npx tsx src/workers/ingest.worker.ts
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { connectDB } = require('../config/database');

  connectDB().then(() => {
    console.log('🚀 [IngestWorker Process] Đang chạy độc lập...');
    startIngestWorker();
  });
}

