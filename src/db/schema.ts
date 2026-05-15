import { pgTable, pgEnum, text, integer, numeric, uuid, timestamp, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// =============================================================================
// ENUMS
// =============================================================================

/**
 * Transaction status lifecycle:
 * PENDING → created when payment is initiated
 * PAID    → set when Xendit webhook confirms payment
 * FAILED  → set if payment expires or fails
 */
export const transactionStatusEnum = pgEnum("transaction_status", [
  "PENDING",
  "PAID",
  "FAILED",
]);

// =============================================================================
// TABLES
// =============================================================================

/**
 * user_detail
 * Stores basic user information. Users are upserted by phone on payment initiation.
 */
export const userDetail = pgTable("user_detail", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  address: text("address").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * transactions
 * Each record represents a single payment attempt.
 * The UUID `id` is used as Xendit's `external_id` for direct correlation.
 */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: integer("user_id")
      .notNull()
      .references(() => userDetail.id),
    xenditExternalId: text("xendit_external_id").notNull().unique(),
    xenditInvoiceId: text("xendit_invoice_id"),
    status: transactionStatusEnum("status").notNull().default("PENDING"),
    totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).notNull(),
    invoiceUrl: text("invoice_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("transactions_user_id_idx").on(table.userId),
    index("transactions_xendit_external_id_idx").on(table.xenditExternalId),
    index("transactions_status_idx").on(table.status),
  ]
);

/**
 * user_items
 * Line items associated with a transaction.
 * `granted_at` is set to the payment timestamp when the transaction is marked PAID.
 */
export const userItems = pgTable(
  "user_items",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id),
    itemCode: text("item_code").notNull(),
    itemName: text("item_name").notNull(),
    quantity: integer("quantity").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }),
  },
  (table) => [
    index("user_items_transaction_id_idx").on(table.transactionId),
  ]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const userDetailRelations = relations(userDetail, ({ many }) => ({
  transactions: many(transactions),
}));

export const transactionsRelations = relations(transactions, ({ one, many }) => ({
  user: one(userDetail, {
    fields: [transactions.userId],
    references: [userDetail.id],
  }),
  items: many(userItems),
}));

export const userItemsRelations = relations(userItems, ({ one }) => ({
  transaction: one(transactions, {
    fields: [userItems.transactionId],
    references: [transactions.id],
  }),
}));
