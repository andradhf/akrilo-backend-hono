import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { userDetail } from "../db/schema";
import { registerOrGetCustomer } from "../services/erp.service";
import { captchaMiddleware } from "../middleware/captcha.middleware";
import { initiateRateLimiter } from "../middleware/rate-limit.middleware";

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const userInitiateSchema = z.object({
  user: z.object({
    name: z.string().min(1, "User name is required"),
    phone: z.string().regex(/^(\+62|62|0)8[1-9][0-9]{6,10}$/, 'Format nomor HP tidak valid'),
    email: z.string().email("Format email tidak valid"),
    address: z.string().min(10).max(500),
  }),
});

// =============================================================================
// ROUTER
// =============================================================================

export const userRoutes = new Hono();

// =============================================================================
// POST /api/user-initiate
// =============================================================================

/**
 * Registers or retrieves a user, then ensures they exist in ERPNext as a Customer.
 *
 * Flow:
 *   1. Rate limit + captcha verification (via middleware)
 *   2. Upsert user in local DB (by phone)
 *   3. Register or find customer in ERPNext
 *   4. Return user_id and ERP customer name
 */
userRoutes.post(
  "/initiate",
  initiateRateLimiter,       // Rate limit first
  captchaMiddleware,         // Then verify captcha
  zValidator("json", userInitiateSchema),
  async (c) => {
    const body = c.req.valid("json");

    // ─── Step 1: Upsert user in local DB by phone ───────────────────────
    let user = await db.query.userDetail.findFirst({
      where: eq(userDetail.phone, body.user.phone),
    });

    if (!user) {
      const [insertedUser] = await db
        .insert(userDetail)
        .values({
          name: body.user.name,
          phone: body.user.phone,
          email: body.user.email,
          address: body.user.address,
        })
        .returning();

      user = insertedUser;
    } else {
      // Update name, email, and address on existing user
      await db
        .update(userDetail)
        .set({
          name: body.user.name,
          email: body.user.email,
          address: body.user.address,
        })
        .where(eq(userDetail.phone, body.user.phone));
    }

    if (!user) {
      return c.json({ success: false, message: "Failed to create or find user" }, 500);
    }

    // ─── Step 2: Register or get customer in ERPNext ────────────────────
    const erpCustomerName = await registerOrGetCustomer({
      name: body.user.name,
      phone: body.user.phone,
      address: body.user.address,
    });

    // ─── Step 3: Return success ─────────────────────────────────────────
    return c.json({
      success: true,
      user_id: user.id,
      phone: body.user.phone,
      erp_customer: erpCustomerName,
    }, 201);
  }
);
