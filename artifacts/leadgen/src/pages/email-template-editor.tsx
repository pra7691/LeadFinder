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
import { ArrowLeft, Bold, Code2, Italic, Link as LinkIcon, List, Loader2, Mail, Paperclip, Plus, Save, Trash2, Upload } from "lucide-react";
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
  attachments: TemplateAttachment[];
  isActive: boolean;
};

type TemplateAttachment = {
  filename: string;
  url?: string;
  storageKey?: string;
  contentType?: string;
  size?: number;
};

const EMPTY_FORM: FormState = {
  name: "",
  subject: "",
  body: "<p>Hi {{company_name}},</p>\n\n<p>I wanted to reach out about your work at <a href=\"{{website_url}}\">{{website_url}}</a>.</p>\n\n<p>Best regards,</p>",
  personalizationPrompt: "",
  attachments: [],
  isActive: true,
};

function renderSample(value: string) {
  return Object.entries(SAMPLE_VALUES).reduce((text, [key, sample]) => text.replaceAll(key, sample), value);
}

function parseAttachmentsJson(value: string | null | undefined): TemplateAttachment[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        filename: String(item?.filename ?? "").trim(),
        url: String(item?.url ?? "").trim() || undefined,
        storageKey: String(item?.storageKey ?? "").trim() || undefined,
        contentType: String(item?.contentType ?? "").trim() || undefined,
        size: Number.isFinite(Number(item?.size)) ? Number(item.size) : undefined,
      }))
      .filter((item) => item.filename || item.url || item.storageKey);
  } catch {
    return [];
  }
}

function isValidAttachmentUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function cleanAttachments(attachments: TemplateAttachment[]) {
  return attachments
    .map((attachment) => ({
      filename: attachment.filename.trim(),
      url: attachment.url?.trim() || undefined,
      storageKey: attachment.storageKey?.trim() || undefined,
      contentType: attachment.contentType?.trim() || undefined,
      size: attachment.size,
    }))
    .filter((attachment) => attachment.filename && (attachment.storageKey || (attachment.url && isValidAttachmentUrl(attachment.url))))
    .slice(0, 10);
}

function formatBytes(value: number | undefined) {
  if (!value) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function EmailPreview({ subject, body, attachments }: { subject: string; body: string; attachments: TemplateAttachment[] }) {
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
        {attachments.length > 0 && (
          <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
            <p className="text-[11px] font-medium text-muted-foreground mb-2">ATTACHMENTS</p>
            <div className="space-y-1.5">
              {attachments.map((attachment, index) => (
                <div key={`${attachment.filename}-${index}`} className="flex items-center gap-2 text-xs">
                  <Paperclip className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="truncate">{attachment.filename || "Untitled attachment"}</span>
                </div>
              ))}
            </div>
          </div>
        )}
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [location, navigate] = useLocation();
  const listPath = location.startsWith("/settings/email-templates") ? "/settings/email-templates" : "/email-templates";
  const qc = useQueryClient();
  const { toast } = useToast();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);

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
      attachments: parseAttachmentsJson(template.attachmentsJson),
      isActive: template.isActive,
    });
  }, [template]);

  const isSaving = createMut.isPending || updateMut.isPending;
  const completeAttachments = cleanAttachments(form.attachments);
  const hasIncompleteAttachment = form.attachments.some(
    (attachment) => attachment.filename.trim() || attachment.url?.trim() || attachment.storageKey,
  ) && completeAttachments.length !== form.attachments.filter((attachment) => attachment.filename.trim() || attachment.url?.trim() || attachment.storageKey).length;
  const valid = form.name.trim() && form.subject.trim() && form.body.trim() && !hasIncompleteAttachment;

  const preview = useMemo(
    () => ({ subject: form.subject, body: form.body, attachments: completeAttachments }),
    [completeAttachments, form.body, form.subject],
  );

  const set = (key: keyof FormState, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const setAttachment = (index: number, key: keyof TemplateAttachment, value: string) => {
    setForm((current) => ({
      ...current,
      attachments: current.attachments.map((attachment, currentIndex) =>
        currentIndex === index ? { ...attachment, [key]: value } : attachment,
      ),
    }));
  };

  const addAttachment = () => {
    setForm((current) => ({
      ...current,
      attachments: [...current.attachments, { filename: "", url: "" }],
    }));
  };

  const removeAttachment = (index: number) => {
    setForm((current) => ({
      ...current,
      attachments: current.attachments.filter((_, currentIndex) => currentIndex !== index),
    }));
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;

    const remainingSlots = Math.max(0, 10 - form.attachments.length);
    const selectedFiles = Array.from(files).slice(0, remainingSlots);
    if (selectedFiles.length === 0) {
      toast({ title: "Maximum 10 attachments allowed", variant: "destructive" });
      return;
    }

    setIsUploadingAttachment(true);
    try {
      const uploaded: TemplateAttachment[] = [];
      for (const file of selectedFiles) {
        const data = await fileToDataUrl(file);
        const response = await fetch("/api/email-template-attachments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            data,
          }),
        });

        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error ?? `Failed to upload ${file.name}`);
        }

        uploaded.push({
          filename: body.filename,
          url: body.url,
          storageKey: body.storageKey,
          contentType: body.contentType,
          size: body.size,
        });
      }

      setForm((current) => ({
        ...current,
        attachments: [...current.attachments, ...uploaded],
      }));
      toast({ title: `${uploaded.length} attachment${uploaded.length === 1 ? "" : "s"} uploaded` });
    } catch (error) {
      toast({
        title: "Failed to upload attachment",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploadingAttachment(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
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
      attachmentsJson: completeAttachments.length ? JSON.stringify(completeAttachments) : null,
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

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label className="text-xs font-medium flex items-center gap-2">
                    <Paperclip className="w-3.5 h-3.5" />
                    Attachments <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <p className="text-[11px] text-muted-foreground mt-1">Upload files from your computer, or add public file links. They will be attached when this template is sent.</p>
                </div>
                <div className="flex flex-wrap gap-2 justify-end">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(event) => uploadFiles(event.target.files)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl gap-2 shrink-0"
                    disabled={isUploadingAttachment || form.attachments.length >= 10}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {isUploadingAttachment ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    Upload File
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="rounded-xl gap-2 shrink-0" onClick={addAttachment} disabled={form.attachments.length >= 10}>
                    <Plus className="w-3.5 h-3.5" />
                    Add URL
                  </Button>
                </div>
              </div>

              {form.attachments.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/60 p-5 text-center text-sm text-muted-foreground">
                  No attachments added.
                </div>
              ) : (
                <div className="space-y-3">
                  {form.attachments.map((attachment, index) => {
                    const hasAnyValue = attachment.filename.trim() || attachment.url?.trim() || attachment.storageKey;
                    const hasError = Boolean(hasAnyValue && (!attachment.filename.trim() || (!attachment.storageKey && !isValidAttachmentUrl(attachment.url?.trim() ?? ""))));
                    return (
                      <div key={index} className="rounded-xl border border-border/60 bg-muted/10 p-3 space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)_auto] gap-3 items-start">
                          <div className="space-y-1.5">
                            <Label className="text-[11px] text-muted-foreground">File name</Label>
                            <Input
                              value={attachment.filename}
                              onChange={(e) => setAttachment(index, "filename", e.target.value)}
                              placeholder="Brochure.pdf"
                              className="rounded-xl"
                            />
                          </div>
                          <div className="space-y-1.5">
                            {attachment.storageKey ? (
                              <>
                                <Label className="text-[11px] text-muted-foreground">Uploaded file</Label>
                                <div className="min-h-10 rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm flex items-center gap-2">
                                  <Paperclip className="w-3.5 h-3.5 text-primary shrink-0" />
                                  <span className="truncate">Stored on server</span>
                                  {attachment.size ? <span className="text-xs text-muted-foreground shrink-0">({formatBytes(attachment.size)})</span> : null}
                                </div>
                              </>
                            ) : (
                              <>
                                <Label className="text-[11px] text-muted-foreground">File URL</Label>
                                <Input
                                  value={attachment.url ?? ""}
                                  onChange={(e) => setAttachment(index, "url", e.target.value)}
                                  placeholder="https://example.com/brochure.pdf"
                                  className="rounded-xl"
                                />
                              </>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="rounded-lg text-destructive hover:bg-destructive/10 md:mt-6"
                            title="Remove attachment"
                            onClick={() => removeAttachment(index)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                        {hasError && (
                          <p className="text-[11px] text-destructive">Upload a file or enter both a file name and a valid http/https file URL.</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="xl:sticky xl:top-6">
          <EmailPreview subject={preview.subject} body={preview.body} attachments={preview.attachments} />
        </div>
      </div>
    </div>
  );
}
