# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
bun install

# Run API server (with hot reload)
bun run dev

# Run API server (production)
bun run start

# Run BullMQ worker (separate process)
bun run worker

# Database
bun run db:generate   # generate Drizzle migration files
bun run db:migrate    # apply migrations to DB
bun run db:push       # push schema directly (dev only, no migration files)
bun run db:studio     # open Drizzle Studio (DB browser)
```

There are no tests in this project.

## Architecture

This is a **payment bridge** between a frontend, DOKU (payment gateway), and ERPNext (ERP system), with Mailtrap for order-confirmation emails. It runs two separate processes that must both be running in production:

1. **HTTP server** (`src/index.ts`) — Hono app on Bun
2. **BullMQ worker** (`src/queue/worker.ts`) — ERP job + email job processor

### Request Flow

**User Registration** (`POST /api/user/initiate`):
- Rate limit → Cloudflare Turnstile captcha verification → schema validation
- Upsert user in local DB by phone number
- Register or find customer in ERPNext

**Payment Initiation** (`POST /api/payment/initiate`):
- Rate limit → schema validation
- Look up user by phone (must be registered first)
- Fetch authoritative item prices from ERP (prices never come from client)
- Insert `transactions` (PENDING) + `user_items` rows
- Call DOKU checkout API → update transaction with payment token and payment URL
- Return `invoice_url` to client for redirect

**DOKU Webhook** (`POST /api/payment/webhook`):
- 4-layer duplicate/fraud protection:
  1. HMAC-SHA256 signature verification (`Client-Id` + `Request-Id` + `Request-Timestamp` + body digest, per `src/services/doku.service.ts`)
  2. Redis `SETNX` idempotency key on DOKU's `Request-Id` header (24h TTL)
  3. PostgreSQL `SELECT ... FOR UPDATE` row lock
  4. Status guard (skip if already PAID)
- Only `transaction.status === "SUCCESS"` payloads are processed; FAILED/EXPIRED are ignored
- On confirmed payment: mark transaction PAID, enqueue `erpQueue` job

**BullMQ Worker** (standalone process, `src/queue/worker.ts`):
- `erpQueue`: picked up after webhook confirms payment. Registers/finds ERP customer, builds line items (each `user_items.content` entry becomes one ERP line item; falls back to a single zero-rate line if no content), creates a Sales Order in ERPNext with a generated `po_no` (`PO-<ulid>`), marks `user_items.granted_at`, persists `po_no`, then enqueues an `emailQueue` job. Email enqueue failures are swallowed on purpose — retrying the ERP job would create a duplicate Sales Order.
- `emailQueue`: sends the order-confirmation email via Mailtrap (`src/services/email.service.ts`). Kept as a separate queue/job so an email failure never re-triggers Sales Order creation.
- Retry: 3 attempts, exponential backoff (5s → 10s → 20s), for both queues.

### Infrastructure

- **Database**: PostgreSQL via `drizzle-orm` + `postgres` (postgres-js)
- **Queue**: Redis via `ioredis` + `bullmq`
- **Schema**: `src/db/schema.ts` — three tables: `user_detail`, `transactions`, `user_items`
- **Transaction UUID** doubles as DOKU's `order.invoice_number` for direct webhook correlation

### Key Design Decisions

- Item prices are **always fetched from ERP** at payment initiation — the client only sends `item_code`, `item_name`, `quantity`, and design `content`. `getProductFromERP` queries the `Item Price` resource directly (not `get_item_details`, which is broken on this ERP instance), so ERPNext pricing rules (qty breaks, discounts) are **not** applied.
- The webhook handler uses raw `postgres-js` SQL (`queryClient.begin`) for `SELECT ... FOR UPDATE` because Drizzle ORM doesn't support it natively. Drizzle is used everywhere else.
- The BullMQ ERP job is enqueued **after** the DB transaction commits (outside `queryClient.begin`) to avoid enqueueing on a rolled-back write.
- On webhook processing errors, the Redis idempotency key is deleted so DOKU retries can reprocess.
- WhatsApp notifications (Fonnte) were replaced by email (Mailtrap): `src/services/whatsapp.service.ts` is fully commented out and kept only for reference; `FONNTE_TOKEN`/`FONNTE_API_URL` are not in `src/lib/env.ts`. Don't re-enable it without re-adding those env vars.
- `src/services/erp.service.ts` keeps an old, unused `createErpSalesOrderOld` implementation commented out at the bottom for reference — the active `createErpSalesOrder` uses the newer request shape (`naming_series`, `custom_buyer_message`, etc.).

### Environment

All env vars are validated at startup via Zod in `src/lib/env.ts`. The app will refuse to start if any required variable is missing. See `.env.example` for all required variables.

ERP auth uses Frappe token format: `token API_KEY:API_SECRET`. DOKU requests are signed with HMAC-SHA256 over `Client-Id`/`Request-Id`/`Request-Timestamp`/`Request-Target`/body-digest, using `DOKU_SECRET_KEY` (see `src/services/doku.service.ts` for the exact component-string format — the same signing scheme is reused to verify incoming webhooks).
