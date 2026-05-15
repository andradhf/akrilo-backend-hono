import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "../lib/env";

/**
 * Standalone migration runner.
 * Run with: bun run src/db/migrate.ts
 *
 * Uses a dedicated connection (max: 1) to run migrations sequentially,
 * then exits the process.
 */
async function runMigrations() {
  console.log("🔄 Running database migrations...");

  const migrationClient = postgres(env.DATABASE_URL, { max: 1 });
  const db = drizzle(migrationClient);

  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("✅ Migrations completed successfully");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  } finally {
    await migrationClient.end();
  }
}

runMigrations();
