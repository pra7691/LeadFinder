export interface EmailTemplateSnapshot {
  id: number;
  name: string;
  subject: string;
  body: string;
  sendFormat: "plain_text" | "html";
  personalizationPrompt: string | null;
  attachmentsJson: string | null;
  unsubscribeFooter: string | null;
  sourceUpdatedAt: string;
}

export interface CampaignRunConfigurationSnapshot {
  version: 1;
  capturedAt: string;
  campaign: {
    name: string;
    objective: string;
    minRelevanceScore: number;
    maxSearchesPerDay: number;
    maxEmailsPerDay: number;
    resultsPerSearch: number;
    discoveryInputMode: string;
    uploadedDomains: string;
    uploadedDomainsApplyBlockLogic: boolean;
    queryRefreshDays: number;
    discoverySourceRefreshDays: number;
    subjectTemplate: string | null;
    emailTemplate: string | null;
    unsubscribeFooter: string | null;
    emailTemplateId: number | null;
    crawlPaths: string;
    internalLinkKeywords: string;
    maxPagesPerDomain: number;
    maxCrawlDepth: number;
  };
  keywords: string[];
  locations: string[];
  senderAccountIds: number[];
  emailTemplate: EmailTemplateSnapshot | null;
  ai: {
    personalizationEnabled: boolean;
    scoringEnabled: boolean;
    model: string;
  };
  automation: {
    autoListEnabled: boolean;
    autoOutreachEnabled: boolean;
  };
}
