import { env } from "../lib/env";

/**
 * Fonnte WhatsApp API client.
 * Docs: https://docs.fonnte.com
 */

/**
 * Normalizes an Indonesian phone number to the "62xxx" format Fonnte expects.
 * Numbers in our DB can be stored as +62/62/0-prefixed (see regex in routes/user.ts).
 */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("62")) return digits;
  return `62${digits}`;
}

/**
 * Sends a WhatsApp message via Fonnte.
 * Throws on HTTP failure or Fonnte-reported failure, so BullMQ can retry.
 */
export async function sendWhatsappMessage(phone: string, message: string): Promise<void> {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 10_000);

  try {
    const body = new URLSearchParams({
      target:  normalizePhone(phone),
      message,
    });

    const res = await fetch(env.FONNTE_API_URL, {
      method: "POST",
      headers: {
        Authorization: env.FONNTE_TOKEN,
      },
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Fonnte API error [${res.status}]: ${errorBody}`);
    }

    const data = await res.json() as { status: boolean; reason?: string };

    if (data.status !== true) {
      throw new Error(`Fonnte reported failure: ${data.reason ?? "unknown reason"}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Builds the "order confirmed, check your design" message sent after a
 * Sales Order is successfully created in ERP.
 */
export function buildOrderConfirmationMessage(poNo: string): string {
  return [
    "Terima kasih sudah membeli. Silakan cek design terlebih dahulu.",
    `Nomor PO: ${poNo}`,
    env.DESIGN_URL,
  ].join("\n");
}
