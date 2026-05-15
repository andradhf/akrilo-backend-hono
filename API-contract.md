# Request body configs from FE to BE

# the flows
┌─────────────────────────────────┐
                    │         FLOW YANG BENAR          │
                    └─────────────────────────────────┘

 User ──► Isi Form ──► Solve CAPTCHA ──► Dapat captcha_token
                                               │
                              ┌────────────────▼──────────────────┐
                              │          POST /checkout            │
                              │  Header: X-Captcha-Token: xxx      │
                              │  Body: { product_id, qty,          │
                              │          content, user_details }   │
                              │  ← TANPA PRICE dari FE!            │
                              └────────────────┬──────────────────┘
                                               │
                              ┌────────────────▼──────────────────┐
                              │         BACKEND VALIDASI           │
                              │  1. Verify captcha token ke server │
                              │  2. Ambil price dari DB sendiri    │
                              │  3. Proses checkout                │
                              └───────────────────────────────────┘

## pendaftaran user from Fe -> BE ( as a bridge ) -> ERP
```
{
user_details":{
        "customer_name": "jhon doe",
        "phone": "+62876901293476",
        "customer_type": "individual",
        "customer_group": "Individual",
        "territory": "All Territories",
        "address": "cipinang muara 2, jl 31 no.51",
        }
}

curl -s -X POST "${BASE_URL}/api/resource/Customer" \
  -H "Content-Type: application/json" \
  -H "Authorization: ${AUTH}" \
  -d '{
    "customer_name": "rohim",
    "customer_type": "Individual",
    "customer_group": "Individual",
    "territory": "All Territories"
  }' | python3 -m json.tool

```

## order payload body

```
method: Post/ajsdla
api_key: {jwt token}
{
    "product_id": "NMHTN-1815",
    "price": "59000",
    "qty": "1",
    "font_type":{
        "font_name": "garet",
        "style": "book"
        },
    "content":{
        "content_numbers": "A/11",
        "content_address": "Citra Harmoni",
        },
    "user_details":{
        "name": "jhon doe",
        "phone": "+62876901293476",
        "address": "cipinang muara 2, jl 31 no.51",
        }
    "notes": "Buat gak pake lama!",
}
```

# Request body from BE to ERP
```
      {
          doctype: "Sales Order",
          customer: "rohim",
          company: "Akrilo Creations",
          transaction_date: "2026-05-09",
          delivery_date": "2026-05-15",
          order_type: "Sales",
          currency: "IDR",
          conversion_rate: 1,
          selling_price_list: "Standard Selling",
          price_list_currency: "IDR",
          plc_conversion_rate: 1,
          po_no: "ulid",
          items: [
            {
              item_code: "TY-P1",
              qty: 1,
              rate: 100000,
              delivery_date: "2026-05-15",
              warehouse: "Finished Goods - AC",
              uom: "Pcs",
              conversion_factor: 1
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
│          │ → Max X request per IP per menit                 │
├──────────┼──────────────────────────────────────────────────┤
│  Layer 3 │ INPUT VALIDATION (Zod)                           │
│          │ → Sanitasi & validasi semua field dari FE        │
├──────────┼──────────────────────────────────────────────────┤
│  Layer 4 │ PRICE VALIDATION di BE                           │
│          │ → Harga selalu dari ERP/DB, tidak dari FE        │
├──────────┼──────────────────────────────────────────────────┤
│  Layer 5 │ IDEMPOTENCY CHECK                                │
│          │ → Cek duplicate customer sebelum register ke ERP │
├──────────┼──────────────────────────────────────────────────┤
│  Layer 6 │ ERP CREDENTIALS di Server Only                   │
│          │ → API Key ERP tidak pernah sampai ke client      │
└──────────┴──────────────────────────────────────────────────┘

CHECKOUT & PAYMENT FLOW
┌──────────┐                                              ┌─────────────┐
│  NEXT.JS │  (1) POST /checkout + captcha_token          │             │
│    FE    │ ────────────────────────────────────────►   │  HONO BE    │
│          │                                              │             │
│          │  (2) { payment_url: "https://xendit..." }    │  (3) Bikin  │
│          │ ◄────────────────────────────────────────   │  Invoice di │
│          │                                              │  Xendit     │
│          │  (4) Redirect ke payment_url                 │             │
│          │ ──────────────────────────────────────────► └──────┬──────┘
└──────────┘                                                    │  Xendit
                                                                │  API
                                                         ┌──────▼──────┐
                  ┌────────────────────────────────────  │   XENDIT    │
                  │   (6) Webhook: Payment Success/Fail   │             │
                  │                                       │  (5) User   │
                  ▼                                       │  Bayar di   │
           ┌──────────────┐                              │  sini       │
           │   HONO BE    │                              │             │
           │  /webhook    │  (7) Update status ERP       │  (8) Xendit │
           │  /xendit     │ ──────────────────────►ERP  │  redirect   │
           └──────────────┘                              │  ke         │
                                                         │  success/   │
                                            ┌────────────│  fail page  │
                                            │            └─────────────┘
                                            ▼
                                    ┌───────────────┐
                                    │  success.com  │
                                    │  /thank-you   │  ← Kamu set di
                                    │               │    Xendit Dashboard
                                    └───────────────┘