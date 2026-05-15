import { env } from "../lib/env";
import type {
  XenditInvoiceRequest,
  XenditInvoiceResponse,
} from "../types/index";

/**
 * Xendit Invoice API base URL.
 * Xendit uses Basic Auth with the Secret Key as username and empty password.
 */
const XENDIT_API_BASE = "https://api.xendit.co";

/**
 * Build the Basic Auth header for Xendit API calls.
 * Format: base64("SECRET_KEY:")
 */
function getAuthHeader(): string {
  const credentials = Buffer.from(`${env.XENDIT_SECRET_KEY}:`).toString("base64");
  return `Basic ${credentials}`;
}

/**
 * Creates a Xendit Invoice (payment link) for a given transaction.
 *
 * @param request - Invoice creation parameters
 * @returns Xendit Invoice response containing the `invoice_url`
 * @throws Error if the Xendit API returns a non-2xx response
 */
export async function createXenditInvoice(
  request: XenditInvoiceRequest
): Promise<XenditInvoiceResponse> {
  const url = `${XENDIT_API_BASE}/v2/invoices`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: getAuthHeader(),
    },
    body: JSON.stringify({
      external_id: request.external_id,
      amount: request.amount,
      description: request.description,
      invoice_duration: request.invoice_duration ?? 86400, // 24 hours
      currency: request.currency ?? "IDR",
      items: request.items ?? [],
      ...(request.success_redirect_url && { success_redirect_url: request.success_redirect_url }),
      ...(request.failure_redirect_url && { failure_redirect_url: request.failure_redirect_url }),
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Xendit API error [${response.status}]: ${errorBody}`
    );
  }

  const data = await response.json() as XenditInvoiceResponse;
  return data;
}
