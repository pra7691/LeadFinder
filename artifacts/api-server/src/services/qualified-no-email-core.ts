export const QUALIFIED_NO_EMAIL_SCORING_METHOD = "ai" as const;

export interface QualifiedNoEmailCandidate {
  crawlStatus: string | null;
  qualificationStatus: string;
  scoringMethod: string | null;
  relevanceScore: number | null;
  campaignMinRelevanceScore: number;
  emails: string | null;
}

export function isQualifiedNoEmailLead(candidate: QualifiedNoEmailCandidate): boolean {
  return candidate.crawlStatus === "crawled" &&
    candidate.qualificationStatus === "qualified" &&
    candidate.scoringMethod === QUALIFIED_NO_EMAIL_SCORING_METHOD &&
    candidate.relevanceScore !== null &&
    candidate.relevanceScore >= candidate.campaignMinRelevanceScore &&
    (candidate.emails === null || candidate.emails.trim() === "");
}

export function normalizeQualifiedNoEmailPage(
  limitValue: unknown,
  offsetValue: unknown,
): { limit: number; offset: number } {
  const parsedLimit = Number(limitValue ?? 50);
  const parsedOffset = Number(offsetValue ?? 0);
  return {
    limit: Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 200) : 50,
    offset: Number.isFinite(parsedOffset) ? Math.max(Math.trunc(parsedOffset), 0) : 0,
  };
}
