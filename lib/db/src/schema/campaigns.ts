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
  maxLeadsPerDay: integer("max_leads_per_day").notNull().default(50),
  maxEmailsPerDay: integer("max_emails_per_day").notNull().default(20),
  emailTemplate: text("email_template"),
  unsubscribeFooter: text("unsubscribe_footer"),
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
