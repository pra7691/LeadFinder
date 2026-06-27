import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  isQualifiedNoEmailLead,
  normalizeQualifiedNoEmailPage,
  QUALIFIED_NO_EMAIL_SCORING_METHOD,
  type QualifiedNoEmailCandidate,
} from "./qualified-no-email-core";

const eligible: QualifiedNoEmailCandidate = {
  crawlStatus: "crawled",
  qualificationStatus: "qualified",
  scoringMethod: "ai",
  relevanceScore: 70,
  campaignMinRelevanceScore: 60,
  emails: null,
};

describe("qualified no-email eligibility", () => {
  it("uses the exact AI scoring method", () => {
    expect(QUALIFIED_NO_EMAIL_SCORING_METHOD).toBe("ai");
  });

  it.each([null, "", "   \n  "])("includes eligible leads with no extracted email: %j", (emails) => {
    expect(isQualifiedNoEmailLead({ ...eligible, emails })).toBe(true);
  });

  it("excludes a qualified lead when any nonempty email was extracted", () => {
    expect(isQualifiedNoEmailLead({ ...eligible, emails: "invalid-value" })).toBe(false);
    expect(isQualifiedNoEmailLead({ ...eligible, emails: "person@example.com" })).toBe(false);
  });

  it.each([
    { crawlStatus: "failed" },
    { crawlStatus: "pending" },
    { crawlStatus: "crawling" },
    { scoringMethod: null },
    { scoringMethod: "keyword_fallback" },
    { qualificationStatus: "rejected" },
    { qualificationStatus: "unqualified" },
    { relevanceScore: null },
    { relevanceScore: 59 },
  ] as Array<Partial<QualifiedNoEmailCandidate>>)("excludes ineligible state %#", (override) => {
    expect(isQualifiedNoEmailLead({ ...eligible, ...override })).toBe(false);
  });

  it("uses each campaign's own relevance threshold", () => {
    expect(isQualifiedNoEmailLead({ ...eligible, relevanceScore: 65, campaignMinRelevanceScore: 65 })).toBe(true);
    expect(isQualifiedNoEmailLead({ ...eligible, relevanceScore: 65, campaignMinRelevanceScore: 66 })).toBe(false);
  });
});

describe("qualified no-email pagination", () => {
  it("normalizes defaults, bounds, and offsets", () => {
    expect(normalizeQualifiedNoEmailPage(undefined, undefined)).toEqual({ limit: 50, offset: 0 });
    expect(normalizeQualifiedNoEmailPage(5000, -2)).toEqual({ limit: 200, offset: 0 });
    expect(normalizeQualifiedNoEmailPage(25, 75)).toEqual({ limit: 25, offset: 75 });
  });

  it("wires paginated listing and CSV export to the same campaign/run-aware predicate", () => {
    const leadsRoute = readFileSync("src/routes/leads.ts", "utf8");
    const exportRoute = readFileSync("src/routes/export.ts", "utf8");
    const query = readFileSync("src/services/qualified-no-email-query.ts", "utf8");

    expect(leadsRoute).toContain("qualifiedNoEmailConditions(filters)");
    expect(exportRoute).toContain("qualifiedNoEmailConditions({");
    expect(query).toContain("filters.campaignId");
    expect(query).toContain("filters.campaignRunId");
  });
});
