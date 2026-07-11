import { Worker, type Job } from "bullmq";
import { ulid } from "ulid";
import { createRedisConnection } from "./connection";
import { addWaJob } from "./producer";
import { db } from "../db/index";
import { transactions, userDetail, userItems } from "../db/schema";
import { eq } from "drizzle-orm";
import { createErpSalesOrder, registerOrGetCustomer } from "../services/erp.service";
import { sendWhatsappMessage, buildOrderConfirmationMessage } from "../services/whatsapp.service";
import type { ErpJobData, ErpItem, ItemContent, WaJobData } from "../types/index";

/**
 * BullMQ Worker — ERP Sales Order Processor
 *
 * This is a STANDALONE process. Start it separately with:
 *   bun run src/queue/worker.ts
 *
 * It listens to the "erpQueue" and creates Sales Orders in ERPNext
 * after a payment has been successfully confirmed by Xendit.
 *
 * Retry behavior is configured on the Queue producer side (3 attempts,
 * exponential backoff: 5s → 10s → 20s).
 */

async function processErpJob(job: Job<ErpJobData>): Promise<void> {
  const { transactionId, userId } = job.data;

  console.log(`[Worker] Processing job ${job.id} — transaction: ${transactionId}`);

  // ─── Step 1: Fetch the transaction and its items from DB ─────────────────
  const transaction = await db.query.transactions.findFirst({
    where: eq(transactions.id, transactionId),
    with: { items: true },
  });

  if (!transaction) {
    // This shouldn't happen in normal flow, but guard against orphaned jobs
    throw new Error(`Transaction not found: ${transactionId}`);
  }

  if (transaction.status !== "PAID") {
    console.warn(`[Worker] Transaction ${transactionId} is not PAID (status: ${transaction.status}). Skipping.`);
    return;
  }

  // ─── Step 2: Fetch the user's name ───────────────────────────────────────
  const user = await db.query.userDetail.findFirst({
    where: eq(userDetail.id, userId),
  });

  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }

  // ─── Step 3: Register or get customer in ERP ──────────────────────────
  const erpCustomerName = await registerOrGetCustomer({
    name:    user.name,
    phone:   user.phone,
    address: user.address,
  });

  // ─── Step 4: Map items to ERPNext format ─────────────────────────────
  // Each content entry in an item becomes one line item in the Sales Order.
  // If no content is provided, fall back to a single line with the item itself.
  const erpItems: ErpItem[] = transaction.items.flatMap((item) => {
    const contents = (item.content as ItemContent[] | null) ?? [];

    if (contents.length === 0) {
      return [{
        item_code:         item.itemCode,
        qty:               item.quantity,
        rate:              0,
        uom:               "Pcs",
        conversion_factor: 1,
      }];
    }

    return contents.map((c) => ({
      item_code:         item.itemCode,
      qty:               1,
      rate:              0,
      uom:               "Pcs",
      conversion_factor: 1,
      item_numbers:      c.item_numbers,
    }));
  });

  // ─── Step 4b: Build the buyer message from all content entries ───────
  // Address/font/style used to live per line-item — now they're combined
  // into one order-level message, one line per content entry.
  const customBuyerMessage = transaction.items
    .flatMap((item) => (item.content as ItemContent[] | null) ?? [])
    .map((c) => {
      const fonts  = c.item_style.map((s) => s.item_font).join(", ");
      const styles = c.item_style.map((s) => s.font_style).join(", ");
      return `Address: ${c.item_address} | Font: ${fonts} | Style: ${styles}`;
    })
    .join("\n");

  // ─── Step 5: Create the Sales Order in ERPNext ───────────────────────
  const poNo = `PO-${ulid()}`;

  const erpResponse = await createErpSalesOrder(
    transactionId,
    erpCustomerName,   // verified ERP customer name
    erpItems,
    customBuyerMessage,
    poNo
  );

  console.log(
    `[Worker] ✅ Sales Order created in ERP: ${erpResponse.data.name} — transaction: ${transactionId}`
  );

  // ─── Step 6: Mark items as granted + persist po_no ────────────────────
  await db
    .update(userItems)
    .set({ grantedAt: new Date() })
    .where(eq(userItems.transactionId, transactionId));

  await db
    .update(transactions)
    .set({ poNo })
    .where(eq(transactions.id, transactionId));

  // ─── Step 7: Enqueue WhatsApp notification (SO already succeeded) ─────
  // Enqueue failures are swallowed on purpose — retrying this job would
  // re-run createErpSalesOrder and create a duplicate Sales Order in ERP.
  try {
    await addWaJob(user.phone, poNo);
  } catch (err) {
    console.error(`[Worker] Failed to enqueue WhatsApp job for PO ${poNo}:`, err);
  }
}

async function processWaJob(job: Job<WaJobData>): Promise<void> {
  const { phone, poNo } = job.data;

  console.log(`[Worker] Sending WhatsApp confirmation for PO ${poNo}`);

  await sendWhatsappMessage(phone, buildOrderConfirmationMessage(poNo));

  console.log(`[Worker] ✅ WhatsApp confirmation sent — PO: ${poNo}`);
}

// =============================================================================
// WORKER SETUP
// =============================================================================

const worker = new Worker<ErpJobData>("erpQueue", processErpJob, {
  connection: createRedisConnection(),
  concurrency: 5,
  limiter: {
    // Rate-limit ERP calls to protect the ERP server from burst traffic
    max: 10,
    duration: 1000, // max 10 jobs per second
  },
});

const waWorker = new Worker<WaJobData>("waQueue", processWaJob, {
  connection: createRedisConnection(),
  concurrency: 5,
  limiter: {
    // Rate-limit outbound WhatsApp sends to stay under Fonnte's limits
    max: 10,
    duration: 1000, // max 10 jobs per second
  },
});

// ─── Event Listeners ─────────────────────────────────────────────────────────

worker.on("completed", (job) => {
  console.log(`[Worker] ✅ Job ${job.id} completed`);
});

worker.on("failed", (job, error) => {
  console.error(
    `[Worker] ❌ Job ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts.attempts}):`,
    error.message
  );
});

worker.on("error", (error) => {
  console.error("[Worker] Worker error:", error);
});

waWorker.on("completed", (job) => {
  console.log(`[Worker] ✅ WA job ${job.id} completed`);
});

waWorker.on("failed", (job, error) => {
  console.error(
    `[Worker] ❌ WA job ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts.attempts}):`,
    error.message
  );
});

waWorker.on("error", (error) => {
  console.error("[Worker] WA worker error:", error);
});

console.log("[Worker] 🚀 ERP queue worker started, listening for jobs...");
console.log("[Worker] 🚀 WhatsApp queue worker started, listening for jobs...");

// =============================================================================
// GRACEFUL SHUTDOWN
// =============================================================================

async function shutdown(signal: string) {
  console.log(`[Worker] Received ${signal}. Shutting down gracefully...`);

  // Wait for the current job to finish before exiting
  await Promise.all([worker.close(), waWorker.close()]);

  console.log("[Worker] Workers closed. Exiting.");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
