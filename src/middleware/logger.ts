import { logger as honoLogger } from "hono/logger";

/**
 * Request logger middleware.
 *
 * Uses Hono's built-in logger with a custom print function for structured output.
 * Format: [timestamp] METHOD PATH → STATUS (duration ms)
 */
export const requestLogger = honoLogger((message, ...rest) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, ...rest);
});
