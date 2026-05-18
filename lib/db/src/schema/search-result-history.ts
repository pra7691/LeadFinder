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
import { searchQueryHistoryTable } from "./search-query-history";

export const searchResultHistoryTable = pgTable(
  "search_result_history",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaignsTable.id, { onDelete: "cascade" }),
    campaignRunId: integer("campaign_run_id").references(
      () => campaignRunsTable.id,
      { onDelete: "set null" },
    ),
    searchQueryHistoryId: integer("search_query_history_id").references(
      () => searchQueryHistoryTable.id,
      { onDelete: "set null" },
    ),
    query: text("query").notNull().default(""),
    resultUrl: text("result_url").notNull(),
    rootDomain: text("root_domain").notNull().default(""),
    resultTitle: text("result_title"),
    resultSnippet: text("result_snippet"),
    resultPosition: integer("result_position"),
    resultType: text("result_type").notNull().default("direct"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    timesSeen: integer("times_seen").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("srh_campaign_url_unique").on(t.campaignId, t.resultUrl)],
);

export type SearchResultHistory = typeof searchResultHistoryTable.$inferSelect;
