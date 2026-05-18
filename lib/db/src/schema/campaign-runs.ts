import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { campaignsTable } from "./campaigns";

export const campaignRunsTable = pgTable("campaign_runs", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id")
    .notNull()
    .references(() => campaignsTable.id, { onDelete: "cascade" }),
  runName: text("run_name"),
  runType: text("run_type").notNull().default("manual"), // manual | scheduled
  status: text("status").notNull().default("running"),   // running | completed | failed | partial
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  totalSearches: integer("total_searches").notNull().default(0),
  totalSearchesSkipped: integer("total_searches_skipped").notNull().default(0),
  totalResults: integer("total_results").notNull().default(0),
  totalResultsSeenBefore: integer("total_results_seen_before").notNull().default(0),
  totalNewLeads: integer("total_new_leads").notNull().default(0),
  totalDuplicates: integer("total_duplicates").notNull().default(0),
  totalBlocked: integer("total_blocked").notNull().default(0),
  totalRejected: integer("total_rejected").notNull().default(0),
  totalDiscoverySourcesFound: integer("total_discovery_sources_found").notNull().default(0),
  totalDiscoverySourcesMined: integer("total_discovery_sources_mined").notNull().default(0),
  totalDiscoverySourcesSkipped: integer("total_discovery_sources_skipped").notNull().default(0),
  errorMessage: text("error_message"),
  metadataJson: text("metadata_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CampaignRun = typeof campaignRunsTable.$inferSelect;
