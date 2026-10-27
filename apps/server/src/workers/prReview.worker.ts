// apps/server/src/workers/prReview.worker.ts
import { Worker, Job } from 'bullmq';
import { createRedisClient } from '../config/redis';
import { PR_REVIEW_QUEUE_NAME } from '../queues/prReview.queue';
import { PRReviewService, PRReviewJobData } from '../services/prReview.service';

let prWorker: Worker<PRReviewJobData> | null = null;

export function startPRReviewWorker(): Worker<PRReviewJobData> {
  if (prWorker) {
    return prWorker;
  }

  console.log(`👷 [PRReviewWorker] Khởi động BullMQ Worker lắng nghe queue "${PR_REVIEW_QUEUE_NAME}"...`);

  prWorker = new Worker<PRReviewJobData>(
    PR_REVIEW_QUEUE_NAME,
    async (job: Job<PRReviewJobData>) => {
      console.log(`📥 [PRReviewWorker] Nhận Job review PR #${job.data.prNumber} (${job.data.repoFullName})`);
      await PRReviewService.processPRReview(job.data);
    },
    {
      connection: createRedisClient(),
      concurrency: 3, // Xử lý đồng thời tối đa 3 Pull Requests
    }
  );

  prWorker.on('completed', (job) => {
    console.log(`✅ [PRReviewWorker] Job hoàn thành thành công: PR #${job.data.prNumber} (${job.data.repoFullName})`);
  });

  prWorker.on('failed', (job, err) => {
    console.error(
      `❌ [PRReviewWorker] Job thất bại: PR #${job?.data.prNumber} (${job?.data.repoFullName}) - Lỗi: ${err.message}`
    );
  });

  prWorker.on('error', (err) => {
    console.error(`💥 [PRReviewWorker] Lỗi kết nối Redis Worker: ${err.message}`);
  });

  return prWorker;
}

// Cho phép chạy độc lập qua: npm run pr-worker
if (require.main === module) {
  require('dotenv').config();
  const { connectDB } = require('../config/database');

  connectDB().then(() => {
    startPRReviewWorker();
    console.log('👷 [PRReviewWorker] Đang chạy dưới tiến trình độc lập...');
  });
}

