import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { campaignsTable } from "./campaigns";
import { leadsTable } from "./leads";
import { emailAccountsTable } from "./email-accounts";

export const outreachQueueTable = pgTable("outreach_queue", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id")
    .notNull()
    .references(() => campaignsTable.id, { onDelete: "cascade" }),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leadsTable.id, { onDelete: "cascade" }),
  emailAccountId: integer("email_account_id").references(
    () => emailAccountsTable.id,
    { onDelete: "set null" },
  ),
  recipientEmail: text("recipient_email").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("draft"),
  failureReason: text("failure_reason"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertOutreachQueueSchema = createInsertSchema(
  outreachQueueTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOutreachQueue = z.infer<typeof insertOutreachQueueSchema>;
export type OutreachQueue = typeof outreachQueueTable.$inferSelect;
