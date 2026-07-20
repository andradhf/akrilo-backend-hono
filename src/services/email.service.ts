import { env } from "../lib/env";

/**
 * Mailtrap Email Testing (sandbox) API client.
 * Docs: https://api-docs.mailtrap.io/docs/mailtrap-api-docs/
 */

/**
 * Sends an email via the Mailtrap sandbox Sending API.
 * Throws on HTTP failure or Mailtrap-reported failure, so BullMQ can retry.
 */
export async function sendEmailMessage(to: string, subject: string, html: string): Promise<void> {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(`${env.MAILTRAP_API_URL}/api/send/${env.MAILTRAP_INBOX_ID}`, {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${env.MAILTRAP_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from:     { email: env.MAILTRAP_FROM_EMAIL, name: env.MAILTRAP_FROM_NAME },
        to:       [{ email: to }],
        subject,
        html,
        category: "Order Confirmation",
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Mailtrap API error [${res.status}]: ${errorBody}`);
    }

    const data = await res.json() as { success?: boolean; errors?: string[] };

    if (data.success === false) {
      throw new Error(`Mailtrap reported failure: ${(data.errors ?? []).join(", ") || "unknown reason"}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Builds the "order confirmed, check your design" email sent after a
 * Sales Order is successfully created in ERP.
 */
export function buildOrderConfirmationEmail(poNo: string): { subject: string; html: string } {
  const html = `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;font-family:Arial,Helvetica,sans-serif;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="background:#111827;padding:20px 32px;">
              <span style="color:#ffffff;font-size:16px;font-weight:bold;letter-spacing:0.3px;">Akrilo Creations</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#111827;">Halo,</p>
              <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#374151;">
                Terima kasih, pesanan Anda telah kami terima dan sedang diproses. Mohon periksa kembali detail design sebelum kami lanjutkan ke tahap produksi.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:24px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;">Nomor PO</p>
                    <p style="margin:0;font-size:16px;font-weight:bold;color:#111827;">${poNo}</p>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#111827;border-radius:6px;">
                    <a href="${env.DESIGN_URL}" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;">
                      Cek Design Pesanan
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">Akrilo Creations · Email ini dikirim otomatis, mohon tidak membalas.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`.trim();

  return {
    subject: `Pesanan Diterima — PO ${poNo}`,
    html,
  };
}

