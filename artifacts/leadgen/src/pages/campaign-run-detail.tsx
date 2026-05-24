import {
  useGetCampaign,
  useGetCampaignRun,
  useGetCampaignRunLeads,
  useGetCampaignRunResults,
  getGetCampaignQueryKey,
  getGetCampaignRunResultsQueryKey,
  useListLeadLists,
  useAddLeadsToList,
  useUpdateLead,
  useDeleteCampaignRun,
  useDeleteLead,
  useBulkDeleteLeads,
  useBulkLeadAction,
  useCancelCampaignRun,
  useResumeCampaignRun,
  getGetCampaignRunQueryKey,
  getGetCampaignRunLeadsQueryKey,
  getListCampaignRunsQueryKey,
  getGetListHealthQueryKey,
} from "@workspace/api-client-react";
import type { CampaignRun } from "@workspace/api-client-react";
import type { Lead } from "@workspace/api-client-react";
import { useParams, Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ChevronLeft,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  Users,
  Search,
  Plus,
  Globe,
  ThumbsUp,
  ThumbsDown,
  Download,
  Mail,
  Phone,
  Trash2,
  Square,
  X,
  Ban,
  Copy,
  RotateCcw,
} from "lucide-react";
import { LeadDetailDrawer } from "@/components/lead-detail-drawer";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ScoreBadge } from "@/components/ScoreBadge";
import { format, formatDistanceToNow, formatDuration, intervalToDuration } from "date-fns";
import { cn } from "@/lib/utils";
import { saveExportToServer, saveTextExportToServer } from "@/lib/export-files";
import { useState, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

function RunStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    running: { label: "Running", cls: "bg-blue-500/10 text-blue-500", icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    completed: { label: "Completed", cls: "bg-emerald-500/10 text-emerald-500", icon: <CheckCircle2 className="w-3 h-3" /> },
    partial: { label: "Partial", cls: "bg-amber-500/10 text-amber-600", icon: <AlertCircle className="w-3 h-3" /> },
    failed: { label: "Failed", cls: "bg-red-500/10 text-red-400", icon: <XCircle className="w-3 h-3" /> },
    cancelled: { label: "Cancelled", cls: "bg-amber-500/10 text-amber-500", icon: <AlertCircle className="w-3 h-3" /> },
  };
  const s = map[status] ?? { label: status, cls: "bg-muted/40 text-muted-foreground", icon: null };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium ${s.cls}`}>
      {s.icon}
      {s.label}
    </span>
  );
}

function QualBadge({ status }: { status: string | null | undefined }) {
  const map: Record<string, string> = {
    qualified: "bg-emerald-500/10 text-emerald-600",
    rejected: "bg-red-500/10 text-red-500",
    unqualified: "bg-muted/40 text-muted-foreground",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium", map[status ?? "unqualified"] ?? map.unqualified)}>
      {status ?? "unreviewed"}
    </span>
  );
}

type BlockReasonFilter = "all" | "settings" | "blog_page" | "platform" | "gov_edu" | "research_docs" | "junk_title" | "other";
type BlockReasonCategory = { key: Exclude<BlockReasonFilter, "all">; label: string };

const BLOCK_REASON_LABELS: Record<Exclude<BlockReasonFilter, "all">, string> = {
  settings: "Domain blocked in settings",
  blog_page: "Blog / article page",
  platform: "Platform / news / social domain",
  gov_edu: "Government / education domain",
  research_docs: "Research / docs / dataset page",
  junk_title: "Junk title/content signal",
  other: "Other blocked reason",
};

const PLATFORM_DOMAINS = [
  "linkedin.com", "github.com", "indeed.com", "medium.com", "youtube.com", "facebook.com",
  "twitter.com", "x.com", "reddit.com", "quora.com", "wikipedia.org", "forbes.com",
  "techcrunch.com", "venturebeat.com", "wired.com", "bloomberg.com", "reuters.com",
  "theverge.com", "sites.google.com",
];

function csvEscape(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (text.includes(",") || text.includes('"') || text.includes("\n") || text.includes("\r")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function blockReasonCategory(result: { reason?: string | null; url?: string | null; rootDomain?: string | null; title?: string | null }): BlockReasonCategory {
  const reason = (result.reason ?? "").toLowerCase();
  const domain = (result.rootDomain ?? "").toLowerCase();
  const title = (result.title ?? "").toLowerCase();
  let pathname = "";
  try {
    pathname = result.url ? new URL(result.url).pathname.toLowerCase() : "";
  } catch {
    pathname = "";
  }

  if (reason.includes("settings")) return { key: "settings", label: BLOCK_REASON_LABELS.settings };
  if (/\.(gov|edu|ac\.uk|ac\.jp|edu\.au|gov\.uk|gov\.au|ac\.nz|edu\.nz|gc\.ca)$/i.test(domain) || reason.includes("government") || reason.includes("education")) {
    return { key: "gov_edu", label: BLOCK_REASON_LABELS.gov_edu };
  }
  if (
    reason.includes("docs") ||
    reason.includes("dataset") ||
    /\/(docs|documentation|paper|research-paper|dataset|datasets)\b/i.test(pathname) ||
    /(dataset|datasets|research paper|publication|conference paper|preprint|arxiv|documentation|github repo|open source)/i.test(title)
  ) {
    return { key: "research_docs", label: BLOCK_REASON_LABELS.research_docs };
  }
  if (
    reason.includes("blog") ||
    /\/(blog|blogs|article|articles|news|post|tag|category|topics|tutorial|tutorials|community|forum)\b/i.test(pathname)
  ) {
    return { key: "blog_page", label: BLOCK_REASON_LABELS.blog_page };
  }
  if (
    reason.includes("platform") ||
    reason.includes("social") ||
    PLATFORM_DOMAINS.some((blockedDomain) => domain === blockedDomain || domain.endsWith(`.${blockedDomain}`))
  ) {
    return { key: "platform", label: BLOCK_REASON_LABELS.platform };
  }
  if (reason.includes("junk") || /(tutorial|blog post|community forum)/i.test(title)) {
    return { key: "junk_title", label: BLOCK_REASON_LABELS.junk_title };
  }
  return { key: "other", label: BLOCK_REASON_LABELS.other };
}

export function CampaignRunDetail() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const campaignId = Number(id);
  const runIdNum = Number(runId);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const { data: campaign } = useGetCampaign(campaignId, {
    query: {
      queryKey: getGetCampaignQueryKey(campaignId),
      enabled: !!campaignId,
    },
  });

  const { data: run, isLoading: runLoading } = useGetCampaignRun(runIdNum, {
    query: {
      queryKey: getGetCampaignRunQueryKey(runIdNum),
      refetchInterval: (q) => {
        const r = q?.state?.data as CampaignRun | undefined;
        return r?.status === "running" ? 3000 : false;
      },
      enabled: !!runIdNum,
    },
  });

  const { data: leads, isLoading: leadsLoading } = useGetCampaignRunLeads(runIdNum, {
    query: {
      queryKey: getGetCampaignRunLeadsQueryKey(runIdNum),
      refetchInterval: run?.status === "running" ? 3000 : undefined,
      enabled: !!runIdNum,
    },
  });
  type CampaignRunLead = Lead & { addedToList?: boolean };
  const leadRows: CampaignRunLead[] = Array.isArray(leads) ? leads as CampaignRunLead[] : [];

  const { data: lists } = useListLeadLists();
  const listRows = Array.isArray(lists) ? lists : [];
  const minRelevanceScore = campaign?.minRelevanceScore ?? 50;
  const addLeadsToList = useAddLeadsToList();
  const updateLead = useUpdateLead();
  const deleteRun = useDeleteCampaignRun();
  const deleteLead = useDeleteLead();
  const bulkDeleteLeads = useBulkDeleteLeads();
  const bulkLeadAction = useBulkLeadAction();
  const cancelRun = useCancelCampaignRun();
  const resumeRun = useResumeCampaignRun();

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [addToListOpen, setAddToListOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  type StatusFilter = "all" | "unreviewed" | "qualified" | "rejected";
  type LeadFilter = "hasEmail" | "hasPhone" | "aboveMinScore" | "notInList";
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [leadFilters, setLeadFilters] = useState<Set<LeadFilter>>(new Set());
  const [minScoreFilter, setMinScoreFilter] = useState<string>("");
  const [maxScoreFilter, setMaxScoreFilter] = useState<string>("");
  const [resultFilter, setResultFilter] = useState<null | "blocked" | "duplicate" | "rejected">(null);
  const [blockReasonFilter, setBlockReasonFilter] = useState<BlockReasonFilter>("all");
  const [resultSearchQuery, setResultSearchQuery] = useState("");
  const [selectedBlockedResultIds, setSelectedBlockedResultIds] = useState<Set<number>>(new Set());

  const resultsParams = resultFilter && resultFilter !== "rejected" ? { status: resultFilter } : undefined;
  const { data: runResults, isLoading: runResultsLoading } = useGetCampaignRunResults(
    runIdNum,
    resultsParams,
    {
      query: {
        queryKey: getGetCampaignRunResultsQueryKey(runIdNum, resultsParams),
        enabled: !!runIdNum && resultFilter !== null && resultFilter !== "rejected",
        refetchInterval: run?.status === "running" ? 5000 : undefined,
      },
    },
  );
  const runResultRows = Array.isArray(runResults) ? runResults : [];
  const blockedReasonOptions = useMemo(() => {
    const counts = new Map<BlockReasonFilter, number>();
    for (const row of runResultRows) {
      if (row.resultStatus !== "blocked") continue;
      const category = blockReasonCategory(row);
      counts.set(category.key, (counts.get(category.key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([key, count]) => ({ key, count, label: key === "all" ? "All reasons" : BLOCK_REASON_LABELS[key] }))
      .sort((a, b) => b.count - a.count);
  }, [runResultRows]);
  const filteredRunResultRows = useMemo(() => {
    let rows = runResultRows;
    if (resultFilter === "blocked" && blockReasonFilter !== "all") {
      rows = rows.filter((row) => blockReasonCategory(row).key === blockReasonFilter);
    }
    if (resultFilter === "blocked" && resultSearchQuery.trim()) {
      const query = resultSearchQuery.trim().toLowerCase();
      rows = rows.filter((row) => {
        const haystack = [
          row.title,
          row.url,
          row.rootDomain,
          row.sourceQuery,
          row.reason,
          blockReasonCategory(row).label,
        ].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(query);
      });
    }
    return rows;
  }, [blockReasonFilter, resultFilter, resultSearchQuery, runResultRows]);

  // Delete state
  const [deleteRunOpen, setDeleteRunOpen] = useState(false);
  const [deleteRunKeepLeads, setDeleteRunKeepLeads] = useState(false);
  const [deleteRunTyped, setDeleteRunTyped] = useState("");
  const [cancelRunOpen, setCancelRunOpen] = useState(false);
  const [deletingLeadId, setDeletingLeadId] = useState<number | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [unblockingResultId, setUnblockingResultId] = useState<number | null>(null);
  const [bulkUnblockingResults, setBulkUnblockingResults] = useState(false);

  const filteredLeads = useMemo(() => {
    return leadRows.filter((l) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!l.companyName?.toLowerCase().includes(q) && !l.rootDomain?.toLowerCase().includes(q)) return false;
      }
      if (statusFilter === "qualified" && l.qualificationStatus !== "qualified") return false;
      if (statusFilter === "rejected" && l.qualificationStatus !== "rejected") return false;
      if (statusFilter === "unreviewed" && (l.qualificationStatus === "qualified" || l.qualificationStatus === "rejected")) return false;
      if (leadFilters.has("hasEmail") && !l.emails) return false;
      if (leadFilters.has("hasPhone") && !l.phoneNumbers) return false;
      if (leadFilters.has("aboveMinScore") && (typeof l.relevanceScore !== "number" || l.relevanceScore < minRelevanceScore)) return false;
      if (leadFilters.has("notInList") && l.addedToList) return false;
      if (minScoreFilter !== "" && (typeof l.relevanceScore !== "number" || l.relevanceScore < Number(minScoreFilter))) return false;
      if (maxScoreFilter !== "" && (typeof l.relevanceScore !== "number" || l.relevanceScore > Number(maxScoreFilter))) return false;
      return true;
    });
  }, [leadRows, searchQuery, statusFilter, leadFilters, minRelevanceScore, minScoreFilter, maxScoreFilter]);

  const crawlSummary = useMemo(() => {
    const total = leadRows.length;
    const crawled = leadRows.filter((l) => l.crawlStatus === "crawled").length;
    const failed = leadRows.filter((l) => l.crawlStatus === "failed").length;
    const crawling = leadRows.filter((l) => l.crawlStatus === "crawling").length;
    const pending = leadRows.filter((l) => !l.crawlStatus || l.crawlStatus === "pending").length;
    const finished = crawled + failed;
    const progress = total > 0 ? Math.round((finished / total) * 100) : 0;
    return { total, crawled, failed, crawling, pending, finished, progress };
  }, [leadRows]);

  const toggleLeadFilter = (filter: LeadFilter) => {
    setLeadFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      return next;
    });
    setSelectedIds(new Set());
  };

  const toggleLead = (leadId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === filteredLeads.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredLeads.map((l) => l.id)));
  };

  const visibleBlockedResultIds = filteredRunResultRows
    .filter((row) => row.resultStatus === "blocked")
    .map((row) => row.id);
  const selectedVisibleBlockedCount = visibleBlockedResultIds.filter((id) => selectedBlockedResultIds.has(id)).length;
  const allVisibleBlockedSelected = visibleBlockedResultIds.length > 0 && selectedVisibleBlockedCount === visibleBlockedResultIds.length;

  const toggleBlockedResult = (resultId: number) => {
    setSelectedBlockedResultIds((prev) => {
      const next = new Set(prev);
      if (next.has(resultId)) next.delete(resultId);
      else next.add(resultId);
      return next;
    });
  };

  const toggleAllVisibleBlockedResults = () => {
    setSelectedBlockedResultIds((prev) => {
      const next = new Set(prev);
      if (allVisibleBlockedSelected) {
        visibleBlockedResultIds.forEach((id) => next.delete(id));
      } else {
        visibleBlockedResultIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const handleQualify = (leadId: number, status: "qualified" | "rejected") => {
    updateLead.mutate(
      { id: leadId, data: { qualificationStatus: status } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetCampaignRunLeadsQueryKey(runIdNum) });
        },
        onError: () => toast({ title: "Failed to update lead.", variant: "destructive" }),
      },
    );
  };

  const handleAddToList = (listId: number) => {
    const leadIds = Array.from(selectedIds);
    if (leadIds.length === 0) return;
    addLeadsToList.mutate(
      { id: listId, data: { leadIds } },
      {
        onSuccess: (result) => {
          toast({ title: `Added ${result.added} lead${result.added !== 1 ? "s" : ""} to list.` });
          setAddToListOpen(false);
          setSelectedIds(new Set());
          queryClient.invalidateQueries({ queryKey: getGetCampaignRunLeadsQueryKey(runIdNum) });
          queryClient.invalidateQueries({ queryKey: getGetListHealthQueryKey(listId) });
          queryClient.invalidateQueries({ queryKey: getGetCampaignRunQueryKey(runIdNum) });
        },
        onError: () => {
          toast({ title: "Failed to add leads to list.", variant: "destructive" });
        },
      },
    );
  };

  const handleExport = async (format: "csv" | "xlsx" = "csv") => {
    if (!filteredLeads.length) return;
    const ids = filteredLeads.map((l) => l.id).join(",");
    try {
      const saved = await saveExportToServer(`/api/leads/export?format=${format}&leadIds=${ids}`);
      toast({ title: `Export saved to ${saved.relativePath}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Export failed";
      toast({ title: message, variant: "destructive" });
    }
  };

  const handleExportResults = async () => {
    if (!resultFilter || resultFilter === "rejected") return;
    const rows = [
      ["Result ID", "Campaign ID", "Campaign Run ID", "Status", "Reason Category", "Saved Reason", "Title", "URL", "Root Domain", "Source Query", "Created At"],
      ...filteredRunResultRows.map((row) => [
        row.id,
        row.campaignId,
        row.campaignRunId,
        row.resultStatus,
        row.resultStatus === "blocked" ? blockReasonCategory(row).label : "",
        row.reason ?? "",
        row.title ?? "",
        row.url ?? "",
        row.rootDomain ?? "",
        row.sourceQuery ?? "",
        row.createdAt ?? "",
      ]),
    ];
    const csv = `${rows.map((row) => row.map(csvEscape).join(",")).join("\r\n")}\r\n`;
    try {
      const saved = await saveTextExportToServer(
        `campaign-run-${runIdNum}-${resultFilter}-${new Date().toISOString().slice(0, 10)}.csv`,
        csv,
      );
      toast({ title: `Export saved to ${saved.relativePath}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Export failed";
      toast({ title: message, variant: "destructive" });
    }
  };

  const handleCancelRun = () => {
    cancelRun.mutate(
      { id: runIdNum },
      {
        onSuccess: () => {
          toast({ title: "Run stopped. Leads discovered so far have been kept." });
          setCancelRunOpen(false);
          queryClient.invalidateQueries({ queryKey: getGetCampaignRunQueryKey(runIdNum) });
          queryClient.invalidateQueries({ queryKey: getListCampaignRunsQueryKey({ campaignId }) });
        },
        onError: () => toast({ title: "Failed to stop run.", variant: "destructive" }),
      },
    );
  };

  const handleDeleteRun = () => {
    const doDeleteRun = () =>
      deleteRun.mutate(
        { id: runIdNum },
        {
          onSuccess: () => {
            toast({ title: deleteRunKeepLeads ? "Run deleted. Leads were kept." : "Run and all leads deleted." });
            setDeleteRunOpen(false);
            queryClient.invalidateQueries({ queryKey: getListCampaignRunsQueryKey({ campaignId }) });
            navigate(`/campaigns/${campaignId}`);
          },
          onError: () => toast({ title: "Failed to delete run.", variant: "destructive" }),
        },
      );

    if (!deleteRunKeepLeads && leadRows.length > 0) {
      bulkDeleteLeads.mutate(
        { data: { ids: leadRows.map((l) => l.id) } },
        {
          onSuccess: doDeleteRun,
          onError: () => toast({ title: "Failed to delete leads.", variant: "destructive" }),
        },
      );
    } else {
      doDeleteRun();
    }
  };

  const handleDeleteLead = (leadId: number) => {
    deleteLead.mutate(
      { id: leadId },
      {
        onSuccess: () => {
          toast({ title: "Lead deleted." });
          setDeletingLeadId(null);
          setSelectedIds((prev) => { const next = new Set(prev); next.delete(leadId); return next; });
          queryClient.invalidateQueries({ queryKey: getGetCampaignRunLeadsQueryKey(runIdNum) });
        },
        onError: () => toast({ title: "Failed to delete lead.", variant: "destructive" }),
      },
    );
  };

  const handleBulkDeleteLeads = () => {
    const ids = Array.from(selectedIds);
    bulkDeleteLeads.mutate(
      { data: { ids } },
      {
        onSuccess: (result) => {
          toast({ title: `${result.deleted} lead${result.deleted !== 1 ? "s" : ""} deleted.` });
          setBulkDeleteOpen(false);
          setSelectedIds(new Set());
          queryClient.invalidateQueries({ queryKey: getGetCampaignRunLeadsQueryKey(runIdNum) });
        },
        onError: () => toast({ title: "Failed to delete leads.", variant: "destructive" }),
      },
    );
  };

  const handleUnblockResult = async (resultId: number) => {
    setUnblockingResultId(resultId);
    try {
      const response = await fetch(`/api/campaign-run-results/${resultId}/unblock`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || "Failed to mark result as non-blocked");
      }
      toast({ title: "Result marked as non-blocked and added as a lead." });
      queryClient.invalidateQueries({ queryKey: getGetCampaignRunResultsQueryKey(runIdNum, resultsParams) });
      queryClient.invalidateQueries({ queryKey: getGetCampaignRunLeadsQueryKey(runIdNum) });
      queryClient.invalidateQueries({ queryKey: getGetCampaignRunQueryKey(runIdNum) });
      setSelectedBlockedResultIds((prev) => {
        const next = new Set(prev);
        next.delete(resultId);
        return next;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to mark result as non-blocked";
      toast({ title: message, variant: "destructive" });
    } finally {
      setUnblockingResultId(null);
    }
  };

  const handleBulkUnblockResults = async () => {
    const resultIds = Array.from(selectedBlockedResultIds);
    if (resultIds.length === 0) return;

    setBulkUnblockingResults(true);
    try {
      const response = await fetch("/api/campaign-run-results/unblock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resultIds }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || "Failed to mark selected results as non-blocked");
      }
      const body = await response.json() as { created?: number; duplicates?: number; skipped?: number };
      toast({
        title: `${body.created ?? 0} new lead${body.created === 1 ? "" : "s"} added, ${body.duplicates ?? 0} duplicate${body.duplicates === 1 ? "" : "s"} moved.`,
      });
      setSelectedBlockedResultIds(new Set());
      queryClient.invalidateQueries({ queryKey: getGetCampaignRunResultsQueryKey(runIdNum, resultsParams) });
      queryClient.invalidateQueries({ queryKey: getGetCampaignRunLeadsQueryKey(runIdNum) });
      queryClient.invalidateQueries({ queryKey: getGetCampaignRunQueryKey(runIdNum) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to mark selected results as non-blocked";
      toast({ title: message, variant: "destructive" });
    } finally {
      setBulkUnblockingResults(false);
    }
  };

  if (runLoading) {
    return (
      <div className="space-y-6 max-w-5xl animate-in fade-in">
        <div className="flex items-center gap-4">
          <div className="h-8 w-8 rounded-full bg-muted/40 animate-pulse" />
          <div className="h-8 w-48 rounded-lg bg-muted/40 animate-pulse" />
        </div>
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded-2xl bg-muted/40 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="p-8 text-sm text-destructive">Run not found.</div>
    );
  }

  const startedAt = run.startedAt ? new Date(run.startedAt) : null;
  const completedAt = run.completedAt ? new Date(run.completedAt) : null;
  const durationMs = startedAt && completedAt ? completedAt.getTime() - startedAt.getTime() : null;
  const durationLabel = durationMs != null
    ? durationMs < 60_000
      ? `${Math.round(durationMs / 1000)}s`
      : formatDuration(intervalToDuration({ start: 0, end: durationMs }), { format: ["minutes", "seconds"] })
    : null;
  let metadata: { crawlFailedCount?: number; pendingCrawlCount?: number; pendingScoreCount?: number } = {};
  try {
    metadata = run.metadataJson ? JSON.parse(run.metadataJson) : {};
  } catch {
    metadata = {};
  }
  const crawlFailedCount = metadata.crawlFailedCount ?? crawlSummary.failed;
  const runErrorSummary = run.errorMessage
    ? crawlFailedCount > 0
      ? `${crawlFailedCount} website${crawlFailedCount !== 1 ? "s" : ""} failed to crawl. Review the detailed failure list in Failed Logs.`
      : run.errorMessage
    : null;

  const STAGE_LABELS: Record<string, string> = {
    searching: "Searching…",
    processing_results: "Processing results…",
    creating_leads: "Creating leads…",
    crawling: "Crawling websites…",
    scoring: "Scoring leads…",
    completed: "Completed",
    partial: "Partial",
    failed: "Failed",
    cancelled: "Cancelled",
  };

  type ResultFilterKey = "blocked" | "duplicate" | "rejected";
  const stats: { label: string; value: number; icon: React.ReactNode; filterKey?: ResultFilterKey }[] = [
    { label: "New Leads", value: run.totalNewLeads ?? 0, icon: <Users className="w-4 h-4" /> },
    { label: "Searches", value: run.totalSearches ?? 0, icon: <Search className="w-4 h-4" /> },
    { label: "Duplicates", value: run.totalDuplicates ?? 0, icon: <Copy className="w-4 h-4" />, filterKey: "duplicate" },
    { label: "Blocked", value: run.totalBlocked ?? 0, icon: <Ban className="w-4 h-4" />, filterKey: "blocked" },
  ];

  const STATUS_TABS: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "unreviewed", label: "Unreviewed" },
    { key: "qualified", label: "Qualified" },
    { key: "rejected", label: "Rejected" },
  ];
  const LEAD_FILTER_TABS: { key: LeadFilter; label: string }[] = [
    { key: "hasEmail", label: "Has Email" },
    { key: "hasPhone", label: "Has Phone" },
    { key: "aboveMinScore", label: `Above ${minRelevanceScore}` },
    { key: "notInList", label: "Not in List" },
  ];

  return (
    <>
      <div className="space-y-6 max-w-5xl animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Header */}
        <div className="flex items-center gap-4 flex-wrap">
          <Link
            href={`/campaigns/${campaignId}`}
            className="text-muted-foreground hover:text-foreground transition-colors p-2 rounded-full hover:bg-muted"
          >
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight truncate">
              {run.runName ?? `Run #${run.id}`}
            </h1>
            {startedAt && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {format(startedAt, "MMM d, yyyy · HH:mm")} ·{" "}
                {formatDistanceToNow(startedAt, { addSuffix: true })}
              </p>
            )}
          </div>
          <RunStatusBadge status={run.status} />
          {run.status === "running" && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl gap-1.5 text-xs border-amber-500/40 text-amber-600 hover:bg-amber-500/10 hover:border-amber-500/60"
              onClick={() => setCancelRunOpen(true)}
              data-testid="button-stop-run"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              Stop Run
            </Button>
          )}
          {(run.status === "failed" || run.status === "partial" || run.status === "cancelled") && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl gap-1.5 text-xs border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 hover:border-emerald-500/60"
              disabled={resumeRun.isPending}
              onClick={() => {
                resumeRun.mutate(
                  { id: runIdNum },
                  {
                    onSuccess: () => {
                      toast({ title: "Run resumed", description: "The pipeline is picking up from where it left off." });
                      queryClient.invalidateQueries({ queryKey: getGetCampaignRunQueryKey(runIdNum) });
                      queryClient.invalidateQueries({ queryKey: getListCampaignRunsQueryKey({ campaignId: campaignId ? Number(campaignId) : undefined }) });
                    },
                    onError: (err: unknown) => {
                      const msg = (err as { message?: string })?.message ?? "Failed to resume run";
                      toast({ title: "Resume failed", description: msg, variant: "destructive" });
                    },
                  },
                );
              }}
              data-testid="button-resume-run"
            >
              {resumeRun.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              Resume Run
            </Button>
          )}
          {run.status !== "running" && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl gap-1.5 text-xs border-destructive/30 text-destructive hover:bg-destructive/10 hover:border-destructive/50"
              onClick={() => { setDeleteRunTyped(""); setDeleteRunOpen(true); }}
              data-testid="button-delete-run"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Run
            </Button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map((s) => {
            const isActive = s.filterKey ? resultFilter === s.filterKey : false;
            const isClickable = !!s.filterKey;
            return isClickable ? (
              <button
                key={s.label}
                onClick={() => {
                  setResultFilter(isActive ? null : s.filterKey!);
                  setBlockReasonFilter("all");
                  setResultSearchQuery("");
                  setSelectedBlockedResultIds(new Set());
                }}
                className={cn(
                  "text-left rounded-2xl border transition-all focus:outline-none",
                  isActive
                    ? "border-primary/50 bg-primary/10 ring-1 ring-primary/30"
                    : "border-border/50 bg-card hover:border-primary/30 hover:bg-primary/5",
                )}
              >
                <div className="p-5">
                  <div className="flex items-center gap-2 text-muted-foreground mb-2">
                    {s.icon}
                    <span className="text-xs font-medium uppercase tracking-wider">{s.label}</span>
                    {isActive && <X className="w-3 h-3 ml-auto text-primary" />}
                  </div>
                  <p className="text-3xl font-semibold">{s.value}</p>
                </div>
              </button>
            ) : (
              <Card key={s.label} className="glass-card">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 text-muted-foreground mb-2">
                    {s.icon}
                    <span className="text-xs font-medium uppercase tracking-wider">{s.label}</span>
                  </div>
                  <p className="text-3xl font-semibold">{s.value}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {leadRows.length > 0 && (
          <Card className="glass-card">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Globe className="w-4 h-4 text-muted-foreground" />
                    Crawl Progress
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {crawlSummary.finished} of {crawlSummary.total} websites finished crawling.
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums">{crawlSummary.progress}%</span>
              </div>

              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${crawlSummary.progress}%` }}
                />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-xl border border-border/40 bg-background/40 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Crawled</p>
                  <p className="mt-1 text-xl font-semibold">{crawlSummary.crawled}</p>
                </div>
                <div className="rounded-xl border border-border/40 bg-background/40 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Currently Crawling</p>
                  <p className="mt-1 text-xl font-semibold">{crawlSummary.crawling}</p>
                </div>
                <div className="rounded-xl border border-border/40 bg-background/40 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Pending</p>
                  <p className="mt-1 text-xl font-semibold">{crawlSummary.pending}</p>
                </div>
                <div className="rounded-xl border border-border/40 bg-background/40 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Failed</p>
                  <p className="mt-1 text-xl font-semibold">{crawlSummary.failed}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results panel (blocked / duplicates) */}
        {resultFilter !== null && (
          <Card className="glass-card">
            <CardHeader className="border-b border-border/30 pb-4">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
                  {resultFilter === "blocked" && <Ban className="w-4 h-4 text-muted-foreground" />}
                  {resultFilter === "duplicate" && <Copy className="w-4 h-4 text-muted-foreground" />}
                  {resultFilter === "rejected" && <XCircle className="w-4 h-4 text-muted-foreground" />}
                  {resultFilter === "blocked" && "Blocked Results"}
                  {resultFilter === "duplicate" && "Duplicate Results"}
                  {resultFilter === "rejected" && "Rejected Leads"}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {resultFilter === "blocked" && selectedBlockedResultIds.size > 0 && (
                    <Button
                      size="sm"
                      className="h-8 rounded-lg gap-1.5 text-xs"
                      disabled={bulkUnblockingResults}
                      onClick={handleBulkUnblockResults}
                    >
                      {bulkUnblockingResults ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <ThumbsUp className="w-3.5 h-3.5" />
                      )}
                      Non-block selected ({selectedBlockedResultIds.size})
                    </Button>
                  )}
                  {resultFilter !== "rejected" && filteredRunResultRows.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-lg gap-1.5 text-xs"
                      onClick={handleExportResults}
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export CSV
                    </Button>
                  )}
                  <button
                    onClick={() => {
                      setResultFilter(null);
                      setResultSearchQuery("");
                      setSelectedBlockedResultIds(new Set());
                    }}
                    className="p-1 rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {resultFilter === "rejected" ? (
                (() => {
                  const rejectedLeads = leadRows.filter((l) => l.qualificationStatus === "rejected");
                  return rejectedLeads.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">No rejected leads.</div>
                  ) : (
                    <div className="divide-y divide-border/30">
                      {rejectedLeads.map((lead) => (
                        <div key={lead.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{lead.companyName || lead.rootDomain}</p>
                            <p className="text-xs text-muted-foreground truncate">{lead.sourceQuery}</p>
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">{lead.rootDomain}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()
              ) : runResultsLoading ? (
                <div className="divide-y divide-border/30">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="flex items-center gap-4 px-5 py-3.5 animate-pulse">
                      <div className="h-4 w-48 rounded bg-muted/40" />
                      <div className="h-4 w-32 rounded bg-muted/40 ml-auto" />
                    </div>
                  ))}
                </div>
              ) : !filteredRunResultRows.length ? (
                <div className="py-8 text-center text-sm text-muted-foreground">No results.</div>
              ) : (
                <>
                  {resultFilter === "blocked" && (
                    <div className="px-5 py-3 border-b border-border/30 bg-muted/10">
                      <div className="flex flex-col gap-3">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input
                            placeholder="Search blocked title, domain, URL, query, or reason..."
                            value={resultSearchQuery}
                            onChange={(e) => {
                              setResultSearchQuery(e.target.value);
                              setSelectedBlockedResultIds(new Set());
                            }}
                            className="pl-9 h-10 rounded-xl bg-background/60"
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-muted-foreground mr-1">Reason:</span>
                          <button
                            type="button"
                            onClick={() => {
                              setBlockReasonFilter("all");
                              setSelectedBlockedResultIds(new Set());
                            }}
                            className={cn(
                              "px-3 py-1 rounded-full text-xs font-medium transition-all",
                              blockReasonFilter === "all"
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted/40 text-muted-foreground hover:bg-muted/60",
                            )}
                          >
                            All ({runResultRows.length})
                          </button>
                          {blockedReasonOptions.map((option) => (
                            <button
                              key={option.key}
                              type="button"
                              onClick={() => {
                                setBlockReasonFilter(option.key);
                                setSelectedBlockedResultIds(new Set());
                              }}
                              className={cn(
                                "px-3 py-1 rounded-full text-xs font-medium transition-all",
                                blockReasonFilter === option.key
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted/40 text-muted-foreground hover:bg-muted/60",
                              )}
                            >
                              {option.label} ({option.count})
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-3 px-5 py-2.5 bg-muted/20 border-b border-border/30 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {resultFilter === "blocked" && (
                      <input
                        type="checkbox"
                        checked={allVisibleBlockedSelected}
                        onChange={toggleAllVisibleBlockedResults}
                        className="h-4 w-4 rounded border-border"
                        aria-label="Select all visible blocked results"
                      />
                    )}
                    <span className="flex-1">Title / URL</span>
                    <span className="w-36 hidden md:block">Domain</span>
                    <span className="w-48 hidden sm:block">Query</span>
                    <span className="w-48">Reason</span>
                    {resultFilter === "blocked" && <span className="w-36 text-right">Action</span>}
                  </div>
                  <div className="divide-y divide-border/30">
                    {filteredRunResultRows.map((r) => (
                      <div key={r.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                        {resultFilter === "blocked" && (
                          <input
                            type="checkbox"
                            checked={selectedBlockedResultIds.has(r.id)}
                            onChange={() => toggleBlockedResult(r.id)}
                            className="h-4 w-4 rounded border-border"
                            aria-label={`Select ${r.rootDomain ?? r.title ?? "blocked result"}`}
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{r.title || r.url || r.rootDomain}</p>
                          {r.url && (
                            <a
                              href={r.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary/70 hover:text-primary truncate block"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {r.url}
                            </a>
                          )}
                        </div>
                        <span className="w-36 text-xs text-muted-foreground truncate hidden md:block">{r.rootDomain}</span>
                        <span className="w-48 text-xs text-muted-foreground truncate hidden sm:block">{r.sourceQuery}</span>
                        <span className="w-48 text-xs text-muted-foreground">
                          {resultFilter === "blocked" ? (
                            <span className="space-y-0.5 block">
                              <span className="block font-medium text-foreground/80 truncate">{blockReasonCategory(r).label}</span>
                              <span className="block truncate">{r.reason}</span>
                            </span>
                          ) : (
                            <span className="truncate block">{r.reason}</span>
                          )}
                        </span>
                        {resultFilter === "blocked" && (
                          <div className="w-36 flex justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 rounded-lg text-xs"
                              disabled={unblockingResultId === r.id}
                              onClick={() => handleUnblockResult(r.id)}
                            >
                              {unblockingResultId === r.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <ThumbsUp className="w-3.5 h-3.5" />
                              )}
                              Non-block
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Status pills */}
        <div className="flex flex-wrap gap-3">
          {durationLabel && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 border border-border/50 px-4 py-2 rounded-xl">
              <Clock className="w-4 h-4" />
              Duration: <span className="font-medium text-foreground">{durationLabel}</span>
            </div>
          )}
          {run.status === "running" && (
            <div className="flex items-center gap-2 text-sm text-blue-500 bg-blue-500/10 border border-blue-500/20 px-4 py-2 rounded-xl">
              <Loader2 className="w-4 h-4 animate-spin" />
              {run.currentStage && STAGE_LABELS[run.currentStage]
                ? STAGE_LABELS[run.currentStage]
                : "Campaign is running — leads will appear as they are discovered"}
            </div>
          )}
          {runErrorSummary && (
            <div className="flex items-center gap-3 text-sm text-amber-700 bg-amber-500/10 border border-amber-500/20 px-4 py-2 rounded-xl">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="min-w-0">{runErrorSummary}</span>
              {crawlFailedCount > 0 && (
                <Link
                  href="/failed-logs"
                  className="ml-auto shrink-0 rounded-lg border border-amber-500/30 px-2.5 py-1 text-xs font-medium hover:bg-amber-500/10"
                >
                  View Failed Logs
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Leads table */}
        <Card className="glass-card">
          <CardHeader className="border-b border-border/30 pb-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                Leads from this run
                {leads && (
                  <span className="text-muted-foreground font-normal">
                    ({filteredLeads.length}{filteredLeads.length !== leads.length ? ` of ${leads.length}` : ""})
                  </span>
                )}
              </CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                {selectedIds.size > 0 && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl gap-2 text-xs h-8 border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10"
                      onClick={() => bulkLeadAction.mutate(
                        { data: { action: "qualify", leadIds: Array.from(selectedIds) } },
                        { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetCampaignRunLeadsQueryKey(runIdNum) }) }
                      )}
                      disabled={bulkLeadAction.isPending}
                    >
                      <ThumbsUp className="w-3.5 h-3.5" />
                      Qualify {selectedIds.size}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl gap-2 text-xs h-8 border-orange-500/30 text-orange-500 hover:bg-orange-500/10"
                      onClick={() => bulkLeadAction.mutate(
                        { data: { action: "disqualify", leadIds: Array.from(selectedIds) } },
                        { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetCampaignRunLeadsQueryKey(runIdNum) }) }
                      )}
                      disabled={bulkLeadAction.isPending}
                    >
                      <ThumbsDown className="w-3.5 h-3.5" />
                      Disqualify {selectedIds.size}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl gap-2 text-xs h-8"
                      onClick={() => setAddToListOpen(true)}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add {selectedIds.size} to List
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl gap-2 text-xs h-8 border-destructive/30 text-destructive hover:bg-destructive/10"
                      onClick={() => setBulkDeleteOpen(true)}
                      data-testid="button-bulk-delete-leads"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete {selectedIds.size}
                    </Button>
                  </>
                )}
                {filteredLeads.length > 0 && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl gap-2 text-xs h-8"
                      onClick={() => handleExport("csv")}
                    >
                      <Download className="w-3.5 h-3.5" />
                      CSV
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl gap-2 text-xs h-8"
                      onClick={() => handleExport("xlsx")}
                    >
                      <Download className="w-3.5 h-3.5" />
                      XLSX
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Search + filter */}
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              <div className="relative flex-1 min-w-[180px] max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setSelectedIds(new Set()); }}
                  placeholder="Search company or domain…"
                  className="pl-8 h-8 text-xs rounded-xl bg-background/50"
                />
              </div>
              {/* Score range filter */}
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Score</span>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  placeholder="Min"
                  value={minScoreFilter}
                  onChange={(e) => { setMinScoreFilter(e.target.value); setSelectedIds(new Set()); }}
                  className="w-14 h-8 text-xs rounded-xl bg-background/50 text-center px-1"
                />
                <span className="text-xs text-muted-foreground">–</span>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  placeholder="Max"
                  value={maxScoreFilter}
                  onChange={(e) => { setMaxScoreFilter(e.target.value); setSelectedIds(new Set()); }}
                  className="w-14 h-8 text-xs rounded-xl bg-background/50 text-center px-1"
                />
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {STATUS_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => {
                      setStatusFilter(tab.key);
                      if (tab.key === "all") setLeadFilters(new Set());
                      setSelectedIds(new Set());
                    }}
                    className={cn(
                      "px-3 py-1 rounded-full text-xs font-medium transition-all",
                      statusFilter === tab.key
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/40 text-muted-foreground hover:bg-muted/60",
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
                {LEAD_FILTER_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => toggleLeadFilter(tab.key)}
                    className={cn(
                      "px-3 py-1 rounded-full text-xs font-medium transition-all",
                      leadFilters.has(tab.key)
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/40 text-muted-foreground hover:bg-muted/60",
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {leadsLoading ? (
              <div className="divide-y divide-border/30">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-5 py-3.5 animate-pulse">
                    <div className="h-4 w-4 rounded bg-muted/40" />
                    <div className="h-4 w-40 rounded bg-muted/40" />
                    <div className="h-4 w-28 rounded bg-muted/40" />
                    <div className="h-4 w-16 rounded bg-muted/40 ml-auto" />
                  </div>
                ))}
              </div>
            ) : !filteredLeads.length ? (
              <div className="py-12 text-center">
                <Users className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  {!leadRows.length
                    ? run.status === "running"
                      ? "Leads will appear here as they are discovered…"
                      : "No leads were discovered in this run."
                    : "No leads match this filter."}
                </p>
              </div>
            ) : (
              <>
                {/* Header row */}
                <div className="flex items-center gap-3 px-5 py-2.5 bg-muted/20 border-b border-border/30 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === filteredLeads.length && filteredLeads.length > 0}
                    onChange={toggleAll}
                    className="rounded accent-primary shrink-0"
                  />
                  <span className="flex-1">Company</span>
                  <span className="w-36 hidden md:block">Domain</span>
                  <span className="w-12 hidden sm:block text-center">Score</span>
                  <span className="w-14 hidden sm:block text-center">Email</span>
                  <span className="w-16 hidden md:block text-center">In List</span>
                  <span className="w-24">Status</span>
                  <span className="w-28 text-right">Actions</span>
                </div>
                <div className="divide-y divide-border/30">
                  {filteredLeads.map((lead) => (
                    <div
                      key={lead.id}
                      className={cn(
                        "flex items-center gap-3 px-5 py-3 hover:bg-muted/10 transition-colors group",
                        selectedIds.has(lead.id) && "bg-primary/5",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(lead.id)}
                        onChange={() => toggleLead(lead.id)}
                        className="rounded accent-primary shrink-0"
                      />
                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => setSelectedLeadId(lead.id)}
                      >
                        <p className="text-sm font-medium truncate hover:text-primary transition-colors">
                          {lead.companyName || (
                            <span className="italic text-muted-foreground/60 font-normal text-xs">
                              {lead.crawlStatus === "failed" ? "Company unavailable" : "Pending crawl"}
                            </span>
                          )}
                        </p>
                        <div className="flex items-center gap-2 flex-wrap">
                          {lead.crawlStatus === "failed" && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 font-medium">
                              Crawl failed
                            </span>
                          )}
                          {lead.crawlStatus === "pending" && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500 font-medium">
                              Pending crawl
                            </span>
                          )}
                          {lead.sourceCountry && (
                            <p className="text-xs text-muted-foreground truncate">{lead.sourceCountry}</p>
                          )}
                          {lead.leadType && lead.leadType !== "company" && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-medium capitalize">
                              {lead.leadType.replace("_", " ")}
                            </span>
                          )}
                        </div>
                      </div>
                      <a
                        href={lead.rootDomain ? `https://${lead.rootDomain}` : undefined}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="w-36 text-xs text-muted-foreground truncate hidden md:flex items-center gap-1 hover:text-primary transition-colors"
                      >
                        <Globe className="w-3 h-3 shrink-0 opacity-60" />
                        {lead.rootDomain}
                      </a>
                      <span className="w-12 hidden sm:block text-center">
                        {(lead.relevanceScore != null || lead.scoringMethod?.startsWith("failed")) ? (
                          <ScoreBadge score={lead.relevanceScore} reason={lead.relevanceReason} scoringMethod={lead.scoringMethod} />
                        ) : (
                          <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground/40">—</span>
                        )}
                      </span>
                      <span className="w-14 hidden sm:block text-center">
                        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                          {lead.emails && <Mail className="w-3 h-3 text-emerald-500" aria-label={lead.emails} />}
                          {lead.phoneNumbers && <Phone className="w-3 h-3 text-blue-500" aria-label={lead.phoneNumbers} />}
                        </span>
                      </span>
                      <span className="w-16 hidden md:block text-center">
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                            lead.addedToList
                              ? "bg-emerald-500/10 text-emerald-600"
                              : "bg-muted/40 text-muted-foreground",
                          )}
                        >
                          {lead.addedToList ? "Yes" : "No"}
                        </span>
                      </span>
                      <span className="w-24 shrink-0">
                        <QualBadge status={lead.qualificationStatus} />
                      </span>
                      <span className="w-28 shrink-0 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          title="Qualify"
                          onClick={(e) => { e.stopPropagation(); handleQualify(lead.id, "qualified"); }}
                          disabled={lead.qualificationStatus === "qualified" || updateLead.isPending}
                          className="p-1.5 rounded-lg hover:bg-emerald-500/10 text-muted-foreground hover:text-emerald-600 transition-colors disabled:opacity-30"
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          title="Reject"
                          onClick={(e) => { e.stopPropagation(); handleQualify(lead.id, "rejected"); }}
                          disabled={lead.qualificationStatus === "rejected" || updateLead.isPending}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-30"
                        >
                          <ThumbsDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          title="Delete lead"
                          onClick={(e) => { e.stopPropagation(); setDeletingLeadId(lead.id); }}
                          className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          data-testid={`button-delete-lead-${lead.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Add to List dialog */}
        <Dialog open={addToListOpen} onOpenChange={setAddToListOpen}>
          <DialogContent className="sm:max-w-[380px] rounded-2xl border-border/50 bg-background/80 backdrop-blur-2xl">
            <DialogHeader>
              <DialogTitle>Add {selectedIds.size} Lead{selectedIds.size !== 1 ? "s" : ""} to List</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 mt-2">
              {!listRows.length ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No lists yet — create one in the Lists section first.
                </p>
              ) : (
                listRows.map((list) => (
                  <button
                    key={list.id}
                    onClick={() => handleAddToList(list.id)}
                    disabled={addLeadsToList.isPending}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-colors text-left"
                  >
                    <div>
                      <p className="text-sm font-medium">{list.name}</p>
                      {list.description && (
                        <p className="text-xs text-muted-foreground">{list.description}</p>
                      )}
                    </div>
                    {addLeadsToList.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    ) : (
                      <Plus className="w-4 h-4 text-muted-foreground" />
                    )}
                  </button>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stop Run confirm */}
      <ConfirmDialog
        open={cancelRunOpen}
        onOpenChange={setCancelRunOpen}
        title="Stop Campaign Run?"
        description="The pipeline will stop at its next safe checkpoint. All leads discovered so far will be kept. This action cannot be undone."
        confirmLabel="Stop Run"
        loading={cancelRun.isPending}
        onConfirm={handleCancelRun}
      />

      {/* Delete Run dialog (custom — has option A/B + typed confirmation) */}
      <Dialog open={deleteRunOpen} onOpenChange={(v) => { if (!v) { setDeleteRunTyped(""); } setDeleteRunOpen(v); }}>
        <DialogContent className="sm:max-w-md rounded-2xl border-border/50 bg-background/90 backdrop-blur-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5 shrink-0" />
              Delete Campaign Run
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This run record will be permanently deleted. Choose what to do with the leads discovered in this run:
          </p>
          <div className="space-y-3">
            <label className={cn(
              "flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors",
              !deleteRunKeepLeads ? "border-destructive/40 bg-destructive/5" : "border-border/50 hover:border-border",
            )}>
              <input
                type="radio"
                checked={!deleteRunKeepLeads}
                onChange={() => setDeleteRunKeepLeads(false)}
                className="mt-0.5 accent-destructive"
              />
              <div>
                <p className="text-sm font-medium">Delete run and leads</p>
                <p className="text-xs text-muted-foreground">Removes the run and all leads created in it, including outreach history.</p>
              </div>
            </label>
            <label className={cn(
              "flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors",
              deleteRunKeepLeads ? "border-primary/40 bg-primary/5" : "border-border/50 hover:border-border",
            )}>
              <input
                type="radio"
                checked={deleteRunKeepLeads}
                onChange={() => setDeleteRunKeepLeads(true)}
                className="mt-0.5 accent-primary"
              />
              <div>
                <p className="text-sm font-medium">Delete run only, keep leads</p>
                <p className="text-xs text-muted-foreground">The leads remain in your database, unlinked from this run.</p>
              </div>
            </label>
          </div>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Type <span className="font-mono font-semibold text-foreground">DELETE RUN</span> to confirm
            </p>
            <Input
              value={deleteRunTyped}
              onChange={(e) => setDeleteRunTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && deleteRunTyped === "DELETE RUN" && handleDeleteRun()}
              placeholder="DELETE RUN"
              className="rounded-xl font-mono"
              autoComplete="off"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" className="rounded-xl" onClick={() => setDeleteRunOpen(false)} disabled={deleteRun.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-xl"
              onClick={handleDeleteRun}
              disabled={deleteRunTyped !== "DELETE RUN" || deleteRun.isPending || bulkDeleteLeads.isPending}
              data-testid="button-confirm-delete-run"
            >
              {deleteRun.isPending ? "Deleting…" : "Delete Run"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete single lead confirm */}
      <ConfirmDialog
        open={deletingLeadId !== null}
        onOpenChange={(open) => { if (!open) setDeletingLeadId(null); }}
        title="Delete Lead"
        description="This lead and its associated outreach data will be permanently deleted. This action cannot be undone."
        confirmLabel="Delete Lead"
        loading={deleteLead.isPending}
        onConfirm={() => deletingLeadId !== null && handleDeleteLead(deletingLeadId)}
      />

      {/* Bulk delete confirm */}
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`Delete ${selectedIds.size} Leads`}
        description={`${selectedIds.size} lead${selectedIds.size !== 1 ? "s" : ""} and their associated outreach data will be permanently deleted. This action cannot be undone.`}
        confirmLabel={`Delete ${selectedIds.size} Leads`}
        loading={bulkDeleteLeads.isPending}
        onConfirm={handleBulkDeleteLeads}
      />

      {/* Lead Detail Drawer */}
      <LeadDetailDrawer
        leadId={selectedLeadId}
        onClose={() => setSelectedLeadId(null)}
        onLeadUpdate={() => {
          queryClient.invalidateQueries({ queryKey: getGetCampaignRunLeadsQueryKey(runIdNum) });
        }}
      />
    </>
  );
}
