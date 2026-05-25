import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { outreachQueueTable } from "./outreach-queue";

export const unsubscribesTable = pgTable("unsubscribes", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  token: text("token").notNull().unique(),
  outreachId: integer("outreach_id").references(() => outreachQueueTable.id, { onDelete: "set null" }),
  companyName: text("company_name"),
  unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUnsubscribeSchema = createInsertSchema(unsubscribesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertUnsubscribe = z.infer<typeof insertUnsubscribeSchema>;
export type Unsubscribe = typeof unsubscribesTable.$inferSelect;
