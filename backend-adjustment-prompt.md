# Claude Code — Backend Adjustment Prompt
# Nomorku Bridge: Delta from Existing Plan

---

## CONTEXT

You are adjusting an **existing** Hono + Bun + Drizzle + BullMQ backend service called `nomorku-bridge`.
The base architecture is already planned. This prompt only describes **what to ADD, CHANGE, or REMOVE** from the existing plan.

Do not rewrite what is already correct. Follow the section markers precisely:
- `[ADD]` — new file or feature not in the existing plan
- `[CHANGE]` — modify existing planned file or behavior
- `[REMOVE]` — delete or strip out something from the existing plan

---

## CRITICAL RULES (Never Violate)

1. **Price ALWAYS comes from ERP** — `rate` must never be accepted from the request body
2. **ERP Customer must be registered/verified before creating Sales Order** — the worker cannot assume the customer exists in ERP
3. **Sales Order is ONLY created after Xendit webhook `status: PAID`** — already correct in existing plan, keep it
4. **Always return HTTP 200 to Xendit webhook** — already correct in existing plan, keep it

---

## SECTION 1 — ENVIRONMENT VARIABLES

### [CHANGE] `.env.example`

Add the following missing variables to the existing `.env.example`:

```env
# Captcha (ADD THIS BLOCK)
TURNSTILE_SECRET_KEY=your_cloudflare_turnstile_secret_key

# Frontend URL (ADD THIS — needed for Xendit redirect after payment)
FE_BASE_URL=http://localhost:3000

# ERP Extra Config (ADD THESE)
ERP_COMPANY=Akrilo Creations
ERP_WAREHOUSE=Finished Goods - AC
ERP_SELLING_PRICE_LIST=Standard Selling
```

### [CHANGE] `src/lib/env.ts`

Add the new variables to the existing Zod schema:

```typescript
// ADD these fields inside the existing envSchema object:
TURNSTILE_SECRET_KEY: z.string().min(1),
FE_BASE_URL: z.string().url(),
ERP_COMPANY: z.string().min(1),
ERP_WAREHOUSE: z.string().min(1),
ERP_SELLING_PRICE_LIST: z.string().min(1),
```

---

## SECTION 2 — DATABASE SCHEMA

### [CHANGE] `src/db/schema.ts`

The existing schema has `email` on `user_detail`. Change this:

**REMOVE** the `email` field from `user_detail`.
**ADD** a `phone` field instead. Phone is the identifier used to check for duplicate customers in ERP.

```typescript
// REMOVE:
email: text("email").notNull().unique(),

// ADD:
phone: text("phone").notNull().unique(),
```

**Why**: Our checkout flow identifies customers by phone number, matching how ERP deduplication works (`mobile_no` field in ERPNext).

Also on the `user_items` table, **REMOVE** the `rate` column. Price is fetched from ERP, not stored from client input.

```typescript
// REMOVE from user_items:
rate: integer("rate").notNull(),
```

After changing the schema, run:
```bash
bun run db:generate
bun run db:migrate
```

---

## SECTION 3 — CAPTCHA MIDDLEWARE

### [ADD] `src/middleware/captcha.middleware.ts`

New file. Does not exist in the current plan.

```typescript
import { createMiddleware } from 'hono/factory';
import { env } from '../lib/env';

const verifyCaptchaToken = async (token: string): Promise<boolean> => {
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({
      secret:   env.TURNSTILE_SECRET_KEY,
      response: token,
    }),
  });
  const data = await res.json();
  return data.success === true;
};

export const captchaMiddleware = createMiddleware(async (c, next) => {
  const token = c.req.header('X-Captcha-Token');

  if (!token) {
    return c.json({ success: false, message: 'Captcha token required' }, 401);
  }

  const valid = await verifyCaptchaToken(token);
  if (!valid) {
    return c.json({ success: false, message: 'Invalid captcha' }, 403);
  }

  await next();
});
```

---

## SECTION 4 — RATE LIMITING MIDDLEWARE

### [ADD] `src/middleware/rate-limit.middleware.ts`

New file. Does not exist in the current plan. Install `hono-rate-limiter` first:

```bash
bun add hono-rate-limiter
```

```typescript
import { rateLimiter } from 'hono-rate-limiter';

// Apply ONLY to POST /api/payment/initiate — not to the webhook route
export const initiateRateLimiter = rateLimiter({
  windowMs: 60 * 1000,    // 1 minute window
  limit:    5,             // max 5 requests per IP per minute
  keyGenerator: (c) =>
    c.req.header('x-forwarded-for') ??
    c.req.header('x-real-ip') ??
    'unknown',
  handler: (c) =>
    c.json({ success: false, message: 'Terlalu banyak request, coba lagi nanti.' }, 429),
});
```

---

## SECTION 5 — ROUTES

### [CHANGE] `src/routes/payment.ts`

#### 5A. Apply new middlewares to `POST /api/payment/initiate`

Add `initiateRateLimiter` and `captchaMiddleware` to the initiate route **before** the Zod validator:

```typescript
// BEFORE (existing):
app.post('/initiate', zValidator('json', initiateSchema), async (c) => { ... });

// AFTER (updated):
import { captchaMiddleware }    from '../middleware/captcha.middleware';
import { initiateRateLimiter }  from '../middleware/rate-limit.middleware';

app.post('/initiate',
  initiateRateLimiter,       // ADD — rate limit first
  captchaMiddleware,         // ADD — then verify captcha
  zValidator('json', initiateSchema),
  async (c) => { ... }
);
```

Do NOT add captcha or rate limit middleware to the webhook route.

#### 5B. CHANGE the `initiateSchema` — Remove `rate` from items

The existing `initiateSchema` accepts `rate` per item from the client. This is a security vulnerability.

```typescript
// REMOVE from the items array schema:
rate: z.number().positive(),

// REMOVE from the items array schema:
uom: z.string().default("Pcs"),
warehouse: z.string().default("Finished Goods - AC"),
```

`rate`, `uom`, and `warehouse` will now come from ERP lookup inside the handler, not from the client.

Updated items schema:

```typescript
items: z.array(z.object({
  item_code:  z.string().min(1),   // KEEP — used to look up product in ERP
  item_name:  z.string().min(1),   // KEEP — used for Xendit invoice description
  quantity:   z.number().int().positive(),  // KEEP
})).min(1),
```

Also **CHANGE** the `user` object — replace `email` with `phone`:

```typescript
// REMOVE:
user: z.object({
  name:  z.string().min(1),
  email: z.string().email(),
}),

// ADD:
user: z.object({
  name:    z.string().min(1),
  phone:   z.string().regex(/^(\+62|62|0)8[1-9][0-9]{6,10}$/, 'Format nomor HP tidak valid'),
  address: z.string().min(10).max(500),
}),
```

#### 5C. CHANGE the initiate handler — Fetch price from ERP, not from body

Inside the `POST /api/payment/initiate` handler, after validation, add ERP product lookup before calculating the total and creating the Xendit invoice:

```typescript
// ADD: Fetch price for each item from ERP
// Replace any logic that uses body.items[n].rate with ERP-fetched rate

import { getProductFromERP, registerOrGetCustomer } from '../services/erp.service';

// Inside handler, BEFORE calculating total:
const enrichedItems = await Promise.all(
  body.items.map(async (item) => {
    const erpProduct = await getProductFromERP(item.item_code);
    return {
      item_code:  item.item_code,
      item_name:  item.item_name,
      quantity:   item.quantity,
      rate:       erpProduct.standard_rate,   // FROM ERP — never from client
      uom:        erpProduct.stock_uom ?? 'Pcs',
      warehouse:  env.ERP_WAREHOUSE,
    };
  })
);

const totalAmount = enrichedItems.reduce((sum, i) => sum + i.rate * i.quantity, 0);
```

Also **CHANGE** how `user_detail` is saved — use `phone` instead of `email`, and add `address`:

```typescript
// CHANGE upsert to use phone as the unique identifier:
await db.insert(userDetailTable)
  .values({
    name:    body.user.name,
    phone:   body.user.phone,    // was email
    address: body.user.address,  // ADD this field
  })
  .onConflictDoUpdate({
    target: userDetailTable.phone,   // was email
    set: {
      name:    body.user.name,
      address: body.user.address,
    },
  });
```

#### 5D. CHANGE Xendit invoice creation — Add redirect URLs

When calling `xenditService.createInvoice()`, add success and failure redirect URLs so Xendit redirects the user back to the FE after payment:

```typescript
// CHANGE the Xendit invoice payload to include:
success_redirect_url: `${env.FE_BASE_URL}/thank-you?order_id=${transactionId}`,
failure_redirect_url: `${env.FE_BASE_URL}/payment-failed?order_id=${transactionId}`,
```

---

## SECTION 6 — ERP SERVICE

### [CHANGE] `src/services/erp.service.ts`

The existing plan only has Sales Order creation. Add two new functions.

#### ADD Function 1: `getProductFromERP()`

Fetches item details including price from ERPNext. Called during payment initiation.

```typescript
export const getProductFromERP = async (itemCode: string) => {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(
      `${env.ERP_BASE_URL}/api/resource/Item/${encodeURIComponent(itemCode)}`,
      {
        signal:  controller.signal,
        headers: {
          Authorization:  `token ${env.ERP_API_KEY}:${env.ERP_API_SECRET}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!res.ok) throw new Error(`ERP product lookup failed: ${res.status}`);

    const data = await res.json();
    return {
      item_code:     data.data.name           as string,
      item_name:     data.data.item_name      as string,
      standard_rate: data.data.standard_rate  as number,
      stock_uom:     data.data.stock_uom      as string,
    };
  } finally {
    clearTimeout(timeout);
  }
};
```

#### ADD Function 2: `registerOrGetCustomer()`

Checks if a customer exists in ERPNext by phone. Creates a new one if not found.
Called inside the **BullMQ worker** before creating the Sales Order.

```typescript
export const registerOrGetCustomer = async (customer: {
  name:    string;
  phone:   string;
  address: string;
}): Promise<string> => {
  // Returns the ERPNext customer_name (their internal identifier)

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 10_000);

  try {
    const encoded = encodeURIComponent(
      JSON.stringify([['mobile_no', '=', customer.phone]])
    );
    const searchRes = await fetch(
      `${env.ERP_BASE_URL}/api/resource/Customer?filters=${encoded}&fields=["name","customer_name"]`,
      {
        signal:  controller.signal,
        headers: { Authorization: `token ${env.ERP_API_KEY}:${env.ERP_API_SECRET}` },
      }
    );

    const searchData = await searchRes.json();

    if (searchData.data && searchData.data.length > 0) {
      return searchData.data[0].customer_name as string;
    }

    // Not found — create new customer
    const createRes = await fetch(`${env.ERP_BASE_URL}/api/resource/Customer`, {
      method: 'POST',
      headers: {
        Authorization:  `token ${env.ERP_API_KEY}:${env.ERP_API_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        doctype:       'Customer',
        customer_name: customer.name,
        customer_type: 'Individual',
        mobile_no:     customer.phone,
      }),
    });

    const created = await createRes.json();
    return created.data.customer_name as string;

  } finally {
    clearTimeout(timeout);
  }
};
```

#### CHANGE `createSalesOrder()` — Use env vars, not hardcoded strings

Replace any hardcoded values for company, warehouse, selling price list with env vars:

```typescript
// CHANGE hardcoded strings to env vars:
company:             env.ERP_COMPANY,           // was "Akrilo Creations"
selling_price_list:  env.ERP_SELLING_PRICE_LIST, // was "Standard Selling"
// warehouse per item:
warehouse: env.ERP_WAREHOUSE,                    // was "Finished Goods - AC"
```

---

## SECTION 7 — BULLMQ WORKER

### [CHANGE] `src/queue/worker.ts`

The existing worker fetches transaction + user from DB then builds the ERP payload.
Add one step before building the Sales Order payload: **register or get the ERP customer**.

```typescript
// CHANGE the worker job processor — ADD this step before building ERP payload:

const { transactionId, userId } = job.data;

// Step 1: Fetch transaction + items from DB (existing — KEEP)
// Step 2: Fetch user from DB (existing — KEEP)

// Step 3: ADD — Register or get customer in ERP
const erpCustomerName = await registerOrGetCustomer({
  name:    user.name,
  phone:   user.phone,    // was user.email
  address: user.address,
});

// Step 4: Build ERP Sales Order payload — CHANGE customer field:
const salesOrderPayload = {
  doctype:  'Sales Order',
  customer: erpCustomerName,   // was user.name — now verified ERP customer name
  // ... rest of payload unchanged
};

// Step 5: POST to ERPNext (existing — KEEP)
```

---

## SECTION 8 — MAIN SERVER

### [CHANGE] `src/index.ts`

Add CORS middleware. The existing plan does not configure CORS.

Install if needed:
```bash
# cors is built into hono — no extra install needed
```

Add to the top of the Hono app setup, **before** all routes:

```typescript
import { cors } from 'hono/cors';

// ADD — restrict to FE origin only
app.use('*', cors({
  origin:         env.FE_BASE_URL,
  allowMethods:   ['POST', 'OPTIONS'],
  allowHeaders:   ['Content-Type', 'X-Captcha-Token'],
}));
```

---

## SECTION 9 — TYPES

### [CHANGE] `src/types/index.ts`

Update the user-related types to reflect `phone` and `address` instead of `email`:

```typescript
// CHANGE:
export interface UserDetail {
  id:         number;
  name:       string;
  phone:      string;   // was email
  address:    string;   // ADD
  created_at: Date;
}

// ADD new type for ERP product lookup result:
export interface ErpProduct {
  item_code:     string;
  item_name:     string;
  standard_rate: number;
  stock_uom:     string;
}

// ADD enriched item type used internally (after ERP price fetch):
export interface EnrichedItem {
  item_code: string;
  item_name: string;
  quantity:  number;
  rate:      number;   // always from ERP
  uom:       string;
  warehouse: string;
}
```

---

## SUMMARY TABLE — What Changed

| File | Action | What Changed |
|------|--------|--------------|
| `.env.example` | CHANGE | Add `TURNSTILE_SECRET_KEY`, `FE_BASE_URL`, `ERP_COMPANY`, `ERP_WAREHOUSE`, `ERP_SELLING_PRICE_LIST` |
| `src/lib/env.ts` | CHANGE | Add 5 new env vars to Zod schema |
| `src/db/schema.ts` | CHANGE | Replace `email` with `phone` + add `address` on `user_detail`; remove `rate` from `user_items` |
| `src/middleware/captcha.middleware.ts` | ADD | New — Cloudflare Turnstile verification |
| `src/middleware/rate-limit.middleware.ts` | ADD | New — max 5 req/min per IP on initiate endpoint |
| `src/routes/payment.ts` | CHANGE | Add middlewares; remove `rate`/`uom`/`warehouse` from schema; replace `email` with `phone`+`address`; fetch price from ERP; add Xendit redirect URLs |
| `src/services/erp.service.ts` | CHANGE | Add `getProductFromERP()` and `registerOrGetCustomer()`; replace hardcoded strings with env vars in `createSalesOrder()` |
| `src/queue/worker.ts` | CHANGE | Add `registerOrGetCustomer()` call before building Sales Order payload |
| `src/index.ts` | CHANGE | Add CORS middleware restricted to `FE_BASE_URL` |
| `src/types/index.ts` | CHANGE | Update `UserDetail` type; add `ErpProduct` and `EnrichedItem` types |

---

## FILES THAT DO NOT CHANGE

These existing planned files are correct as-is. Do not modify them:

| File | Reason |
|------|--------|
| `src/db/index.ts` | Drizzle connection is fine |
| `src/db/migrate.ts` | Migration runner is fine |
| `drizzle.config.ts` | Config is fine |
| `src/queue/connection.ts` | Redis connection is fine |
| `src/queue/producer.ts` | Producer is fine |
| `src/middleware/error-handler.ts` | Error handler is fine |
| `src/middleware/logger.ts` | Logger is fine |
| `src/lib/idempotency.ts` | Idempotency helper is fine |
| `src/services/xendit.service.ts` | Fine — only needs redirect URLs added via caller |
| `ecosystem.config.cjs` | PM2 config is fine |
| `package.json` | Fine — only add `hono-rate-limiter` |

---

## VERIFICATION ADDITIONS

Add these checks on top of the existing verification plan:

- [ ] `POST /api/payment/initiate` without `X-Captcha-Token` header → returns 401
- [ ] `POST /api/payment/initiate` with invalid captcha token → returns 403
- [ ] `POST /api/payment/initiate` with `rate` in request body → `rate` is ignored, ERP price is used
- [ ] `POST /api/payment/initiate` with `email` in user object → validation rejects it (no such field)
- [ ] 6th request from same IP within 1 minute → returns 429
- [ ] Xendit invoice URL response includes `success_redirect_url` pointing to `FE_BASE_URL/thank-you`
- [ ] Worker creates ERP customer before Sales Order if customer does not exist in ERP
- [ ] Worker uses `env.ERP_COMPANY` and `env.ERP_WAREHOUSE` — no hardcoded strings
- [ ] CORS rejects requests from origins other than `FE_BASE_URL`
