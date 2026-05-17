import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leadsTable } from "./leads";

export const leadStatusHistoryTable = pgTable("lead_status_history", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leadsTable.id, { onDelete: "cascade" }),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  fromReviewStatus: text("from_review_status"),
  toReviewStatus: text("to_review_status"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertLeadStatusHistorySchema = createInsertSchema(
  leadStatusHistoryTable,
).omit({ id: true, createdAt: true });
export type InsertLeadStatusHistory = z.infer<
  typeof insertLeadStatusHistorySchema
>;
export type LeadStatusHistory = typeof leadStatusHistoryTable.$inferSelect;
