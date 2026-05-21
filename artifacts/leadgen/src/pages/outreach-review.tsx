import { useState, useMemo } from "react";
import {
  useListOutreach,
  useRejectOutreach,
  useBulkRejectOutreach,
  useBulkApproveOutreach,
  useApproveOutreach,
  useRegenerateOutreach,
  useUpdateOutreach,
  getListOutreachQueryKey,
} from "@workspace/api-client-react";
import type { OutreachItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Loader2,
  MailOpen,
  ChevronDown,
  ChevronUp,
  Zap,
  Info,
  AlertCircle,
  Eye,
  Pencil,
  Mail,
  FileText,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

type QualityWarning = {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
};

type EnrichedItem = OutreachItem & {
  qualityWarnings?: QualityWarning[];
  templateName?: string | null;
  senderEmail?: string | null;
  listName?: string | null;
  recipientEmailType?: string | null;
};

const SEVERITY_ICON: Record<string, React.ReactNode> = {
  error: <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />,
  warning: <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />,
  info: <Info className="w-3.5 h-3.5 text-blue-400 shrink-0" />,
};

const SEVERITY_COLOR: Record<string, string> = {
  error: "text-destructive",
  warning: "text-amber-500",
  info: "text-blue-400",
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending_review: { label: "Pending Review", className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  approved: { label: "Approved", className: "bg-green-500/10 text-green-600 border-green-500/20" },
  rejected: { label: "Rejected", className: "bg-destructive/10 text-destructive border-destructive/20" },
  draft: { label: "Draft", className: "bg-muted text-muted-foreground border-border/50" },
  queued: { label: "Queued", className: "bg-primary/10 text-primary border-primary/20" },
  sent: { label: "Sent", className: "bg-green-500/10 text-green-600 border-green-500/20" },
  failed: { label: "Failed", className: "bg-destructive/10 text-destructive border-destructive/20" },
};

const EMAIL_TYPE_BADGE: Record<string, { label: string; className: string }> = {
  noreply: { label: "No-reply", className: "bg-destructive/10 text-destructive border-destructive/20" },
  invalid: { label: "Invalid", className: "bg-destructive/10 text-destructive border-destructive/20" },
  generic: { label: "Generic", className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  personal: { label: "Personal", className: "bg-green-500/10 text-green-600 border-green-500/20" },
};

type FilterTab = "pending_review" | "approved" | "rejected" | "all";

const TABS: { id: FilterTab; label: string }[] = [
  { id: "pending_review", label: "Needs Review" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "all", label: "All" },
];

function WarningBadge({ warnings }: { warnings: QualityWarning[] }) {
  const errors = warnings.filter((w) => w.severity === "error").length;
  const warningCount = warnings.filter((w) => w.severity === "warning").length;
  if (errors > 0) {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] border-destructive/30 text-destructive bg-destructive/5">
        <AlertCircle className="w-3 h-3" /> {errors} error{errors !== 1 ? "s" : ""}
      </Badge>
    );
  }
  if (warningCount > 0) {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] border-amber-500/30 text-amber-600 bg-amber-500/5">
        <AlertTriangle className="w-3 h-3" /> {warningCount} warning{warningCount !== 1 ? "s" : ""}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-[10px] border-green-500/30 text-green-600 bg-green-500/5">
      <CheckCircle2 className="w-3 h-3" /> Clean
    </Badge>
  );
}

function QualityPanel({ warnings }: { warnings: QualityWarning[] }) {
  if (warnings.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-green-600">
        <CheckCircle2 className="w-4 h-4" />
        No quality issues detected
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {warnings.map((w) => (
        <div key={w.code} className="flex items-start gap-2 text-xs">
          {SEVERITY_ICON[w.severity]}
          <span className={cn("leading-relaxed", SEVERITY_COLOR[w.severity])}>{w.message}</span>
        </div>
      ))}
    </div>
  );
}

function ItemRow({
  item,
  selected,
  onToggle,
  onApprove,
  onReject,
  onRegenerate,
  onPreview,
  onEdit,
}: {
  item: EnrichedItem;
  selected: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onReject: (reason?: string) => void;
  onRegenerate: () => void;
  onPreview: () => void;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const warnings: QualityWarning[] = item.qualityWarnings ?? [];
  const hasErrors = warnings.some((w) => w.severity === "error");
  const statusMeta = STATUS_BADGE[item.status] ?? STATUS_BADGE.draft;
  const emailTypeMeta = item.recipientEmailType ? EMAIL_TYPE_BADGE[item.recipientEmailType] : null;
  const isActionable = ["pending_review", "draft", "queued"].includes(item.status);

  return (
    <>
      <Card className={cn(
        "glass-card transition-all duration-200 border",
        selected ? "border-primary/40 bg-primary/5" : hasErrors ? "border-destructive/20" : "border-border/40",
      )}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            {/* Checkbox */}
            <div className="pt-0.5 shrink-0">
              <Checkbox checked={selected} onCheckedChange={onToggle} className="rounded" />
            </div>

            {/* Main content */}
            <div className="flex-1 min-w-0">
              {/* Row 1: company + badges */}
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="font-medium text-sm">{item.companyName ?? "Unknown"}</span>
                <Badge variant="outline" className={cn("text-[10px]", statusMeta.className)}>
                  {statusMeta.label}
                </Badge>
                {item.aiPersonalized && (
                  <Badge variant="outline" className="gap-1 text-[10px] border-blue-500/30 text-blue-500 bg-blue-500/5">
                    <Zap className="w-3 h-3" /> AI
                  </Badge>
                )}
                {emailTypeMeta && item.recipientEmailType !== "personal" && (
                  <Badge variant="outline" className={cn("text-[10px]", emailTypeMeta.className)}>
                    {emailTypeMeta.label}
                  </Badge>
                )}
                <WarningBadge warnings={warnings} />
              </div>

              {/* Row 2: metadata */}
              <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground mb-2">
                <span className="font-mono">{item.recipientEmail}</span>
                {item.senderEmail && (
                  <span className="flex items-center gap-1">
                    <Send className="w-3 h-3" /> {item.senderEmail}
                  </span>
                )}
                {item.templateName && (
                  <span className="flex items-center gap-1">
                    <FileText className="w-3 h-3" /> {item.templateName}
                  </span>
                )}
                {item.listName && (
                  <span className="text-muted-foreground/60">List: {item.listName}</span>
                )}
                {item.campaignName && (
                  <span className="text-muted-foreground/60">· {item.campaignName}</span>
                )}
                {item.relevanceScore != null && (
                  <span className={cn(
                    "font-medium",
                    (item.relevanceScore as number) >= 70 ? "text-green-600" : (item.relevanceScore as number) >= 40 ? "text-amber-500" : "text-destructive",
                  )}>
                    Score: {item.relevanceScore}
                  </span>
                )}
              </div>

              {/* Row 3: subject */}
              <p className="text-xs font-medium text-foreground truncate">{item.subject}</p>

              {/* Expanded: body + quality warnings */}
              {expanded && (
                <div className="mt-3 space-y-3 animate-in fade-in">
                  <div className="bg-muted/30 rounded-xl p-3">
                    <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Body preview</p>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed line-clamp-6">
                      {item.body}
                    </p>
                  </div>
                  <div className="border border-border/40 rounded-xl p-3">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
                      Quality Analysis
                    </p>
                    <QualityPanel warnings={warnings} />
                  </div>
                  {item.scheduledAt && (
                    <p className="text-xs text-muted-foreground">
                      Scheduled: {format(new Date(item.scheduledAt), "MMM d, yyyy HH:mm")}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost" size="icon"
                className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                onClick={() => setExpanded((e) => !e)}
                title={expanded ? "Collapse" : "Expand"}
              >
                {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </Button>
              <Button
                variant="ghost" size="icon"
                className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                onClick={onPreview}
                title="Full preview"
              >
                <Eye className="w-3.5 h-3.5" />
              </Button>
              {isActionable && (
                <>
                  <Button
                    variant="ghost" size="icon"
                    className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                    onClick={onEdit}
                    title="Edit"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost" size="icon"
                    className="h-7 w-7 rounded-lg text-muted-foreground hover:text-amber-500"
                    onClick={onRegenerate}
                    title="Regenerate"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost" size="icon"
                    className="h-7 w-7 rounded-lg text-muted-foreground hover:text-destructive"
                    onClick={() => setShowRejectDialog(true)}
                    title="Reject"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 rounded-lg text-xs gap-1 bg-green-600 hover:bg-green-700 text-white px-2.5"
                    onClick={onApprove}
                  >
                    <CheckCircle2 className="w-3 h-3" /> Approve
                  </Button>
                </>
              )}
              {item.status === "rejected" && (
                <Button
                  variant="ghost" size="icon"
                  className="h-7 w-7 rounded-lg text-muted-foreground hover:text-amber-500"
                  onClick={onRegenerate}
                  title="Regenerate and re-review"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reject dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject outreach to {item.companyName ?? item.recipientEmail}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Optionally add a reason for rejection (shown in activity logs).
            </p>
            <Textarea
              placeholder="e.g. Wrong contact, low relevance, email risky…"
              className="rounded-xl text-sm"
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setShowRejectDialog(false)}>Cancel</Button>
            <Button
              variant="destructive" className="rounded-xl"
              onClick={() => {
                onReject(rejectReason || undefined);
                setShowRejectDialog(false);
                setRejectReason("");
              }}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function OutreachReview() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [tab, setTab] = useState<FilterTab>("pending_review");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkRejectDialog, setBulkRejectDialog] = useState(false);
  const [previewItem, setPreviewItem] = useState<EnrichedItem | null>(null);
  const [editItem, setEditItem] = useState<EnrichedItem | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");

  const { data: items = [], isLoading } = useListOutreach(
    tab === "all" ? {} : { status: tab },
  );

  const approve = useApproveOutreach();
  const reject = useRejectOutreach();
  const bulkApprove = useBulkApproveOutreach();
  const bulkReject = useBulkRejectOutreach();
  const regenerate = useRegenerateOutreach();
  const update = useUpdateOutreach();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListOutreachQueryKey() });
    qc.invalidateQueries({ queryKey: getListOutreachQueryKey({ status: "pending_review" }) });
    qc.invalidateQueries({ queryKey: getListOutreachQueryKey({ status: "approved" }) });
    qc.invalidateQueries({ queryKey: getListOutreachQueryKey({ status: "rejected" }) });
  };

  const enrichedItems = useMemo(() => {
    const typed = items as EnrichedItem[];
    return [...typed].sort((a, b) => {
      const aWarnings = Array.isArray(a.qualityWarnings) ? a.qualityWarnings : [];
      const bWarnings = Array.isArray(b.qualityWarnings) ? b.qualityWarnings : [];
      const aErrors = aWarnings.filter((w) => w.severity === "error").length;
      const bErrors = bWarnings.filter((w) => w.severity === "error").length;
      return bErrors - aErrors;
    });
  }, [items]);

  const errorCount = enrichedItems.filter((i) =>
    Array.isArray(i.qualityWarnings) && i.qualityWarnings.some((w) => w.severity === "error"),
  ).length;
  const warningCount = enrichedItems.filter(
    (i) =>
      !(Array.isArray(i.qualityWarnings) && i.qualityWarnings.some((w) => w.severity === "error")) &&
      Array.isArray(i.qualityWarnings) && i.qualityWarnings.some((w) => w.severity === "warning"),
  ).length;
  const cleanCount = enrichedItems.filter(
    (i) => !Array.isArray(i.qualityWarnings) || i.qualityWarnings.every((w) => w.severity === "info"),
  ).length;

  const toggleItem = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === enrichedItems.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(enrichedItems.map((i) => i.id)));
    }
  };

  const handleApprove = (id: number) => {
    approve.mutate({ id }, {
      onSuccess: () => { invalidate(); toast({ title: "Approved." }); },
    });
  };

  const handleReject = (id: number, reason?: string) => {
    reject.mutate({ id, data: reason ? { reason } : {} }, {
      onSuccess: () => { invalidate(); toast({ title: "Rejected." }); },
    });
  };

  const handleRegenerate = (id: number) => {
    regenerate.mutate({ id, data: { forceAi: false } }, {
      onSuccess: () => { invalidate(); toast({ title: "Email regenerated — moved back to review." }); },
      onError: () => toast({ title: "Regeneration failed.", variant: "destructive" }),
    });
  };

  const handleBulkApprove = () => {
    if (selected.size === 0) return;
    bulkApprove.mutate({ data: { ids: [...selected] } }, {
      onSuccess: (r) => {
        invalidate();
        setSelected(new Set());
        toast({ title: `Approved ${r.approved} items.` });
      },
    });
  };

  const handleBulkReject = () => {
    if (selected.size === 0) return;
    bulkReject.mutate(
      { data: { ids: [...selected] } },
      {
        onSuccess: (r) => {
          invalidate();
          setSelected(new Set());
          setBulkRejectDialog(false);
          toast({ title: `Rejected ${r.rejected} items.` });
        },
      },
    );
  };

  const handleSaveEdit = () => {
    if (!editItem) return;
    update.mutate(
      { id: editItem.id, data: { subject: editSubject, body: editBody } },
      {
        onSuccess: () => {
          invalidate();
          setEditItem(null);
          toast({ title: "Email updated." });
        },
        onError: () => toast({ title: "Failed to save.", variant: "destructive" }),
      },
    );
  };

  const openEdit = (item: EnrichedItem) => {
    setEditItem(item);
    setEditSubject(item.subject);
    setEditBody(item.body);
  };

  const pendingCount = enrichedItems.filter((i) => i.status === "pending_review").length;

  return (
    <div className="space-y-6 max-w-5xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-3">
            <ShieldCheck className="w-7 h-7 text-primary" />
            Review Queue
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            QC emails before they go out — items sorted by severity, errors first.
          </p>
        </div>
        {pendingCount > 0 && (
          <div className="px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 text-sm font-medium">
            {pendingCount} pending review
          </div>
        )}
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="glass-card border-destructive/20">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-destructive/10 rounded-xl shrink-0">
              <AlertCircle className="w-5 h-5 text-destructive" />
            </div>
            <div>
              <div className="text-2xl font-semibold text-destructive">{errorCount}</div>
              <div className="text-xs text-muted-foreground">Has errors</div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card border-amber-500/20">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-amber-500/10 rounded-xl shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <div className="text-2xl font-semibold text-amber-500">{warningCount}</div>
              <div className="text-xs text-muted-foreground">Has warnings</div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card border-green-500/20">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-green-500/10 rounded-xl shrink-0">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <div className="text-2xl font-semibold text-green-500">{cleanCount}</div>
              <div className="text-xs text-muted-foreground">Clean</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tab bar + bulk actions */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-1 p-1 bg-muted/50 rounded-xl">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setSelected(new Set()); }}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                tab === t.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{selected.size} selected</span>
            <Button
              size="sm" variant="outline"
              className="rounded-xl h-8 text-xs gap-1.5 border-green-500/30 text-green-600 hover:bg-green-500/5"
              onClick={handleBulkApprove}
              disabled={bulkApprove.isPending}
            >
              {bulkApprove.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
              Approve all
            </Button>
            <Button
              size="sm" variant="outline"
              className="rounded-xl h-8 text-xs gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/5"
              onClick={() => setBulkRejectDialog(true)}
            >
              <XCircle className="w-3 h-3" /> Reject all
            </Button>
          </div>
        )}
      </div>

      {/* Item list */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 bg-muted/30 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : enrichedItems.length === 0 ? (
        <Card className="glass-card border-border/40">
          <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <MailOpen className="w-10 h-10 opacity-20" />
            <p className="text-sm">
              {tab === "pending_review" ? "No items awaiting review." : `No ${tab.replace("_", " ")} items.`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-2 px-1">
            <Checkbox
              checked={selected.size === enrichedItems.length && enrichedItems.length > 0}
              onCheckedChange={toggleAll}
              className="rounded"
            />
            <span className="text-xs text-muted-foreground">Select all ({enrichedItems.length})</span>
          </div>

          <div className="space-y-2">
            {enrichedItems.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                selected={selected.has(item.id)}
                onToggle={() => toggleItem(item.id)}
                onApprove={() => handleApprove(item.id)}
                onReject={(reason) => handleReject(item.id, reason)}
                onRegenerate={() => handleRegenerate(item.id)}
                onPreview={() => setPreviewItem(item)}
                onEdit={() => openEdit(item)}
              />
            ))}
          </div>
        </>
      )}

      {/* Full preview dialog */}
      <Dialog open={!!previewItem} onOpenChange={(v) => { if (!v) setPreviewItem(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-primary" />
              Email Preview — {previewItem?.companyName ?? previewItem?.recipientEmail}
            </DialogTitle>
          </DialogHeader>
          {previewItem && (
            <div className="space-y-4">
              {/* Metadata grid */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-muted/30 rounded-xl p-3 space-y-1">
                  <p className="text-muted-foreground font-medium">To</p>
                  <p className="font-mono">{previewItem.recipientEmail}</p>
                </div>
                <div className="bg-muted/30 rounded-xl p-3 space-y-1">
                  <p className="text-muted-foreground font-medium">From</p>
                  <p className="font-mono">{previewItem.senderEmail ?? "Not assigned"}</p>
                </div>
                {previewItem.templateName && (
                  <div className="bg-muted/30 rounded-xl p-3 space-y-1">
                    <p className="text-muted-foreground font-medium">Template</p>
                    <p>{previewItem.templateName}</p>
                  </div>
                )}
                {previewItem.listName && (
                  <div className="bg-muted/30 rounded-xl p-3 space-y-1">
                    <p className="text-muted-foreground font-medium">List</p>
                    <p>{previewItem.listName}</p>
                  </div>
                )}
                {previewItem.campaignName && (
                  <div className="bg-muted/30 rounded-xl p-3 space-y-1">
                    <p className="text-muted-foreground font-medium">Campaign</p>
                    <p>{previewItem.campaignName}</p>
                  </div>
                )}
                <div className="bg-muted/30 rounded-xl p-3 space-y-1">
                  <p className="text-muted-foreground font-medium">Status</p>
                  <p>{previewItem.status.replace(/_/g, " ")}</p>
                </div>
              </div>

              {/* Subject */}
              <div className="border border-border/40 rounded-xl p-4">
                <p className="text-xs text-muted-foreground font-medium mb-1">Subject</p>
                <p className="font-medium text-sm">{previewItem.subject}</p>
              </div>

              {/* Body */}
              <div className="border border-border/40 rounded-xl p-4">
                <p className="text-xs text-muted-foreground font-medium mb-2">Body</p>
                <div className="text-sm whitespace-pre-wrap leading-relaxed text-foreground/90 font-mono text-[12px]">
                  {previewItem.body}
                </div>
              </div>

              {/* Quality warnings */}
              {(previewItem.qualityWarnings ?? []).length > 0 && (
                <div className="border border-border/40 rounded-xl p-4">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">
                    Quality Analysis
                  </p>
                  <QualityPanel warnings={previewItem.qualityWarnings ?? []} />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setPreviewItem(null)}>
              Close
            </Button>
            {previewItem && ["pending_review", "draft", "queued"].includes(previewItem.status) && (
              <Button
                className="rounded-xl bg-green-600 hover:bg-green-700 text-white gap-1.5"
                onClick={() => {
                  handleApprove(previewItem.id);
                  setPreviewItem(null);
                }}
              >
                <CheckCircle2 className="w-4 h-4" /> Approve
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editItem} onOpenChange={(v) => { if (!v) setEditItem(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-primary" />
              Edit Email — {editItem?.companyName ?? editItem?.recipientEmail}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Subject</Label>
              <Input
                className="rounded-xl"
                value={editSubject}
                onChange={(e) => setEditSubject(e.target.value)}
                placeholder="Email subject…"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Body</Label>
              <Textarea
                className="rounded-xl text-sm font-mono min-h-[280px]"
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                placeholder="Email body…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setEditItem(null)}>
              Cancel
            </Button>
            <Button
              className="rounded-xl"
              onClick={handleSaveEdit}
              disabled={update.isPending}
            >
              {update.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk reject dialog */}
      <Dialog open={bulkRejectDialog} onOpenChange={setBulkRejectDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject {selected.size} items</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground">
              This will move all {selected.size} selected items to <strong>Rejected</strong> status. They will not be sent.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setBulkRejectDialog(false)}>Cancel</Button>
            <Button
              variant="destructive" className="rounded-xl"
              disabled={bulkReject.isPending}
              onClick={handleBulkReject}
            >
              {bulkReject.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Reject {selected.size} items
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
