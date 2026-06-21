import {
  useListOutreach,
  useUpdateOutreach,
  useDeleteOutreach,
  useApproveOutreach,
  useRejectOutreach,
  useBulkApproveOutreach,
  useBulkRejectOutreach,
  useListCampaigns,
  useListEmailAccounts,
  useSendOutreachItem,
  useRetryOutreachItem,
  useSendOutreachBatch,
  useSendTestEmail,
  useRegenerateOutreach,
  getListOutreachQueryKey,
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
  Mail,
  MailOpen,
  RefreshCw,
  Zap,
  FlaskConical,
  Ban,
  AlertTriangle,
  Info,
  CheckCircle2,
  MousePointerClick,
  Eye,
  Users,
  MailX,
  SkipForward,
  Pause,
  Play,
  Search,
} from "lucide-react";
import { useMemo, useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

// ── Types ──────────────────────────────────────────────────────────────────

export type OutreachItem = {
  id: number;
  campaignId: number | null;
  leadId: number;
  emailAccountId?: number | null;
  emailTemplateId?: number | null;
  listId?: number | null;
  recipientEmail: string;
  subject: string;
  body: string;
  batchId?: string | null;
  status: string;
  aiPersonalized?: boolean | null;
  failureReason?: string | null;
  retryCount: number;
  trackingId?: string | null;
  openCount?: number | null;
  clickCount?: number | null;
  firstOpenedAt?: string | null;
  lastOpenedAt?: string | null;
  lastClickedAt?: string | null;
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

export type OutreachDisplayRow = {
  id: string;
  kind: "group" | "item";
  items: OutreachItem[];
  primary: OutreachItem;
  count: number;
  title: string;
  subtitle: string;
  subject: string;
  templateName: string | null;
  listName: string | null;
  status: string;
  sentCount: number;
  remainingCount: number;
  date: string;
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
  sending: {
    label: "Sending",
    color: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    icon: <Loader2 className="w-3 h-3 animate-spin" />,
  },
  completed: {
    label: "Completed",
    color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    icon: <CheckCircle className="w-3 h-3" />,
  },
  stopped: {
    label: "Stopped",
    color: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    icon: <Pause className="w-3 h-3" />,
  },
  limit_reached: {
    label: "Daily Limit Reached",
    color: "bg-orange-500/10 text-orange-600 border-orange-500/20",
    icon: <Pause className="w-3 h-3" />,
  },
  approved_limit_account: {
    label: "Waiting · Account Limit",
    color: "bg-orange-500/10 text-orange-600 border-orange-500/20",
    icon: <Pause className="w-3 h-3" />,
  },
  approved_limit_global: {
    label: "Waiting · Global Limit",
    color: "bg-orange-500/10 text-orange-600 border-orange-500/20",
    icon: <Pause className="w-3 h-3" />,
  },
  // ── Derived display statuses ───────────────────────────────────────────────
  opened: {
    label: "Opened",
    color: "bg-purple-500/10 text-purple-600 border-purple-500/20",
    icon: <MailOpen className="w-3 h-3" />,
  },
  clicked: {
    label: "Clicked",
    color: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
    icon: <MousePointerClick className="w-3 h-3" />,
  },
  unsubscribed: {
    label: "Unsubscribed",
    color: "bg-orange-500/10 text-orange-600 border-orange-500/20",
    icon: <MailX className="w-3 h-3" />,
  },
  skipped_unsubscribed: {
    label: "Skipped · Unsubscribed",
    color: "bg-orange-500/10 text-orange-600 border-orange-500/20",
    icon: <SkipForward className="w-3 h-3" />,
  },
  skipped_duplicate: {
    label: "Skipped · Duplicate",
    color: "bg-muted text-muted-foreground border-border",
    icon: <SkipForward className="w-3 h-3" />,
  },
  skipped_invalid: {
    label: "Skipped · Invalid Email",
    color: "bg-destructive/10 text-destructive border-destructive/20",
    icon: <SkipForward className="w-3 h-3" />,
  },
};

const ALL_STATUSES = [
  // Note: "clicked" is intentionally omitted — engagement state collapses
  // into "opened" (see getDisplayStatus). Click counts are shown in their
  // own column, not as a separate status filter.
  "pending_review", "approved", "sent", "opened",
  "unsubscribed", "failed", "bounced", "rejected",
  "skipped_unsubscribed", "skipped_duplicate", "skipped_invalid",
  "draft", "queued",
];

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

/**
 * Derives the rich display status from raw DB fields.
 * Used in the batch detail view and anywhere a per-item status is shown.
 */
export function getDisplayStatus(item: OutreachItem): string {
  // Structured skip reasons (written when antiSpamCheck or doSend skips the item)
  if (item.failureReason === "skipped:unsubscribed") return "skipped_unsubscribed";
  if (item.failureReason === "skipped:duplicate")    return "skipped_duplicate";
  if (item.failureReason === "skipped:invalid_email") return "skipped_invalid";
  if (item.status === "approved" && item.failureReason === "limit:account_daily") {
    return "approved_limit_account";
  }
  if (item.status === "approved" && item.failureReason === "limit:global_daily") {
    return "approved_limit_global";
  }
  // Post-send unsubscribe (recipient clicked the link after receiving the email)
  if (item.status === "sent" && item.failureReason === "unsubscribed") return "unsubscribed";
  // Engagement state (only meaningful once sent).
  // We collapse "opened" and "clicked" into a single "opened" badge so that
  // a batch with a mix of opens and clicks still aggregates correctly (the
  // aggregate badge stays "Opened" instead of falling through to "Completed").
  // Tracking still affects display status, but tracking counts are not shown
  // in the outreach list; delivery progress is shown as sent/remaining.
  if (item.status === "sent" && ((item.openCount ?? 0) > 0 || (item.clickCount ?? 0) > 0)) {
    return "opened";
  }
  return item.status;
}

export function StatusBadge({ status }: { status: string }) {
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

const TERMINAL_STATUSES = new Set([
  "sent", "opened", "clicked", "unsubscribed",
  "failed", "bounced", "rejected",
  "skipped_unsubscribed", "skipped_duplicate", "skipped_invalid",
]);

export function aggregateStatus(items: OutreachItem[]): string {
  // A batch is "stopped" when the user has paused at least one of its pending items
  // (marker written by /outreach/send-batch/cancel). Show the badge accordingly so
  // the user can distinguish a paused batch from a completed one.
  const hasPaused = items.some(
    (item) => item.status === "approved" && item.failureReason === "paused_by_user",
  );
  if (hasPaused) return "stopped";

  const hasLimitBlocked = items.some(
    (item) =>
      item.status === "approved" &&
      (item.failureReason === "limit:account_daily" || item.failureReason === "limit:global_daily"),
  );

  const displayStatuses = items.map((item) => getDisplayStatus(item));
  const statusSet = new Set(displayStatuses);

  // All the same → use that status directly
  if (statusSet.size === 1) return displayStatuses[0] ?? "completed";

  const hasApproved = displayStatuses.some((s) => s === "approved");
  const hasTerminal = displayStatuses.some((s) => TERMINAL_STATUSES.has(s));

  if (hasLimitBlocked) return "limit_reached";

  // Some sent, some still approved → actively sending
  if (hasApproved && hasTerminal) return "sending";

  // Nothing left to send → all done
  if (!hasApproved) return "completed";

  // All waiting (e.g. mix of pending_review + approved)
  return "approved";
}

export function fallbackBatchKey(item: OutreachItem): string {
  if (!item.listId) return `item-${item.id}`;
  const created = new Date(item.createdAt);
  const minuteBucket = Number.isNaN(created.getTime())
    ? item.createdAt
    : created.toISOString().slice(0, 16);
  return [
    "list",
    item.listId,
    item.emailTemplateId ?? "template",
    item.emailAccountId ?? "account",
    minuteBucket,
  ].join("-");
}

export function buildDisplayRows(items: OutreachItem[]): OutreachDisplayRow[] {
  const groups = new Map<string, OutreachItem[]>();

  for (const item of items) {
    const key = item.listId ? (item.batchId || fallbackBatchKey(item)) : `item-${item.id}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return [...groups.entries()].map(([key, groupItems]) => {
    const sorted = [...groupItems].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const primary = sorted[0]!;
    const isGroup = sorted.length > 1 || Boolean(primary.listId);
    const sentCount = sorted.filter((item) => item.status === "sent" || Boolean(item.sentAt)).length;

    return {
      id: key,
      kind: isGroup ? "group" : "item",
      items: sorted,
      primary,
      count: sorted.length,
      title: isGroup ? primary.listName ?? `List #${primary.listId}` : primary.companyName ?? primary.recipientEmail,
      subtitle: isGroup ? "" : primary.campaignName ?? "",
      subject: primary.subject,
      templateName: primary.templateName ?? null,
      listName: primary.listName ?? null,
      status: aggregateStatus(sorted),
      sentCount,
      remainingCount: sorted.length - sentCount,
      date: primary.sentAt ?? primary.approvedAt ?? primary.createdAt,
    };
  });
}

export function formatTrackingTime(value?: string | null): string {
  if (!value) return "Not yet";
  return format(new Date(value), "MMM d, yyyy HH:mm");
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
          <StatusBadge status={getDisplayStatus(item)} />
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
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [campaignFilter, setCampaignFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<OutreachItem | null>(null);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [emailSearch, setEmailSearch] = useState("");

  // Batch send state
  const [batchResult, setBatchResult] = useState<{ sent: number; failed: number; skipped: number; stopped?: boolean } | null>(null);
  const [stoppingBatch, setStoppingBatch] = useState(false);
  const [sendingGroupId, setSendingGroupId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll /api/outreach/send-batch/status so "Sending" persists after page revisit
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}api/outreach/send-batch/status`);
        if (!res.ok || cancelled) return;
        const data = await res.json() as { running: boolean; batchId: string | null };
        if (data.running && data.batchId) {
          setSendingGroupId((prev) => prev ?? data.batchId);
        } else {
          // Send finished — clear state and refresh list
          setSendingGroupId((prev) => {
            if (prev !== null) {
              qc.invalidateQueries({ queryKey: getListOutreachQueryKey() });
            }
            return null;
          });
        }
      } catch { /* network error — ignore */ }
    };
    poll();
    pollRef.current = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [qc]);

  const { data: campaigns } = useListCampaigns();

  // Derived statuses are computed client-side from status + failureReason + tracking counts.
  // They must not be sent to the API as a server-side filter.
  const DERIVED_STATUSES = useMemo(
    () => new Set(["opened", "unsubscribed", "skipped_unsubscribed", "skipped_duplicate", "skipped_invalid"]),
    [],
  );

  const queryParams = {
    campaignId: campaignFilter !== "all" ? Number(campaignFilter) : undefined,
    // For derived statuses, fetch all and filter client-side
    status: statusFilter !== "all" && !DERIVED_STATUSES.has(statusFilter) ? statusFilter : undefined,
  };

  const { data: rawItems, isLoading } = useListOutreach(queryParams);
  const outreachItems = Array.isArray(rawItems) ? (rawItems as OutreachItem[]) : [];
  const campaignRows = Array.isArray(campaigns) ? campaigns : [];
  const filteredOutreachItems = useMemo(() => {
    const q = emailSearch.trim().toLowerCase();
    if (!q) return outreachItems;
    return outreachItems.filter((item) => item.recipientEmail.toLowerCase().includes(q));
  }, [outreachItems, emailSearch]);

  const deleteOutreach = useDeleteOutreach();
  const bulkApprove = useBulkApproveOutreach();
  const bulkReject = useBulkRejectOutreach();
  const sendBatch = useSendOutreachBatch();
  const displayRows = useMemo(() => {
    const rows = buildDisplayRows(filteredOutreachItems);
    if (statusFilter === "all" || !DERIVED_STATUSES.has(statusFilter)) return rows;
    // Client-side filter: keep only rows that contain items matching the derived status
    return rows
      .map((row) => {
        const filtered = row.items.filter((item) => getDisplayStatus(item) === statusFilter);
        return { ...row, items: filtered, count: filtered.length, status: aggregateStatus(filtered) };
      })
      .filter((row) => row.count > 0);
  }, [filteredOutreachItems, statusFilter, DERIVED_STATUSES]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListOutreachQueryKey() });
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

  const handleDeleteGroup = (items: OutreachItem[]) => {
    if (!confirm(`Delete this batch (${items.length} item${items.length === 1 ? "" : "s"})? This cannot be undone.`)) return;
    Promise.all(items.map((item) => deleteOutreach.mutateAsync({ id: item.id }).catch(() => null))).then(() => {
      invalidate();
      setSelected((prev) => {
        const next = new Set(prev);
        items.forEach((item) => next.delete(item.id));
        return next;
      });
    });
  };

  const sendSelectedItems = async (ids: number[]) => {
    const res = await fetch(`${import.meta.env.BASE_URL}api/outreach/send-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(json?.error ?? "Failed to send selected outreach.");
    }
    return json as { sent: number; failed: number; skipped: number; stopped?: boolean };
  };

  const handleSendGroup = async (items: OutreachItem[]) => {
    const ids = items.filter((item) => item.status === "approved").map((item) => item.id);
    if (ids.length === 0 || sendingGroupId || sendBatch.isPending) return;
    const groupId = buildDisplayRows(items)[0]?.id ?? ids.join("-");
    try {
      setBatchResult(null);
      setStoppingBatch(false);
      setSendingGroupId(groupId);
      const result = await sendSelectedItems(ids);
      setBatchResult({ sent: result.sent, failed: result.failed, skipped: result.skipped, stopped: result.stopped });
      invalidate();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send selected outreach.";
      toast({ title: message, variant: "destructive" });
    } finally {
      setSendingGroupId(null);
      setStoppingBatch(false);
    }
  };

  const handleApproveGroup = (items: OutreachItem[]) => {
    const ids = items
      .filter((item) => item.status === "pending_review" || item.status === "draft" || item.status === "queued")
      .map((item) => item.id);
    if (ids.length === 0) return;
    bulkApprove.mutate({ data: { ids } }, { onSuccess: invalidate });
  };

  const handleRejectGroup = (items: OutreachItem[]) => {
    const ids = items
      .filter((item) => item.status === "pending_review" || item.status === "draft" || item.status === "queued" || item.status === "approved")
      .map((item) => item.id);
    if (ids.length === 0) return;
    bulkReject.mutate({ data: { ids } }, { onSuccess: invalidate });
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
      await fetch(`${import.meta.env.BASE_URL}api/outreach/send-batch/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Scope the cancel to just the currently-running batch (if known) so
        // other concurrent batches aren't affected. Empty body pauses all.
        body: JSON.stringify(sendingGroupId ? { batchId: sendingGroupId } : {}),
      });
      // Force a quick refresh so the UI shows "Stopped" badge sooner
      invalidate();
    } catch {
      setStoppingBatch(false);
    }
  };

  const handleSyncTracking = async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/outreach/tracking-sync`, { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.message ?? "Tracking sync failed");
      }
      toast({ title: `Tracking synced for ${json.synced} outreach item${json.synced === 1 ? "" : "s"}.` });
      invalidate();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Tracking sync failed";
      toast({ title: message, variant: "destructive" });
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
    const visibleIds = displayRows.flatMap((row) => row.items.map((item) => item.id));
    if (!visibleIds.length) return;
    if (visibleIds.every((id) => selected.has(id))) setSelected(new Set());
    else setSelected(new Set(visibleIds));
  };

  const statusCounts = ALL_STATUSES.reduce(
    (acc, s) => {
      acc[s] = outreachItems.filter((i) => getDisplayStatus(i) === s).length;
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
            onClick={handleSyncTracking}
          >
            <RefreshCw className="w-4 h-4" /> Sync Tracking
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-1.5"
            onClick={() => setTestDialogOpen(true)}
          >
            <FlaskConical className="w-4 h-4" /> Send Test
          </Button>
          {/* Send Batch button removed — users send/resume per-batch from the row actions.
              The global Stop button only appears while a send is actually in progress. */}
          {sendBatch.isPending && (
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
          )}
        </div>
      </div>

      {/* Stats */}
      {outreachItems.length > 0 && (() => {
        const totalOutreach = displayRows.length;
        const totalEmailsSent = outreachItems.filter((i) => i.status === "sent").length;

        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-card/30 p-3">
              <Send className="w-5 h-5 text-primary" />
              <div>
                <p className="text-lg font-semibold text-foreground leading-none">{totalOutreach}</p>
                <p className="text-xs text-muted-foreground mt-1">Total outreach</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-card/30 p-3">
              <Mail className="w-5 h-5 text-primary" />
              <div>
                <p className="text-lg font-semibold text-foreground leading-none">{totalEmailsSent}</p>
                <p className="text-xs text-muted-foreground mt-1">Total emails sent</p>
              </div>
            </div>
          </div>
        );
      })()}

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

        {campaignFilter !== "all" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs text-muted-foreground"
            onClick={() => setCampaignFilter("all")}
          >
            <X className="w-3 h-3 mr-1" /> Clear
          </Button>
        )}
        <div className="relative min-w-[260px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={emailSearch}
            onChange={(e) => setEmailSearch(e.target.value)}
            placeholder="Search recipient email"
            className="h-9 rounded-xl pl-9 text-sm"
          />
        </div>
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
                    checked={displayRows.length > 0 && displayRows.flatMap((row) => row.items.map((item) => item.id)).every((id) => selected.has(id))}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead>Outreach</TableHead>
                <TableHead>Template</TableHead>
                <TableHead className="w-[100px]">Count</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead className="w-[90px] text-center">Sent</TableHead>
                <TableHead className="w-[110px] text-center">Remaining</TableHead>
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
              ) : displayRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-40 text-center">
                    <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                      <MailOpen className="w-8 h-8 opacity-20" />
                      <p className="text-sm">
                        {emailSearch.trim()
                          ? `No outreach found for “${emailSearch.trim()}”`
                          : statusFilter !== "all" || campaignFilter !== "all"
                          ? "No items match the current filters"
                          : "The queue is empty — queue leads from the Leads page."}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                displayRows.map((row) => (
                  row.kind === "group" ? (
                    <OutreachGroupRow
                      key={row.id}
                      row={row}
                      selected={row.items.every((item) => selected.has(item.id))}
                      onToggle={() => {
                        const allSelected = row.items.every((item) => selected.has(item.id));
                        setSelected((prev) => {
                          const next = new Set(prev);
                          row.items.forEach((item) => {
                            if (allSelected) next.delete(item.id);
                            else next.add(item.id);
                          });
                          return next;
                        });
                      }}
                      onApprove={() => handleApproveGroup(row.items)}
                      onReject={() => handleRejectGroup(row.items)}
                      onSend={() => handleSendGroup(row.items)}
                      onStop={handleStopBatch}
                      onDelete={() => handleDeleteGroup(row.items)}
                      onPreview={() => navigate(`/outreach/batches/${encodeURIComponent(row.id)}`)}
                      isBusy={bulkApprove.isPending || bulkReject.isPending}
                      isSending={sendingGroupId === row.id}
                      isStopping={stoppingBatch && sendingGroupId === row.id}
                      isGlobalSending={sendBatch.isPending && sendingGroupId !== row.id}
                    />
                  ) : (
                    <OutreachRow
                      key={row.primary.id}
                      item={row.primary}
                      selected={selected.has(row.primary.id)}
                      isPreview={preview?.id === row.primary.id}
                      onToggle={() => toggleRow(row.primary.id)}
                      onPreview={() => setPreview(preview?.id === row.primary.id ? null : row.primary)}
                      onDelete={() => handleDelete(row.primary.id)}
                      onRefresh={invalidate}
                    />
                  )
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

function OutreachGroupRow({
  row,
  selected,
  onToggle,
  onApprove,
  onReject,
  onSend,
  onStop,
  onDelete,
  onPreview,
  isBusy,
  isSending,
  isStopping,
  isGlobalSending,
}: {
  row: OutreachDisplayRow;
  selected: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onReject: () => void;
  onSend: () => void;
  onStop: () => void;
  onDelete: () => void;
  onPreview: () => void;
  isBusy: boolean;
  isSending: boolean;
  isStopping: boolean;
  isGlobalSending: boolean;
}) {
  const approvableCount = row.items.filter((item) => item.status === "pending_review" || item.status === "draft" || item.status === "queued").length;
  const rejectableCount = row.items.filter((item) => item.status === "pending_review" || item.status === "draft" || item.status === "queued" || item.status === "approved").length;
  const sendableCount = row.items.filter((item) => item.status === "approved").length;

  return (
    <TableRow
      className={cn(
        "group border-border/30 transition-colors cursor-pointer",
        selected && "bg-muted/40",
      )}
      onClick={onPreview}
    >
      <TableCell className="pl-4 w-10" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selected} onCheckedChange={onToggle} aria-label={`Select outreach ${row.title}`} />
      </TableCell>

      <TableCell className="font-medium max-w-[220px]">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Users className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm">{row.title}</div>
            <div className="text-xs text-muted-foreground truncate">{row.subtitle}</div>
          </div>
        </div>
      </TableCell>

      <TableCell className="max-w-[260px]">
        <p className="truncate text-sm">{row.templateName ?? <span className="italic text-muted-foreground">No template</span>}</p>
      </TableCell>

      <TableCell>
        <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/30 px-2.5 py-1 text-xs font-medium">
          {row.count} email{row.count === 1 ? "" : "s"}
        </span>
      </TableCell>

      <TableCell>
        {isSending ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            <Loader2 className="w-3 h-3 animate-spin" />
            Sending
          </span>
        ) : (
          <StatusBadge status={row.status} />
        )}
      </TableCell>

      <TableCell className="text-center">
        <span className={cn("text-sm font-semibold", row.sentCount > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/50")}>
          {row.sentCount}
        </span>
      </TableCell>

      <TableCell className="text-center">
        <span className={cn("text-sm font-semibold", row.remainingCount > 0 ? "text-amber-600" : "text-muted-foreground/50")}>
          {row.remainingCount}
        </span>
      </TableCell>

      <TableCell className="text-xs text-muted-foreground">
        {format(new Date(row.date), "MMM d, HH:mm")}
      </TableCell>

      <TableCell className="text-right pr-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
          {approvableCount > 0 && (
            <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-green-600 hover:bg-green-500/10"
              onClick={onApprove} disabled={isBusy} title={`Approve ${approvableCount}`}>
              <ThumbsUp className="w-3.5 h-3.5 mr-1" /> Approve
            </Button>
          )}
          {isSending ? (
            <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-destructive hover:bg-destructive/10"
              onClick={onStop} disabled={isStopping} title="Stop sending">
              {isStopping ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <X className="w-3.5 h-3.5 mr-1" />}
              {isStopping ? "Stopping" : "Stop"}
            </Button>
          ) : isGlobalSending && sendableCount > 0 ? (
            <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-primary/60 cursor-default" disabled title="Sending…">
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> Sending…
            </Button>
          ) : row.status === "stopped" && sendableCount > 0 ? (
            <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-amber-600 hover:bg-amber-500/10"
              onClick={onSend} disabled={isBusy} title={`Resume ${sendableCount} pending email(s)`}>
              <Play className="w-3.5 h-3.5 mr-1" /> Resume
            </Button>
          ) : sendableCount > 0 && (
            <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-primary hover:bg-primary/10"
              onClick={onSend} disabled={isBusy} title={`Send ${sendableCount}`}>
              <Send className="w-3.5 h-3.5 mr-1" /> Send
            </Button>
          )}
          {!isSending && rejectableCount > 0 && (
            <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg text-destructive hover:bg-destructive/10"
              onClick={onReject} disabled={isBusy} title={`Reject ${rejectableCount}`}>
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg text-destructive/60 hover:text-destructive hover:bg-destructive/10"
            onClick={onDelete} disabled={isBusy || isSending} title="Delete batch">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

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
        {item.campaignName && !item.companyName && (
          <div className="text-xs text-muted-foreground truncate">{item.campaignName}</div>
        )}
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

      <TableCell><StatusBadge status={getDisplayStatus(item)} /></TableCell>

      <TableCell className="text-center">
        <span className={cn("text-sm font-semibold", item.status === "sent" || item.sentAt ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/50")}>
          {item.status === "sent" || item.sentAt ? 1 : 0}
        </span>
      </TableCell>

      <TableCell className="text-center">
        <span className={cn("text-sm font-semibold", item.status === "sent" || item.sentAt ? "text-muted-foreground/50" : "text-amber-600")}>
          {item.status === "sent" || item.sentAt ? 0 : 1}
        </span>
      </TableCell>

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
