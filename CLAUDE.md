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

This is a **payment bridge** between a frontend, Xendit (payment gateway), and ERPNext (ERP system). It runs two separate processes that must both be running in production:

1. **HTTP server** (`src/index.ts`) — Hono app on Bun
2. **BullMQ worker** (`src/queue/worker.ts`) — ERP job processor

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
- Call Xendit Invoice API → update transaction with invoice ID and URL
- Return `invoice_url` to client for redirect

**Xendit Webhook** (`POST /api/payment/webhook`):
- 4-layer duplicate protection:
  1. `x-callback-token` header verification
  2. Redis `SETNX` idempotency key (24h TTL)
  3. PostgreSQL `SELECT ... FOR UPDATE` row lock
  4. Status guard (skip if already PAID)
- On confirmed payment: mark transaction PAID, enqueue BullMQ job

**BullMQ Worker** (standalone process):
- Picks up `erpQueue` jobs after webhook confirms payment
- Registers/finds ERP customer, creates Sales Order in ERPNext
- Marks `user_items.granted_at` on success
- Retry: 3 attempts, exponential backoff (5s → 10s → 20s)

### Infrastructure

- **Database**: PostgreSQL via `drizzle-orm` + `postgres` (postgres-js)
- **Queue**: Redis via `ioredis` + `bullmq`
- **Schema**: `src/db/schema.ts` — three tables: `user_detail`, `transactions`, `user_items`
- **Transaction UUID** doubles as `xendit_external_id` for direct webhook correlation

### Key Design Decisions

- Item prices are **always fetched from ERP** at payment initiation — the client only sends `item_code`, `item_name`, and `quantity`.
- The webhook handler uses raw `postgres-js` SQL (`queryClient.begin`) for `SELECT ... FOR UPDATE` because Drizzle ORM doesn't support it natively. Drizzle is used everywhere else.
- The BullMQ ERP job is enqueued **after** the DB transaction commits (outside `queryClient.begin`) to avoid enqueueing on a rolled-back write.
- On webhook processing errors, the Redis idempotency key is deleted so Xendit retries can reprocess.

### Environment

All env vars are validated at startup via Zod in `src/lib/env.ts`. The app will refuse to start if any required variable is missing. See `.env.example` for all required variables.

ERP auth uses Frappe token format: `token API_KEY:API_SECRET`. Xendit uses HTTP Basic Auth with Secret Key as username and empty password.
