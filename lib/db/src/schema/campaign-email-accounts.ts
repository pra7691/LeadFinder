import { pgTable, serial, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { campaignsTable } from "./campaigns";
import { emailAccountsTable } from "./email-accounts";

export const campaignEmailAccountsTable = pgTable("campaign_email_accounts", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id")
    .notNull()
    .references(() => campaignsTable.id, { onDelete: "cascade" }),
  emailAccountId: integer("email_account_id")
    .notNull()
    .references(() => emailAccountsTable.id, { onDelete: "cascade" }),
});

export const insertCampaignEmailAccountSchema = createInsertSchema(
  campaignEmailAccountsTable,
).omit({ id: true });
export type InsertCampaignEmailAccount = z.infer<
  typeof insertCampaignEmailAccountSchema
>;
export type CampaignEmailAccount =
  typeof campaignEmailAccountsTable.$inferSelect;
