import { z } from "zod";

/**
 * Zod schema for all required environment variables.
 * The app will throw and refuse to start if any required var is missing.
 */
const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid PostgreSQL connection URL"),

  // Redis
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // Xendit
  XENDIT_SECRET_KEY: z.string().min(1, "XENDIT_SECRET_KEY is required"),
  XENDIT_WEBHOOK_TOKEN: z.string().min(1, "XENDIT_WEBHOOK_TOKEN is required"),

  // Captcha (Cloudflare Turnstile)
  TURNSTILE_SECRET_KEY: z.string().min(1),

  // Frontend URL
  FE_BASE_URL: z.string().url(),

  // ERPNext
  ERP_BASE_URL: z.string().url("ERP_BASE_URL must be a valid URL"),
  ERP_API_KEY: z.string().min(1, "ERP_API_KEY is required"),
  ERP_API_SECRET: z.string().min(1, "ERP_API_SECRET is required"),
  ERP_COMPANY: z.string().default("Akrilo Creations"),
  ERP_WAREHOUSE: z.string().default("Finished Goods - AC"),
  ERP_SELLING_PRICE_LIST: z.string().default("Standard Selling"),
  ERP_CURRENCY: z.string().default("IDR"),

  // Server
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
