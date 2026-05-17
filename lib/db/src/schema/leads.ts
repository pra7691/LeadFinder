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

export const leadsTable = pgTable(
  "leads",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaignsTable.id, { onDelete: "cascade" }),
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
    emailStatus: text("email_status"),
    notes: text("notes"),
    sourceKeyword: text("source_keyword"),
    sourceCountry: text("source_country"),
    sourceQuery: text("source_query"),
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
