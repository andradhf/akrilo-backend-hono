import { sendEmailMessage, buildOrderConfirmationEmail } from "../src/services/email.service";

/**
 * Standalone script to test the Mailtrap email integration in isolation —
 * no DB, Redis, DOKU, or ERP involved. Only MAILTRAP_* env vars need to be real.
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

console.log("Sent. Check your Mailtrap sandbox inbox.");
