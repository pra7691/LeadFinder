import { useState } from "react";
import {
  useListEmailTemplates,
  getListEmailTemplatesQueryKey,
  useCreateEmailTemplate,
  useUpdateEmailTemplate,
  useDeleteEmailTemplate,
  usePreviewEmailTemplate,
} from "@workspace/api-client-react";
import type { EmailTemplate } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Mail,
  Pencil,
  Trash2,
  Eye,
  ToggleLeft,
  ToggleRight,
  Loader2,
  FileText,
} from "lucide-react";

const TEMPLATE_VARS = [
  "{{company_name}}",
  "{{website_url}}",
  "{{country}}",
  "{{emails}}",
  "{{relevance_reason}}",
  "{{campaign_name}}",
  "{{list_name}}",
];

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
  body: "",
  personalizationPrompt: "",
  isActive: true,
};

function TemplateForm({
  initial,
  onSave,
  onCancel,
  isSaving,
}: {
  initial: FormState;
  onSave: (f: FormState) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const set = (k: keyof FormState, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const valid = form.name.trim() && form.subject.trim() && form.body.trim();

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs font-medium">Template Name *</Label>
        <Input
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Cold Outreach v1"
          className="rounded-xl"
          data-testid="input-template-name"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs font-medium">Subject Line *</Label>
        <Input
          value={form.subject}
          onChange={(e) => set("subject", e.target.value)}
          placeholder="Outreach — {{company_name}}"
          className="rounded-xl"
          data-testid="input-template-subject"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs font-medium">Email Body *</Label>
        <Textarea
          value={form.body}
          onChange={(e) => set("body", e.target.value)}
          placeholder={"Hi,\n\nI noticed {{company_name}} and wanted to reach out…"}
          className="rounded-xl min-h-[180px] font-mono text-sm resize-y"
          data-testid="textarea-template-body"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs font-medium">AI Personalization Prompt <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <Textarea
          value={form.personalizationPrompt}
          onChange={(e) => set("personalizationPrompt", e.target.value)}
          placeholder="Personalize this email with a relevant insight about the company's work in their industry."
          className="rounded-xl min-h-[80px] text-sm resize-y"
        />
        <p className="text-[11px] text-muted-foreground">If AI is enabled, this prompt guides personalization. Leave blank for simple variable replacement.</p>
      </div>
      <div className="rounded-xl bg-muted/30 border border-border/50 p-3 space-y-1">
        <p className="text-[11px] font-medium text-muted-foreground">Available variables:</p>
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATE_VARS.map((v) => (
            <code key={v} className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-mono">{v}</code>
          ))}
        </div>
      </div>
      <DialogFooter className="pt-2">
        <Button variant="ghost" onClick={onCancel} disabled={isSaving}>Cancel</Button>
        <Button onClick={() => onSave(form)} disabled={!valid || isSaving} className="gap-2">
          {isSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : "Save Template"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function PreviewDialog({ template, open, onClose }: { template: EmailTemplate | null; open: boolean; onClose: () => void }) {
  const previewMut = usePreviewEmailTemplate();
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);

  const handlePreview = () => {
    if (!template) return;
    setPreview(null);
    previewMut.mutate(
      { id: template.id, data: {} },
      {
        onSuccess: (r) => setPreview({ subject: r.subject, body: r.body }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setPreview(null); } }}>
      <DialogContent className="sm:max-w-2xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-primary" />
            Template Preview — {template?.name}
          </DialogTitle>
          <DialogDescription>Rendered with sample data. Variables show placeholder values.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Button onClick={handlePreview} disabled={previewMut.isPending} size="sm" variant="outline" className="rounded-xl gap-2">
            {previewMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
            {preview ? "Regenerate Preview" : "Generate Preview"}
          </Button>
          {preview ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                <p className="text-[11px] font-medium text-muted-foreground mb-1">SUBJECT</p>
                <p className="text-sm font-medium">{preview.subject}</p>
              </div>
              <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                <p className="text-[11px] font-medium text-muted-foreground mb-2">BODY</p>
                <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{preview.body}</pre>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border/50 p-8 text-center text-sm text-muted-foreground">
              Click "Generate Preview" to see a rendered sample.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EmailTemplates() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: templates, isLoading } = useListEmailTemplates(
    { includeInactive: true },
    { query: { queryKey: getListEmailTemplatesQueryKey({ includeInactive: true }), staleTime: 15_000 } },
  );

  const createMut = useCreateEmailTemplate();
  const updateMut = useUpdateEmailTemplate();
  const deleteMut = useDeleteEmailTemplate();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EmailTemplate | null>(null);
  const [previewTarget, setPreviewTarget] = useState<EmailTemplate | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: getListEmailTemplatesQueryKey({ includeInactive: true }) });

  const handleCreate = (form: FormState) => {
    createMut.mutate(
      { data: { name: form.name, subject: form.subject, body: form.body, personalizationPrompt: form.personalizationPrompt || undefined, isActive: form.isActive } },
      {
        onSuccess: () => {
          toast({ title: "Template created" });
          setCreateOpen(false);
          invalidate();
        },
        onError: () => toast({ title: "Failed to create template", variant: "destructive" }),
      },
    );
  };

  const handleEdit = (form: FormState) => {
    if (!editTarget) return;
    updateMut.mutate(
      { id: editTarget.id, data: { name: form.name, subject: form.subject, body: form.body, personalizationPrompt: form.personalizationPrompt || null, isActive: form.isActive } },
      {
        onSuccess: () => {
          toast({ title: "Template updated" });
          setEditTarget(null);
          invalidate();
        },
        onError: () => toast({ title: "Failed to update template", variant: "destructive" }),
      },
    );
  };

  const handleToggleActive = (tmpl: EmailTemplate) => {
    updateMut.mutate(
      { id: tmpl.id, data: { isActive: !tmpl.isActive } },
      {
        onSuccess: () => { toast({ title: tmpl.isActive ? "Template deactivated" : "Template activated" }); invalidate(); },
      },
    );
  };

  const handleDelete = (tmpl: EmailTemplate) => {
    if (!confirm(`Delete template "${tmpl.name}"? This cannot be undone.`)) return;
    deleteMut.mutate(
      { id: tmpl.id },
      {
        onSuccess: () => { toast({ title: "Template deleted" }); invalidate(); },
        onError: () => toast({ title: "Failed to delete template", variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Email Templates</h1>
          <p className="text-sm text-muted-foreground mt-1">Reusable subject + body templates for outreach campaigns.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="rounded-xl gap-2">
          <Plus className="w-4 h-4" /> New Template
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-32 rounded-2xl bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : !templates?.length ? (
        <div className="glass-card rounded-2xl flex flex-col items-center justify-center py-24 gap-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center">
            <FileText className="w-7 h-7 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-lg">No templates yet</p>
            <p className="text-sm text-muted-foreground mt-1">Create reusable email templates for your outreach.</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="rounded-xl gap-2 mt-2">
            <Plus className="w-4 h-4" /> Create first template
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {templates.map((tmpl) => (
            <Card key={tmpl.id} className={`glass-card transition-opacity ${tmpl.isActive ? "" : "opacity-60"}`}>
              <CardHeader className="pb-3 flex flex-row items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-base font-semibold">{tmpl.name}</CardTitle>
                    <Badge variant={tmpl.isActive ? "default" : "secondary"} className="text-xs px-2 py-0">
                      {tmpl.isActive ? "Active" : "Inactive"}
                    </Badge>
                    {tmpl.personalizationPrompt && (
                      <Badge variant="outline" className="text-xs px-2 py-0 text-violet-500 border-violet-500/30">
                        AI-enhanced
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 font-mono truncate">{tmpl.subject}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground" title="Preview" onClick={() => setPreviewTarget(tmpl)}>
                    <Eye className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground" title="Edit" onClick={() => setEditTarget(tmpl)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className={`w-8 h-8 rounded-lg ${tmpl.isActive ? "text-amber-500 hover:bg-amber-500/10" : "text-emerald-500 hover:bg-emerald-500/10"}`} title={tmpl.isActive ? "Deactivate" : "Activate"} onClick={() => handleToggleActive(tmpl)}>
                    {tmpl.isActive ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="w-8 h-8 rounded-lg text-destructive hover:bg-destructive/10" title="Delete" onClick={() => handleDelete(tmpl)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-sans line-clamp-3 leading-relaxed">
                  {tmpl.body}
                </pre>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(v) => { if (!v) setCreateOpen(false); }}>
        <DialogContent className="sm:max-w-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-primary" /> New Email Template
            </DialogTitle>
            <DialogDescription>Create a reusable template with variable placeholders.</DialogDescription>
          </DialogHeader>
          <TemplateForm initial={EMPTY_FORM} onSave={handleCreate} onCancel={() => setCreateOpen(false)} isSaving={createMut.isPending} />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={(v) => { if (!v) setEditTarget(null); }}>
        <DialogContent className="sm:max-w-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-primary" /> Edit Template
            </DialogTitle>
            <DialogDescription>Update this template's content.</DialogDescription>
          </DialogHeader>
          {editTarget && (
            <TemplateForm
              initial={{ name: editTarget.name, subject: editTarget.subject, body: editTarget.body, personalizationPrompt: editTarget.personalizationPrompt ?? "", isActive: editTarget.isActive }}
              onSave={handleEdit}
              onCancel={() => setEditTarget(null)}
              isSaving={updateMut.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <PreviewDialog template={previewTarget} open={!!previewTarget} onClose={() => setPreviewTarget(null)} />
    </div>
  );
}
