/**
 * Lead relevance scoring service.
 *
 * Strategy:
 *   1. Read AI settings from app_settings.
 *   2. If ai_scoring_enabled = true AND a key is present, call OpenAI for semantic scoring.
 *   3. If AI is not configured or the OpenAI call fails, return an explicit failure state.
 *
 * ai_scoring_enabled is independent of ai_enabled (which controls email personalization).
 * scoringMethod is returned with every result so callers can persist and display it.
 */

import { logger } from "../lib/logger";
import { classifyLeadType, maxRelevanceScore } from "./lead-classifier";
import { getAISettings } from "./ai-settings";

export interface ScoreInput {
  leadId?: number;
  campaignObjective: string;
  campaignKeywords: string[];
  companyName: string;
  rootDomain: string;
  rawText: string | null;
  sourceQuery: string | null;
}

export interface ScoreOutput {
  score: number | null;
  reason: string;
  scoringMethod: "ai" | "keyword_fallback" | "failed_ai_not_configured" | "failed_ai_error";
}

// ── AI scoring ─────────────────────────────────────────────────────────────

async function scoreWithAI(
  input: ScoreInput,
  apiKey: string,
  model: string,
): Promise<ScoreOutput> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey });
  const truncatedText = (input.rawText ?? "").slice(0, 4000);

  const prompt = `You are a lead relevance scoring assistant for a B2B lead generation tool.

Campaign objective: ${input.campaignObjective}
Campaign keywords: ${input.campaignKeywords.join(", ")}

Evaluate this company and score its relevance to the campaign objective on a scale from 0 to 100.

Company name: ${input.companyName}
Domain: ${input.rootDomain}
Search query that found this company: ${input.sourceQuery ?? "unknown"}
Extracted website text (truncated):
---
${truncatedText || "(no crawl data yet)"}
---

Scoring guidelines:
- 80–100: Highly relevant — directly matches the campaign objective and keywords
- 60–79: Relevant — clearly related to the industry/use case
- 40–59: Somewhat relevant — tangentially related, worth reviewing
- 20–39: Low relevance — weak connection to the objective
- 0–19: Not relevant — no meaningful connection

Respond ONLY with valid JSON in this exact format:
{"score": <integer 0-100>, "reason": "<one concise sentence explaining the score, max 150 chars>"}`;

  const response = await client.chat.completions.create({
    model,
    max_completion_tokens: 200,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.choices[0]?.message?.content ?? "";

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in AI response");
    const parsed = JSON.parse(jsonMatch[0]) as { score?: unknown; reason?: unknown };
    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score))));
    const reason = String(parsed.reason ?? "").slice(0, 255);
    if (isNaN(score)) throw new Error("Invalid score value in AI response");
    return { score, reason, scoringMethod: "ai" };
  } catch {
    // JSON parse failed — fall through to keyword scoring in the caller
    throw new Error("Could not parse AI scoring response");
  }
}

// ── Keyword fallback scoring ───────────────────────────────────────────────

export function scoreWithKeywords(input: ScoreInput): ScoreOutput {
  const haystack = [
    input.companyName,
    input.rootDomain,
    input.rawText ?? "",
    input.sourceQuery ?? "",
  ]
    .join(" ")
    .toLowerCase();

  const objective = input.campaignObjective.toLowerCase();
  const keywords = input.campaignKeywords.map((k) => k.toLowerCase());

  let score = 0;
  const matched: string[] = [];

  // Each keyword match = up to 15 points (capped at 60)
  for (const kw of keywords) {
    const words = kw.split(/\s+/);
    const allMatch = words.every((w) => haystack.includes(w));
    if (allMatch) {
      score += 15;
      matched.push(kw);
    } else if (words.some((w) => w.length > 4 && haystack.includes(w))) {
      score += 6;
      matched.push(`${kw} (partial)`);
    }
  }
  score = Math.min(60, score);

  // Objective words that appear in the text = up to 40 more points
  const objWords = objective
    .split(/\s+/)
    .filter((w) => w.length > 4)
    .slice(0, 10);
  const objHits = objWords.filter((w) => haystack.includes(w));
  score += Math.round((objHits.length / Math.max(objWords.length, 1)) * 40);

  score = Math.max(0, Math.min(100, score));

  const reason =
    matched.length > 0
      ? `Matched keywords: ${matched.slice(0, 3).join(", ")}. ${objHits.length}/${objWords.length} objective terms found.`
      : `No direct keyword matches. ${objHits.length}/${objWords.length} objective terms found in site text.`;

  return { score, reason: reason.slice(0, 255), scoringMethod: "keyword_fallback" };
}

// ── Main entry point ───────────────────────────────────────────────────────

export async function scoreLead(input: ScoreInput): Promise<ScoreOutput> {
  const ai = await getAISettings();

  if (!ai.scoringEnabled) {
    return scoreWithKeywords(input);
  }

  if (!ai.apiKey) {
    const reason = "Scoring failed: AI is not configured in Settings → AI Settings.";
    logger.warn(
      { leadId: input.leadId, aiScoringEnabled: ai.scoringEnabled, hasKey: false },
      "AI scoring skipped because AI is not configured",
    );
    return {
      score: null,
      reason,
      scoringMethod: "failed_ai_not_configured",
    };
  }

  try {
    const result = await scoreWithAI(input, ai.apiKey, ai.model);
    logger.debug(
      { leadId: input.leadId, model: ai.model, score: result.score },
      "AI scoring succeeded",
    );
    const leadType = classifyLeadType(input.rootDomain);
    const cap = maxRelevanceScore(leadType);
    if (leadType !== "company" && result.score != null && result.score > cap) {
      return {
        score: cap,
        reason: `[${leadType}] ${result.reason}`,
        scoringMethod: result.scoringMethod,
      };
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { leadId: input.leadId, model: ai.model, err: msg },
      "AI scoring failed",
    );
    return {
      score: null,
      reason: `Scoring failed: ${msg.slice(0, 180)}`,
      scoringMethod: "failed_ai_error",
    };
  }
}
