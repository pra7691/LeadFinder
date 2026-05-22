import { useEffect, useMemo, useRef, useState } from "react";
import {
  getGetEmailTemplateQueryKey,
  getListEmailTemplatesQueryKey,
  useCreateEmailTemplate,
  useGetEmailTemplate,
  useUpdateEmailTemplate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, Bold, Code2, Italic, Link as LinkIcon, List, Loader2, Mail, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { toPreviewHtml } from "@/lib/email-html";

const TEMPLATE_VARS = [
  "{{company_name}}",
  "{{website_url}}",
  "{{country}}",
  "{{emails}}",
  "{{relevance_reason}}",
  "{{campaign_name}}",
  "{{list_name}}",
];

const SAMPLE_VALUES: Record<string, string> = {
  "{{company_name}}": "Acme Corp",
  "{{website_url}}": "https://acme.example.com",
  "{{country}}": "USA",
  "{{emails}}": "hello@acme.example.com",
  "{{relevance_reason}}": "Matches your target profile",
  "{{campaign_name}}": "My Campaign",
  "{{list_name}}": "My List",
};

type FormState = {
  name: string;
  subject: string;
  body: string;
  personalizationPrompt: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  subject: "",
  body: "<p>Hi {{company_name}},</p>\n\n<p>I wanted to reach out about your work at <a href=\"{{website_url}}\">{{website_url}}</a>.</p>\n\n<p>Best regards,</p>",
  personalizationPrompt: "",
  isActive: true,
};

function renderSample(value: string) {
  return Object.entries(SAMPLE_VALUES).reduce((text, [key, sample]) => text.replaceAll(key, sample), value);
}

function EmailPreview({ subject, body }: { subject: string; body: string }) {
  return (
    <Card className="glass-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Mail className="w-4 h-4 text-primary" />
          Live Preview
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
          <p className="text-[11px] font-medium text-muted-foreground mb-1">SUBJECT</p>
          <p className="text-sm font-medium">{renderSample(subject) || "Subject preview"}</p>
        </div>
        <div className="rounded-xl border border-border/50 bg-background p-4 min-h-[360px]">
          {body.trim() ? (
            <div
              className="text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold"
              dangerouslySetInnerHTML={{ __html: toPreviewHtml(renderSample(body)) }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Email body preview</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function EmailTemplateEditor() {
  const params = useParams<{ id?: string }>();
  const templateId = params.id ? Number(params.id) : null;
  const isEdit = Number.isFinite(templateId) && templateId !== null;
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [location, navigate] = useLocation();
  const listPath = location.startsWith("/settings/email-templates") ? "/settings/email-templates" : "/email-templates";
  const qc = useQueryClient();
  const { toast } = useToast();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const { data: template, isLoading, isError } = useGetEmailTemplate(templateId ?? 0, {
    query: { queryKey: getGetEmailTemplateQueryKey(templateId ?? 0), enabled: isEdit },
  });
  const createMut = useCreateEmailTemplate();
  const updateMut = useUpdateEmailTemplate();

  useEffect(() => {
    if (!template) return;
    setForm({
      name: template.name,
      subject: template.subject,
      body: template.body,
      personalizationPrompt: template.personalizationPrompt ?? "",
      isActive: template.isActive,
    });
  }, [template]);

  const isSaving = createMut.isPending || updateMut.isPending;
  const valid = form.name.trim() && form.subject.trim() && form.body.trim();

  const preview = useMemo(() => ({ subject: form.subject, body: form.body }), [form.subject, form.body]);

  const set = (key: keyof FormState, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const insertAtCursor = (before: string, after = "", fallback = "text") => {
    const target = bodyRef.current;
    if (!target) {
      set("body", `${form.body}${before}${fallback}${after}`);
      return;
    }

    const start = target.selectionStart;
    const end = target.selectionEnd;
    const selected = form.body.slice(start, end) || fallback;
    const next = `${form.body.slice(0, start)}${before}${selected}${after}${form.body.slice(end)}`;
    set("body", next);
    requestAnimationFrame(() => {
      target.focus();
      target.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  };

  const save = () => {
    const payload = {
      name: form.name.trim(),
      subject: form.subject.trim(),
      body: form.body,
      personalizationPrompt: form.personalizationPrompt.trim() || null,
      isActive: form.isActive,
    };

    if (isEdit && templateId) {
      updateMut.mutate(
        { id: templateId, data: payload },
        {
          onSuccess: () => {
            toast({ title: "Template updated" });
            qc.invalidateQueries({ queryKey: getGetEmailTemplateQueryKey(templateId) });
            qc.invalidateQueries({ queryKey: getListEmailTemplatesQueryKey({ includeInactive: true }) });
            navigate(listPath);
          },
          onError: () => toast({ title: "Failed to update template", variant: "destructive" }),
        },
      );
      return;
    }

    createMut.mutate(
      { data: { ...payload, personalizationPrompt: payload.personalizationPrompt ?? undefined } },
      {
        onSuccess: () => {
          toast({ title: "Template created" });
          qc.invalidateQueries({ queryKey: getListEmailTemplatesQueryKey({ includeInactive: true }) });
          navigate(listPath);
        },
        onError: () => toast({ title: "Failed to create template", variant: "destructive" }),
      },
    );
  };

  if (isEdit && isLoading) {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="h-10 w-48 rounded-xl bg-muted/50 animate-pulse" />
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-6">
          <div className="h-[560px] rounded-2xl bg-muted/40 animate-pulse" />
          <div className="h-[560px] rounded-2xl bg-muted/40 animate-pulse" />
        </div>
      </div>
    );
  }

  if (isEdit && isError) {
    return (
      <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <Button asChild variant="ghost" className="rounded-xl gap-2">
          <Link href={listPath}>
            <ArrowLeft className="w-4 h-4" /> Back to Templates
          </Link>
        </Button>
        <Card className="glass-card">
          <CardContent className="py-12 text-center">
            <p className="font-semibold">Template not found</p>
            <p className="text-sm text-muted-foreground mt-1">This template may have been deleted.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <Button asChild variant="ghost" className="rounded-xl gap-2 -ml-3">
            <Link href={listPath}>
              <ArrowLeft className="w-4 h-4" /> Back to Templates
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{isEdit ? "Edit Email Template" : "New Email Template"}</h1>
            <p className="text-sm text-muted-foreground mt-1">Write HTML email content and preview the formatted result before saving.</p>
          </div>
        </div>
        <Button onClick={save} disabled={!valid || isSaving} className="rounded-xl gap-2 shrink-0">
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Template
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-6 items-start">
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Code2 className="w-4 h-4 text-primary" />
              HTML Editor
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-4 items-end">
              <div className="space-y-2">
                <Label htmlFor="template-name" className="text-xs font-medium">Template Name *</Label>
                <Input
                  id="template-name"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="e.g. Cold Outreach v1"
                  className="rounded-xl"
                  data-testid="input-template-name"
                />
              </div>
              <label className="flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2 min-h-10">
                <Switch checked={form.isActive} onCheckedChange={(checked) => set("isActive", checked)} />
                <span className="text-sm font-medium">Active</span>
              </label>
            </div>

            <div className="space-y-2">
              <Label htmlFor="template-subject" className="text-xs font-medium">Subject Line *</Label>
              <Input
                id="template-subject"
                value={form.subject}
                onChange={(e) => set("subject", e.target.value)}
                placeholder="Outreach - {{company_name}}"
                className="rounded-xl"
                data-testid="input-template-subject"
              />
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Label htmlFor="template-body" className="text-xs font-medium">HTML Body *</Label>
                <div className="flex flex-wrap gap-1.5">
                  <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => insertAtCursor("<strong>", "</strong>")}>
                    <Bold className="w-3.5 h-3.5" />
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => insertAtCursor("<em>", "</em>")}>
                    <Italic className="w-3.5 h-3.5" />
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => insertAtCursor("<a href=\"https://example.com\">", "</a>", "link")}>
                    <LinkIcon className="w-3.5 h-3.5" />
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => insertAtCursor("<ul>\n  <li>", "</li>\n</ul>", "item")}>
                    <List className="w-3.5 h-3.5" />
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => insertAtCursor("<p>", "</p>")}>
                    P
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => insertAtCursor("<br>", "", "")}>
                    BR
                  </Button>
                </div>
              </div>
              <Textarea
                ref={bodyRef}
                id="template-body"
                value={form.body}
                onChange={(e) => set("body", e.target.value)}
                placeholder="<p>Hi {{company_name}},</p>"
                className="rounded-xl min-h-[360px] font-mono text-sm resize-y"
                data-testid="textarea-template-body"
              />
            </div>

            <div className="rounded-xl bg-muted/30 border border-border/50 p-3 space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground">Available variables</p>
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATE_VARS.map((variable) => (
                  <button
                    key={variable}
                    type="button"
                    onClick={() => insertAtCursor(variable, "", "")}
                    className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-mono"
                  >
                    {variable}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="template-prompt" className="text-xs font-medium">
                AI Personalization Prompt <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                id="template-prompt"
                value={form.personalizationPrompt}
                onChange={(e) => set("personalizationPrompt", e.target.value)}
                placeholder="Personalize this email with a relevant insight about the company's work in their industry."
                className="rounded-xl min-h-[88px] text-sm resize-y"
              />
              <p className="text-[11px] text-muted-foreground">If AI is enabled, this prompt guides personalization. Leave blank for simple variable replacement.</p>
            </div>
          </CardContent>
        </Card>

        <div className="xl:sticky xl:top-6">
          <EmailPreview subject={preview.subject} body={preview.body} />
        </div>
      </div>
    </div>
  );
}
