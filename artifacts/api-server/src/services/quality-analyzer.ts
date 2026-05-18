// Quality analysis for outreach items — computes warnings and risks

import { classifyEmail } from "./email-validator";

export interface QualityWarning {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
}

export interface OutreachContext {
  recipientEmail: string;
  subject: string;
  body: string;
  aiPersonalized: boolean;
  companyName?: string | null;
  relevanceScore?: number | null;
  qualificationStatus?: string | null;
  websiteUrl?: string | null;
  country?: string | null;
  // For duplicate detection — pass all recipient emails in the batch
  allRecipientEmails?: string[];
}

export function analyzeQuality(ctx: OutreachContext): QualityWarning[] {
  const warnings: QualityWarning[] = [];

  // Email type classification
  const emailResult = classifyEmail(ctx.recipientEmail);
  if (emailResult.type === "noreply") {
    warnings.push({
      code: "NOREPLY_EMAIL",
      severity: "error",
      message: "Recipient email is a no-reply address and cannot receive responses",
    });
  } else if (emailResult.type === "invalid") {
    warnings.push({
      code: "INVALID_EMAIL",
      severity: "error",
      message: `Invalid or test email address: ${ctx.recipientEmail}`,
    });
  } else if (emailResult.type === "generic") {
    warnings.push({
      code: "GENERIC_EMAIL",
      severity: "warning",
      message: `Generic email address (${ctx.recipientEmail}) — lower response rate likely`,
    });
  }

  // Risky domain TLD check
  const riskyTlds = [".xyz", ".top", ".click", ".loan", ".win", ".bid", ".review"];
  const domain = ctx.recipientEmail.split("@")[1] ?? "";
  if (riskyTlds.some((tld) => domain.endsWith(tld))) {
    warnings.push({
      code: "RISKY_DOMAIN",
      severity: "warning",
      message: `Recipient domain (${domain}) has a risky TLD`,
    });
  }

  // No personalization
  if (!ctx.aiPersonalized) {
    warnings.push({
      code: "NO_PERSONALIZATION",
      severity: "info",
      message: "Email was not AI-personalized — lower engagement expected",
    });
  }

  // Missing company name in subject or body
  const hasCompanyInSubject = ctx.companyName
    ? ctx.subject.includes(ctx.companyName)
    : false;
  const hasCompanyInBody = ctx.companyName
    ? ctx.body.includes(ctx.companyName)
    : false;

  if (ctx.companyName && !hasCompanyInSubject && !hasCompanyInBody) {
    warnings.push({
      code: "MISSING_COMPANY_NAME",
      severity: "warning",
      message: "Company name is not mentioned in subject or body",
    });
  }

  // Missing unsubscribe text
  const unsubscribeKeywords = ["unsubscribe", "opt out", "opt-out", "stop receiving", "remove me"];
  const hasUnsubscribe = unsubscribeKeywords.some(
    (kw) => ctx.body.toLowerCase().includes(kw),
  );
  if (!hasUnsubscribe) {
    warnings.push({
      code: "MISSING_UNSUBSCRIBE",
      severity: "warning",
      message: "Email body lacks an unsubscribe/opt-out option",
    });
  }

  // Low relevance score
  if (ctx.relevanceScore !== null && ctx.relevanceScore !== undefined) {
    if (ctx.relevanceScore < 40) {
      warnings.push({
        code: "LOW_RELEVANCE",
        severity: "warning",
        message: `Low relevance score (${ctx.relevanceScore}/100) — lead may not be a good fit`,
      });
    }
  }

  // Unqualified lead
  if (ctx.qualificationStatus === "unqualified") {
    warnings.push({
      code: "UNQUALIFIED_LEAD",
      severity: "warning",
      message: "Lead has not been qualified — review before sending",
    });
  }

  // No website
  if (!ctx.websiteUrl) {
    warnings.push({
      code: "NO_WEBSITE",
      severity: "info",
      message: "Lead has no website — limited context for personalization",
    });
  }

  // No country
  if (!ctx.country) {
    warnings.push({
      code: "NO_COUNTRY",
      severity: "info",
      message: "Lead country is unknown",
    });
  }

  // Duplicate recipient
  if (ctx.allRecipientEmails) {
    const lowerEmail = ctx.recipientEmail.toLowerCase();
    const dupeCount = ctx.allRecipientEmails.filter(
      (e) => e.toLowerCase() === lowerEmail,
    ).length;
    if (dupeCount > 1) {
      warnings.push({
        code: "DUPLICATE_RECIPIENT",
        severity: "error",
        message: `Duplicate recipient email — appears ${dupeCount} times in this batch`,
      });
    }
  }

  return warnings;
}

export function isRiskyItem(warnings: QualityWarning[]): boolean {
  return warnings.some((w) => w.severity === "error");
}
