import { pgTable, serial, integer, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { campaignsTable } from "./campaigns";
import { campaignRunsTable } from "./campaign-runs";
import { leadsTable } from "./leads";

export const leadCrawlAttemptsTable = pgTable("lead_crawl_attempts", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  campaignId: integer("campaign_id").notNull().references(() => campaignsTable.id, { onDelete: "cascade" }),
  campaignRunId: integer("campaign_run_id").references(() => campaignRunsTable.id, { onDelete: "cascade" }),
  httpStatus: text("http_status").notNull().default("pending"),
  httpFailureCategory: text("http_failure_category"),
  httpError: text("http_error"),
  httpStartedAt: timestamp("http_started_at", { withTimezone: true }),
  httpCompletedAt: timestamp("http_completed_at", { withTimezone: true }),
  browserStatus: text("browser_status").notNull().default("not_needed"),
  browserError: text("browser_error"),
  browserQueuedAt: timestamp("browser_queued_at", { withTimezone: true }),
  browserStartedAt: timestamp("browser_started_at", { withTimezone: true }),
  browserCompletedAt: timestamp("browser_completed_at", { withTimezone: true }),
  finalStatus: text("final_status"),
  finalCrawler: text("final_crawler"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  unique("lead_crawl_attempts_lead_unique").on(table.leadId),
  uniqueIndex("lead_crawl_attempts_one_browser_running_idx")
    .on(table.browserStatus)
    .where(sql`${table.browserStatus} = 'running'`),
]);

export type LeadCrawlAttempt = typeof leadCrawlAttemptsTable.$inferSelect;
