import {
  useGetCampaignRun,
  useGetCampaignRunLeads,
  useGetCampaignRunResults,
  getGetCampaignRunResultsQueryKey,
  useListLeadLists,
  useAddLeadsToList,
  useUpdateLead,
  useDeleteCampaignRun,
  useDeleteLead,
  useBulkDeleteLeads,
  useCancelCampaignRun,
  getGetCampaignRunQueryKey,
  getGetCampaignRunLeadsQueryKey,
  getListCampaignRunsQueryKey,
  getGetListHealthQueryKey,
} from "@workspace/api-client-react";
import type { CampaignRun } from "@workspace/api-client-react";
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
} from "lucide-react";
import { LeadDetailDrawer } from "@/components/lead-detail-drawer";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ScoreBadge } from "@/components/ScoreBadge";
import { format, formatDistanceToNow, formatDuration, intervalToDuration } from "date-fns";
import { cn } from "@/lib/utils";
import { useState, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

function RunStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    running: { label: "Running", cls: "bg-blue-500/10 text-blue-500", icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    completed: { label: "Completed", cls: "bg-emerald-500/10 text-emerald-500", icon: <CheckCircle2 className="w-3 h-3" /> },
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

export function CampaignRunDetail() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const campaignId = Number(id);
  const runIdNum = Number(runId);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

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
  const leadRows = Array.isArray(leads) ? leads : [];

  const { data: lists } = useListLeadLists();
  const listRows = Array.isArray(lists) ? lists : [];
  const addLeadsToList = useAddLeadsToList();
  const updateLead = useUpdateLead();
  const deleteRun = useDeleteCampaignRun();
  const deleteLead = useDeleteLead();
  const bulkDeleteLeads = useBulkDeleteLeads();
  const cancelRun = useCancelCampaignRun();

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [addToListOpen, setAddToListOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [qualFilter, setQualFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState<null | "blocked" | "duplicate" | "rejected">(null);

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

  // Delete state
  const [deleteRunOpen, setDeleteRunOpen] = useState(false);
  const [deleteRunKeepLeads, setDeleteRunKeepLeads] = useState(false);
  const [deleteRunTyped, setDeleteRunTyped] = useState("");
  const [cancelRunOpen, setCancelRunOpen] = useState(false);
  const [deletingLeadId, setDeletingLeadId] = useState<number | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const filteredLeads = useMemo(() => {
    return leadRows.filter((l) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!l.companyName?.toLowerCase().includes(q) && !l.rootDomain?.toLowerCase().includes(q)) return false;
      }
      if (qualFilter === "qualified") return l.qualificationStatus === "qualified";
      if (qualFilter === "rejected") return l.qualificationStatus === "rejected";
      if (qualFilter === "unreviewed") return l.qualificationStatus !== "qualified" && l.qualificationStatus !== "rejected";
      if (qualFilter === "hasEmail") return !!l.emails;
      return true;
    });
  }, [leadRows, searchQuery, qualFilter]);

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

  const handleExport = (format: "csv" | "xlsx" = "csv") => {
    if (!filteredLeads.length) return;
    const ids = filteredLeads.map((l) => l.id).join(",");
    window.open(`/api/leads/export?format=${format}&leadIds=${ids}`, "_blank");
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

  const QUAL_TABS = [
    { key: "all", label: "All" },
    { key: "unreviewed", label: "Unreviewed" },
    { key: "qualified", label: "Qualified" },
    { key: "rejected", label: "Rejected" },
    { key: "hasEmail", label: "Has Email" },
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
                onClick={() => setResultFilter(isActive ? null : s.filterKey!)}
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
                <button
                  onClick={() => setResultFilter(null)}
                  className="p-1 rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
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
              ) : !runResultRows.length ? (
                <div className="py-8 text-center text-sm text-muted-foreground">No results.</div>
              ) : (
                <>
                  <div className="flex items-center gap-3 px-5 py-2.5 bg-muted/20 border-b border-border/30 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <span className="flex-1">Title / URL</span>
                    <span className="w-36 hidden md:block">Domain</span>
                    <span className="w-48 hidden sm:block">Query</span>
                    <span className="w-40">Reason</span>
                  </div>
                  <div className="divide-y divide-border/30">
                    {runResultRows.map((r) => (
                      <div key={r.id} className="flex items-center gap-3 px-5 py-3 text-sm">
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
                        <span className="w-40 text-xs text-muted-foreground truncate">{r.reason}</span>
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
          {run.errorMessage && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 px-4 py-2 rounded-xl">
              <AlertCircle className="w-4 h-4" />
              {run.errorMessage}
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
              <div className="flex gap-1.5 flex-wrap">
                {QUAL_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => { setQualFilter(tab.key); setSelectedIds(new Set()); }}
                    className={cn(
                      "px-3 py-1 rounded-full text-xs font-medium transition-all",
                      qualFilter === tab.key
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
                  <span className="w-24">Status</span>
                  <span className="w-28 text-right">Actions</span>
                </div>
                <div className="divide-y divide-border/30">
                  {filteredLeads.map((lead) => (
                    <div
                      key={lead.id}
                      className={cn(
                        "flex items-center gap-3 px-5 py-3 hover:bg-muted/10 transition-colors group cursor-pointer",
                        selectedIds.has(lead.id) && "bg-primary/5",
                      )}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('input,button')) return;
                        setSelectedLeadId(lead.id);
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(lead.id)}
                        onChange={() => toggleLead(lead.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded accent-primary shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                          {lead.companyName || <span className="italic text-muted-foreground/60 font-normal text-xs">Pending crawl</span>}
                        </p>
                        <div className="flex items-center gap-2 flex-wrap">
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
                      <span className="w-36 text-xs text-muted-foreground truncate hidden md:block">
                        {lead.rootDomain}
                      </span>
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
