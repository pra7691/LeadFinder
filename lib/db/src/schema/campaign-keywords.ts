import { pgTable, serial, integer, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { campaignsTable } from "./campaigns";

export const campaignKeywordsTable = pgTable("campaign_keywords", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id")
    .notNull()
    .references(() => campaignsTable.id, { onDelete: "cascade" }),
  keyword: text("keyword").notNull(),
});

export const insertCampaignKeywordSchema = createInsertSchema(
  campaignKeywordsTable,
).omit({ id: true });
export type InsertCampaignKeyword = z.infer<typeof insertCampaignKeywordSchema>;
export type CampaignKeyword = typeof campaignKeywordsTable.$inferSelect;
