# Request body configs from FE to BE

> **Sumber kebenaran kontrak API adalah `src/openapi.ts`**, yang bisa dibuka lewat Swagger UI di `/docs` saat server berjalan (`bun run dev` → http://localhost:3000/docs). Dokumen markdown ini hanya ringkasan dan bisa tertinggal dari kode — kalau ada perbedaan, ikuti `src/openapi.ts` / Zod schema di `src/routes/`.

# the flows
```
┌─────────────────────────────────┐
                    │         FLOW YANG BENAR          │
                    └─────────────────────────────────┘

 User ──► Isi Form ──► Solve CAPTCHA ──► Dapat captcha_token
                                               │
                              ┌────────────────▼──────────────────┐
                              │      POST /api/payment/initiate    │
                              │  Body: { phone, items[] }          │
                              │  ← TANPA PRICE dari FE!            │
                              └────────────────┬──────────────────┘
                                               │
                              ┌────────────────▼──────────────────┐
                              │         BACKEND VALIDASI           │
                              │  1. Cek user sudah terdaftar       │
                              │  2. Ambil price dari ERP           │
                              │  3. Buat payment page di DOKU      │
                              └───────────────────────────────────┘
```

## pendaftaran user from Fe -> BE ( as a bridge ) -> ERP

`POST /api/user/initiate` (perlu header `X-Captcha-Token`):

```json
{
  "user": {
    "name": "jhon doe",
    "phone": "+62876901293476",
    "email": "jhon@example.com",
    "address": "cipinang muara 2, jl 31 no.51"
  }
}
```

Response:
```json
{ "success": true, "user_id": 1, "phone": "+62876901293476", "erp_customer": "web - jhon doe" }
```

## payment initiate payload — POST /api/payment/initiate

User harus sudah terdaftar lebih dulu lewat `/api/user/initiate`. `phone` di root body dipakai untuk mencari user tersebut — email TIDAK dikirim di sini, sudah tersimpan dari step registrasi.

```json
{
  "phone": "+62876901293476",
  "items": [
    {
      "item_code": "NMDL-M1430-BS",
      "item_name": "Nomor Rumah Akrilik Portrait",
      "quantity": 1,
      "content": [
        {
          "item_numbers": "A/11",
          "item_address": "Citra Harmoni",
          "item_style": [
            { "item_font": "garet", "font_style": "Book" }
          ]
        }
      ]
    }
  ]
}
```

**Penting — semua key huruf kecil (snake_case), termasuk di dalam `item_style`.** Kesalahan umum: mengirim `Item_font` / `Font_style` (kapital di awal) alih-alih `item_font` / `font_style` — ini akan ditolak dengan 400 karena Zod schema di `src/routes/payment.ts` case-sensitive.

Response sukses (`201`):
```json
{
  "success": true,
  "invoice_url": "https://payment.doku.com/checkout/...",
  "transaction_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

Response gagal validasi (`400`) — tiap entry `details` menyebut field yang gagal:
```json
{
  "success": false,
  "error": "Validation failed",
  "details": [
    { "field": "items.0.content.0.item_style.0.item_font", "message": "Required" }
  ]
}
```

## Request body from BE to ERP (Sales Order)

Dibuat otomatis oleh BullMQ worker (`src/queue/worker.ts` + `src/services/erp.service.ts`) setelah pembayaran DOKU sukses — FE tidak pernah memanggil ini langsung.

```
{
    doctype: "Sales Order",
    customer: "web - jhon doe",
    company: "Akrilo Creations",
    transaction_date: "2026-05-09",
    delivery_date: "2026-05-15",
    order_type: "Sales",
    currency: "IDR",
    selling_price_list: "Standard Selling",
    price_list_currency: "IDR",
    po_no: "PO-<ulid>",
    custom_buyer_message: "Address: Citra Harmoni | Font: garet | Style: Book",
    items: [
      {
        item_code: "NMDL-M1430-BS",
        qty: 1,
        rate: 0,
        uom: "Pcs",
        conversion_factor: 1,
        item_numbers: "A/11"
      }
    ]
}
```

┌─────────────────────────────────────────────────────────────┐
│                    SECURITY LAYERS                          │
├─────────────────────────────────────────────────────────────┤
│  Layer 1 │ CAPTCHA (Cloudflare Turnstile)                   │
│          │ → Blokir bot & automated request                 │
├──────────┼──────────────────────────────────────────────────┤
│  Layer 2 │ RATE LIMITING                                    │
│          │ → Max 5 request per IP per menit (initiate)      │
├──────────┼──────────────────────────────────────────────────┤
│  Layer 3 │ INPUT VALIDATION (Zod)                           │
│          │ → Sanitasi & validasi semua field dari FE        │
├──────────┼──────────────────────────────────────────────────┤
│  Layer 4 │ PRICE VALIDATION di BE                           │
│          │ → Harga selalu dari ERP, tidak dari FE           │
├──────────┼──────────────────────────────────────────────────┤
│  Layer 5 │ IDEMPOTENCY CHECK                                │
│          │ → Redis SETNX + DB row lock di webhook DOKU      │
├──────────┼──────────────────────────────────────────────────┤
│  Layer 6 │ ERP/DOKU CREDENTIALS di Server Only              │
│          │ → API Key tidak pernah sampai ke client          │
└──────────┴──────────────────────────────────────────────────┘

CHECKOUT & PAYMENT FLOW
```
┌──────────┐                                              ┌─────────────┐
│  NEXT.JS │  (1) POST /api/payment/initiate              │             │
│    FE    │ ────────────────────────────────────────►   │  HONO BE    │
│          │                                              │             │
│          │  (2) { invoice_url: "https://doku..." }      │  (3) Bikin  │
│          │ ◄────────────────────────────────────────   │  payment    │
│          │                                              │  page di    │
│          │  (4) Redirect ke invoice_url                 │  DOKU       │
│          │ ──────────────────────────────────────────► └──────┬──────┘
└──────────┘                                                    │  DOKU
                                                                │  API
                                                         ┌──────▼──────┐
                  ┌────────────────────────────────────  │    DOKU     │
                  │   (6) Webhook: transaction.status     │             │
                  │       SUCCESS/FAILED/EXPIRED          │  (5) User   │
                  ▼                                       │  Bayar di   │
           ┌──────────────┐                              │  sini       │
           │   HONO BE    │                              │             │
           │  /api/payment│  (7) Enqueue BullMQ job       │  (8) DOKU   │
           │  /webhook    │ ──────────────────────► ERP  │  redirect   │
           └──────────────┘     (via emailQueue jg)       │  ke         │
                                                         │  callback_  │
                                            ┌────────────│  url        │
                                            │            └─────────────┘
                                            ▼
                                    ┌───────────────┐
                                    │  FE_BASE_URL  │
                                    │  /thank-you   │  ← diset di
                                    │               │    payload initiate
                                    └───────────────┘
```
