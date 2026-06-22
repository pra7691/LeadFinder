import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { campaignsTable } from "./campaigns";
import { campaignRunsTable } from "./campaign-runs";
import { leadsTable } from "./leads";
import { emailAccountsTable } from "./email-accounts";
import { emailTemplatesTable } from "./email-templates";

export const campaignRunBatchesTable = pgTable(
  "campaign_run_batches",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaignsTable.id, { onDelete: "cascade" }),
    campaignRunId: integer("campaign_run_id")
      .notNull()
      .references(() => campaignRunsTable.id, { onDelete: "cascade" }),
    batchNumber: integer("batch_number").notNull(),
    status: text("status").notNull().default("claimed"),
    crawledLeadsCount: integer("crawled_leads_count").notNull().default(0),
    scoredCount: integer("scored_count").notNull().default(0),
    qualifiedCount: integer("qualified_count").notNull().default(0),
    outreachDraftsCreated: integer("outreach_drafts_created").notNull().default(0),
    emailTemplateId: integer("email_template_id").references(
      () => emailTemplatesTable.id,
      { onDelete: "set null" },
    ),
    senderAccountId: integer("sender_account_id").references(
      () => emailAccountsTable.id,
      { onDelete: "set null" },
    ),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("campaign_run_batches_run_number_unique").on(
      t.campaignRunId,
      t.batchNumber,
    ),
  ],
);

export const campaignRunBatchItemsTable = pgTable(
  "campaign_run_batch_items",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaignsTable.id, { onDelete: "cascade" }),
    campaignRunId: integer("campaign_run_id")
      .notNull()
      .references(() => campaignRunsTable.id, { onDelete: "cascade" }),
    batchId: integer("batch_id")
      .notNull()
      .references(() => campaignRunBatchesTable.id, { onDelete: "cascade" }),
    leadId: integer("lead_id")
      .notNull()
      .references(() => leadsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("campaign_run_batch_items_run_lead_unique").on(
      t.campaignRunId,
      t.leadId,
    ),
  ],
);

export type CampaignRunBatch = typeof campaignRunBatchesTable.$inferSelect;
export type CampaignRunBatchItem =
  typeof campaignRunBatchItemsTable.$inferSelect;
