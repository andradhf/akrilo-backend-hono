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
