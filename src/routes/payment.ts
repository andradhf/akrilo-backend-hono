import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { db, queryClient } from "../db/index";
import { userDetail, transactions, userItems } from "../db/schema";
import { createDokuPayment, verifyDokuWebhookSignature } from "../services/doku.service";
import { getProductFromERP } from "../services/erp.service";
import { checkIdempotency } from "../lib/idempotency";
import { addErpJob } from "../queue/producer";
import { redisClient } from "../queue/connection";
import { env } from "../lib/env";
import { AppError } from "../middleware/error-handler";
import { initiateRateLimiter } from "../middleware/rate-limit.middleware";
import type {
  DokuWebhookPayload,
  InitiatePaymentResponse,
} from "../types/index";

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const initiatePaymentSchema = z.object({
  phone: z.string().regex(/^(\+62|62|0)8[1-9][0-9]{6,10}$/, 'Format nomor HP tidak valid'),
  items: z
    .array(
      z.object({
        item_code: z.string().min(1, "item_code is required"),
        item_name: z.string().min(1, "item_name is required"),
        quantity: z.number().int().positive("Quantity must be a positive integer"),
        content: z
            .array(
              z.object({
                item_numbers: z.string().min(1, "Item_numbers is rquired"),
                item_address: z.string().min(1," Item_address is required"),
                item_style: z
                  .array(
                    z.object({
                      item_font: z.string().min(1, "item_font is required"),
                      font_style: z.string().min(1, "font_style is reqired"),
                    })
                  )
              })
            )
      })
    )
    .min(1, "At least one item is required"),
});

// =============================================================================
// ROUTER
// =============================================================================

export const paymentRoutes = new Hono();

// =============================================================================
// POST /api/payment/initiate
// =============================================================================

/**
 * Creates a new DOKU payment page for the user.
 *
 * Prerequisites: User must already be registered via POST /api/user-initiate.
 *
 * Flow:
 *   1. Validate request body
 *   2. Look up user by phone (must exist — registered via /api/user-initiate)
 *   3. Fetch price for each item from ERP (price NEVER comes from client)
 *   4. Calculate total_amount from ERP-fetched prices
 *   5. Insert transaction row (status: PENDING), use UUID as DOKU invoice_number
 *   6. Insert line items into `user_items`
 *   7. Call DOKU API to create payment page (with redirect URLs)
 *   8. Update transaction with DOKU payment token and payment URL
 *   9. Return payment_url and transaction_id to client
 */
paymentRoutes.post(
  "/initiate",
  initiateRateLimiter,
  zValidator("json", initiatePaymentSchema),
  async (c) => {
    const body = c.req.valid("json");

    // ─── Step 1: Look up user by phone ──────────────────────────────────
    const user = await db.query.userDetail.findFirst({
      where: eq(userDetail.phone, body.phone),
    });

    if (!user) {
      return c.json(
        { success: false, message: "User not found. Please register via /api/user-initiate first." },
        404
      );
    }

    // ─── Step 2: Fetch price for each item from ERP ─────────────────────
    const enrichedItems = await Promise.all(
      body.items.map(async (item) => {
        const erpProduct = await getProductFromERP(item.item_code);
        return {
          item_code:  item.item_code,
          item_name:  item.item_name,
          quantity:   item.quantity,
          content:    item.content,
          rate:       erpProduct.standard_rate,  // FROM ERP — never from client
          uom:        erpProduct.stock_uom ?? "Pcs",
          warehouse:  env.ERP_WAREHOUSE,
        };
      })
    );

    // ─── Step 3: Calculate total amount from ERP prices ──────────────────
    const totalAmount = enrichedItems.reduce(
      (sum, i) => sum + i.rate * i.quantity,
      0
    );

    // ─── Step 4: Insert transaction (PENDING) ────────────────────────────
    // The UUID doubles as DOKU's order.invoice_number for webhook correlation.
    const [transaction] = await db
      .insert(transactions)
      .values({
        userId: user.id,
        paymentReferenceId: crypto.randomUUID(), // temporary — will be overwritten with transaction.id
        status: "PENDING",
        totalAmount: totalAmount.toString(),
      })
      .returning();

    if (!transaction) {
      throw new AppError(500, "Failed to create transaction");
    }

    // Use the transaction UUID as the DOKU invoice_number for direct correlation
    await db
      .update(transactions)
      .set({ paymentReferenceId: transaction.id })
      .where(eq(transactions.id, transaction.id));

    // ─── Step 5: Insert line items ─────────────────────────────────────
    await db.insert(userItems).values(
      enrichedItems.map((item) => ({
        transactionId: transaction.id,
        itemCode: item.item_code,
        itemName: item.item_name,
        quantity: item.quantity,
        content: item.content,
      }))
    );

    // ─── Step 6: Call DOKU API ──────────────────────────────────────────
    const dokuPayment = await createDokuPayment({
      invoice_number: transaction.id, // UUID as invoice_number for direct correlation
      amount: totalAmount,
      currency: env.ERP_CURRENCY,
      callback_url: `${env.FE_BASE_URL}/thank-you?order_id=${transaction.id}`,
      callback_url_cancel: `${env.FE_BASE_URL}/payment-failed?order_id=${transaction.id}`,
      payment_due_date: 60, // 60 minutes
      line_items: enrichedItems.map((item) => ({
        name: item.item_name,
        price: item.rate,
        quantity: item.quantity,
      })),
      customer: {
        id: String(user.id),
        name: user.name,
        email: user.email,
        phone: user.phone,
        address: user.address,
      },
    });

    // ─── Step 7: Update transaction with DOKU payment data ──────────────
    await db
      .update(transactions)
      .set({
        paymentInvoiceToken: dokuPayment.payment.token_id,
        invoiceUrl: dokuPayment.payment.url,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, transaction.id));

    // ─── Step 8: Return payment URL ──────────────────────────────────────
    const response: InitiatePaymentResponse = {
      success: true,
      invoice_url: dokuPayment.payment.url,
      transaction_id: transaction.id,
    };

    return c.json(response, 201);
  }
);

// =============================================================================
// POST /api/payment/webhook
// =============================================================================

/**
 * DOKU Webhook Handler
 *
 * DOKU calls this endpoint after a payment is completed, failed, or expired.
 * We only process SUCCESS transactions.
 *
 * 4-layer protection against duplicate/fraudulent webhook deliveries:
 *   Layer 1: HMAC-SHA256 signature verification (Client-Id + Request-Id + Timestamp + Digest)
 *   Layer 2: Redis SETNX idempotency key (24h TTL) — stops duplicate Request-Ids immediately
 *   Layer 3: SELECT ... FOR UPDATE row-level DB lock — prevents concurrent DB writes
 *   Layer 4: Status guard — if already PAID, skip and return 200
 */
paymentRoutes.post("/webhook", async (c) => {
  // ─── Layer 1: Verify DOKU HMAC-SHA256 signature ────────────────────────
  const clientId         = c.req.header("Client-Id") ?? "";
  const requestId        = c.req.header("Request-Id") ?? "";
  const requestTimestamp = c.req.header("Request-Timestamp") ?? "";
  const signature        = c.req.header("Signature") ?? "";

  if (!clientId || !requestId || !requestTimestamp || !signature) {
    console.warn("[Webhook] Missing required DOKU headers");
    return c.json({ error: "Forbidden" }, 403);
  }

  // Read raw body text for signature verification BEFORE parsing as JSON
  const rawBody = await c.req.text();

  const isValid = verifyDokuWebhookSignature(
    clientId,
    requestId,
    requestTimestamp,
    "/api/payment/webhook",
    rawBody,
    signature
  );

  if (!isValid) {
    console.warn("[Webhook] Invalid DOKU signature");
    return c.json({ error: "Forbidden" }, 403);
  }

  // Parse the webhook payload
  let payload: DokuWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as DokuWebhookPayload;
  } catch {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  // We only process SUCCESS — ignore FAILED and EXPIRED
  if (payload.transaction.status !== "SUCCESS") {
    console.log(`[Webhook] Ignoring webhook with status: ${payload.transaction.status}`);
    return c.json({ received: true }, 200);
  }

  const invoiceNumber = payload.order?.invoice_number; // This is our transaction UUID

  if (!invoiceNumber || !requestId) {
    return c.json({ error: "Missing invoice_number or Request-Id in payload/headers" }, 400);
  }

  // ─── Layer 2: Redis idempotency check (SETNX) ──────────────────────────
  // Use DOKU's Request-Id header as the unique delivery identifier.
  // DOKU may retry webhooks — SETNX ensures only the first delivery is processed.
  const isNew = await checkIdempotency(redisClient, requestId, 86400);

  if (!isNew) {
    console.log(`[Webhook] Duplicate webhook detected (Request-Id: ${requestId}). Returning 200.`);
    return c.json({ received: true }, 200);
  }

  // ─── Layers 3 & 4: DB row-level lock + status guard ────────────────────
  type LockedTx = { id: string; status: string; user_id: number };
  let erpJobArgs: { transactionId: string; userId: number } | null = null;

  try {
    await queryClient.begin(async (sql) => {
      // Layer 3: Lock the row — concurrent requests BLOCK here until commit
      const rows = await sql<LockedTx[]>`
        SELECT id, status, user_id
        FROM transactions
        WHERE id = ${invoiceNumber}
        FOR UPDATE
      `;

      const lockedTransaction = rows[0];

      if (!lockedTransaction) {
        console.warn(`[Webhook] Transaction not found for invoice_number: ${invoiceNumber}`);
        return;
      }

      // Layer 4: Status guard
      if (lockedTransaction.status === "PAID") {
        console.log(`[Webhook] Transaction ${invoiceNumber} already PAID. Skipping.`);
        return;
      }

      await sql`
        UPDATE transactions
        SET status = 'PAID', updated_at = NOW()
        WHERE id = ${invoiceNumber}
      `;

      console.log(`[Webhook] ✅ Transaction ${invoiceNumber} marked as PAID`);

      erpJobArgs = { transactionId: invoiceNumber, userId: lockedTransaction.user_id };
    });

    // ─── Enqueue ERP job AFTER DB transaction commits ────────────────────
    if (erpJobArgs !== null) {
      const { transactionId, userId } = erpJobArgs as { transactionId: string; userId: number };
      await addErpJob(transactionId, userId);
    }
  } catch (err) {
    console.error("[Webhook] Error processing webhook:", err);
    // Delete idempotency key so DOKU retries can reprocess
    await redisClient.del(`webhook:idempotency:${requestId}`);
    return c.json({ error: "Internal server error" }, 500);
  }

  return c.json({ received: true }, 200);
});
