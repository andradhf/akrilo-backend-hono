import { sendEmailMessage, buildOrderConfirmationEmail } from "../src/services/email.service";
import { env } from "../src/lib/env";

/**
 * Standalone script to test the Mailtrap email integration in isolation —
 * no DB, Redis, DOKU, or ERP involved. Only MAILTRAP_* env vars need to be real.
 * Respects MAILTRAP_MODE — sandbox mail lands in the Mailtrap test inbox,
 * production mail is delivered to the real address.
 *
 * Usage: bun run scripts/test-email.ts <to-email> [po-no]
 */

const to = process.argv[2];
const poNo = process.argv[3] ?? "PO-TEST123";

if (!to) {
  console.error("Usage: bun run scripts/test-email.ts <to-email> [po-no]");
  process.exit(1);
}

const { subject, html } = buildOrderConfirmationEmail(poNo);

console.log(`Sending test email to ${to} (PO: ${poNo})...`);

await sendEmailMessage(to, subject, html);

console.log(
  env.MAILTRAP_MODE === "production"
    ? `Sent. Check the real inbox at ${to}.`
    : "Sent. Check your Mailtrap sandbox inbox."
);
