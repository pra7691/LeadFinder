import {
  useListLeads,
  useRunCrawl,
  useBulkCrawl,
  useScoreLead,
  useBulkScore,
  useBulkLeadAction,
  getListLeadsQueryKey,
  useQueueLead,
  useBulkQueueLeads,
  useListCampaigns,
  useListCampaignRuns,
  getListCampaignRunsQueryKey,
  useListLeadLists,
  getListLeadListsQueryKey,
  getGetLeadListQueryKey,
  getGetListLeadsQueryKey,
  useAddLeadsToList,
  getListOutreachQueryKey,
  getGetListHealthQueryKey,
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
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useState } from "react";
import {
  X,
  Search,
  Globe,
  Mail as MailIcon,
  Phone,
  ScanSearch,
  Layers,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Sparkles,
  Filter,
  Check,
  AlertTriangle,
  Archive,
  BadgeCheck,
  ChevronRight,
  Send,
  Download,
  FileText,
  FileSpreadsheet,
  ThumbsUp,
  ThumbsDown,
  BookMarked,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ScoreBadge } from "@/components/ScoreBadge";
import { LeadDrawer } from "@/components/LeadDrawer";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────

type CrawlRowState = "idle" | "crawling" | "done" | "error";
type ScoreRowState = "idle" | "scoring" | "done" | "error";

type QuickFilter =
  | "all"
  | "unqualified"
  | "qualified"
  | "rejected_qual"
  | "queued"
  | "high_relevance"
  | "no_email"
  | "has_email"
  | "contacted"
  | "low_relevance";

// ── Status meta ────────────────────────────────────────────────────────────

const LEAD_STATUS_META: Record<string, { label: string; color: string }> = {
  discovered:    { label: "Discovered",    color: "bg-slate-500/10 text-slate-400" },
  crawled:       { label: "Crawled",        color: "bg-sky-500/10 text-sky-400" },
  scored:        { label: "Scored",         color: "bg-violet-500/10 text-violet-400" },
  approved:      { label: "Approved",       color: "bg-emerald-500/10 text-emerald-500" },
  rejected:      { label: "Rejected",       color: "bg-red-500/10 text-red-400" },
  contacted:     { label: "Contacted",      color: "bg-blue-500/10 text-blue-400" },
  followup_sent: { label: "Follow-up",      color: "bg-indigo-500/10 text-indigo-400" },
  invalid:       { label: "Invalid",        color: "bg-orange-500/10 text-orange-400" },
  archived:      { label: "Archived",       color: "bg-muted text-muted-foreground" },
  new:           { label: "New",            color: "bg-slate-500/10 text-slate-400" },
};

const REVIEW_STATUS_META: Record<string, { label: string; color: string }> = {
  pending:       { label: "Pending",        color: "bg-amber-500/10 text-amber-500" },
  approved:      { label: "Approved",       color: "bg-emerald-500/10 text-emerald-500" },
  rejected:      { label: "Rejected",       color: "bg-red-500/10 text-red-400" },
  low_relevance: { label: "Low Relevance",  color: "bg-orange-500/10 text-orange-400" },
};

// ── Export helpers ─────────────────────────────────────────────────────────

type ExportFormat = "csv" | "xlsx";

interface ExportOptions {
  format: ExportFormat;
  campaignId: string;
  status: string;
  minScore: string;
  country: string;
  leadIds?: number[];
}

function buildExportUrl(opts: ExportOptions): string {
  const base = `${import.meta.env.BASE_URL ?? "/"}api/leads/export`.replace(
    /\/+/g,
    "/",
  );
  const params = new URLSearchParams();
  params.set("format", opts.format);
  if (opts.campaignId) params.set("campaignId", opts.campaignId);
  if (opts.status && opts.status !== "all") params.set("status", opts.status);
  if (opts.minScore) params.set("minScore", opts.minScore);
  if (opts.country) params.set("country", opts.country);
  if (opts.leadIds && opts.leadIds.length > 0) {
    params.set("leadIds", opts.leadIds.join(","));
  }
  return `${base}?${params.toString()}`;
}

function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── Export Dialog ──────────────────────────────────────────────────────────

function ExportDialog({
  open,
  onOpenChange,
  bulkLeadIds,
  campaigns,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bulkLeadIds?: number[];
  campaigns?: { id: number; name: string }[];
}) {
  const isBulk = bulkLeadIds && bulkLeadIds.length > 0;
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [campaignId, setCampaignId] = useState("");
  const [status, setStatus] = useState("all");
  const [minScore, setMinScore] = useState("");
  const [country, setCountry] = useState("");
  const [exported, setExported] = useState(false);

  const handleExport = () => {
    const url = buildExportUrl({
      format,
      campaignId,
      status,
      minScore,
      country,
      leadIds: isBulk ? bulkLeadIds : undefined,
    });
    triggerDownload(url);
    setExported(true);
    setTimeout(() => {
      setExported(false);
      onOpenChange(false);
    }, 1200);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="w-4 h-4 text-primary" />
            {isBulk ? `Export ${bulkLeadIds.length} Selected Leads` : "Export Leads"}
          </DialogTitle>
          <DialogDescription>
            {isBulk
              ? "The selected leads will be exported — filter options below will be ignored."
              : "Apply filters to narrow the export, then choose a format."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Format selector */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">Format</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["csv", "xlsx"] as ExportFormat[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormat(f)}
                  className={cn(
                    "flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-medium transition-all",
                    format === f
                      ? "bg-primary/10 border-primary text-primary"
                      : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  {f === "csv" ? (
                    <FileText className="w-4 h-4" />
                  ) : (
                    <FileSpreadsheet className="w-4 h-4" />
                  )}
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {!isBulk && (
            <>
              {/* Campaign filter */}
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Campaign</Label>
                <Select value={campaignId || "all"} onValueChange={(v) => setCampaignId(v === "all" ? "" : v)}>
                  <SelectTrigger className="rounded-xl">
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

              {/* Status filter */}
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="approved">Approved only</SelectItem>
                    <SelectItem value="pending">Pending only</SelectItem>
                    <SelectItem value="contacted">Contacted only</SelectItem>
                    <SelectItem value="high_relevance">High relevance (≥80)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Min score + Country */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Min Score</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    placeholder="0"
                    value={minScore}
                    onChange={(e) => setMinScore(e.target.value)}
                    className="rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Country Code</Label>
                  <Input
                    placeholder="e.g. US"
                    value={country}
                    onChange={(e) => setCountry(e.target.value.toUpperCase())}
                    className="rounded-xl font-mono text-sm"
                    maxLength={4}
                  />
                </div>
              </div>
            </>
          )}

          {/* Exported fields info */}
          <div className="p-3 bg-muted/30 rounded-xl border border-border/40 text-xs text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">Fields exported:</span>{" "}
            Company Name, Domain, Website, Country, Emails, Phones, Relevance Score, Relevance Reason, Lead Status, Review Status, Notes
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={exported}
            className="gap-2"
            data-testid="btn-confirm-export"
          >
            {exported ? (
              <><CheckCircle2 className="w-4 h-4" /> Downloading…</>
            ) : (
              <><Download className="w-4 h-4" /> Export {format.toUpperCase()}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Contact quality ────────────────────────────────────────────────────────

function ContactQualityBadge({
  emails,
  phones,
  linkedin,
}: {
  emails?: string | null;
  phones?: string | null;
  linkedin?: string | null;
}) {
  const hasEmail = !!emails;
  const hasPhone = !!phones;
  const hasLinkedin = !!linkedin;

  if (hasEmail && hasPhone && hasLinkedin)
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-400 font-medium">
        <BadgeCheck className="w-3 h-3" /> Excellent
      </span>
    );
  if (hasEmail && (hasPhone || hasLinkedin))
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-sky-400 font-medium">
        <BadgeCheck className="w-3 h-3" /> Good
      </span>
    );
  if (hasEmail)
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-500 font-medium">
        <MailIcon className="w-3 h-3" /> Email only
      </span>
    );
  if (hasPhone)
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-orange-400 font-medium">
        <Phone className="w-3 h-3" /> Phone only
      </span>
    );
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/40 italic">
      No contact
    </span>
  );
}

// ── Crawl status badge ─────────────────────────────────────────────────────

function CrawlStatusBadge({
  status,
  rowState,
}: {
  status?: string | null;
  rowState: CrawlRowState;
}) {
  const effective =
    rowState === "done"
      ? "crawled"
      : rowState === "error"
        ? "failed"
        : rowState === "crawling"
          ? "crawling"
          : (status ?? "pending");

  if (effective === "crawling")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-primary">
        <Loader2 className="w-3 h-3 animate-spin" /> crawling…
      </span>
    );
  if (effective === "crawled")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500">
        <CheckCircle2 className="w-3 h-3" /> crawled
      </span>
    );
  if (effective === "failed")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-destructive">
        <AlertCircle className="w-3 h-3" /> failed
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/50">
      <Clock className="w-3 h-3" /> pending
    </span>
  );
}

// ── Filter bar ─────────────────────────────────────────────────────────────

const FILTERS: { value: QuickFilter; label: string; color?: string }[] = [
  { value: "all",           label: "All" },
  { value: "unqualified",   label: "Unqualified",    color: "text-amber-500" },
  { value: "qualified",     label: "Qualified",      color: "text-emerald-500" },
  { value: "rejected_qual", label: "Rejected",       color: "text-red-400" },
  { value: "queued",        label: "Queued",         color: "text-primary" },
  { value: "contacted",     label: "Contacted",      color: "text-blue-400" },
  { value: "high_relevance",label: "Score ≥80",      color: "text-emerald-400" },
  { value: "low_relevance", label: "Low Relevance",  color: "text-orange-400" },
  { value: "has_email",     label: "Has Email",      color: "text-sky-400" },
  { value: "no_email",      label: "No Email",       color: "text-muted-foreground" },
];

// ── Main component ─────────────────────────────────────────────────────────

export function Leads() {
  const [filterCampaignId, setFilterCampaignId] = useState<number | undefined>(undefined);
  const [filterRunId, setFilterRunId] = useState<number | undefined>(undefined);

  const { data: leads, isLoading } = useListLeads({
    limit: 200,
    campaignId: filterCampaignId,
    campaignRunId: filterRunId,
  });
  const runCrawl = useRunCrawl();
  const bulkCrawl = useBulkCrawl();
  const scoreLeadMut = useScoreLead();
  const bulkScoreMut = useBulkScore();
  const bulkAction = useBulkLeadAction();
  const queryClient = useQueryClient();
  const leadRows = Array.isArray(leads) ? leads : [];

  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<QuickFilter>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [openLeadId, setOpenLeadId] = useState<number | null>(null);

  const [crawlStates, setCrawlStates] = useState<Record<number, CrawlRowState>>({});
  const [scoreStates, setScoreStates] = useState<Record<number, ScoreRowState>>({});

  type BulkOp = "idle" | "running" | "done";
  const [bulkCrawlState, setBulkCrawlState] = useState<BulkOp>("idle");
  const [bulkCrawlSummary, setBulkCrawlSummary] = useState<{ attempted: number; succeeded: number; failed: number } | null>(null);
  const [bulkScoreState, setBulkScoreState] = useState<BulkOp>("idle");
  const [bulkScoreSummary, setBulkScoreSummary] = useState<{ attempted: number; succeeded: number; failed: number } | null>(null);
  const [bulkActionState, setBulkActionState] = useState<BulkOp>("idle");

  // ── Export dialog ─────────────────────────────────────────────────────────
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBulkIds, setExportBulkIds] = useState<number[]>([]);

  const openExport = (bulk = false) => {
    setExportBulkIds(bulk ? [...selected] : []);
    setExportOpen(true);
  };

  // ── Add to List dialog ───────────────────────────────────────────────────
  const { data: lists } = useListLeadLists(
    {},
    { query: { staleTime: 30_000, queryKey: getListLeadListsQueryKey({}) } },
  );
  const listRows = Array.isArray(lists) ? lists : [];
  const addToListMut = useAddLeadsToList();
  const [addToListOpen, setAddToListOpen] = useState(false);
  const [addToListId, setAddToListId] = useState<string>("");
  const [addToListState, setAddToListState] = useState<"idle" | "running" | "done">("idle");
  const [addToListResult, setAddToListResult] = useState<{ added: number; duplicates: number } | null>(null);

  const openAddToList = () => {
    setAddToListOpen(true);
    setAddToListId(listRows[0]?.id ? String(listRows[0].id) : "");
    setAddToListState("idle");
    setAddToListResult(null);
  };

  const handleConfirmAddToList = () => {
    if (!addToListId || !selectedIds.length) return;
    setAddToListState("running");
    addToListMut.mutate(
      { id: Number(addToListId), data: { leadIds: selectedIds } },
      {
        onSuccess: (r) => {
          setAddToListState("done");
          setAddToListResult({ added: r.added, duplicates: r.duplicates });
          setSelected(new Set());
          queryClient.invalidateQueries({ queryKey: getGetListHealthQueryKey(Number(addToListId)) });
          queryClient.invalidateQueries({ queryKey: getGetLeadListQueryKey(Number(addToListId)) });
          queryClient.invalidateQueries({ queryKey: getGetListLeadsQueryKey(Number(addToListId)) });
          setTimeout(() => { setAddToListOpen(false); setAddToListState("idle"); }, 1500);
        },
        onError: () => setAddToListState("idle"),
      },
    );
  };

  // ── Campaign/Run filters ─────────────────────────────────────────────────
  const { data: campaigns } = useListCampaigns();
  const campaignRows = Array.isArray(campaigns) ? campaigns : [];
  const campaignRunsParams = filterCampaignId ? { campaignId: filterCampaignId } : {};
  const { data: campaignRuns } = useListCampaignRuns(
    campaignRunsParams,
    {
      query: {
        enabled: !!filterCampaignId,
        staleTime: 15_000,
        queryKey: getListCampaignRunsQueryKey(campaignRunsParams),
      },
    },
  );
  const campaignRunRows = Array.isArray(campaignRuns) ? campaignRuns : [];
  const queueLeadMut = useQueueLead();
  const bulkQueueMut = useBulkQueueLeads();

  const [queueDialog, setQueueDialog] = useState<{ open: boolean; leadId: number | null; bulk: boolean }>({
    open: false, leadId: null, bulk: false,
  });
  const [queueCampaignId, setQueueCampaignId] = useState<string>("");
  const [queueState, setQueueState] = useState<"idle" | "running" | "done">("idle");
  const [queueResult, setQueueResult] = useState<{ queued: number; skipped: number } | null>(null);

  const openQueueDialog = (e: React.MouseEvent, leadId: number) => {
    e.stopPropagation();
    setQueueDialog({ open: true, leadId, bulk: false });
    setQueueCampaignId(campaignRows[0]?.id ? String(campaignRows[0].id) : "");
    setQueueState("idle");
    setQueueResult(null);
  };

  const openBulkQueueDialog = () => {
    if (!selectedIds.length) return;
    setQueueDialog({ open: true, leadId: null, bulk: true });
    setQueueCampaignId(campaignRows[0]?.id ? String(campaignRows[0].id) : "");
    setQueueState("idle");
    setQueueResult(null);
  };

  const handleConfirmQueue = () => {
    if (!queueCampaignId) return;
    setQueueState("running");

    if (queueDialog.bulk) {
      bulkQueueMut.mutate(
        { data: { leadIds: selectedIds, campaignId: Number(queueCampaignId) } },
        {
          onSuccess: (r) => {
            queryClient.invalidateQueries({ queryKey: getListOutreachQueryKey() });
            setQueueState("done");
            setQueueResult({ queued: r.queued, skipped: r.skipped });
            setSelected(new Set());
            setTimeout(() => setQueueDialog({ open: false, leadId: null, bulk: false }), 1600);
          },
          onError: () => setQueueState("idle"),
        },
      );
    } else if (queueDialog.leadId) {
      queueLeadMut.mutate(
        { data: { leadId: queueDialog.leadId, campaignId: Number(queueCampaignId) } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListOutreachQueryKey() });
            setQueueState("done");
            setQueueResult({ queued: 1, skipped: 0 });
            setTimeout(() => setQueueDialog({ open: false, leadId: null, bulk: false }), 1200);
          },
          onError: () => setQueueState("idle"),
        },
      );
    }
  };

  const invalidateLeads = () =>
    queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });

  // ── Per-row actions ──────────────────────────────────────────────────────

  const handleSingleCrawl = (e: React.MouseEvent, leadId: number) => {
    e.stopPropagation();
    setCrawlStates((s) => ({ ...s, [leadId]: "crawling" }));
    runCrawl.mutate(
      { id: leadId },
      {
        onSuccess: () => { setCrawlStates((s) => ({ ...s, [leadId]: "done" })); invalidateLeads(); },
        onError:   () => { setCrawlStates((s) => ({ ...s, [leadId]: "error" })); invalidateLeads(); },
      },
    );
  };

  const handleSingleScore = (e: React.MouseEvent, leadId: number) => {
    e.stopPropagation();
    setScoreStates((s) => ({ ...s, [leadId]: "scoring" }));
    scoreLeadMut.mutate(
      { id: leadId },
      {
        onSuccess: () => { setScoreStates((s) => ({ ...s, [leadId]: "done" })); invalidateLeads(); },
        onError:   () => { setScoreStates((s) => ({ ...s, [leadId]: "error" })); invalidateLeads(); },
      },
    );
  };

  // ── Bulk ops ─────────────────────────────────────────────────────────────

  const isBulkBusy = bulkCrawlState === "running" || bulkScoreState === "running" || bulkActionState === "running";

  const selectedIds = [...selected];

  const handleBulkCrawl = () => {
    const ids = selectedIds.length > 0 ? selectedIds : searchFiltered.map((l) => l.id);
    if (!ids.length) return;
    setBulkCrawlState("running");
    bulkCrawl.mutate(
      { data: { leadIds: ids } },
      {
        onSuccess: (r) => { setBulkCrawlState("done"); setBulkCrawlSummary({ attempted: r.attempted, succeeded: r.succeeded, failed: r.failed }); invalidateLeads(); },
        onError:   () => setBulkCrawlState("idle"),
      },
    );
  };

  const handleBulkScore = () => {
    const ids = selectedIds.length > 0 ? selectedIds : searchFiltered.map((l) => l.id);
    if (!ids.length) return;
    setBulkScoreState("running");
    bulkScoreMut.mutate(
      { data: { leadIds: ids } },
      {
        onSuccess: (r) => { setBulkScoreState("done"); setBulkScoreSummary({ attempted: r.attempted, succeeded: r.succeeded, failed: r.failed }); invalidateLeads(); },
        onError:   () => setBulkScoreState("idle"),
      },
    );
  };

  const handleBulkActionOp = (action: string) => {
    if (!selectedIds.length) return;
    setBulkActionState("running");
    bulkAction.mutate(
      { data: { action, leadIds: selectedIds } },
      {
        onSuccess: () => { setBulkActionState("done"); setSelected(new Set()); invalidateLeads(); setTimeout(() => setBulkActionState("idle"), 1500); },
        onError:   () => setBulkActionState("idle"),
      },
    );
  };

  // ── Selection ─────────────────────────────────────────────────────────────

  const toggleSelect = (e: React.MouseEvent | React.ChangeEvent, id: number) => {
    e.stopPropagation?.();
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── Filtering ─────────────────────────────────────────────────────────────

  const searchFiltered = leadRows.filter(
    (l) =>
      l.companyName?.toLowerCase().includes(search.toLowerCase()) ||
      l.rootDomain?.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredLeads = searchFiltered.filter((l) => {
    switch (activeFilter) {
      case "unqualified":    return l.qualificationStatus === "unqualified";
      case "qualified":      return l.qualificationStatus === "qualified";
      case "rejected_qual":  return l.qualificationStatus === "rejected";
      case "queued":         return l.outreachStatus === "queued" || l.outreachStatus === "contacted" || l.outreachStatus === "followup_sent";
      case "contacted":      return l.outreachStatus === "contacted" || l.leadStatus === "contacted" || l.leadStatus === "followup_sent";
      case "high_relevance": return (l.relevanceScore ?? -1) >= 80;
      case "low_relevance":  return l.reviewStatus === "low_relevance";
      case "has_email":      return !!l.emails;
      case "no_email":       return !l.emails;
      default:               return true;
    }
  });

  const allSelected =
    !!filteredLeads && filteredLeads.length > 0 && filteredLeads.every((l) => selected.has(l.id));

  const toggleAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    allSelected
      ? setSelected(new Set())
      : setSelected(new Set(filteredLeads.map((l) => l.id)));
  };

  const countFor = (f: QuickFilter) => {
    if (!searchFiltered) return 0;
    switch (f) {
      case "all":            return searchFiltered.length;
      case "unqualified":    return searchFiltered.filter((l) => l.qualificationStatus === "unqualified").length;
      case "qualified":      return searchFiltered.filter((l) => l.qualificationStatus === "qualified").length;
      case "rejected_qual":  return searchFiltered.filter((l) => l.qualificationStatus === "rejected").length;
      case "queued":         return searchFiltered.filter((l) => l.outreachStatus === "queued" || l.outreachStatus === "contacted" || l.outreachStatus === "followup_sent").length;
      case "contacted":      return searchFiltered.filter((l) => l.outreachStatus === "contacted" || l.leadStatus === "contacted" || l.leadStatus === "followup_sent").length;
      case "high_relevance": return searchFiltered.filter((l) => (l.relevanceScore ?? -1) >= 80).length;
      case "low_relevance":  return searchFiltered.filter((l) => l.reviewStatus === "low_relevance").length;
      case "has_email":      return searchFiltered.filter((l) => !!l.emails).length;
      case "no_email":       return searchFiltered.filter((l) => !l.emails).length;
    }
  };

  const crawlLabel  = selectedIds.length > 0 ? `Crawl ${selectedIds.length}` : "Crawl all";
  const scoreLabel  = selectedIds.length > 0 ? `Score ${selectedIds.length}` : "Score all";

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-3xl font-semibold tracking-tight">Leads Queue</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Campaign filter */}
          <Select
            value={filterCampaignId ? String(filterCampaignId) : "all"}
            onValueChange={(v) => {
              const id = v === "all" ? undefined : Number(v);
              setFilterCampaignId(id);
              setFilterRunId(undefined);
            }}
          >
            <SelectTrigger className="rounded-xl h-9 w-44 text-sm">
              <SelectValue placeholder="All campaigns" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All campaigns</SelectItem>
              {campaignRows.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Run filter — only when a campaign is selected */}
          {filterCampaignId && (
            <Select
              value={filterRunId ? String(filterRunId) : "all"}
              onValueChange={(v) => setFilterRunId(v === "all" ? undefined : Number(v))}
            >
              <SelectTrigger className="rounded-xl h-9 w-44 text-sm">
                <SelectValue placeholder="All runs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All runs</SelectItem>
                {campaignRunRows.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.runName ?? `Run #${r.id}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="relative w-56">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search company or domain…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 rounded-xl bg-background/50 border-border/50"
              data-testid="lead-search"
            />
          </div>
          <Button variant="outline" size="sm" className="rounded-xl gap-1.5" onClick={handleBulkCrawl}
            disabled={isBulkBusy || filteredLeads.length === 0} data-testid="btn-bulk-crawl">
            {bulkCrawlState === "running" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
            {bulkCrawlState === "running" ? "Crawling…" : crawlLabel}
          </Button>
          <Button variant="outline" size="sm"
            className="rounded-xl gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
            onClick={handleBulkScore} disabled={isBulkBusy || filteredLeads.length === 0} data-testid="btn-bulk-score">
            {bulkScoreState === "running" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {bulkScoreState === "running" ? "Scoring…" : scoreLabel}
          </Button>
          {/* Export button */}
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-1.5"
            onClick={() => openExport(false)}
            data-testid="btn-export"
          >
            <Download className="w-4 h-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-muted-foreground mr-1 shrink-0" />
        {FILTERS.map((opt) => {
          const count = countFor(opt.value);
          const active = activeFilter === opt.value;
          return (
            <button key={opt.value} onClick={() => setActiveFilter(opt.value)}
              data-testid={`filter-${opt.value}`}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-medium transition-all ${
                active ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                       : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}>
              <span className={active ? "" : (opt.color ?? "")}>{opt.label}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${active ? "bg-primary/20" : "bg-muted"}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Bulk action toolbar — appears when items are selected */}
      {selectedIds.length > 0 && (
        <div className="glass-card p-3 flex items-center gap-2 flex-wrap" data-testid="bulk-action-bar">
          <span className="text-sm font-medium text-foreground mr-1">
            {selectedIds.length} selected
          </span>
          <Button size="sm" variant="outline"
            className="h-7 px-3 text-xs rounded-lg gap-1.5 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10"
            disabled={isBulkBusy} onClick={() => handleBulkActionOp("qualify")}>
            <ThumbsUp className="w-3 h-3" /> Qualify
          </Button>
          <Button size="sm" variant="outline"
            className="h-7 px-3 text-xs rounded-lg gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
            disabled={isBulkBusy} onClick={() => handleBulkActionOp("disqualify")}>
            <ThumbsDown className="w-3 h-3" /> Reject
          </Button>
          <Button size="sm" variant="outline"
            className="h-7 px-3 text-xs rounded-lg gap-1.5 text-primary border-primary/30 hover:bg-primary/10"
            disabled={isBulkBusy || !campaignRows.length} onClick={openBulkQueueDialog}>
            <Send className="w-3 h-3" /> Queue for Outreach
          </Button>
          <Button size="sm" variant="outline"
            className="h-7 px-3 text-xs rounded-lg gap-1.5 text-muted-foreground"
            disabled={isBulkBusy} onClick={() => handleBulkActionOp("archive")}>
            <Archive className="w-3 h-3" /> Archive
          </Button>
          <Button size="sm" variant="outline"
            className="h-7 px-3 text-xs rounded-lg gap-1.5 text-violet-500 border-violet-500/30 hover:bg-violet-500/10"
            disabled={isBulkBusy || !listRows.length} onClick={openAddToList}>
            <BookMarked className="w-3 h-3" /> Add to List
          </Button>
          {/* Bulk export */}
          <Button size="sm" variant="outline"
            className="h-7 px-3 text-xs rounded-lg gap-1.5 text-foreground"
            onClick={() => openExport(true)}
            data-testid="btn-bulk-export">
            <Download className="w-3 h-3" /> Export {selectedIds.length}
          </Button>
          {bulkActionState === "running" && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          {bulkActionState === "done" && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
          <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setSelected(new Set())}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Banners */}
      {bulkCrawlState === "done" && bulkCrawlSummary && (
        <div className="glass-card p-4 flex items-center gap-3 text-sm" data-testid="bulk-crawl-summary">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          <span>Bulk crawl complete — <strong>{bulkCrawlSummary.succeeded}</strong> succeeded, <strong>{bulkCrawlSummary.failed}</strong> failed out of <strong>{bulkCrawlSummary.attempted}</strong>.</span>
          <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => { setBulkCrawlState("idle"); setBulkCrawlSummary(null); }}><X className="w-4 h-4" /></button>
        </div>
      )}
      {bulkScoreState === "done" && bulkScoreSummary && (
        <div className="glass-card p-4 flex items-center gap-3 text-sm border-primary/20" data-testid="bulk-score-summary">
          <Sparkles className="w-5 h-5 text-primary shrink-0" />
          <span>Bulk scoring complete — <strong>{bulkScoreSummary.succeeded}</strong> scored, <strong>{bulkScoreSummary.failed}</strong> failed out of <strong>{bulkScoreSummary.attempted}</strong>.</span>
          <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => { setBulkScoreState("idle"); setBulkScoreSummary(null); }}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Table */}
      <div className="glass-card overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow className="border-border/30 hover:bg-transparent">
              <TableHead className="w-10 pl-4">
                <Checkbox checked={allSelected} onCheckedChange={() => {}} onClick={toggleAll}
                  aria-label="Select all" data-testid="checkbox-select-all" />
              </TableHead>
              <TableHead className="w-[190px]">Company</TableHead>
              <TableHead>Domain / Contact</TableHead>
              <TableHead className="w-[90px]">Crawl</TableHead>
              <TableHead className="w-[120px]">Score</TableHead>
              <TableHead className="w-[180px]">Status</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground animate-pulse">Loading leads…</TableCell>
              </TableRow>
            ) : filteredLeads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center">
                  <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <Search className="w-6 h-6 opacity-20" />
                    <p>No leads found.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredLeads.map((lead) => {
                const crawlRowState = crawlStates[lead.id] ?? "idle";
                const scoreRowState = scoreStates[lead.id] ?? "idle";
                const isCrawling = crawlRowState === "crawling";
                const isScoring  = scoreRowState === "scoring";
                const lsMeta = LEAD_STATUS_META[lead.leadStatus] ?? { label: lead.leadStatus, color: "bg-muted text-muted-foreground" };
                const rvMeta = REVIEW_STATUS_META[lead.reviewStatus] ?? { label: lead.reviewStatus, color: "bg-muted text-muted-foreground" };

                return (
                  <TableRow
                    key={lead.id}
                    className="group border-border/30 transition-colors cursor-pointer hover:bg-muted/20"
                    data-testid={`lead-row-${lead.id}`}
                    onClick={() => setOpenLeadId(lead.id)}
                  >
                    {/* Select */}
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected.has(lead.id)}
                        onCheckedChange={() => {}}
                        onClick={(e) => toggleSelect(e, lead.id)}
                        aria-label={`Select ${lead.companyName}`}
                        data-testid={`checkbox-lead-${lead.id}`} />
                    </TableCell>

                    {/* Company */}
                    <TableCell className="font-medium text-foreground leading-tight">
                      <div>{lead.companyName || <span className="italic text-muted-foreground/60 font-normal text-sm">Pending crawl</span>}</div>
                      <ContactQualityBadge emails={lead.emails} phones={lead.phoneNumbers} linkedin={lead.linkedinUrl} />
                    </TableCell>

                    {/* Domain + contact */}
                    <TableCell>
                      <div className="space-y-0.5">
                        <a href={`https://${lead.rootDomain}`} target="_blank" rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center text-muted-foreground hover:text-primary transition-colors text-sm">
                          <Globe className="w-3.5 h-3.5 mr-1.5 opacity-70" />{lead.rootDomain}
                        </a>
                        {lead.emails ? (
                          <div className="flex items-center text-[11px] text-muted-foreground gap-1">
                            <MailIcon className="w-3 h-3 opacity-60 shrink-0" />
                            <span className="truncate max-w-[160px] font-mono">{lead.emails.split(",")[0]?.trim()}</span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground/30 italic">No email</span>
                        )}
                        {lead.phoneNumbers && (
                          <div className="flex items-center text-[11px] text-muted-foreground/70 gap-1">
                            <Phone className="w-3 h-3 opacity-60 shrink-0" />
                            <span className="truncate max-w-[160px] font-mono">{lead.phoneNumbers.split(",")[0]?.trim()}</span>
                          </div>
                        )}
                      </div>
                    </TableCell>

                    {/* Crawl */}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-col gap-1">
                        <CrawlStatusBadge status={lead.crawlStatus} rowState={crawlRowState} />
                        <Button variant="ghost" size="sm"
                          className="h-7 px-2 rounded-lg text-[11px] gap-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 w-fit"
                          onClick={(e) => handleSingleCrawl(e, lead.id)}
                          disabled={isCrawling || isBulkBusy} data-testid={`btn-crawl-${lead.id}`}>
                          {isCrawling ? <Loader2 className="w-3 h-3 animate-spin" /> : <ScanSearch className="w-3 h-3" />}
                          {isCrawling ? "Crawling" : "Crawl"}
                        </Button>
                      </div>
                    </TableCell>

                    {/* Score */}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-col gap-1">
                        {scoreRowState === "scoring" ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-primary">
                            <Loader2 className="w-3 h-3 animate-spin" /> Scoring…
                          </span>
                        ) : scoreRowState === "error" ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-destructive">
                            <AlertCircle className="w-3 h-3" /> Error
                          </span>
                        ) : lead.relevanceScore != null || lead.scoringMethod?.startsWith("failed") ? (
                          <ScoreBadge score={lead.relevanceScore} reason={lead.relevanceReason} scoringMethod={lead.scoringMethod} />
                        ) : (
                          <span className="text-[11px] text-muted-foreground/40 italic">—</span>
                        )}
                        <Button variant="ghost" size="sm"
                          className="h-7 px-2 rounded-lg text-[11px] gap-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 w-fit"
                          onClick={(e) => handleSingleScore(e, lead.id)}
                          disabled={isScoring || isBulkBusy} data-testid={`btn-score-${lead.id}`}>
                          {isScoring ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                          {isScoring ? "Scoring" : "Score"}
                        </Button>
                      </div>
                    </TableCell>

                    {/* Status */}
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {/* Qualification status — primary signal */}
                        {lead.qualificationStatus === "qualified" && (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium w-fit bg-emerald-500/10 text-emerald-500">
                            ✓ Qualified
                          </span>
                        )}
                        {lead.qualificationStatus === "rejected" && (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium w-fit bg-red-500/10 text-red-400">
                            ✗ Rejected
                          </span>
                        )}
                        {lead.qualificationStatus === "unqualified" && (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium w-fit bg-amber-500/10 text-amber-500">
                            Unqualified
                          </span>
                        )}
                        {/* Outreach status */}
                        {lead.outreachStatus && lead.outreachStatus !== "not_queued" && (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium w-fit bg-primary/10 text-primary capitalize">
                            {lead.outreachStatus.replace(/_/g, " ")}
                          </span>
                        )}
                        {/* Lead crawl status */}
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium w-fit ${lsMeta.color}`}>
                          {lsMeta.label}
                        </span>
                      </div>
                    </TableCell>

                    {/* Row actions */}
                    <TableCell className="text-right pr-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {lead.qualificationStatus !== "qualified" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-lg text-emerald-500 hover:bg-emerald-500/10"
                            title="Mark Qualified"
                            onClick={(e) => {
                              e.stopPropagation();
                              bulkAction.mutate(
                                { data: { action: "qualify", leadIds: [lead.id] } },
                                { onSuccess: invalidateLeads },
                              );
                            }}
                          >
                            <ThumbsUp className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {lead.qualificationStatus !== "rejected" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-lg text-destructive hover:bg-destructive/10"
                            title="Mark Rejected"
                            onClick={(e) => {
                              e.stopPropagation();
                              bulkAction.mutate(
                                { data: { action: "disqualify", leadIds: [lead.id] } },
                                { onSuccess: invalidateLeads },
                              );
                            }}
                          >
                            <ThumbsDown className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {campaignRows.length && lead.qualificationStatus === "qualified" ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-lg text-primary hover:bg-primary/10"
                            title="Queue for outreach"
                            onClick={(e) => openQueueDialog(e, lead.id)}
                          >
                            <Send className="w-3.5 h-3.5" />
                          </Button>
                        ) : null}
                        <ChevronRight
                          className="w-4 h-4 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors opacity-100"
                          onClick={() => setOpenLeadId(lead.id)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Queue for Outreach dialog */}
      <Dialog
        open={queueDialog.open}
        onOpenChange={(open) => {
          if (!open && queueState !== "running") setQueueDialog({ open: false, leadId: null, bulk: false });
        }}
      >
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>
              {queueDialog.bulk ? `Queue ${selectedIds.length} leads for outreach` : "Queue lead for outreach"}
            </DialogTitle>
            <DialogDescription>
              An email draft will be generated from the campaign template.
            </DialogDescription>
          </DialogHeader>

          {queueState === "done" && queueResult ? (
            <div className="py-6 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500" />
              <p className="font-medium">
                {queueResult.queued} email{queueResult.queued !== 1 ? "s" : ""} added to queue
              </p>
              {queueResult.skipped > 0 && (
                <p className="text-sm text-muted-foreground">
                  {queueResult.skipped} skipped (no email address)
                </p>
              )}
            </div>
          ) : (
            <div className="py-4 space-y-4">
              <div className="space-y-2">
                <Label>Campaign</Label>
                <Select value={queueCampaignId} onValueChange={setQueueCampaignId}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Select a campaign" />
                  </SelectTrigger>
                  <SelectContent>
                    {campaignRows.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setQueueDialog({ open: false, leadId: null, bulk: false })}
              disabled={queueState === "running"}
            >
              Cancel
            </Button>
            {queueState !== "done" && (
              <Button
                onClick={handleConfirmQueue}
                disabled={!queueCampaignId || queueState === "running"}
              >
                {queueState === "running" ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Queuing…</>
                ) : (
                  "Confirm"
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add to List dialog */}
      <Dialog
        open={addToListOpen}
        onOpenChange={(v) => { if (!v && addToListState !== "running") setAddToListOpen(false); }}
      >
        <DialogContent className="sm:max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookMarked className="w-4 h-4 text-violet-500" />
              Add {selectedIds.length} lead{selectedIds.length !== 1 ? "s" : ""} to list
            </DialogTitle>
            <DialogDescription>
              Choose a list to add the selected leads to.
            </DialogDescription>
          </DialogHeader>
          {addToListState === "done" && addToListResult ? (
            <div className="py-6 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500" />
              <p className="font-medium">{addToListResult.added} lead{addToListResult.added !== 1 ? "s" : ""} added</p>
              {addToListResult.duplicates > 0 && (
                <p className="text-sm text-muted-foreground">{addToListResult.duplicates} already in list</p>
              )}
            </div>
          ) : (
            <div className="py-4">
              <Select value={addToListId} onValueChange={setAddToListId}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select a list" />
                </SelectTrigger>
                <SelectContent>
                {listRows.filter((l) => l.listStatus === "active").map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>
                    {l.name} ({l.leadCount} leads)
                  </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddToListOpen(false)} disabled={addToListState === "running"}>
              Cancel
            </Button>
            {addToListState !== "done" && (
              <Button
                onClick={handleConfirmAddToList}
                disabled={!addToListId || addToListState === "running"}
                className="gap-2"
              >
                {addToListState === "running" ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Adding…</>
                ) : "Add to list"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lead detail drawer */}
      <LeadDrawer
        leadId={openLeadId}
        onClose={() => setOpenLeadId(null)}
      />

      {/* Export dialog */}
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        bulkLeadIds={exportBulkIds.length > 0 ? exportBulkIds : undefined}
        campaigns={campaignRows.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
