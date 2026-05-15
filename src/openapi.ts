export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Nomorku Bridge API",
    version: "1.0.0",
    description:
      "Payment bridge between frontend, Xendit (payment gateway), and ERPNext.",
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
                    required: ["name", "phone", "address"],
                    properties: {
                      name: { type: "string", example: "Budi Santoso" },
                      phone: {
                        type: "string",
                        example: "081234567890",
                        description: "Indonesian phone number (+62 / 62 / 0 prefix)",
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
          "Creates a Xendit invoice for the given items. User must be registered first. Item prices are fetched from ERPNext — the client only provides item_code, item_name, and quantity.",
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
                    description: "Must match a registered user",
                  },
                  items: {
                    type: "array",
                    minItems: 1,
                    items: {
                      type: "object",
                      required: ["item_code", "item_name", "quantity"],
                      properties: {
                        item_code: { type: "string", example: "ITEM-001" },
                        item_name: { type: "string", example: "Paket Belajar" },
                        quantity: { type: "integer", minimum: 1, example: 1 },
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
            description: "Invoice created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    invoice_url: {
                      type: "string",
                      example: "https://checkout.xendit.co/web/...",
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
        summary: "Xendit webhook receiver",
        description:
          "Called by Xendit when a payment status changes. Requires the `x-callback-token` header. Protected by 4-layer duplicate prevention (token + Redis SETNX + DB FOR UPDATE + status guard).",
        parameters: [
          {
            in: "header",
            name: "x-callback-token",
            required: true,
            schema: { type: "string" },
            description: "Xendit webhook verification token",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  id: { type: "string", example: "579c8d61f23fa4ca35e52da4" },
                  external_id: {
                    type: "string",
                    format: "uuid",
                    description: "Matches transaction UUID",
                  },
                  status: {
                    type: "string",
                    enum: ["PAID", "EXPIRED", "PENDING"],
                    example: "PAID",
                  },
                  paid_amount: { type: "number", example: 150000 },
                  currency: { type: "string", example: "IDR" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Webhook received (including duplicates)" },
          "400": { description: "Invalid payload" },
          "403": { description: "Invalid callback token" },
          "500": { description: "Processing error — Xendit will retry" },
        },
      },
    },
  },
};
