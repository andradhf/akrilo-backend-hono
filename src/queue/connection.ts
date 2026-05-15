import IORedis from "ioredis";
import { env } from "../lib/env";

/**
 * Creates a shared IORedis connection instance.
 *
 * CRITICAL: `maxRetriesPerRequest: null` is REQUIRED by BullMQ.
 * Without this, BullMQ's blocking Redis commands will throw errors.
 *
 * @param lazyConnect - If true, does not connect until the first command.
 *                      Set to false for BullMQ connections (it manages its own lifecycle).
 */
export function createRedisConnection(lazyConnect = false): IORedis {
  return new IORedis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null, // Required by BullMQ
    lazyConnect,
    retryStrategy(times) {
      // Exponential backoff capped at 30 seconds
      const delay = Math.min(times * 500, 30000);
      console.warn(`[Redis] Reconnecting in ${delay}ms (attempt #${times})`);
      return delay;
    },
  });
}

/**
 * Dedicated Redis connection for idempotency checks (non-BullMQ).
 * This instance uses lazyConnect so it's only opened when first used.
 */
export const redisClient = createRedisConnection(true);
