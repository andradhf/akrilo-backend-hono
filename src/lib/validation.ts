import type { Context } from "hono";
import type { ZodError } from "zod";

/**
 * Hook for zValidator. Without this, @hono/zod-validator's default hook
 * replies with the raw ZodError object, burying each issue's `path` inside
 * nested arrays instead of surfacing which field actually failed.
 */
export function validationHook(
  result: { success: boolean; error?: ZodError },
  c: Context
) {
  if (result.success || !result.error) return;

  return c.json(
    {
      success: false,
      error: "Validation failed",
      details: result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    },
    400
  );
}
