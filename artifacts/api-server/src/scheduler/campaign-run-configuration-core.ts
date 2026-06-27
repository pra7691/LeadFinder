import type { CampaignRunConfigurationSnapshot, EmailTemplateSnapshot } from "@workspace/db";

export type CampaignConfigurationSource = CampaignRunConfigurationSnapshot["campaign"];

export interface CampaignRunConfigurationInputs {
  keywords: string[];
  locations: string[];
  senderAccountIds: number[];
  emailTemplate: EmailTemplateSnapshot | null;
  ai: CampaignRunConfigurationSnapshot["ai"];
}

export function buildCampaignRunConfiguration(
  campaign: CampaignConfigurationSource,
  inputs: CampaignRunConfigurationInputs,
  capturedAt = new Date().toISOString(),
): CampaignRunConfigurationSnapshot {
  return {
    version: 1,
    capturedAt,
    campaign: {
      name: campaign.name,
      objective: campaign.objective,
      minRelevanceScore: campaign.minRelevanceScore,
      maxSearchesPerDay: campaign.maxSearchesPerDay,
      maxEmailsPerDay: campaign.maxEmailsPerDay,
      resultsPerSearch: campaign.resultsPerSearch,
      discoveryInputMode: campaign.discoveryInputMode,
      uploadedDomains: campaign.uploadedDomains,
      uploadedDomainsApplyBlockLogic: campaign.uploadedDomainsApplyBlockLogic,
      queryRefreshDays: campaign.queryRefreshDays,
      discoverySourceRefreshDays: campaign.discoverySourceRefreshDays,
      subjectTemplate: campaign.subjectTemplate,
      emailTemplate: campaign.emailTemplate,
      unsubscribeFooter: campaign.unsubscribeFooter,
      emailTemplateId: campaign.emailTemplateId,
      crawlPaths: campaign.crawlPaths,
      internalLinkKeywords: campaign.internalLinkKeywords,
      maxPagesPerDomain: campaign.maxPagesPerDomain,
      maxCrawlDepth: campaign.maxCrawlDepth,
    },
    keywords: [...inputs.keywords],
    locations: [...inputs.locations],
    senderAccountIds: [...inputs.senderAccountIds],
    emailTemplate: inputs.emailTemplate ? { ...inputs.emailTemplate } : null,
    ai: { ...inputs.ai },
    automation: {
      autoListEnabled: true,
      autoOutreachEnabled: inputs.emailTemplate != null && inputs.senderAccountIds.length > 0,
    },
  };
}

export function campaignFromRunConfiguration<T extends CampaignConfigurationSource>(
  currentCampaign: T,
  snapshot: CampaignRunConfigurationSnapshot,
): T {
  return {
    ...currentCampaign,
    ...snapshot.campaign,
  };
}

export function isCampaignRunConfigurationSnapshot(
  value: unknown,
): value is CampaignRunConfigurationSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<CampaignRunConfigurationSnapshot>;
  return snapshot.version === 1 &&
    !!snapshot.campaign &&
    typeof snapshot.campaign.name === "string" &&
    typeof snapshot.campaign.objective === "string" &&
    Array.isArray(snapshot.keywords) &&
    Array.isArray(snapshot.locations) &&
    Array.isArray(snapshot.senderAccountIds) &&
    (snapshot.emailTemplate === null || isEmailTemplateSnapshot(snapshot.emailTemplate)) &&
    !!snapshot.ai &&
    !!snapshot.automation;
}

export function buildRerunName(sourceName: string | null, sourceId: number, rerunNumber: number): string {
  const baseName = sourceName?.trim() || `Run #${sourceId}`;
  return `${baseName} — Rerun ${rerunNumber}`;
}

export function isTerminalRerunStatus(status: string): boolean {
  return ["completed", "partial", "failed", "cancelled"].includes(status);
}

export const RERUN_PIPELINE_OPTIONS = {
  forceDiscoveryRefresh: true,
  forceDiscoverySourceRefresh: true,
  skipDiscovery: false,
} as const;

export function isEmailTemplateSnapshot(value: unknown): value is EmailTemplateSnapshot {
  if (!value || typeof value !== "object") return false;
  const template = value as Partial<EmailTemplateSnapshot>;
  return typeof template.id === "number" &&
    typeof template.name === "string" &&
    typeof template.subject === "string" &&
    typeof template.body === "string" &&
    (template.sendFormat === "plain_text" || template.sendFormat === "html") &&
    (template.personalizationPrompt === null || typeof template.personalizationPrompt === "string") &&
    (template.attachmentsJson === null || typeof template.attachmentsJson === "string") &&
    (template.unsubscribeFooter === null || typeof template.unsubscribeFooter === "string") &&
    typeof template.sourceUpdatedAt === "string";
}

export function templateFromRunConfiguration(
  snapshot: CampaignRunConfigurationSnapshot | null | undefined,
): EmailTemplateSnapshot | null {
  return snapshot?.emailTemplate ? { ...snapshot.emailTemplate } : null;
}

export function shouldSkipRefresh(
  nextRefreshAt: Date | null | undefined,
  now: Date,
  forceRefresh: boolean | undefined,
): boolean {
  return !forceRefresh && !!nextRefreshAt && nextRefreshAt > now;
}

export function buildRerunValues(
  sourceRun: {
    id: number;
    campaignId: number;
    runName: string | null;
    status: string;
    configurationSnapshot: unknown;
  },
  rerunNumber: number,
  requestKey: string,
) {
  if (!isTerminalRerunStatus(sourceRun.status)) {
    throw new Error(`Only terminal runs can be rerun. This run is ${sourceRun.status}.`);
  }
  if (!isCampaignRunConfigurationSnapshot(sourceRun.configurationSnapshot)) {
    throw new Error("This older run has no saved configuration, so it cannot be rerun exactly.");
  }
  return {
    campaignId: sourceRun.campaignId,
    runName: buildRerunName(sourceRun.runName, sourceRun.id, rerunNumber),
    runType: "manual" as const,
    status: "running" as const,
    currentStage: "searching",
    configurationSnapshot: sourceRun.configurationSnapshot,
    rerunOfRunId: sourceRun.id,
    rerunNumber,
    rerunRequestKey: requestKey,
  };
}
