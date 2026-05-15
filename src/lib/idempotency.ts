import IORedis from "ioredis";

/**
 * Idempotency check using Redis SET NX (Set if Not eXists).
 *
 * This is used on the webhook endpoint to prevent duplicate processing
 * when Xendit retries a webhook delivery.
 *
 * Flow:
 *   - First call with a given key → SET succeeds → returns true (new request)
 *   - Subsequent calls with same key → SET fails (key exists) → returns false (duplicate)
 *
 * @param redis     - IORedis client instance
 * @param key       - Unique identifier (e.g., Xendit webhook ID)
 * @param ttlSeconds - How long to keep the key (default: 24h = 86400s)
 * @returns true if this is a NEW request, false if it's a DUPLICATE
 */
export async function checkIdempotency(
  redis: IORedis,
  key: string,
  ttlSeconds: number = 86400
): Promise<boolean> {
  // Use the atomic SET key value EX ttl NX command
  // Returns "OK" on success, null if key already exists
  const result = await redis.set(
    `webhook:idempotency:${key}`,
    "1",
    "EX",
    ttlSeconds,
    "NX"
  );

  return result === "OK";
}
