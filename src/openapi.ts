export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Nomorku Bridge API",
    version: "1.0.0",
    description:
      "Payment bridge between frontend, DOKU (payment gateway), and ERPNext.",
  },
  servers: [{ url: "" }],
  paths: {
    "/health": {
      get: {
        tags: ["System"],
        summary: "Health check",
        responses: {
          "200": {
            description: "All services healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "ok" },
                    timestamp: { type: "string", format: "date-time" },
                    services: {
                      type: "object",
                      properties: {
                        database: { type: "string", example: "ok" },
                        redis: { type: "string", example: "ok" },
                      },
                    },
                  },
                },
              },
            },
          },
          "503": { description: "One or more services degraded" },
        },
      },
    },
    "/api/user/initiate": {
      post: {
        tags: ["User"],
        summary: "Register or retrieve a user",
        description:
          "Upserts the user in the local DB and registers them as a Customer in ERPNext. Requires a valid Cloudflare Turnstile captcha token.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["user"],
                properties: {
                  user: {
                    type: "object",
                    required: ["name", "phone", "email", "address"],
                    properties: {
                      name: { type: "string", example: "Budi Santoso" },
                      phone: {
                        type: "string",
                        example: "081234567890",
                        description: "Indonesian phone number (+62 / 62 / 0 prefix)",
                      },
                      email: {
                        type: "string",
                        format: "email",
                        example: "budi@example.com",
                      },
                      address: {
                        type: "string",
                        minLength: 10,
                        maxLength: 500,
                        example: "Jl. Merdeka No. 1, Jakarta",
                      },
                    },
                  },
                },
              },
            },
          },
        },
        parameters: [
          {
            in: "header",
            name: "X-Captcha-Token",
            required: true,
            schema: { type: "string" },
            description: "Cloudflare Turnstile token",
          },
        ],
        responses: {
          "201": {
            description: "User registered / found",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    user_id: { type: "integer", example: 1 },
                    phone: { type: "string", example: "081234567890" },
                    erp_customer: { type: "string", example: "Budi Santoso" },
                  },
                },
              },
            },
          },
          "400": { description: "Validation error" },
          "429": { description: "Rate limit exceeded" },
        },
      },
    },
    "/api/payment/initiate": {
      post: {
        tags: ["Payment"],
        summary: "Initiate a payment invoice",
        description:
          "Creates a DOKU payment page for the given items. User must be registered first. Item prices are fetched from ERPNext — the client only provides item_code, item_name, quantity, and content.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["phone", "items"],
                properties: {
                  phone: {
                    type: "string",
                    example: "081234567890",
                    description: "Must match a registered user. The user's email (registered via /api/user/initiate) is used automatically — not accepted here.",
                  },
                  items: {
                    type: "array",
                    minItems: 1,
                    items: {
                      type: "object",
                      required: ["item_code", "item_name", "quantity", "content"],
                      properties: {
                        item_code: { type: "string", example: "ITEM-001" },
                        item_name: { type: "string", example: "Paket Belajar" },
                        quantity: { type: "integer", minimum: 1, example: 1 },
                        content: {
                          type: "array",
                          minItems: 1,
                          description: "Customization details for this item",
                          items: {
                            type: "object",
                            required: ["item_numbers", "item_address", "item_style"],
                            properties: {
                              item_numbers: { type: "string", example: "12345" },
                              item_address: {
                                type: "string",
                                example: "Jl. Contoh No. 1, Jakarta",
                              },
                              item_style: {
                                type: "array",
                                minItems: 1,
                                items: {
                                  type: "object",
                                  required: ["item_font", "font_style"],
                                  properties: {
                                    item_font: { type: "string", example: "Arial" },
                                    font_style: { type: "string", example: "Bold" },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Payment page created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    invoice_url: {
                      type: "string",
                      example: "https://payment.doku.com/checkout/...",
                    },
                    transaction_id: {
                      type: "string",
                      format: "uuid",
                      example: "550e8400-e29b-41d4-a716-446655440000",
                    },
                  },
                },
              },
            },
          },
          "400": { description: "Validation error" },
          "404": { description: "User not found" },
          "429": { description: "Rate limit exceeded" },
        },
      },
    },
    "/api/payment/webhook": {
      post: {
        tags: ["Payment"],
        summary: "DOKU webhook receiver",
        description:
          "Called by DOKU when a payment status changes. Requires HMAC-SHA256 signature headers. Protected by 4-layer duplicate prevention (signature + Redis SETNX + DB FOR UPDATE + status guard).",
        parameters: [
          {
            in: "header",
            name: "Client-Id",
            required: true,
            schema: { type: "string" },
            description: "DOKU client ID (must match DOKU_CLIENT_ID)",
          },
          {
            in: "header",
            name: "Request-Id",
            required: true,
            schema: { type: "string" },
            description: "Unique delivery ID, used as the Redis idempotency key",
          },
          {
            in: "header",
            name: "Request-Timestamp",
            required: true,
            schema: { type: "string" },
            description: "ISO-8601 timestamp used in the signature component string",
          },
          {
            in: "header",
            name: "Signature",
            required: true,
            schema: { type: "string" },
            description: "HMAC-SHA256 signature, format: HMAC SHA256:{base64}",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  order: {
                    type: "object",
                    properties: {
                      invoice_number: {
                        type: "string",
                        format: "uuid",
                        description: "Matches transaction UUID",
                      },
                      amount: { type: "number", example: 150000 },
                    },
                  },
                  transaction: {
                    type: "object",
                    properties: {
                      status: {
                        type: "string",
                        enum: ["SUCCESS", "FAILED", "EXPIRED"],
                        example: "SUCCESS",
                      },
                      date: { type: "string" },
                      original_request_id: { type: "string" },
                    },
                  },
                  payment: {
                    type: "object",
                    properties: {
                      channel: { type: "string" },
                      payment_due_date: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Webhook received (including duplicates)" },
          "400": { description: "Invalid JSON payload or missing invoice_number/Request-Id" },
          "403": { description: "Missing headers or invalid signature" },
          "500": { description: "Processing error — DOKU will retry" },
        },
      },
    },
  },
};
