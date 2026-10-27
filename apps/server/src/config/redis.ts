// apps/server/src/config/redis.ts
import Redis, { RedisOptions } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

/**
 * Cấu hình chung cho ioredis & BullMQ
 * BullMQ bắt buộc maxRetriesPerRequest: null
 */
export const defaultRedisOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times) {
    // Thử lại với khoảng thời gian tăng dần, tối đa 3 giây
    return Math.min(times * 250, 3000);
  },
};

/**
 * Factory tạo Redis Client mới (dùng cho BullMQ Queue, Worker & Redis Pub/Sub)
 */
export function createRedisClient(customOptions: Partial<RedisOptions> = {}): Redis {
  const client = new Redis(REDIS_URL, {
    ...defaultRedisOptions,
    ...customOptions,
  });

  client.on('error', (err) => {
    // Ghi log cảnh báo để tránh unhandled error crash app khi Redis chưa bật
    console.warn(`⚠️ [Redis Error] ${err.message}`);
  });

  return client;
}

/**
 * Shared Redis Client dùng chung cho các tác vụ cache / lệnh thông thường
 */
export const redisConnection = createRedisClient();

/**
 * Redis Client chuyên dụng cho Publisher (Pub/Sub sự kiện tiến độ)
 */
export const redisPublisher = createRedisClient();

