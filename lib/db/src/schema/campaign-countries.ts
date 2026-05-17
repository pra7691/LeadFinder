import { pgTable, serial, integer, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { campaignsTable } from "./campaigns";

export const campaignCountriesTable = pgTable("campaign_countries", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id")
    .notNull()
    .references(() => campaignsTable.id, { onDelete: "cascade" }),
  country: text("country").notNull(),
});

export const insertCampaignCountrySchema = createInsertSchema(
  campaignCountriesTable,
).omit({ id: true });
export type InsertCampaignCountry = z.infer<typeof insertCampaignCountrySchema>;
export type CampaignCountry = typeof campaignCountriesTable.$inferSelect;
