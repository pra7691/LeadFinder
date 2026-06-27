import { describe, expect, it } from "vitest";
import {
  buildCampaignRunConfiguration,
  buildRerunName,
  buildRerunValues,
  campaignFromRunConfiguration,
  isCampaignRunConfigurationSnapshot,
  RERUN_PIPELINE_OPTIONS,
  shouldSkipRefresh,
  templateFromRunConfiguration,
  type CampaignConfigurationSource,
} from "./campaign-run-configuration-core";

type Campaign = CampaignConfigurationSource & {
  id: number;
  isActive: boolean;
  scheduleType: string;
  scheduleDays: string | null;
  scheduleTime: string | null;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastRunStatus: string;
  isPaused: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 7,
    name: "Historical campaign",
    objective: "Find exact-fit data buyers",
    isActive: true,
    minRelevanceScore: 65,
    maxSearchesPerDay: 90,
    maxEmailsPerDay: 20,
    resultsPerSearch: 50,
    discoveryInputMode: "search",
    uploadedDomains: "",
    uploadedDomainsApplyBlockLogic: true,
    queryRefreshDays: 14,
    discoverySourceRefreshDays: 21,
    subjectTemplate: null,
    emailTemplate: null,
    unsubscribeFooter: null,
    emailTemplateId: 11,
    crawlPaths: "/\n/contact\n/about",
    internalLinkKeywords: "contact\nteam\nresearch",
    maxPagesPerDomain: 75,
    maxCrawlDepth: 2,
    scheduleType: "manual",
    scheduleDays: null,
    scheduleTime: null,
    nextRunAt: null,
    lastRunAt: null,
    lastRunStatus: "idle",
    isPaused: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

const inputs = {
  keywords: ["video training data", "multimodal datasets"],
  locations: ["United States", "London"],
  senderAccountIds: [4, 9],
  emailTemplate: {
    id: 11,
    name: "Original outreach template",
    subject: "Original subject for {{company_name}}",
    body: "<p>Original body</p>",
    sendFormat: "html" as const,
    personalizationPrompt: "Keep the introduction specific.",
    attachmentsJson: "[]",
    unsubscribeFooter: "Original unsubscribe footer",
    sourceUpdatedAt: "2026-01-15T10:00:00.000Z",
  },
  ai: {
    personalizationEnabled: true,
    scoringEnabled: true,
    model: "gpt-4o-mini",
  },
};

describe("campaign run configuration snapshots", () => {
  it("stores the complete immutable run-affecting configuration for a normal run", () => {
    const snapshot = buildCampaignRunConfiguration(
      campaign(),
      inputs,
      "2026-02-01T10:00:00.000Z",
    );

    expect(snapshot).toMatchObject({
      version: 1,
      capturedAt: "2026-02-01T10:00:00.000Z",
      campaign: {
        name: "Historical campaign",
        objective: "Find exact-fit data buyers",
        minRelevanceScore: 65,
        maxSearchesPerDay: 90,
        maxEmailsPerDay: 20,
        resultsPerSearch: 50,
        queryRefreshDays: 14,
        discoverySourceRefreshDays: 21,
        emailTemplateId: 11,
        maxPagesPerDomain: 75,
        maxCrawlDepth: 2,
      },
      keywords: inputs.keywords,
      locations: inputs.locations,
      senderAccountIds: inputs.senderAccountIds,
      emailTemplate: inputs.emailTemplate,
      ai: inputs.ai,
      automation: { autoListEnabled: true, autoOutreachEnabled: true },
    });
    expect(isCampaignRunConfigurationSnapshot(snapshot)).toBe(true);
  });

  it("materializes the saved settings instead of modified current campaign settings", () => {
    const original = campaign();
    const snapshot = buildCampaignRunConfiguration(original, inputs);
    const current = campaign({
      name: "Changed later",
      objective: "A different objective",
      minRelevanceScore: 5,
      resultsPerSearch: 3,
      maxPagesPerDomain: 2,
      emailTemplateId: 99,
    });

    const runtime = campaignFromRunConfiguration(current, snapshot);
    expect(runtime.name).toBe(original.name);
    expect(runtime.objective).toBe(original.objective);
    expect(runtime.minRelevanceScore).toBe(original.minRelevanceScore);
    expect(runtime.resultsPerSearch).toBe(original.resultsPerSearch);
    expect(runtime.maxPagesPerDomain).toBe(original.maxPagesPerDomain);
    expect(runtime.emailTemplateId).toBe(original.emailTemplateId);
    expect(runtime.isActive).toBe(current.isActive);
    expect(runtime.isPaused).toBe(current.isPaused);
  });
});

describe("historical rerun planning", () => {
  it("creates a distinct fresh-discovery run linked to the unchanged source snapshot", () => {
    const snapshot = buildCampaignRunConfiguration(campaign(), inputs);
    const source = {
      id: 51,
      campaignId: 7,
      runName: "Indonesia Recruitment",
      status: "completed",
      configurationSnapshot: snapshot,
    };
    const sourceBefore = structuredClone(source);

    const values = buildRerunValues(source, 1, "request-key-0001");

    expect(values).toMatchObject({
      campaignId: 7,
      runName: "Indonesia Recruitment — Rerun 1",
      runType: "manual",
      status: "running",
      currentStage: "searching",
      rerunOfRunId: 51,
      rerunNumber: 1,
      rerunRequestKey: "request-key-0001",
      configurationSnapshot: snapshot,
    });
    expect(RERUN_PIPELINE_OPTIONS).toEqual({
      forceDiscoveryRefresh: true,
      forceDiscoverySourceRefresh: true,
      skipDiscovery: false,
    });
    expect(source).toEqual(sourceBefore);
  });

  it("numbers repeated reruns clearly", () => {
    expect(buildRerunName("Original Run", 51, 1)).toBe("Original Run — Rerun 1");
    expect(buildRerunName("Original Run", 51, 2)).toBe("Original Run — Rerun 2");
  });

  it("rejects legacy runs without a recoverable snapshot", () => {
    expect(() => buildRerunValues({
      id: 12,
      campaignId: 7,
      runName: "Legacy",
      status: "completed",
      configurationSnapshot: null,
    }, 1, "request-key-legacy")).toThrow(
      "This older run has no saved configuration, so it cannot be rerun exactly.",
    );
  });

  it("rejects non-terminal runs", () => {
    const snapshot = buildCampaignRunConfiguration(campaign(), inputs);
    expect(() => buildRerunValues({
      id: 13,
      campaignId: 7,
      runName: "Active",
      status: "running",
      configurationSnapshot: snapshot,
    }, 1, "request-key-active")).toThrow("Only terminal runs can be rerun");
  });

  it("keeps retry identity stable so the database unique key de-duplicates double submits", () => {
    const snapshot = buildCampaignRunConfiguration(campaign(), inputs);
    const source = {
      id: 51,
      campaignId: 7,
      runName: "Original",
      status: "failed",
      configurationSnapshot: snapshot,
    };
    const first = buildRerunValues(source, 1, "stable-request-key");
    const retry = buildRerunValues(source, 1, "stable-request-key");
    expect(retry.rerunRequestKey).toBe(first.rerunRequestKey);
    expect(retry.rerunOfRunId).toBe(first.rerunOfRunId);
    expect(retry.rerunNumber).toBe(first.rerunNumber);
  });

  it("keeps original template content and format after the live template is edited", () => {
    const snapshot = buildCampaignRunConfiguration(campaign(), inputs);
    const editedLiveTemplate = {
      ...inputs.emailTemplate,
      subject: "Edited subject",
      body: "Edited body",
      sendFormat: "plain_text" as const,
    };

    const rerunTemplate = templateFromRunConfiguration(snapshot);
    expect(editedLiveTemplate.subject).toBe("Edited subject");
    expect(rerunTemplate).toMatchObject({
      subject: "Original subject for {{company_name}}",
      body: "<p>Original body</p>",
      sendFormat: "html",
      personalizationPrompt: "Keep the introduction specific.",
    });
  });

  it("keeps the template available when the live template has been deleted", () => {
    const snapshot = buildCampaignRunConfiguration(campaign(), inputs);
    const deletedLiveTemplate = null;
    expect(deletedLiveTemplate).toBeNull();
    expect(templateFromRunConfiguration(snapshot)).toEqual(inputs.emailTemplate);
  });

  it("forces both query and discovery-source refresh for reruns", () => {
    const now = new Date("2026-02-01T00:00:00.000Z");
    const futureRefresh = new Date("2026-03-01T00:00:00.000Z");
    expect(shouldSkipRefresh(futureRefresh, now, RERUN_PIPELINE_OPTIONS.forceDiscoveryRefresh)).toBe(false);
    expect(shouldSkipRefresh(futureRefresh, now, RERUN_PIPELINE_OPTIONS.forceDiscoverySourceRefresh)).toBe(false);
  });

  it("keeps normal refresh-history behavior when no rerun force flag is present", () => {
    const now = new Date("2026-02-01T00:00:00.000Z");
    const futureRefresh = new Date("2026-03-01T00:00:00.000Z");
    expect(shouldSkipRefresh(futureRefresh, now, undefined)).toBe(true);
  });
});
