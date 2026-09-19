ALTER TABLE "user_detail" ADD COLUMN "email" text;--> statement-breakpoint
UPDATE "user_detail" SET "email" = '' WHERE "email" IS NULL;--> statement-breakpoint
ALTER TABLE "user_detail" ALTER COLUMN "email" SET NOT NULL;