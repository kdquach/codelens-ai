// apps/server/src/queues/prReview.queue.ts
import { Queue } from 'bullmq';
import { createRedisClient } from '../config/redis';
import { PRReviewJobData } from '../services/prReview.service';

export const PR_REVIEW_QUEUE_NAME = 'pr-review-queue';

export const prReviewQueue = new Queue<PRReviewJobData>(PR_REVIEW_QUEUE_NAME, {
  connection: createRedisClient(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: {
      count: 100,
      age: 24 * 3600, // Giữ 1 ngày
    },
    removeOnFail: {
      count: 200,
      age: 7 * 24 * 3600, // Giữ 7 ngày cho debug
    },
  },
});

/**
 * Đẩy job đánh giá PR vào hàng đợi BullMQ
 */
export async function addPRReviewJob(data: PRReviewJobData) {
  const job = await prReviewQueue.add('review-pr', data, {
    jobId: `pr_${data.repoFullName.replace('/', '_')}_${data.prNumber}_${Date.now()}`,
  });
  return job;
}

