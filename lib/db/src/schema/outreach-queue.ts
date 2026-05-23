import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { campaignsTable } from "./campaigns";
import { leadsTable } from "./leads";
import { emailAccountsTable } from "./email-accounts";
import { emailTemplatesTable } from "./email-templates";
import { leadListsTable } from "./lead-lists";

export const outreachQueueTable = pgTable("outreach_queue", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id")
    .references(() => campaignsTable.id, { onDelete: "set null" }),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leadsTable.id, { onDelete: "cascade" }),
  emailAccountId: integer("email_account_id").references(
    () => emailAccountsTable.id,
    { onDelete: "set null" },
  ),
  emailTemplateId: integer("email_template_id").references(
    () => emailTemplatesTable.id,
    { onDelete: "set null" },
  ),
  listId: integer("list_id").references(
    () => leadListsTable.id,
    { onDelete: "set null" },
  ),
  recipientEmail: text("recipient_email").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  batchId: text("batch_id"),
  status: text("status").notNull().default("pending_review"),
  aiPersonalized: boolean("ai_personalized").notNull().default(false),
  failureReason: text("failure_reason"),
  retryCount: integer("retry_count").notNull().default(0),
  trackingId: text("tracking_id"),
  openCount: integer("open_count").notNull().default(0),
  clickCount: integer("click_count").notNull().default(0),
  firstOpenedAt: timestamp("first_opened_at", { withTimezone: true }),
  lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
  lastClickedAt: timestamp("last_clicked_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  bouncedAt: timestamp("bounced_at", { withTimezone: true }),
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
