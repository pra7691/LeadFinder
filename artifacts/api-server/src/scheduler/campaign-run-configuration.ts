import {
  db,
  campaignCountriesTable,
  campaignEmailAccountsTable,
  campaignKeywordsTable,
  campaignsTable,
  emailTemplatesTable,
  type CampaignRunConfigurationSnapshot,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAISettings } from "../services/ai-settings";
import { buildCampaignRunConfiguration } from "./campaign-run-configuration-core";
export {
  buildCampaignRunConfiguration,
  buildRerunName,
  buildRerunValues,
  campaignFromRunConfiguration,
  isCampaignRunConfigurationSnapshot,
  isTerminalRerunStatus,
  RERUN_PIPELINE_OPTIONS,
  shouldSkipRefresh,
  templateFromRunConfiguration,
} from "./campaign-run-configuration-core";

type Campaign = typeof campaignsTable.$inferSelect;

export async function captureCampaignRunConfiguration(
  campaign: Campaign,
): Promise<CampaignRunConfigurationSnapshot> {
  const [keywords, locations, senderAccounts, ai, selectedTemplates] = await Promise.all([
    db.select({ value: campaignKeywordsTable.keyword })
      .from(campaignKeywordsTable)
      .where(eq(campaignKeywordsTable.campaignId, campaign.id)),
    db.select({ value: campaignCountriesTable.country })
      .from(campaignCountriesTable)
      .where(eq(campaignCountriesTable.campaignId, campaign.id)),
    db.select({ id: campaignEmailAccountsTable.emailAccountId })
      .from(campaignEmailAccountsTable)
      .where(eq(campaignEmailAccountsTable.campaignId, campaign.id)),
    getAISettings(),
    campaign.emailTemplateId
      ? db.select()
        .from(emailTemplatesTable)
        .where(eq(emailTemplatesTable.id, campaign.emailTemplateId))
        .limit(1)
      : Promise.resolve([]),
  ]);

  const senderAccountIds = senderAccounts.map((row) => row.id);
  const selectedTemplate = selectedTemplates[0];

  return buildCampaignRunConfiguration(campaign, {
    keywords: keywords.map((row) => row.value),
    locations: locations.map((row) => row.value),
    senderAccountIds,
    emailTemplate: selectedTemplate ? {
      id: selectedTemplate.id,
      name: selectedTemplate.name,
      subject: selectedTemplate.subject,
      body: selectedTemplate.body,
      sendFormat: selectedTemplate.sendFormat === "html" ? "html" : "plain_text",
      personalizationPrompt: selectedTemplate.personalizationPrompt,
      attachmentsJson: selectedTemplate.attachmentsJson,
      unsubscribeFooter: campaign.unsubscribeFooter,
      sourceUpdatedAt: selectedTemplate.updatedAt.toISOString(),
    } : null,
    ai: {
      personalizationEnabled: ai.enabled,
      scoringEnabled: ai.scoringEnabled,
      model: ai.model,
    },
  });
}
