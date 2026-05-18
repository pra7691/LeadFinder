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

export const searchQueryHistoryTable = pgTable(
  "search_query_history",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaignsTable.id, { onDelete: "cascade" }),
    campaignRunId: integer("campaign_run_id").references(
      () => campaignRunsTable.id,
      { onDelete: "set null" },
    ),
    query: text("query").notNull(),
    keyword: text("keyword").notNull().default(""),
    country: text("country").notNull().default(""),
    searchedAt: timestamp("searched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resultCount: integer("result_count").notNull().default(0),
    newLeadsCount: integer("new_leads_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    blockedCount: integer("blocked_count").notNull().default(0),
    discoverySourceCount: integer("discovery_source_count").notNull().default(0),
    status: text("status").notNull().default("completed"),
    nextRefreshAt: timestamp("next_refresh_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("sqh_campaign_query_unique").on(t.campaignId, t.query)],
);

export type SearchQueryHistory = typeof searchQueryHistoryTable.$inferSelect;
