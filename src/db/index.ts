import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../lib/env";
import * as schema from "./schema";

/**
 * Create the postgres.js client.
 * `max` controls the connection pool size.
 * `idle_timeout` closes idle connections after 30 seconds.
 */
const queryClient = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  onnotice: () => {}, // suppress notice messages
});

/**
 * Drizzle ORM instance, exported for use across the application.
 * Import this wherever DB access is needed.
 */
export const db = drizzle(queryClient, { schema });

/**
 * Raw postgres client — exposed only for operations that require
 * raw SQL (e.g., SELECT ... FOR UPDATE within a transaction block).
 */
export { queryClient };
