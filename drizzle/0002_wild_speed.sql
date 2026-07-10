ALTER TABLE "transactions" RENAME COLUMN "xendit_external_id" TO "payment_reference_id";--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_xendit_external_id_unique";--> statement-breakpoint
DROP INDEX "transactions_xendit_external_id_idx";--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "payment_invoice_token" text;--> statement-breakpoint
CREATE INDEX "transactions_payment_reference_id_idx" ON "transactions" USING btree ("payment_reference_id");--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "xendit_invoice_id";--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payment_reference_id_unique" UNIQUE("payment_reference_id");