import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const campaignsTable = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  objective: text("objective").notNull().default(""),
  isActive: boolean("is_active").notNull().default(true),
  minRelevanceScore: integer("min_relevance_score").notNull().default(50),
  maxSearchesPerDay: integer("max_searches_per_day").notNull().default(100),
  maxEmailsPerDay: integer("max_emails_per_day").notNull().default(20),
  resultsPerSearch: integer("results_per_search").notNull().default(10),
  queryRefreshDays: integer("query_refresh_days").notNull().default(30),
  discoverySourceRefreshDays: integer("discovery_source_refresh_days").notNull().default(30),
  subjectTemplate: text("subject_template"),
  emailTemplate: text("email_template"),
  unsubscribeFooter: text("unsubscribe_footer"),
  // ── Crawler configuration (per-campaign) ──
  // Newline-separated path list. Crawled first, before internal-link expansion.
  crawlPaths: text("crawl_paths").notNull().default("/\n/contact\n/contact-us\n/about\n/about-us\n/team"),
  // Newline-separated keywords. Internal links whose URL or anchor text contains
  // one of these (case-insensitive) are eligible for follow-up crawling.
  internalLinkKeywords: text("internal_link_keywords").notNull().default(
    "contact\nabout\nteam\npeople\nresearch\nproject\nprojects\nlab\nlabs\nfaculty\npublication\npublications\nrobotics\nvision\nperception\negocentric\nembodied\ndataset"
  ),
  // Hard cap on total pages crawled per lead (configured paths + followed links).
  maxPagesPerDomain: integer("max_pages_per_domain").notNull().default(10),
  // 0 = only the configured paths. 1 = paths + their internal links. 2 = paths + links + links-of-links.
  maxCrawlDepth: integer("max_crawl_depth").notNull().default(1),
  // Scheduler fields
  scheduleType: text("schedule_type").notNull().default("manual"), // manual | daily | weekly
  scheduleDays: text("schedule_days"), // weekly: comma-sep "mon,wed,fri"
  scheduleTime: text("schedule_time"), // "09:00" 24h
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastRunStatus: text("last_run_status").notNull().default("idle"), // idle | running | success | partial | failed | cancelled
  isPaused: boolean("is_paused").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Campaign = typeof campaignsTable.$inferSelect;
