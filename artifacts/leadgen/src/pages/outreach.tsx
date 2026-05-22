import {
  useListOutreach,
  useUpdateOutreach,
  useDeleteOutreach,
  useApproveOutreach,
  useRejectOutreach,
  useBulkApproveOutreach,
  useListCampaigns,
  useListEmailAccounts,
  useSendOutreachItem,
  useRetryOutreachItem,
  useSendOutreachBatch,
  useSendTestEmail,
  useGetSendStats,
  useRegenerateOutreach,
  getListOutreachQueryKey,
  getGetSendStatsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import {
  CheckCircle,
  AlertCircle,
  Clock,
  Send,
  Loader2,
  Trash2,
  Pencil,
  ThumbsUp,
  FileText,
  Filter,
  X,
  ChevronRight,
  MailOpen,
  RefreshCw,
  Zap,
  FlaskConical,
  TrendingUp,
  Ban,
  AlertTriangle,
  Info,
  CheckCircle2,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────

type OutreachItem = {
  id: number;
  campaignId: number | null;
  leadId: number;
  emailAccountId?: number | null;
  emailTemplateId?: number | null;
  listId?: number | null;
  recipientEmail: string;
  subject: string;
  body: string;
  status: string;
  aiPersonalized?: boolean | null;
  failureReason?: string | null;
  retryCount: number;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  scheduledAt?: string | null;
  sentAt?: string | null;
  bouncedAt?: string | null;
  companyName?: string | null;
  campaignName?: string | null;
  templateName?: string | null;
  senderEmail?: string | null;
  listName?: string | null;
  relevanceScore?: number | null;
  qualificationStatus?: string | null;
  recipientEmailType?: string | null;
  qualityWarnings?: QualityWarning[];
  createdAt: string;
  updatedAt: string;
};

type QualityWarning = {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
};

// ── Status config ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  pending_review: {
    label: "Needs Review",
    color: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    icon: <AlertCircle className="w-3 h-3" />,
  },
  draft: {
    label: "Draft",
    color: "bg-muted text-muted-foreground border-border",
    icon: <FileText className="w-3 h-3" />,
  },
  queued: {
    label: "Queued",
    color: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    icon: <Clock className="w-3 h-3" />,
  },
  approved: {
    label: "Approved",
    color: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    icon: <ThumbsUp className="w-3 h-3" />,
  },
  sent: {
    label: "Sent",
    color: "bg-green-500/10 text-green-600 border-green-500/20",
    icon: <CheckCircle className="w-3 h-3" />,
  },
  failed: {
    label: "Failed",
    color: "bg-destructive/10 text-destructive border-destructive/20",
    icon: <AlertCircle className="w-3 h-3" />,
  },
  bounced: {
    label: "Bounced",
    color: "bg-orange-500/10 text-orange-600 border-orange-500/20",
    icon: <Ban className="w-3 h-3" />,
  },
  rejected: {
    label: "Rejected",
    color: "bg-destructive/10 text-destructive border-destructive/20",
    icon: <X className="w-3 h-3" />,
  },
};

const ALL_STATUSES = ["pending_review", "approved", "sent", "failed", "bounced", "rejected", "draft", "queued"];

const SEVERITY_ICON: Record<QualityWarning["severity"], React.ReactNode> = {
  error: <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />,
  warning: <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />,
  info: <Info className="w-3.5 h-3.5 text-blue-400 shrink-0" />,
};

const SEVERITY_COLOR: Record<QualityWarning["severity"], string> = {
  error: "text-destructive",
  warning: "text-amber-500",
  info: "text-blue-400",
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? {
    label: status,
    color: "bg-muted text-muted-foreground border-border",
    icon: null,
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border",
        cfg.color,
      )}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function WarningBadge({ warnings = [] }: { warnings?: QualityWarning[] }) {
  const errors = warnings.filter((w) => w.severity === "error").length;
  const warningCount = warnings.filter((w) => w.severity === "warning").length;

  if (errors > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/5 px-2 py-0.5 text-[10px] font-medium text-destructive">
        <AlertCircle className="w-3 h-3" />
        {errors} error{errors !== 1 ? "s" : ""}
      </span>
    );
  }

  if (warningCount > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/5 px-2 py-0.5 text-[10px] font-medium text-amber-600">
        <AlertTriangle className="w-3 h-3" />
        {warningCount} warning{warningCount !== 1 ? "s" : ""}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-green-500/30 bg-green-500/5 px-2 py-0.5 text-[10px] font-medium text-green-600">
      <CheckCircle2 className="w-3 h-3" />
      Clean
    </span>
  );
}

function QualityPanel({ warnings = [] }: { warnings?: QualityWarning[] }) {
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
      {warnings.map((warning) => (
        <div key={warning.code} className="flex items-start gap-2 text-xs">
          {SEVERITY_ICON[warning.severity]}
          <span className={cn("leading-relaxed", SEVERITY_COLOR[warning.severity])}>
            {warning.message}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Send Test dialog ────────────────────────────────────────────────────────

function SendTestDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data: accounts } = useListEmailAccounts();
  const sendTest = useSendTestEmail();
  const accountRows = Array.isArray(accounts) ? accounts : [];

  const [accountId, setAccountId] = useState("");
  const [toEmail, setToEmail] = useState("");
  const [subject, setSubject] = useState("Test email — Lead Intelligence Platform");
  const [body, setBody] = useState(
    "This is a test email to verify your SMTP configuration is working correctly.",
  );
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleSend = () => {
    if (!accountId || !toEmail) return;
    setResult(null);
    sendTest.mutate(
      {
        data: {
          emailAccountId: Number(accountId),
          toEmail,
          subject,
          body,
        },
      },
      {
        onSuccess: (r) => setResult(r as { ok: boolean; message: string }),
      },
    );
  };

  const handleClose = () => {
    setResult(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-primary" /> Send Test Email
          </DialogTitle>
          <DialogDescription>
            Send a test email using one of your configured SMTP accounts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Sending account</Label>
            {accountRows.length > 0 ? (
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {accountRows.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.smtpUser}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">
                No email accounts configured. Add one in Accounts.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Send to</Label>
            <Input
              type="email"
              placeholder="you@example.com"
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              className="rounded-xl"
            />
          </div>

          <div className="space-y-2">
            <Label>Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="rounded-xl"
            />
          </div>

          <div className="space-y-2">
            <Label>Body</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="rounded-xl min-h-[100px] resize-y"
            />
          </div>

          {result && (
            <div
              className={cn(
                "flex items-start gap-3 p-3 rounded-xl text-sm",
                result.ok
                  ? "bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400"
                  : "bg-destructive/10 border border-destructive/20 text-destructive",
              )}
            >
              {result.ok ? (
                <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <span>{result.message}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" className="rounded-xl" onClick={handleClose}>
            Close
          </Button>
          <Button
            className="rounded-xl"
            onClick={handleSend}
            disabled={!accountId || !toEmail || sendTest.isPending}
          >
            {sendTest.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Send className="w-4 h-4 mr-2" />
            )}
            Send Test
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Send Stats bar ──────────────────────────────────────────────────────────

function SendStatsBar() {
  const { data: stats } = useGetSendStats();
  const campaignStats = Array.isArray(stats?.campaigns) ? stats.campaigns : [];
  const accountStats = Array.isArray(stats?.accounts) ? stats.accounts : [];

  if (!stats || (campaignStats.length === 0 && accountStats.length === 0)) {
    return null;
  }

  const totalSentToday = campaignStats.reduce((s, c) => s + c.sentToday, 0);
  const totalLimit = campaignStats.reduce((s, c) => s + c.dailyLimit, 0);
  const activeCampaigns = campaignStats.filter((c) => c.sentToday > 0).length;
  const accountsAtLimit = accountStats.filter((a) => a.sentToday >= a.dailyLimit).length;

  return (
    <div className="flex items-center gap-4 px-4 py-3 rounded-xl bg-muted/30 border border-border/40 text-sm">
      <TrendingUp className="w-4 h-4 text-primary shrink-0" />
      <span className="font-medium text-foreground">
        {totalSentToday} sent today
      </span>
      {totalLimit > 0 && (
        <span className="text-muted-foreground">
          out of {totalLimit} daily limit
        </span>
      )}
      {activeCampaigns > 0 && (
        <span className="text-muted-foreground hidden sm:inline">
          · {activeCampaigns} campaign{activeCampaigns !== 1 ? "s" : ""} active
        </span>
      )}
      {accountsAtLimit > 0 && (
        <span className="text-amber-600 font-medium hidden sm:inline">
          · {accountsAtLimit} account{accountsAtLimit !== 1 ? "s" : ""} at daily limit
        </span>
      )}
      <div className="ml-auto flex gap-3 shrink-0">
        {campaignStats.slice(0, 3).map((c) => (
          <div key={c.campaignId} className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground truncate max-w-[100px]">{c.campaignName}</span>
            <span
              className={cn(
                "font-medium",
                c.sentToday >= c.dailyLimit ? "text-amber-600" : "text-foreground",
              )}
            >
              {c.sentToday}/{c.dailyLimit}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Preview Panel ───────────────────────────────────────────────────────────

function PreviewPanel({
  item,
  onClose,
  onSaved,
}: {
  item: OutreachItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const updateOutreach = useUpdateOutreach();
  const approveOutreach = useApproveOutreach();
  const sendItem = useSendOutreachItem();
  const retryItem = useRetryOutreachItem();
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(item.subject);
  const [body, setBody] = useState(item.body);

  const canApprove = item.status === "pending_review" || item.status === "draft" || item.status === "queued";
  const canEdit = item.status === "pending_review" || item.status === "draft" || item.status === "queued" || item.status === "approved";
  const canSend = item.status === "approved";
  const canRetry = item.status === "failed" || item.status === "bounced";

  const handleSave = () => {
    updateOutreach.mutate(
      { id: item.id, data: { subject, body } },
      { onSuccess: () => { setEditing(false); onSaved(); } },
    );
  };

  const handleApprove = () => {
    approveOutreach.mutate({ id: item.id }, { onSuccess: onSaved });
  };

  const handleSend = () => {
    sendItem.mutate({ id: item.id }, { onSuccess: onSaved });
  };

  const handleRetry = () => {
    retryItem.mutate({ id: item.id }, { onSuccess: onSaved });
  };

  const isBusy = sendItem.isPending || retryItem.isPending || approveOutreach.isPending || updateOutreach.isPending;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="pb-4 border-b border-border/50 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-base leading-tight truncate">
              {item.companyName ?? item.recipientEmail}
            </p>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {item.recipientEmail}
              {item.campaignName && (
                <span className="ml-1.5">· {item.campaignName}</span>
              )}
            </p>
          </div>
          <StatusBadge status={item.status} />
        </div>
        {item.retryCount > 0 && (
          <p className="text-xs text-muted-foreground">
            Tried {item.retryCount} time{item.retryCount !== 1 ? "s" : ""}
          </p>
        )}
        <div className="flex items-center gap-2 pt-2 flex-wrap">
          {item.relevanceScore != null && (
            <span className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
              item.relevanceScore >= 70
                ? "border-green-500/30 bg-green-500/5 text-green-600"
                : item.relevanceScore >= 40
                  ? "border-amber-500/30 bg-amber-500/5 text-amber-600"
                  : "border-destructive/30 bg-destructive/5 text-destructive",
            )}>
              Score: {item.relevanceScore}
            </span>
          )}
          {item.recipientEmailType && item.recipientEmailType !== "personal" && (
            <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/5 px-2 py-0.5 text-[10px] font-medium capitalize text-amber-600">
              {item.recipientEmailType}
            </span>
          )}
          <WarningBadge warnings={item.qualityWarnings} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-4 space-y-4">
        {/* Subject */}
        <div className="space-y-1.5">
          <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            Subject
          </Label>
          {editing ? (
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="rounded-xl" />
          ) : (
            <p className="text-sm font-medium leading-snug">{item.subject}</p>
          )}
        </div>

        {/* Body */}
        <div className="space-y-1.5">
          <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            Body
          </Label>
          {editing ? (
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="rounded-xl min-h-[180px] font-mono text-sm leading-relaxed resize-y"
            />
          ) : (
            <div className="text-sm whitespace-pre-wrap leading-relaxed text-foreground bg-muted/20 border border-border/40 rounded-xl p-3">
              {item.body}
            </div>
          )}
        </div>

        {/* Failure/bounce reason */}
        {item.failureReason && !editing && (
          <div className="p-3 rounded-xl bg-destructive/5 border border-destructive/20 text-xs text-destructive leading-relaxed">
            <span className="font-semibold">Error: </span>{item.failureReason}
          </div>
        )}

        {!editing && (
          <div className="border border-border/40 rounded-xl p-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">
              Quality Analysis
            </p>
            <QualityPanel warnings={item.qualityWarnings} />
          </div>
        )}

        {/* Timeline */}
        {!editing && (
          <div className="space-y-2 pt-2 border-t border-border/40">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Timeline</p>
            {[
              { label: "Created", ts: item.createdAt },
              { label: "Approved", ts: item.approvedAt },
              { label: "Sent", ts: item.sentAt },
              { label: "Bounced", ts: item.bouncedAt },
            ]
              .filter((r) => r.ts)
              .map((r) => (
                <div key={r.label} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className="font-medium">{format(new Date(r.ts!), "MMM d, yyyy HH:mm")}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="border-t border-border/50 pt-4 space-y-2">
        {editing ? (
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 rounded-xl" onClick={() => { setSubject(item.subject); setBody(item.body); setEditing(false); }}>
              Cancel
            </Button>
            <Button className="flex-1 rounded-xl" onClick={handleSave} disabled={updateOutreach.isPending}>
              {updateOutreach.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Save
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Primary actions */}
            <div className="flex gap-2">
              {canSend && (
                <Button className="flex-1 rounded-xl" onClick={handleSend} disabled={isBusy}>
                  {sendItem.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                  Send Now
                </Button>
              )}
              {canRetry && (
                <Button className="flex-1 rounded-xl" onClick={handleRetry} disabled={isBusy}>
                  {retryItem.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  Retry
                </Button>
              )}
              {canApprove && (
                <Button className="flex-1 rounded-xl" onClick={handleApprove} disabled={isBusy}>
                  {approveOutreach.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ThumbsUp className="w-4 h-4 mr-2" />}
                  Approve
                </Button>
              )}
            </div>
            {/* Edit button */}
            {canEdit && (
              <Button variant="outline" className="w-full rounded-xl" onClick={() => setEditing(true)}>
                <Pencil className="w-4 h-4 mr-2" /> Edit
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function Outreach() {
  const qc = useQueryClient();
  const [campaignFilter, setCampaignFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<OutreachItem | null>(null);
  const [testDialogOpen, setTestDialogOpen] = useState(false);

  // Batch send state
  const [batchResult, setBatchResult] = useState<{ sent: number; failed: number; skipped: number; stopped?: boolean } | null>(null);
  const [stoppingBatch, setStoppingBatch] = useState(false);

  const { data: campaigns } = useListCampaigns();

  const queryParams = {
    campaignId: campaignFilter !== "all" ? Number(campaignFilter) : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
  };

  const { data: rawItems, isLoading } = useListOutreach(queryParams);
  const outreachItems = Array.isArray(rawItems) ? (rawItems as OutreachItem[]) : [];
  const campaignRows = Array.isArray(campaigns) ? campaigns : [];

  const deleteOutreach = useDeleteOutreach();
  const bulkApprove = useBulkApproveOutreach();
  const sendBatch = useSendOutreachBatch();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListOutreachQueryKey() });
    qc.invalidateQueries({ queryKey: getGetSendStatsQueryKey() });
  };

  const handleDelete = (id: number) => {
    if (confirm("Remove this item from the queue?")) {
      deleteOutreach.mutate({ id }, {
        onSuccess: () => { invalidate(); if (preview?.id === id) setPreview(null); },
      });
    }
  };

  const handleBulkApprove = () => {
    const ids = [...selected].filter((id) => {
      const item = outreachItems.find((i) => i.id === id);
      return item && (item.status === "pending_review" || item.status === "draft" || item.status === "queued");
    });
    if (ids.length === 0) return;
    bulkApprove.mutate(
      { data: { ids } },
      { onSuccess: () => { invalidate(); setSelected(new Set()); } },
    );
  };

  const handleBulkDelete = () => {
    if (!confirm(`Delete ${selected.size} selected items?`)) return;
    Promise.all([...selected].map((id) => deleteOutreach.mutateAsync({ id }).catch(() => null))).then(() => {
      invalidate();
      setSelected(new Set());
    });
  };

  const handleSendBatch = () => {
    setBatchResult(null);
    setStoppingBatch(false);
    sendBatch.mutate(undefined, {
      onSuccess: (r) => {
        const result = r as { sent: number; failed: number; skipped: number; stopped?: boolean };
        setBatchResult({ sent: result.sent, failed: result.failed, skipped: result.skipped, stopped: result.stopped });
        setStoppingBatch(false);
        invalidate();
      },
      onError: () => {
        setStoppingBatch(false);
        setBatchResult({ sent: 0, failed: 1, skipped: 0 });
      },
    });
  };

  const handleStopBatch = async () => {
    setStoppingBatch(true);
    try {
      await fetch(`${import.meta.env.BASE_URL}api/outreach/send-batch/cancel`, { method: "POST" });
    } catch {
      setStoppingBatch(false);
    }
  };

  const toggleRow = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!outreachItems.length) return;
    if (selected.size === outreachItems.length) setSelected(new Set());
    else setSelected(new Set(outreachItems.map((i) => i.id)));
  };

  const statusCounts = ALL_STATUSES.reduce(
    (acc, s) => {
      acc[s] = outreachItems.filter((i) => i.status === s).length;
      return acc;
    },
    {} as Record<string, number>,
  );

  const approvedCount = outreachItems.filter((i) => i.status === "approved").length;
  const errorCount = outreachItems.filter((item) =>
    (item.qualityWarnings ?? []).some((warning) => warning.severity === "error"),
  ).length;
  const warningCount = outreachItems.filter((item) => {
    const warnings = item.qualityWarnings ?? [];
    return !warnings.some((warning) => warning.severity === "error") && warnings.some((warning) => warning.severity === "warning");
  }).length;
  const cleanCount = outreachItems.filter((item) => {
    const warnings = item.qualityWarnings ?? [];
    return warnings.length === 0 || warnings.every((warning) => warning.severity === "info");
  }).length;
  const approvableSelected = [...selected].filter((id) => {
    const item = outreachItems.find((i) => i.id === id);
    return item && (item.status === "pending_review" || item.status === "draft" || item.status === "queued");
  }).length;

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Outreach Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review, approve, and send emails to qualified leads
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-1.5"
            onClick={() => setTestDialogOpen(true)}
          >
            <FlaskConical className="w-4 h-4" /> Send Test
          </Button>
          {sendBatch.isPending ? (
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10"
              onClick={handleStopBatch}
              disabled={stoppingBatch}
            >
              {stoppingBatch ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
              {stoppingBatch ? "Stopping…" : "Stop Sending"}
            </Button>
          ) : (
            <Button
              size="sm"
              className="rounded-xl gap-1.5"
              onClick={handleSendBatch}
              disabled={approvedCount === 0}
            >
              <Zap className="w-4 h-4" />
              {`Send Batch${approvedCount > 0 ? ` (${approvedCount})` : ""}`}
            </Button>
          )}
        </div>
      </div>

      {/* Send stats bar */}
      <SendStatsBar />

      {/* Review summary */}
      {outreachItems.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex items-center gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-3">
            <AlertCircle className="w-5 h-5 text-destructive" />
            <div>
              <p className="text-lg font-semibold text-destructive leading-none">{errorCount}</p>
              <p className="text-xs text-muted-foreground mt-1">Has errors</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <div>
              <p className="text-lg font-semibold text-amber-500 leading-none">{warningCount}</p>
              <p className="text-xs text-muted-foreground mt-1">Has warnings</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-green-500/20 bg-green-500/5 p-3">
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            <div>
              <p className="text-lg font-semibold text-green-500 leading-none">{cleanCount}</p>
              <p className="text-xs text-muted-foreground mt-1">Clean</p>
            </div>
          </div>
        </div>
      )}

      {/* Batch send result banner */}
      {batchResult && (
        <div className={cn(
          "flex items-center gap-3 px-4 py-3 rounded-xl border text-sm",
          batchResult.stopped
            ? "bg-amber-500/10 border-amber-500/20"
            : "bg-green-500/10 border-green-500/20",
        )}>
          {batchResult.stopped ? (
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          ) : (
            <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
          )}
          <span className={cn("font-medium", batchResult.stopped ? "text-amber-600" : "text-green-700 dark:text-green-400")}>
            {batchResult.stopped ? "Batch stopped:" : "Batch complete:"}
          </span>
          <span className="text-foreground">
            {batchResult.sent} sent · {batchResult.failed} failed · {batchResult.skipped} skipped
          </span>
          <button
            className="ml-auto text-muted-foreground hover:text-foreground"
            onClick={() => setBatchResult(null)}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={campaignFilter} onValueChange={setCampaignFilter}>
            <SelectTrigger className="h-9 w-44 rounded-xl text-sm">
              <SelectValue placeholder="All campaigns" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All campaigns</SelectItem>
              {campaignRows.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Status tabs */}
        <div className="flex items-center gap-1 bg-muted/50 rounded-xl p-1 border border-border/50 flex-wrap">
          {["all", ...ALL_STATUSES].map((s) => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setSelected(new Set()); }}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                statusFilter === s
                  ? "bg-background text-foreground shadow-sm border border-border/50"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s === "all" ? "All" : STATUS_CONFIG[s]?.label ?? s}
              {s !== "all" && statusCounts[s] > 0 && (
                <span className="ml-1.5 opacity-60">{statusCounts[s]}</span>
              )}
            </button>
          ))}
        </div>

        {(campaignFilter !== "all" || statusFilter !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs text-muted-foreground"
            onClick={() => { setCampaignFilter("all"); setStatusFilter("all"); }}
          >
            <X className="w-3 h-3 mr-1" /> Clear
          </Button>
        )}
      </div>

      {/* Bulk action toolbar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-primary/5 border border-primary/20 flex-wrap">
          <span className="text-sm font-medium text-primary">{selected.size} selected</span>
          <div className="flex gap-2 ml-auto flex-wrap">
            {approvableSelected > 0 && (
              <Button size="sm" className="h-8 rounded-xl text-xs" onClick={handleBulkApprove} disabled={bulkApprove.isPending}>
                {bulkApprove.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <ThumbsUp className="w-3.5 h-3.5 mr-1.5" />}
                Approve {approvableSelected}
              </Button>
            )}
            <Button size="sm" variant="outline"
              className="h-8 rounded-xl text-xs text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20"
              onClick={handleBulkDelete} disabled={deleteOutreach.isPending}>
              <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete {selected.size}
            </Button>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 rounded-xl" onClick={() => setSelected(new Set())}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Table + Preview panel */}
      <div className="flex gap-5">
        <div className="glass-card overflow-hidden flex-1 min-w-0 rounded-2xl">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow className="border-border/30 hover:bg-transparent">
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    checked={!!outreachItems && outreachItems.length > 0 && selected.size === outreachItems.length}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead className="w-[150px]">Quality</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead className="w-[140px]">Date</TableHead>
                <TableHead className="w-[160px] text-right pr-4">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-border/20">
                    <TableCell className="pl-4"><div className="w-4 h-4 rounded bg-muted/50 animate-pulse" /></TableCell>
                    <TableCell>
                      <div className="space-y-1.5">
                        <div className="h-4 w-32 bg-muted/50 rounded animate-pulse" />
                        <div className="h-3 w-44 bg-muted/50 rounded animate-pulse" />
                      </div>
                    </TableCell>
                    <TableCell><div className="h-4 bg-muted/50 rounded animate-pulse" style={{ width: `${55 + i * 7}%` }} /></TableCell>
                    <TableCell><div className="h-5 w-24 bg-muted/50 rounded-full animate-pulse" /></TableCell>
                    <TableCell><div className="h-5 w-20 bg-muted/50 rounded-full animate-pulse" /></TableCell>
                    <TableCell><div className="h-4 w-24 bg-muted/50 rounded animate-pulse" /></TableCell>
                    <TableCell><div className="h-7 w-16 bg-muted/50 rounded-lg animate-pulse ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : outreachItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-40 text-center">
                    <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                      <MailOpen className="w-8 h-8 opacity-20" />
                      <p className="text-sm">
                        {statusFilter !== "all" || campaignFilter !== "all"
                          ? "No items match the current filters"
                          : "The queue is empty — queue leads from the Leads page."}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                outreachItems.map((item) => (
                  <OutreachRow
                    key={item.id}
                    item={item}
                    selected={selected.has(item.id)}
                    isPreview={preview?.id === item.id}
                    onToggle={() => toggleRow(item.id)}
                    onPreview={() => setPreview(preview?.id === item.id ? null : item)}
                    onDelete={() => handleDelete(item.id)}
                    onRefresh={invalidate}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Preview panel */}
        {preview && (
          <div className="w-[360px] shrink-0 glass-card rounded-2xl p-5 flex flex-col max-h-[calc(100vh-200px)] sticky top-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Email Preview</h3>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg" onClick={() => setPreview(null)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <PreviewPanel
              key={preview.id}
              item={outreachItems.find((i) => i.id === preview.id) ?? preview}
              onClose={() => setPreview(null)}
              onSaved={() => { invalidate(); }}
            />
          </div>
        )}
      </div>

      {/* Send Test dialog */}
      <SendTestDialog open={testDialogOpen} onClose={() => setTestDialogOpen(false)} />
    </div>
  );
}

// ── Row component (extracted for clarity) ──────────────────────────────────

function OutreachRow({
  item,
  selected,
  isPreview,
  onToggle,
  onPreview,
  onDelete,
  onRefresh,
}: {
  item: OutreachItem;
  selected: boolean;
  isPreview: boolean;
  onToggle: () => void;
  onPreview: () => void;
  onDelete: () => void;
  onRefresh: () => void;
}) {
  const sendItem = useSendOutreachItem();
  const retryItem = useRetryOutreachItem();
  const approveOutreach = useApproveOutreach();
  const rejectOutreach = useRejectOutreach();
  const regenerateOutreach = useRegenerateOutreach();

  const canSend = item.status === "approved";
  const canRetry = item.status === "failed" || item.status === "bounced";
  const canApprove = item.status === "pending_review" || item.status === "draft" || item.status === "queued";
  const canRegenerate = item.status === "pending_review" || item.status === "rejected" || item.status === "draft" || item.status === "queued";
  const isBusy = sendItem.isPending || retryItem.isPending || approveOutreach.isPending || rejectOutreach.isPending || regenerateOutreach.isPending;
  const warnings = item.qualityWarnings ?? [];

  const handleSend = (e: React.MouseEvent) => {
    e.stopPropagation();
    sendItem.mutate({ id: item.id }, { onSuccess: onRefresh });
  };

  const handleRetry = (e: React.MouseEvent) => {
    e.stopPropagation();
    retryItem.mutate({ id: item.id }, { onSuccess: onRefresh });
  };

  const handleApprove = (e: React.MouseEvent) => {
    e.stopPropagation();
    approveOutreach.mutate({ id: item.id }, { onSuccess: onRefresh });
  };

  const handleReject = (e: React.MouseEvent) => {
    e.stopPropagation();
    rejectOutreach.mutate({ id: item.id, data: {} }, { onSuccess: onRefresh });
  };

  const handleRegenerate = (e: React.MouseEvent) => {
    e.stopPropagation();
    regenerateOutreach.mutate({ id: item.id, data: { forceAi: false } }, { onSuccess: onRefresh });
  };

  return (
    <TableRow
      className={cn(
        "group border-border/30 transition-colors cursor-pointer",
        isPreview && "bg-primary/5",
        selected && "bg-muted/40",
      )}
      onClick={onPreview}
    >
      <TableCell className="pl-4 w-10" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selected} onCheckedChange={onToggle} aria-label={`Select item ${item.id}`} />
      </TableCell>

      <TableCell className="font-medium max-w-[170px]">
        <div className="truncate text-sm">{item.companyName ?? item.recipientEmail}</div>
        <div className="text-xs text-muted-foreground truncate font-mono">
          {item.companyName ? item.recipientEmail : (item.campaignName ?? "")}
        </div>
        {item.listName && <div className="text-[10px] text-muted-foreground/70 truncate">List: {item.listName}</div>}
      </TableCell>

      <TableCell className="max-w-[220px]">
        <p className="truncate text-sm">{item.subject}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {item.aiPersonalized && (
            <span className="inline-flex items-center gap-1 text-[10px] text-blue-500">
              <Zap className="w-3 h-3" /> AI
            </span>
          )}
          {item.templateName && <span className="text-[10px] text-muted-foreground truncate">{item.templateName}</span>}
          {item.retryCount > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {item.retryCount} attempt{item.retryCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </TableCell>

      <TableCell>
        <div className="space-y-1">
          <WarningBadge warnings={warnings} />
          {item.relevanceScore != null && (
            <div className={cn(
              "text-[11px] font-medium",
              item.relevanceScore >= 70 ? "text-green-600" : item.relevanceScore >= 40 ? "text-amber-500" : "text-destructive",
            )}>
              Score: {item.relevanceScore}
            </div>
          )}
        </div>
      </TableCell>

      <TableCell><StatusBadge status={item.status} /></TableCell>

      <TableCell className="text-xs text-muted-foreground">
        {item.sentAt
          ? format(new Date(item.sentAt), "MMM d, HH:mm")
          : item.approvedAt
            ? format(new Date(item.approvedAt), "MMM d, HH:mm")
            : format(new Date(item.createdAt), "MMM d, HH:mm")}
      </TableCell>

      <TableCell className="text-right pr-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
          {canApprove && (
            <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg text-green-600 hover:bg-green-500/10"
              onClick={handleApprove} disabled={isBusy} title="Approve">
              {approveOutreach.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ThumbsUp className="w-3.5 h-3.5" />}
            </Button>
          )}
          {canSend && (
            <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg text-primary hover:bg-primary/10"
              onClick={handleSend} disabled={isBusy} title="Send now">
              {sendItem.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </Button>
          )}
          {canRetry && (
            <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg text-amber-600 hover:bg-amber-500/10"
              onClick={handleRetry} disabled={isBusy} title="Retry">
              {retryItem.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </Button>
          )}
          {canRegenerate && (
            <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg text-amber-600 hover:bg-amber-500/10"
              onClick={handleRegenerate} disabled={isBusy} title="Regenerate">
              {regenerateOutreach.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </Button>
          )}
          {canApprove && (
            <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg text-destructive hover:bg-destructive/10"
              onClick={handleReject} disabled={isBusy} title="Reject">
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg"
            onClick={(e) => { e.stopPropagation(); onPreview(); }} title="Preview">
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg text-destructive hover:bg-destructive/10"
            onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
