import { openai } from "@workspace/integrations-openai-ai-server";

export interface ScoreInput {
  campaignObjective: string;
  campaignKeywords: string[];
  companyName: string;
  rootDomain: string;
  rawText: string | null;
  sourceQuery: string | null;
}

export interface ScoreOutput {
  score: number;
  reason: string;
}

// ── AI scoring ─────────────────────────────────────────────────────────────

export async function scoreWithAI(input: ScoreInput): Promise<ScoreOutput> {
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

  const response = await openai.chat.completions.create({
    model: "gpt-5-mini",
    max_completion_tokens: 200,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.choices[0]?.message?.content ?? "";

  // Parse JSON from response, with fallback
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const parsed = JSON.parse(jsonMatch[0]) as { score?: unknown; reason?: unknown };
    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score))));
    const reason = String(parsed.reason ?? "").slice(0, 255);
    if (isNaN(score)) throw new Error("Invalid score");
    return { score, reason };
  } catch {
    // Fallback to keyword scoring if JSON parse fails
    return scoreWithKeywords(input);
  }
}

// ── Keyword fallback scoring ───────────────────────────────────────────────
// Used when AI is unavailable or returns bad output.

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

  return { score, reason: reason.slice(0, 255) };
}

// ── Main entry point ───────────────────────────────────────────────────────

export async function scoreLead(input: ScoreInput): Promise<ScoreOutput> {
  // Try AI first; fall back to keywords on any error
  try {
    return await scoreWithAI(input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // If it's a missing-env-var startup error, go straight to fallback
    console.warn(`[scorer] AI unavailable (${msg.slice(0, 80)}), using keyword fallback`);
    return scoreWithKeywords(input);
  }
}
