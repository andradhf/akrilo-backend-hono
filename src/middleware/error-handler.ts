import type { Context, Next } from "hono";
import { ZodError } from "zod";

/**
 * Global error handler middleware for Hono.
 *
 * Catches errors thrown from any route handler and returns a
 * structured JSON error response with the appropriate HTTP status.
 *
 * Error hierarchy:
 *   ZodError           → 400 Bad Request (validation failure)
 *   AppError           → Use the status code defined in the error
 *   Unknown errors     → 500 Internal Server Error (no stack trace in production)
 */

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorHandler(err: Error, c: Context): Response {
  const isProd = process.env["NODE_ENV"] === "production";

  // Zod validation errors → 400
  if (err instanceof ZodError) {
    return c.json(
      {
        success: false,
        error: "Validation failed",
        details: err.flatten().fieldErrors,
      },
      400
    );
  }

  // Known application errors
  if (err instanceof AppError) {
    return c.json(
      {
        success: false,
        error: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
      err.statusCode as 400 | 403 | 404 | 409 | 500
    );
  }

  // Unknown/unhandled errors → 500
  console.error("[ErrorHandler] Unhandled error:", err);
  return c.json(
    {
      success: false,
      error: "Internal server error",
      // Only expose stack trace in development
      ...(isProd ? {} : { stack: err.stack }),
    },
    500
  );
}

/**
 * Async error wrapper for Hono route handlers.
 * Hono v4 handles async errors natively, but this is kept
 * as a utility for explicit try/catch in complex handlers.
 */
export function asyncHandler(
  fn: (c: Context, next: Next) => Promise<Response | void>
) {
  return async (c: Context, next: Next) => {
    try {
      return await fn(c, next);
    } catch (err) {
      return errorHandler(err as Error, c);
    }
  };
}
