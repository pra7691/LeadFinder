import { useListOutreach, useDeleteOutreach, getListOutreachQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Download, Eye, Mail, Users, Trash2, Loader2, RefreshCw, Play, Send } from "lucide-react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import {
  buildDisplayRows,
  formatTrackingTime,
  getDisplayStatus,
  StatusBadge,
  type OutreachDisplayRow,
  type OutreachItem,
} from "@/pages/outreach";
import { saveTextExportToServer } from "@/lib/export-files";

function csvEscape(value: unknown): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function findBatch(rows: OutreachDisplayRow[], batchId: string | undefined): OutreachDisplayRow | null {
  if (!batchId) return null;
  const decoded = decodeURIComponent(batchId);
  return rows.find((row) => row.id === decoded) ?? null;
}

export function OutreachBatchDetail() {
  const params = useParams<{ batchId: string }>();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const deleteMut = useDeleteOutreach();
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [resending, setResending] = useState(false);
  const [viewItem, setViewItem] = useState<OutreachItem | null>(null);

  const { data: rawItems, isLoading } = useListOutreach();
  const outreachItems = Array.isArray(rawItems) ? (rawItems as OutreachItem[]) : [];
  const rows = buildDisplayRows(outreachItems);
  const batch = findBatch(rows, params.batchId);

  const invalidate = () => qc.invalidateQueries({ queryKey: getListOutreachQueryKey() });

  const handleExport = async () => {
    if (!batch) return;
    setExporting(true);
    try {
      const header = ["Company", "Email", "Status", "Sent", "Remaining", "Sent At"];
      const dataRows = batch.items.map((item) => [
        item.companyName ?? "",
        item.recipientEmail,
        getDisplayStatus(item),
        item.status === "sent" || item.sentAt ? 1 : 0,
        item.status === "sent" || item.sentAt ? 0 : 1,
        item.sentAt ?? "",
      ]);
      const csv = [header, ...dataRows].map((row) => row.map(csvEscape).join(",")).join("\r\n") + "\r\n";
      const filename = `outreach-${batch.id}-${new Date().toISOString().slice(0, 10)}.csv`;
      const saved = await saveTextExportToServer(filename, csv);
      toast({ title: `Export saved to ${saved.relativePath}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Export failed";
      toast({ title: message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteItem = (id: number) => {
    if (!confirm("Remove this item from the queue?")) return;
    setDeletingId(id);
    deleteMut.mutate({ id }, {
      onSuccess: () => { invalidate(); toast({ title: "Item removed." }); },
      onError: () => toast({ title: "Failed to delete item.", variant: "destructive" }),
      onSettled: () => setDeletingId(null),
    });
  };

  const handleDeleteAll = async () => {
    if (!batch) return;
    if (!confirm(`Delete all ${batch.items.length} item${batch.items.length === 1 ? "" : "s"} in this batch? This cannot be undone.`)) return;
    setDeletingAll(true);
    try {
      await Promise.all(batch.items.map((item) => deleteMut.mutateAsync({ id: item.id }).catch(() => null)));
      invalidate();
      toast({ title: `Batch deleted (${batch.items.length} items).` });
      setLocation("/outreach");
    } catch {
      toast({ title: "Some items could not be deleted.", variant: "destructive" });
    } finally {
      setDeletingAll(false);
    }
  };

  const handleResend = async () => {
    if (!batch) return;
    const resendable = batch.items.filter((i) => i.status === "failed" || i.status === "pending_review" || i.status === "approved");
    if (resendable.length === 0) {
      toast({ title: "No failed or pending items to resend." });
      return;
    }
    setResending(true);
    try {
      // 1. Reset failed/pending items back to approved
      const resetRes = await fetch(`${import.meta.env.BASE_URL}api/outreach/resend-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: batch.id }),
      });
      if (!resetRes.ok) {
        const err = await resetRes.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `Reset failed (${resetRes.status})`);
      }
      const { reset, ids } = await resetRes.json() as { reset: number; ids: number[] };
      if (reset === 0) {
        toast({ title: "No failed or pending items found to resend." });
        return;
      }
      // 2. Trigger send-batch for just those ids
      const sendRes = await fetch(`${import.meta.env.BASE_URL}api/outreach/send-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!sendRes.ok) {
        const err = await sendRes.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `Send failed (${sendRes.status})`);
      }
      const result = await sendRes.json() as { queued: number; skipped: number; message?: string };
      invalidate();
      toast({
        title: result.message ?? `Added ${result.queued} item${result.queued === 1 ? "" : "s"} to send queue.`,
        description: result.skipped > 0 ? `${result.skipped} item${result.skipped === 1 ? "" : "s"} already queued or not eligible.` : undefined,
      });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Resend failed.", variant: "destructive" });
    } finally {
      setResending(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="h-9 w-40 rounded-xl bg-muted/50 animate-pulse" />
        <div className="h-24 rounded-2xl bg-muted/40 animate-pulse" />
        <div className="h-96 rounded-2xl bg-muted/30 animate-pulse" />
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <Link href="/outreach">
          <Button variant="outline" className="rounded-xl gap-2">
            <ArrowLeft className="w-4 h-4" /> Back to Outreach
          </Button>
        </Link>
        <div className="rounded-2xl border border-border/50 bg-muted/20 p-8 text-center">
          <p className="text-lg font-semibold">Outreach batch not found</p>
          <p className="text-sm text-muted-foreground mt-1">The outreach group may have been deleted or filtered out.</p>
        </div>
      </div>
    );
  }

  const sentRecipients = batch.items.filter((item) => item.status === "sent" || Boolean(item.sentAt)).length;
  const remainingRecipients = batch.items.length - sentRecipients;

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href="/outreach">
            <Button variant="outline" size="sm" className="rounded-xl gap-2 mb-4">
              <ArrowLeft className="w-4 h-4" /> Back to Outreach
            </Button>
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">{batch.title}</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={batch.status} />
          {(() => {
            const resendableCount = batch.items.filter(
              (i) => i.status === "failed" || i.status === "pending_review" || i.status === "approved"
            ).length;
            // "stopped" batches use Resume; everything else uses Resend
            const isStopped = batch.status === "stopped";
            return resendableCount > 0 ? (
              <Button
                variant="outline"
                size="sm"
                className={isStopped
                  ? "rounded-xl gap-1.5 text-amber-600 hover:text-amber-700 border-amber-500/30 hover:border-amber-500/60"
                  : "rounded-xl gap-1.5 text-primary/80 hover:text-primary border-primary/20 hover:border-primary/50"}
                onClick={handleResend}
                disabled={resending}
              >
                {resending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : isStopped
                    ? <Play className="w-3.5 h-3.5" />
                    : <RefreshCw className="w-3.5 h-3.5" />}
                {isStopped ? `Resume (${resendableCount})` : `Resend (${resendableCount})`}
              </Button>
            ) : null;
          })()}
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-1.5"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Download className="w-3.5 h-3.5" />}
            Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-1.5 text-destructive/80 hover:text-destructive border-destructive/20 hover:border-destructive/50"
            onClick={handleDeleteAll}
            disabled={deletingAll || deleteMut.isPending}
          >
            {deletingAll
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Trash2 className="w-3.5 h-3.5" />}
            Delete Batch
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-border/50 bg-muted/20 p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-widest">
            <Users className="w-4 h-4" /> Recipients
          </div>
          <p className="mt-2 text-2xl font-semibold">{batch.count}</p>
        </div>
        <div className="rounded-2xl border border-border/50 bg-muted/20 p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-widest">
            <Send className="w-4 h-4" /> Sent
          </div>
          <p className="mt-2 text-2xl font-semibold">{sentRecipients}</p>
          <p className="text-xs text-muted-foreground">email{sentRecipients === 1 ? "" : "s"} sent</p>
        </div>
        <div className="rounded-2xl border border-border/50 bg-muted/20 p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-widest">
            <Mail className="w-4 h-4" /> Remaining
          </div>
          <p className="mt-2 text-2xl font-semibold">{remainingRecipients}</p>
          <p className="text-xs text-muted-foreground">email{remainingRecipients === 1 ? "" : "s"} not sent yet</p>
        </div>
        <div className="rounded-2xl border border-border/50 bg-muted/20 p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-widest">
            <Mail className="w-4 h-4" /> Subject
          </div>
          <p className="mt-2 text-sm font-medium line-clamp-2">{batch.subject}</p>
          {batch.templateName && (
            <p className="mt-1 text-xs text-muted-foreground">Template: {batch.templateName}</p>
          )}
        </div>
      </div>

      <div className="glass-card overflow-hidden rounded-2xl">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow className="border-border/30 hover:bg-transparent">
              <TableHead>Recipient</TableHead>
              <TableHead className="w-[110px]">Status</TableHead>
              <TableHead className="w-[90px] text-center">Sent</TableHead>
              <TableHead className="w-[110px] text-center">Remaining</TableHead>
              <TableHead className="w-[160px]">Sent At</TableHead>
              <TableHead className="w-[96px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {batch.items.map((item) => (
              <TableRow key={item.id} className="border-border/30">
                <TableCell>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.companyName ?? item.recipientEmail}</p>
                    <p className="truncate text-xs text-muted-foreground font-mono">{item.recipientEmail}</p>
                  </div>
                </TableCell>
                <TableCell><StatusBadge status={getDisplayStatus(item)} /></TableCell>
                <TableCell className="text-center font-semibold">{item.status === "sent" || item.sentAt ? 1 : 0}</TableCell>
                <TableCell className="text-center font-semibold">{item.status === "sent" || item.sentAt ? 0 : 1}</TableCell>
                <TableCell className="text-xs">{formatTrackingTime(item.sentAt)}</TableCell>
                <TableCell className="text-right pr-3">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                      onClick={(e) => { e.stopPropagation(); setViewItem(item); }}
                      title="View email content"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 rounded-lg text-destructive/60 hover:text-destructive"
                      disabled={deletingId === item.id || deletingAll}
                      onClick={(e) => { e.stopPropagation(); handleDeleteItem(item.id); }}
                      title="Delete"
                    >
                      {deletingId === item.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ── Email content viewer ────────────────────────────────────── */}
      <Dialog open={!!viewItem} onOpenChange={(open) => { if (!open) setViewItem(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-base font-semibold truncate pr-6">
              {viewItem?.companyName ?? viewItem?.recipientEmail}
            </DialogTitle>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{viewItem?.recipientEmail}</p>
          </DialogHeader>

          {viewItem && (
            <div className="flex flex-col gap-4 overflow-y-auto min-h-0 pt-1">
              {/* Subject */}
              <div className="rounded-xl border border-border/40 bg-muted/20 px-4 py-3">
                <p className="text-[11px] text-muted-foreground uppercase tracking-widest mb-1">Subject</p>
                <p className="text-sm font-medium">{viewItem.subject}</p>
              </div>

              {/* Body */}
              <div className="rounded-xl border border-border/40 bg-muted/20 px-4 py-3 flex-1 min-h-0">
                <p className="text-[11px] text-muted-foreground uppercase tracking-widest mb-2">Body</p>
                {viewItem.body.trimStart().startsWith("<") ? (
                  /* HTML email — render in sandboxed iframe */
                  <iframe
                    srcDoc={viewItem.body}
                    sandbox="allow-same-origin"
                    className="w-full rounded-lg border border-border/30 bg-white"
                    style={{ minHeight: "320px", height: "auto" }}
                    onLoad={(e) => {
                      const iframe = e.currentTarget;
                      const doc = iframe.contentDocument;
                      if (doc) {
                        iframe.style.height = `${doc.documentElement.scrollHeight + 16}px`;
                      }
                    }}
                  />
                ) : (
                  /* Plain-text email */
                  <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{viewItem.body}</pre>
                )}
              </div>

              {/* Meta */}
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pb-1">
                {viewItem.aiPersonalized && (
                  <span className="rounded-full bg-violet-500/10 text-violet-400 px-2 py-0.5 font-medium">AI personalised</span>
                )}
                {viewItem.sentAt && (
                  <span>Sent: {formatTrackingTime(viewItem.sentAt)}</span>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
