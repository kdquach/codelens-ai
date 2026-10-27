// apps/server/src/queues/ingest.queue.ts
import { Queue } from 'bullmq';
import { createRedisClient } from '../config/redis';

export const INGEST_QUEUE_NAME = 'ingest-queue';

export interface IngestJobData {
  repoId: string;
  repoUrl: string;
}

export const ingestQueue = new Queue<IngestJobData>(INGEST_QUEUE_NAME, {
  connection: createRedisClient(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: {
      count: 100,
      age: 24 * 3600, // Giữ tối đa 1 ngày
    },
    removeOnFail: {
      count: 200,
      age: 7 * 24 * 3600, // Giữ 7 ngày cho debug
    },
  },
});

/**
 * Đẩy job nạp repo vào hàng đợi BullMQ
 */
export async function addIngestJob(data: IngestJobData) {
  const job = await ingestQueue.add('ingest-repo', data, {
    jobId: `ingest_${data.repoId}_${Date.now()}`,
  });
  return job;
}

