import {
  useListOutreach,
  useUpdateOutreach,
  useDeleteOutreach,
  useApproveOutreach,
  useBulkApproveOutreach,
  useListCampaigns,
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

type OutreachItem = {
  id: number;
  campaignId: number;
  leadId: number;
  emailAccountId?: number | null;
  recipientEmail: string;
  subject: string;
  body: string;
  status: string;
  failureReason?: string | null;
  approvedAt?: string | null;
  scheduledAt?: string | null;
  sentAt?: string | null;
  companyName?: string | null;
  campaignName?: string | null;
  createdAt: string;
  updatedAt: string;
};

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  draft: {
    label: "Draft",
    color:
      "bg-muted text-muted-foreground border-border",
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
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? {
    label: status,
    color: "bg-muted text-muted-foreground",
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

const ALL_STATUSES = ["draft", "queued", "approved", "sent", "failed"];

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
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(item.subject);
  const [body, setBody] = useState(item.body);

  const canApprove = item.status === "draft" || item.status === "queued";
  const canEdit = item.status === "draft" || item.status === "queued";

  const handleSave = () => {
    updateOutreach.mutate(
      { id: item.id, data: { subject, body } },
      {
        onSuccess: () => {
          setEditing(false);
          onSaved();
        },
      },
    );
  };

  const handleApprove = () => {
    approveOutreach.mutate(
      { id: item.id },
      { onSuccess: onSaved },
    );
  };

  return (
    <div className="flex flex-col h-full">
      <SheetHeader className="pb-4 border-b border-border/50">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <SheetTitle className="text-lg leading-tight">
              {item.companyName ?? item.recipientEmail}
            </SheetTitle>
            <SheetDescription className="text-sm">
              {item.recipientEmail}
              {item.campaignName && (
                <span className="ml-2 text-xs text-muted-foreground">
                  · {item.campaignName}
                </span>
              )}
            </SheetDescription>
          </div>
          <StatusBadge status={item.status} />
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto py-5 space-y-5">
        {/* Subject */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Subject
          </Label>
          {editing ? (
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="rounded-xl"
            />
          ) : (
            <p className="text-sm font-medium">{item.subject}</p>
          )}
        </div>

        {/* Body */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Body
          </Label>
          {editing ? (
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="rounded-xl min-h-[200px] font-mono text-sm leading-relaxed resize-y"
            />
          ) : (
            <div className="text-sm whitespace-pre-wrap leading-relaxed text-foreground bg-muted/20 border border-border/40 rounded-xl p-4">
              {item.body}
            </div>
          )}
        </div>

        {/* Metadata */}
        {!editing && (
          <div className="space-y-3 pt-2 border-t border-border/40">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Details
            </p>
            {[
              { label: "Created", value: format(new Date(item.createdAt), "MMM d, yyyy HH:mm") },
              item.approvedAt
                ? { label: "Approved", value: format(new Date(item.approvedAt), "MMM d, yyyy HH:mm") }
                : null,
              item.sentAt
                ? { label: "Sent", value: format(new Date(item.sentAt), "MMM d, yyyy HH:mm") }
                : null,
              item.failureReason
                ? { label: "Failure", value: item.failureReason }
                : null,
            ]
              .filter(Boolean)
              .map((row) => (
                <div key={row!.label} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{row!.label}</span>
                  <span className="text-foreground font-medium text-right max-w-[60%]">
                    {row!.value}
                  </span>
                </div>
              ))}
          </div>
        )}

        {/* Failure reason */}
        {item.failureReason && (
          <div className="p-3 rounded-xl bg-destructive/5 border border-destructive/20 text-sm text-destructive">
            {item.failureReason}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="border-t border-border/50 pt-4 space-y-2">
        {editing ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 rounded-xl"
              onClick={() => {
                setSubject(item.subject);
                setBody(item.body);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 rounded-xl"
              onClick={handleSave}
              disabled={updateOutreach.isPending}
            >
              {updateOutreach.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              Save Changes
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            {canEdit && (
              <Button
                variant="outline"
                className="flex-1 rounded-xl"
                onClick={() => setEditing(true)}
              >
                <Pencil className="w-4 h-4 mr-2" />
                Edit
              </Button>
            )}
            {canApprove && (
              <Button
                className="flex-1 rounded-xl"
                onClick={handleApprove}
                disabled={approveOutreach.isPending}
              >
                {approveOutreach.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <ThumbsUp className="w-4 h-4 mr-2" />
                )}
                Approve
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function Outreach() {
  const qc = useQueryClient();
  const [campaignFilter, setCampaignFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<OutreachItem | null>(null);

  const { data: campaigns } = useListCampaigns();

  const queryParams = {
    campaignId: campaignFilter !== "all" ? Number(campaignFilter) : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
  };

  const { data: rawItems, isLoading } = useListOutreach(queryParams);
  const outreachItems = rawItems as OutreachItem[] | undefined;

  const updateOutreach = useUpdateOutreach();
  const deleteOutreach = useDeleteOutreach();
  const bulkApprove = useBulkApproveOutreach();

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListOutreachQueryKey() });

  const handleDelete = (id: number) => {
    if (confirm("Remove this item from the queue?")) {
      deleteOutreach.mutate({ id }, { onSuccess: () => { invalidate(); if (preview?.id === id) setPreview(null); } });
    }
  };

  const handleBulkApprove = () => {
    const ids = [...selected].filter((id) => {
      const item = outreachItems?.find((i) => i.id === id);
      return item && (item.status === "draft" || item.status === "queued");
    });
    if (ids.length === 0) return;
    bulkApprove.mutate(
      { data: { ids } },
      { onSuccess: () => { invalidate(); setSelected(new Set()); } },
    );
  };

  const handleBulkDelete = () => {
    if (!confirm(`Delete ${selected.size} selected items?`)) return;
    Promise.all(
      [...selected].map((id) =>
        deleteOutreach.mutateAsync({ id }).catch(() => null),
      ),
    ).then(() => { invalidate(); setSelected(new Set()); });
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
    if (!outreachItems) return;
    if (selected.size === outreachItems.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(outreachItems.map((i) => i.id)));
    }
  };

  const statusCounts = ALL_STATUSES.reduce(
    (acc, s) => {
      acc[s] = (rawItems ?? []).filter((i) => i.status === s).length;
      return acc;
    },
    {} as Record<string, number>,
  );

  const approvableSelected = [...selected].filter((id) => {
    const item = outreachItems?.find((i) => i.id === id);
    return item && (item.status === "draft" || item.status === "queued");
  }).length;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Outreach Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review, edit, and approve emails before sending
          </p>
        </div>
      </div>

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
              {(campaigns ?? []).map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Status tabs */}
        <div className="flex items-center gap-1 bg-muted/50 rounded-xl p-1 border border-border/50">
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
            <X className="w-3 h-3 mr-1" /> Clear filters
          </Button>
        )}
      </div>

      {/* Bulk action toolbar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-primary/5 border border-primary/20">
          <span className="text-sm font-medium text-primary">
            {selected.size} selected
          </span>
          <div className="flex gap-2 ml-auto">
            {approvableSelected > 0 && (
              <Button
                size="sm"
                className="h-8 rounded-xl text-xs"
                onClick={handleBulkApprove}
                disabled={bulkApprove.isPending}
              >
                {bulkApprove.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : (
                  <ThumbsUp className="w-3.5 h-3.5 mr-1.5" />
                )}
                Approve {approvableSelected}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-xl text-xs text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20"
              onClick={handleBulkDelete}
              disabled={deleteOutreach.isPending}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              Delete {selected.size}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 rounded-xl"
              onClick={() => setSelected(new Set())}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Table + Preview panel layout */}
      <div className="flex gap-5">
        {/* Table */}
        <div className={cn("glass-card overflow-hidden flex-1 min-w-0", preview ? "rounded-2xl" : "rounded-2xl")}>
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow className="border-border/30 hover:bg-transparent">
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    checked={
                      outreachItems && outreachItems.length > 0 &&
                      selected.size === outreachItems.length
                    }
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead className="w-[150px]">Date</TableHead>
                <TableHead className="w-[110px] text-right pr-4">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground animate-pulse">
                    Loading queue…
                  </TableCell>
                </TableRow>
              ) : outreachItems?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-40 text-center">
                    <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                      <MailOpen className="w-8 h-8 opacity-20" />
                      <p className="text-sm">
                        {statusFilter !== "all" || campaignFilter !== "all"
                          ? "No items match the current filters"
                          : "The queue is empty. Queue leads from the Leads page."}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                outreachItems?.map((item) => (
                  <TableRow
                    key={item.id}
                    className={cn(
                      "group border-border/30 transition-colors cursor-pointer",
                      preview?.id === item.id && "bg-primary/5",
                      selected.has(item.id) && "bg-muted/40",
                    )}
                    onClick={() => setPreview(preview?.id === item.id ? null : item)}
                  >
                    <TableCell className="pl-4 w-10" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(item.id)}
                        onCheckedChange={() => toggleRow(item.id)}
                        aria-label={`Select item ${item.id}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium max-w-[160px]">
                      <div className="truncate">
                        {item.companyName ?? item.recipientEmail}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {item.companyName ? item.recipientEmail : item.campaignName}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      <p className="truncate text-sm">{item.subject}</p>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={item.status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {item.sentAt
                        ? format(new Date(item.sentAt), "MMM d, HH:mm")
                        : item.approvedAt
                          ? format(new Date(item.approvedAt), "MMM d, HH:mm")
                          : format(new Date(item.createdAt), "MMM d, HH:mm")}
                    </TableCell>
                    <TableCell className="text-right pr-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {(item.status === "draft" || item.status === "queued") && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 rounded-lg text-primary hover:bg-primary/10"
                            onClick={() => {
                              setPreview(item);
                            }}
                            title="Preview & Approve"
                          >
                            <ThumbsUp className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 rounded-lg"
                          onClick={() => setPreview(preview?.id === item.id ? null : item)}
                          title="Preview"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 rounded-lg text-destructive hover:bg-destructive/10"
                          onClick={() => handleDelete(item.id)}
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Preview panel */}
        {preview && (
          <div className="w-[380px] shrink-0 glass-card rounded-2xl p-5 flex flex-col max-h-[calc(100vh-200px)] sticky top-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">Preview</h3>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg"
                onClick={() => setPreview(null)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <PreviewPanel
              key={preview.id}
              item={
                outreachItems?.find((i) => i.id === preview.id) ?? preview
              }
              onClose={() => setPreview(null)}
              onSaved={() => invalidate()}
            />
          </div>
        )}
      </div>
    </div>
  );
}
