import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { swaggerUI } from "@hono/swagger-ui";
import { requestLogger } from "./middleware/logger";
import { errorHandler } from "./middleware/error-handler";
import { paymentRoutes } from "./routes/payment";
import { userRoutes } from "./routes/user";
import { openApiSpec } from "./openapi";
import { env } from "./lib/env";
import { db, queryClient } from "./db/index";
import { sql } from "drizzle-orm";
import { redisClient } from "./queue/connection";
import { erpQueue } from "./queue/producer";

// =============================================================================
// HONO APP
// =============================================================================

const app = new Hono();

// ─── Global Middleware ────────────────────────────────────────────────────────

app.use("*", requestLogger);

app.use("*", cors({
  origin: [env.FE_BASE_URL, "http://localhost:3000"],
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "X-Captcha-Token"],
  credentials: true,
}));

app.use("*", secureHeaders());

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get("/health", async (c) => {
  // Verify DB connectivity on health check
  let dbStatus: "ok" | "error" = "ok";
  try {
    await db.execute(sql`SELECT 1`);
  } catch {
    dbStatus = "error";
  }

  // Verify Redis connectivity
  let redisStatus: "ok" | "error" = "ok";
  try {
    await redisClient.ping();
  } catch {
    redisStatus = "error";
  }

  const healthy = dbStatus === "ok" && redisStatus === "ok";

  return c.json(
    {
      status: healthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      services: {
        database: dbStatus,
        redis: redisStatus,
      },
    },
    healthy ? 200 : 503
  );
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.route("/api/user", userRoutes);
app.route("/api/payment", paymentRoutes);

// ─── API Docs (dev only) ──────────────────────────────────────────────────────

app.get("/docs/openapi.json", (c) => c.json(openApiSpec));
app.get("/docs", swaggerUI({ url: "/docs/openapi.json" }));

// ─── 404 Handler ─────────────────────────────────────────────────────────────

app.notFound((c) => {
  return c.json({ success: false, error: "Route not found" }, 404);
});

// ─── Global Error Handler ─────────────────────────────────────────────────────

app.onError(errorHandler);

// =============================================================================
// SERVER STARTUP
// =============================================================================
//
// IMPORTANT: We export the server config as `default` instead of calling
// Bun.serve() manually. This lets bun's --watch HMR gracefully reload
// the server on file changes without hitting EADDRINUSE.
// Bun detects the default export has { port, fetch } and manages the
// server lifecycle itself.
//

const serverConfig = {
  port: env.PORT,
  fetch: app.fetch,
};

console.log(`🚀 Nomorku Bridge API running on http://localhost:${env.PORT}`);
console.log(`   Environment: ${env.NODE_ENV}`);

// =============================================================================
// GRACEFUL SHUTDOWN
// =============================================================================

async function shutdown(signal: string) {
  console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);

  // Close infrastructure connections
  await Promise.allSettled([
    queryClient.end(),
    redisClient.quit(),
    erpQueue.close(),
  ]);

  console.log("[Server] All connections closed. Goodbye.");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

export default serverConfig;
