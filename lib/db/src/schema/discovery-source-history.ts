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

export const discoverySourceHistoryTable = pgTable(
  "discovery_source_history",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaignsTable.id, { onDelete: "cascade" }),
    campaignRunId: integer("campaign_run_id").references(
      () => campaignRunsTable.id,
      { onDelete: "set null" },
    ),
    sourceUrl: text("source_url").notNull(),
    sourceDomain: text("source_domain").notNull().default(""),
    minedAt: timestamp("mined_at", { withTimezone: true }).notNull().defaultNow(),
    companiesFound: integer("companies_found").notNull().default(0),
    newCompanyLeads: integer("new_company_leads").notNull().default(0),
    duplicateCompanyLeads: integer("duplicate_company_leads").notNull().default(0),
    blockedLinks: integer("blocked_links").notNull().default(0),
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
  (t) => [unique("dsh_campaign_url_unique").on(t.campaignId, t.sourceUrl)],
);

export type DiscoverySourceHistory =
  typeof discoverySourceHistoryTable.$inferSelect;
