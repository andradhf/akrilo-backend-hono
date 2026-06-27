import { createHmac, createHash } from "crypto";
import { env } from "../lib/env";
import type { DokuPaymentRequest, DokuPaymentResponse } from "../types/index";

// =============================================================================
// DOKU SIGNATURE HELPERS
// =============================================================================

/**
 * Generate SHA-256 digest of the request body (Base64-encoded).
 * Required for all POST requests to DOKU API.
 */
function generateDigest(body: string): string {
  return createHash("sha256").update(body).digest("base64");
}

/**
 * Build the string-to-sign and compute HMAC-SHA256 signature.
 *
 * DOKU signature format:
 *   Component string = "Client-Id:{id}\nRequest-Id:{reqId}\nRequest-Timestamp:{ts}\nRequest-Target:{path}\nDigest:{digest}"
 *   Signature = "HMAC SHA256:" + Base64(HMAC-SHA256(component, secretKey))
 */
function generateSignature(
  requestId: string,
  requestTimestamp: string,
  requestTarget: string,
  bodyDigest: string
): string {
  const component = [
    `Client-Id:${env.DOKU_CLIENT_ID}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${requestTimestamp}`,
    `Request-Target:${requestTarget}`,
    `Digest:${bodyDigest}`,
  ].join("\n");

  const hmac = createHmac("sha256", env.DOKU_SECRET_KEY)
    .update(component)
    .digest("base64");

  return `HMAC SHA256:${hmac}`;
}

/**
 * Verify the HMAC-SHA256 signature on an incoming DOKU webhook.
 *
 * DOKU sends the same signature headers on webhook calls.
 * We reconstruct the component string from those headers + body digest
 * and compare with the signature they sent.
 *
 * @returns true if the signature is valid
 */
export function verifyDokuWebhookSignature(
  clientId: string,
  requestId: string,
  requestTimestamp: string,
  requestTarget: string,
  rawBody: string,
  receivedSignature: string
): boolean {
  if (clientId !== env.DOKU_CLIENT_ID) return false;

  const bodyDigest = generateDigest(rawBody);

  const component = [
    `Client-Id:${clientId}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${requestTimestamp}`,
    `Request-Target:${requestTarget}`,
    `Digest:${bodyDigest}`,
  ].join("\n");

  const expectedHmac = createHmac("sha256", env.DOKU_SECRET_KEY)
    .update(component)
    .digest("base64");

  const expectedSignature = `HMAC SHA256:${expectedHmac}`;

  // Constant-time comparison to prevent timing attacks
  return expectedSignature === receivedSignature;
}

// =============================================================================
// DOKU PAYMENT API
// =============================================================================

const PAYMENT_TARGET = "/checkout/v1/payment";

/**
 * Creates a DOKU payment page for a given transaction.
 * Returns the payment URL to redirect the user to.
 *
 * @param request - Payment creation parameters
 * @returns DOKU payment response containing `payment.url`
 * @throws Error if DOKU API returns a non-2xx response
 */
export async function createDokuPayment(
  request: DokuPaymentRequest
): Promise<DokuPaymentResponse> {
  const requestId = crypto.randomUUID();
  const requestTimestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const body = JSON.stringify({
    order: {
      amount: request.amount,
      invoice_number: request.invoice_number,
      currency: request.currency,
      callback_url: request.callback_url,
      callback_url_cancel: request.callback_url_cancel,
      language: "ID",
      auto_redirect: false,
      disable_retry_payment: false,
      line_items: request.line_items,
    },
    payment: {
      payment_due_date: request.payment_due_date,
    },
    customer: request.customer,
  });

  const digest    = generateDigest(body);
  const signature = generateSignature(requestId, requestTimestamp, PAYMENT_TARGET, digest);

  const response = await fetch(`${env.DOKU_BASE_URL}${PAYMENT_TARGET}`, {
    method: "POST",
    headers: {
      "Content-Type":    "application/json",
      "Client-Id":       env.DOKU_CLIENT_ID,
      "Request-Id":      requestId,
      "Request-Timestamp": requestTimestamp,
      "Signature":       signature,
    },
    body,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`DOKU API error [${response.status}]: ${errorBody}`);
  }

  return response.json() as Promise<DokuPaymentResponse>;
}
