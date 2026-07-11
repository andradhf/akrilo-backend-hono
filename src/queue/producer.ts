import { Queue } from "bullmq";
import { createRedisConnection } from "./connection";
import type { ErpJobData, WaJobData } from "../types/index";

/**
 * BullMQ Queue instance for ERP Sales Order creation jobs.
 *
 * This producer is used in the HTTP server (webhook handler) to enqueue jobs.
 * The queue is consumed by the separate worker process (src/queue/worker.ts).
 */
export const erpQueue = new Queue<ErpJobData>("erpQueue", {
  connection: createRedisConnection(),
  defaultJobOptions: {
    // Retry up to 3 times with exponential backoff
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000, // 5s → 10s → 20s
    },
    // Keep completed jobs for monitoring (last 1000)
    removeOnComplete: { count: 1000 },
    // Keep failed jobs for debugging (last 5000)
    removeOnFail: { count: 5000 },
  },
});

/**
 * Adds an ERP Sales Order creation job to the queue.
 *
 * @param transactionId - The internal transaction UUID
 * @param userId        - The user ID from user_detail table
 */
export async function addErpJob(
  transactionId: string,
  userId: number
): Promise<void> {
  const jobData: ErpJobData = { transactionId, userId };

  await erpQueue.add("create-sales-order", jobData, {
    // Use transactionId as the job ID for deduplication within BullMQ
    jobId: `erp-${transactionId}`,
  });

  console.log(`[Queue] Enqueued ERP job for transaction: ${transactionId}`);
}

/**
 * BullMQ Queue instance for WhatsApp notification jobs.
 *
 * Kept separate from erpQueue so a WhatsApp send failure only retries the
 * message — it never re-triggers Sales Order creation in ERP.
 */
export const waQueue = new Queue<WaJobData>("waQueue", {
  connection: createRedisConnection(),
  defaultJobOptions: {
    // Retry up to 3 times with exponential backoff
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000, // 5s → 10s → 20s
    },
    // Keep completed jobs for monitoring (last 1000)
    removeOnComplete: { count: 1000 },
    // Keep failed jobs for debugging (last 5000)
    removeOnFail: { count: 5000 },
  },
});

/**
 * Adds a WhatsApp order-confirmation job to the queue.
 * Only call this after the Sales Order has been created successfully.
 *
 * @param phone - The user's phone number
 * @param poNo  - The PO number generated for the Sales Order
 */
export async function addWaJob(phone: string, poNo: string): Promise<void> {
  const jobData: WaJobData = { phone, poNo };

  await waQueue.add("send-order-confirmation", jobData, {
    // Use poNo as the job ID for deduplication within BullMQ
    jobId: `wa-${poNo}`,
  });

  console.log(`[Queue] Enqueued WhatsApp job for PO: ${poNo}`);
}
