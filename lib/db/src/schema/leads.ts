import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { campaignsTable } from "./campaigns";
import { campaignRunsTable } from "./campaign-runs";

export const leadsTable = pgTable(
  "leads",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaignsTable.id, { onDelete: "cascade" }),
    campaignRunId: integer("campaign_run_id").references(
      () => campaignRunsTable.id,
      { onDelete: "set null" },
    ),
    companyName: text("company_name").notNull(),
    rootDomain: text("root_domain").notNull(),
    websiteUrl: text("website_url").notNull(),
    country: text("country"),
    emails: text("emails"),
    phoneNumbers: text("phone_numbers"),
    address: text("address"),
    linkedinUrl: text("linkedin_url"),
    relevanceScore: integer("relevance_score"),
    relevanceReason: text("relevance_reason"),
    contactQuality: text("contact_quality"),
    leadStatus: text("lead_status").notNull().default("new"),
    reviewStatus: text("review_status").notNull().default("pending"),
    qualificationStatus: text("qualification_status").notNull().default("unqualified"),
    outreachStatus: text("outreach_status").notNull().default("not_queued"),
    emailStatus: text("email_status"),
    notes: text("notes"),
    sourceKeyword: text("source_keyword"),
    sourceCountry: text("source_country"),
    sourceQuery: text("source_query"),
    sourceType: text("source_type").default("direct"), // "direct" | "mined"
    discoverySourceDomain: text("discovery_source_domain"),
    discoverySourceUrl: text("discovery_source_url"),
    crawlStatus: text("crawl_status").default("pending"),
    crawlError: text("crawl_error"),
    rawText: text("raw_text"),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("leads_campaign_domain_unique").on(t.campaignId, t.rootDomain)],
);

export const insertLeadSchema = createInsertSchema(leadsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leadsTable.$inferSelect;
