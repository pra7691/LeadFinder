import { useState } from "react";
import {
  useListEmailTemplates,
  getListEmailTemplatesQueryKey,
  useUpdateEmailTemplate,
  useDeleteEmailTemplate,
  usePreviewEmailTemplate,
} from "@workspace/api-client-react";
import type { EmailTemplate } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { toPreviewHtml } from "@/lib/email-html";
import {
  Plus,
  Pencil,
  Trash2,
  Eye,
  ToggleLeft,
  ToggleRight,
  Loader2,
  FileText,
  Paperclip,
} from "lucide-react";

function getAttachmentCount(template: EmailTemplate) {
  if (!template.attachmentsJson) return 0;
  try {
    const parsed = JSON.parse(template.attachmentsJson);
    return Array.isArray(parsed)
      ? parsed.filter((item) => String(item?.filename ?? "").trim() && (String(item?.url ?? "").trim() || String(item?.storageKey ?? "").trim())).length
      : 0;
  } catch {
    return 0;
  }
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
            Template Preview - {template?.name}
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
                <div
                  className="text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5"
                  dangerouslySetInnerHTML={{ __html: toPreviewHtml(preview.body) }}
                />
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

export function EmailTemplates({ basePath = "/email-templates" }: { basePath?: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: templates, isLoading } = useListEmailTemplates(
    { includeInactive: true },
    { query: { queryKey: getListEmailTemplatesQueryKey({ includeInactive: true }), staleTime: 15_000 } },
  );

  const updateMut = useUpdateEmailTemplate();
  const deleteMut = useDeleteEmailTemplate();
  const [previewTarget, setPreviewTarget] = useState<EmailTemplate | null>(null);
  const templateRows = Array.isArray(templates) ? templates : [];

  const invalidate = () => qc.invalidateQueries({ queryKey: getListEmailTemplatesQueryKey({ includeInactive: true }) });

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
        <Button asChild className="rounded-xl gap-2">
          <Link href={`${basePath}/new`}>
            <Plus className="w-4 h-4" /> New Template
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-32 rounded-2xl bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : templateRows.length === 0 ? (
        <div className="glass-card rounded-2xl flex flex-col items-center justify-center py-24 gap-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center">
            <FileText className="w-7 h-7 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-lg">No templates yet</p>
            <p className="text-sm text-muted-foreground mt-1">Create reusable email templates for your outreach.</p>
          </div>
          <Button asChild className="rounded-xl gap-2 mt-2">
            <Link href={`${basePath}/new`}>
              <Plus className="w-4 h-4" /> Create first template
            </Link>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {templateRows.map((tmpl) => (
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
                    {getAttachmentCount(tmpl) > 0 && (
                      <Badge variant="outline" className="text-xs px-2 py-0 gap-1">
                        <Paperclip className="w-3 h-3" />
                        {getAttachmentCount(tmpl)} attachment{getAttachmentCount(tmpl) === 1 ? "" : "s"}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 font-mono truncate">{tmpl.subject}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground" title="Preview" onClick={() => setPreviewTarget(tmpl)}>
                    <Eye className="w-3.5 h-3.5" />
                  </Button>
                  <Button asChild variant="ghost" size="icon" className="w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground" title="Edit">
                    <Link href={`${basePath}/${tmpl.id}/edit`}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Link>
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

      <PreviewDialog template={previewTarget} open={!!previewTarget} onClose={() => setPreviewTarget(null)} />
    </div>
  );
}
