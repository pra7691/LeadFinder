import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  real,
  jsonb,
  unique,
  AnyPgColumn,
} from "drizzle-orm/pg-core";
import { campaignsTable } from "./campaigns";
import { leadListsTable } from "./lead-lists";
import type { CampaignRunConfigurationSnapshot } from "./campaign-run-configuration";

export const campaignRunsTable = pgTable("campaign_runs", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id")
    .notNull()
    .references(() => campaignsTable.id, { onDelete: "cascade" }),
  runName: text("run_name"),
  runType: text("run_type").notNull().default("manual"), // manual | scheduled
  status: text("status").notNull().default("running"),   // running | completed | failed | partial | cancelled
  currentStage: text("current_stage"),                    // searching | processing_results | creating_leads | crawling | scoring | completed | partial | failed | cancelled
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
  durationSeconds: integer("duration_seconds"),
  estimatedRemainingSeconds: integer("estimated_remaining_seconds"),
  estimatedCompletionAt: timestamp("estimated_completion_at", { withTimezone: true }),
  progressPercent: real("progress_percent").notNull().default(0),
  totalWorkUnits: integer("total_work_units").notNull().default(0),
  completedWorkUnits: integer("completed_work_units").notNull().default(0),
  finalListId: integer("final_list_id").references(() => leadListsTable.id, { onDelete: "set null" }),
  configurationSnapshot: jsonb("configuration_snapshot").$type<CampaignRunConfigurationSnapshot>(),
  rerunOfRunId: integer("rerun_of_run_id").references(
    (): AnyPgColumn => campaignRunsTable.id,
    { onDelete: "set null" },
  ),
  rerunNumber: integer("rerun_number"),
  rerunRequestKey: text("rerun_request_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("campaign_runs_rerun_source_number_unique").on(t.rerunOfRunId, t.rerunNumber),
  unique("campaign_runs_rerun_request_key_unique").on(t.rerunRequestKey),
]);

export type CampaignRun = typeof campaignRunsTable.$inferSelect;
