import type { EmailTemplate } from "@workspace/db";
import type { Lead } from "@workspace/db";
import { logger } from "../lib/logger";
import { getAISettings } from "./ai-settings";

interface GeneratedEmail {
  subject: string;
  body: string;
  aiUsed: boolean;
}

export interface TemplateVars {
  company_name: string;
  website_url: string;
  country: string;
  emails: string;
  relevance_reason: string;
  campaign_name: string;
  list_name: string;
}

export function renderTemplate(template: string, vars: Partial<TemplateVars> & Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key as keyof typeof vars] ?? `{{${key}}}`);
}

export async function generatePersonalizedEmail(
  lead: Pick<Lead, "companyName" | "websiteUrl" | "rootDomain" | "country" | "emails" | "relevanceReason">,
  template: Pick<EmailTemplate, "subject" | "body" | "personalizationPrompt">,
  context: { campaignName?: string; listName?: string } = {},
): Promise<GeneratedEmail> {
  let emailList: string[] = [];
  try { emailList = lead.emails ? JSON.parse(lead.emails) : []; } catch { emailList = []; }

  const vars: Partial<TemplateVars> & Record<string, string> = {
    company_name: lead.companyName,
    website_url: lead.websiteUrl ?? lead.rootDomain ?? "",
    country: lead.country ?? "",
    emails: emailList.join(", "),
    relevance_reason: lead.relevanceReason ?? "",
    campaign_name: context.campaignName ?? "",
    list_name: context.listName ?? "",
  };

  const renderedSubject = renderTemplate(template.subject, vars);
  const renderedBody = renderTemplate(template.body, vars);

  const ai = await getAISettings();

  if (!ai.enabled || !ai.apiKey) {
    return { subject: renderedSubject, body: renderedBody, aiUsed: false };
  }

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: ai.apiKey });

    const prompt = template.personalizationPrompt
      ? `${template.personalizationPrompt}\n\n`
      : "";

    const systemPrompt = `You are a professional B2B email writer. Personalize the given email template for a specific company. 
Rules:
- Keep it concise and professional
- Do not invent facts or make claims not supported by the data
- Use only the information provided
- Preserve the overall structure and intent of the template
- Return JSON with "subject" and "body" fields only`;

    const userPrompt = `${prompt}Personalize this email for:
Company: ${lead.companyName}
Website: ${lead.websiteUrl ?? lead.rootDomain ?? "unknown"}
Country: ${lead.country ?? "unknown"}
Relevance: ${lead.relevanceReason ?? "not specified"}
Campaign: ${context.campaignName ?? ""}
List: ${context.listName ?? ""}

Subject template: ${renderedSubject}
Body template:
${renderedBody}

Return JSON: {"subject": "...", "body": "..."}`;

    const response = await client.chat.completions.create({
      model: ai.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 800,
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { subject?: string; body?: string };

    return {
      subject: parsed.subject ?? renderedSubject,
      body: parsed.body ?? renderedBody,
      aiUsed: true,
    };
  } catch (err) {
    logger.warn({ err }, "AI personalization failed, falling back to template");
    return { subject: renderedSubject, body: renderedBody, aiUsed: false };
  }
}

export async function testAIConnection(): Promise<{ success: boolean; message: string; model: string | null }> {
  const ai = await getAISettings();

  if (!ai.apiKey) {
    return { success: false, message: "No OpenAI API key configured. Add it in Settings → AI Settings.", model: null };
  }

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: ai.apiKey });

    const response = await client.chat.completions.create({
      model: ai.model,
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
      max_tokens: 10,
    });

    const reply = response.choices[0]?.message?.content?.trim() ?? "";
    if (reply) {
      return { success: true, message: `Connected successfully. Model: ${ai.model}`, model: ai.model };
    }
    return { success: false, message: "Got empty response from OpenAI.", model: ai.model };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Connection failed: ${msg}`, model: ai.model };
  }
}
