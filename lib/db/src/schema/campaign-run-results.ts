import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { campaignRunsTable } from "./campaign-runs";
import { campaignsTable } from "./campaigns";

export const campaignRunResultsTable = pgTable("campaign_run_results", {
  id: serial("id").primaryKey(),
  campaignRunId: integer("campaign_run_id")
    .notNull()
    .references(() => campaignRunsTable.id, { onDelete: "cascade" }),
  campaignId: integer("campaign_id")
    .notNull()
    .references(() => campaignsTable.id, { onDelete: "cascade" }),
  resultStatus: text("result_status").notNull(), // lead_created | blocked | duplicate | rejected | skipped_recent
  title: text("title"),
  url: text("url"),
  rootDomain: text("root_domain"),
  sourceQuery: text("source_query"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CampaignRunResult = typeof campaignRunResultsTable.$inferSelect;
