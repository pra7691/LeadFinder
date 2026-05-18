import {
  useGetCampaign,
  useUpdateCampaign,
  useTriggerCampaignPipeline,
  useListCampaignRuns,
  useListLeads,
  useListLeadLists,
  useAddLeadsToList,
  useUpdateLead,
  getListCampaignRunsQueryKey,
  getGetCampaignQueryKey,
  getListLeadsQueryKey,
} from "@workspace/api-client-react";
import type { CampaignRun } from "@workspace/api-client-react";
import type { Campaign } from "@workspace/api-client-react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
} from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft,
  AlertCircle,
  CheckCircle2,
  Zap,
  Clock,
  Calendar,
  Activity,
  Loader2,
  History,
  ArrowRight,
  Users,
  Plus,
  Star,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { Link } from "wouter";
import { format, formatDistanceToNow, formatDuration, intervalToDuration } from "date-fns";
import { cn } from "@/lib/utils";

const DAYS_OF_WEEK = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
];

type FormData = {
  name: string;
  objective: string;
  isActive: boolean;
  minRelevanceScore: number;
  maxSearchesPerDay: number;
  maxLeadsPerDay: number;
  maxEmailsPerDay: number;
  keywords: string;
  countries: string;
  scheduleType: string;
  scheduleTime: string;
};

// ── Shared helpers ───────────────────────────────────────────────────────────

function durationString(startedAt: Date, completedAt: Date | null): string | null {
  if (!completedAt) return null;
  const ms = completedAt.getTime() - startedAt.getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return formatDuration(intervalToDuration({ start: 0, end: ms }), { format: ["minutes", "seconds"] });
}

function RunStatusBadge({ status }: { status: CampaignRun["status"] }) {
  const map: Record<string, { label: string; cls: string }> = {
    running: { label: "Running", cls: "bg-blue-500/10 text-blue-500" },
    completed: { label: "Completed", cls: "bg-emerald-500/10 text-emerald-500" },
    failed: { label: "Failed", cls: "bg-red-500/10 text-red-400" },
    cancelled: { label: "Cancelled", cls: "bg-amber-500/10 text-amber-500" },
  };
  const s = map[status] ?? { label: status, cls: "bg-muted/40 text-muted-foreground" };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${s.cls}`}>{s.label}</span>
  );
}

// ── Current Run live card ────────────────────────────────────────────────────

function CurrentRunCard({ campaignId }: { campaignId: number }) {
  const params = { campaignId };
  const { data: runs } = useListCampaignRuns(params, {
    query: {
      queryKey: getListCampaignRunsQueryKey(params),
      refetchInterval: 3000,
    },
  });

  const activeRun = runs?.find((r) => r.status === "running");
  if (!activeRun) return null;

  const startedAt = activeRun.startedAt ? new Date(activeRun.startedAt) : null;

  const stats = [
    { label: "New Leads", value: activeRun.totalNewLeads ?? 0 },
    { label: "Searches", value: activeRun.totalSearches ?? 0 },
    { label: "Blocked", value: activeRun.totalBlocked ?? 0 },
    { label: "Duplicates", value: activeRun.totalDuplicates ?? 0 },
  ];

  return (
    <Card className="glass-card border-blue-500/20 bg-blue-500/5 animate-in fade-in">
      <CardHeader className="border-b border-blue-500/10 pb-4">
        <CardTitle className="text-sm font-medium text-blue-600 dark:text-blue-400 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Current Run
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded-full ml-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            Live
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="flex flex-wrap items-center gap-6">
          {startedAt && (
            <div className="text-sm text-muted-foreground">
              Started{" "}
              <span className="font-medium text-foreground">
                {formatDistanceToNow(startedAt, { addSuffix: true })}
              </span>
            </div>
          )}
          <div className="flex gap-6">
            {stats.map((s) => (
              <div key={s.label} className="text-center">
                <p className="text-2xl font-semibold text-foreground">{s.value}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{s.label}</p>
              </div>
            ))}
          </div>
          <Link href={`/campaigns/${campaignId}/runs/${activeRun.id}`} className="ml-auto">
            <Button size="sm" variant="outline" className="rounded-xl gap-1.5 text-xs border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10">
              View Run <ArrowRight className="w-3 h-3" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Campaign Runs history ────────────────────────────────────────────────────

function CampaignRunsSection({ campaignId }: { campaignId: number }) {
  const params = { campaignId };
  const { data: runs, isLoading } = useListCampaignRuns(params, {
    query: {
      queryKey: getListCampaignRunsQueryKey(params),
      refetchInterval: (data) => {
        const arr = data?.state?.data as CampaignRun[] | undefined;
        return arr?.some((r) => r.status === "running") ? 3000 : false;
      },
    },
  });

  const completedRuns = runs?.filter((r) => r.status !== "running") ?? [];

  return (
    <Card className="glass-card">
      <CardHeader className="border-b border-border/30 pb-4">
        <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
          <History className="w-4 h-4 text-muted-foreground" />
          Campaign Runs
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="divide-y divide-border/30">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-3 animate-pulse">
                <div className="h-4 w-24 rounded bg-muted/40" />
                <div className="h-4 w-16 rounded bg-muted/40" />
                <div className="h-4 w-32 rounded bg-muted/40 ml-auto" />
              </div>
            ))}
          </div>
        ) : !completedRuns.length ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No completed runs yet. Click <strong>Run Campaign</strong> to get started.
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {completedRuns.map((run) => {
              const startedAt = run.startedAt ? new Date(run.startedAt) : null;
              const completedAt = run.completedAt ? new Date(run.completedAt) : null;
              const dur = startedAt ? durationString(startedAt, completedAt) : null;

              return (
                <Link key={run.id} href={`/campaigns/${campaignId}/runs/${run.id}`}>
                  <div className="flex items-center gap-3 px-5 py-3 hover:bg-muted/10 transition-colors cursor-pointer group">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                        {run.runName ?? `Run #${run.id}`}
                      </p>
                      {startedAt && (
                        <p className="text-xs text-muted-foreground">
                          {format(startedAt, "MMM d, yyyy · HH:mm")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0 flex-wrap justify-end">
                      {run.totalNewLeads != null && (
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {run.totalNewLeads} leads
                        </span>
                      )}
                      {run.totalSearches != null && run.totalSearches > 0 && (
                        <span>{run.totalSearches} searches</span>
                      )}
                      {(run.totalBlocked ?? 0) > 0 && (
                        <span>{run.totalBlocked} blocked</span>
                      )}
                      {(run.totalDuplicates ?? 0) > 0 && (
                        <span>{run.totalDuplicates} dupes</span>
                      )}
                      {dur && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {dur}
                        </span>
                      )}
                      <RunStatusBadge status={run.status} />
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0 group-hover:text-primary transition-colors" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Campaign Leads tab ───────────────────────────────────────────────────────

function CampaignLeadsSection({ campaignId }: { campaignId: number }) {
  const leadsParams = { campaignId };
  const { data: leads, isLoading } = useListLeads(leadsParams, {
    query: { queryKey: getListLeadsQueryKey(leadsParams) },
  });
  const { data: runs } = useListCampaignRuns({ campaignId }, {
    query: { queryKey: getListCampaignRunsQueryKey({ campaignId }) },
  });
  const { data: lists } = useListLeadLists();
  const addLeadsToList = useAddLeadsToList();
  const updateLead = useUpdateLead();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [addToListOpen, setAddToListOpen] = useState(false);
  const [qualFilter, setQualFilter] = useState<string>("all");
  const [runFilter, setRunFilter] = useState<string>("all");

  const filtered = (leads ?? []).filter((l) => {
    if (qualFilter === "qualified" && l.qualificationStatus !== "qualified") return false;
    if (qualFilter === "rejected" && l.qualificationStatus !== "rejected") return false;
    if (qualFilter === "unreviewed" && (l.qualificationStatus === "qualified" || l.qualificationStatus === "rejected")) return false;
    if (qualFilter === "hasEmail" && !l.emails) return false;
    if (runFilter !== "all") {
      const rid = Number(runFilter);
      if ((l.campaignRunId ?? 0) !== rid) return false;
    }
    return true;
  });

  const toggleLead = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((l) => l.id)));
  };

  const handleAddToList = (listId: number) => {
    const leadIds = Array.from(selectedIds);
    if (!leadIds.length) return;
    addLeadsToList.mutate(
      { id: listId, data: { leadIds } },
      {
        onSuccess: (result) => {
          toast({ title: `Added ${result.added} lead${result.added !== 1 ? "s" : ""} to list.` });
          setAddToListOpen(false);
          setSelectedIds(new Set());
          queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey(leadsParams) });
        },
        onError: () => toast({ title: "Failed to add leads to list.", variant: "destructive" }),
      },
    );
  };

  const handleQualify = (leadId: number, status: "qualified" | "rejected") => {
    updateLead.mutate(
      { id: leadId, data: { qualificationStatus: status } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey(leadsParams) });
        },
        onError: () => toast({ title: "Failed to update lead.", variant: "destructive" }),
      },
    );
  };

  const QUAL_TABS = [
    { key: "all", label: "All" },
    { key: "unreviewed", label: "Unreviewed" },
    { key: "qualified", label: "Qualified" },
    { key: "rejected", label: "Rejected" },
    { key: "hasEmail", label: "Has Email" },
  ];

  const completedRuns = (runs ?? []).filter((r) => r.status !== "running");

  return (
    <Card className="glass-card">
      <CardHeader className="border-b border-border/30 pb-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            Campaign Leads
            {leads && (
              <span className="text-muted-foreground font-normal">({leads.length})</span>
            )}
          </CardTitle>
          {selectedIds.size > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl gap-2 text-xs"
              onClick={() => setAddToListOpen(true)}
            >
              <Plus className="w-3.5 h-3.5" />
              Add {selectedIds.size} to List
            </Button>
          )}
        </div>

        {/* Filters row */}
        <div className="flex items-center gap-3 mt-3 flex-wrap">
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
          {completedRuns.length > 0 && (
            <Select value={runFilter} onValueChange={(v) => { setRunFilter(v); setSelectedIds(new Set()); }}>
              <SelectTrigger className="h-7 text-xs rounded-full w-auto min-w-[130px] border-border/50 bg-muted/30">
                <SelectValue placeholder="All Runs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Runs</SelectItem>
                {completedRuns.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.runName ?? `Run #${r.id}`}
                    {r.startedAt && ` · ${format(new Date(r.startedAt), "MMM d")}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
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
        ) : !filtered.length ? (
          <div className="py-12 text-center">
            <Users className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              {qualFilter === "all" && runFilter === "all"
                ? "No leads yet — run the campaign to discover leads."
                : "No leads match this filter."}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-4 px-5 py-2.5 bg-muted/20 border-b border-border/30 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <input
                type="checkbox"
                checked={selectedIds.size === filtered.length && filtered.length > 0}
                onChange={toggleAll}
                className="rounded accent-primary"
              />
              <span className="flex-1">Company</span>
              <span className="w-36 hidden md:block">Domain</span>
              <span className="w-16 hidden sm:block">Score</span>
              <span className="w-24">Status</span>
              <span className="w-20 text-right">Actions</span>
            </div>
            <div className="divide-y divide-border/30">
              {filtered.map((lead) => (
                <div
                  key={lead.id}
                  className={cn(
                    "flex items-center gap-4 px-5 py-3 hover:bg-muted/10 transition-colors group",
                    selectedIds.has(lead.id) && "bg-primary/5",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(lead.id)}
                    onChange={() => toggleLead(lead.id)}
                    className="rounded accent-primary shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{lead.companyName}</p>
                    {lead.emails && (
                      <p className="text-xs text-muted-foreground truncate">{lead.emails}</p>
                    )}
                  </div>
                  <span className="w-36 text-xs text-muted-foreground truncate hidden md:block">
                    {lead.rootDomain}
                  </span>
                  <span className="w-16 hidden sm:block">
                    <span className="inline-flex items-center gap-1 text-xs">
                      <Star className="w-3 h-3 text-amber-400" />
                      {lead.relevanceScore}
                    </span>
                  </span>
                  <span className="w-24 shrink-0">
                    <span className={cn(
                      "inline-block px-2 py-0.5 rounded-full text-[10px] font-medium",
                      lead.qualificationStatus === "qualified"
                        ? "bg-emerald-500/10 text-emerald-600"
                        : lead.qualificationStatus === "rejected"
                          ? "bg-red-500/10 text-red-500"
                          : "bg-muted/50 text-muted-foreground",
                    )}>
                      {lead.qualificationStatus ?? "unreviewed"}
                    </span>
                  </span>
                  <span className="w-20 shrink-0 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      title="Qualify"
                      onClick={() => handleQualify(lead.id, "qualified")}
                      disabled={lead.qualificationStatus === "qualified" || updateLead.isPending}
                      className="p-1 rounded-lg hover:bg-emerald-500/10 text-muted-foreground hover:text-emerald-600 transition-colors disabled:opacity-30"
                    >
                      <ThumbsUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      title="Reject"
                      onClick={() => handleQualify(lead.id, "rejected")}
                      disabled={lead.qualificationStatus === "rejected" || updateLead.isPending}
                      className="p-1 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-30"
                    >
                      <ThumbsDown className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={addToListOpen} onOpenChange={setAddToListOpen}>
        <DialogContent className="sm:max-w-[380px] rounded-2xl border-border/50 bg-background/80 backdrop-blur-2xl">
          <DialogHeader>
            <DialogTitle>Add {selectedIds.size} Lead{selectedIds.size !== 1 ? "s" : ""} to List</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 mt-2">
            {!lists?.length ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No lists yet — create one in the Lists section first.
              </p>
            ) : (
              lists.map((list) => (
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
    </Card>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function CampaignDetail() {
  const { id } = useParams();
  const campaignId = Number(id);
  const { data: campaign, isLoading } = useGetCampaign(campaignId, {
    query: { enabled: !!campaignId, queryKey: getGetCampaignQueryKey(campaignId) },
  });
  const updateCampaign = useUpdateCampaign();
  const triggerPipeline = useTriggerCampaignPipeline();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [formData, setFormData] = useState<FormData>({
    name: "",
    objective: "",
    isActive: true,
    minRelevanceScore: 50,
    maxSearchesPerDay: 10,
    maxLeadsPerDay: 50,
    maxEmailsPerDay: 20,
    keywords: "",
    countries: "",
    scheduleType: "manual",
    scheduleTime: "09:00",
  });
  const initialized = useRef(false);
  const [selectedDays, setSelectedDays] = useState<string[]>(["mon"]);
  const [activeTab, setActiveTab] = useState<"overview" | "leads">("overview");

  useEffect(() => {
    if (campaign && !initialized.current) {
      const days = campaign.scheduleDays;
      setSelectedDays(days ? days.split(",").map((d) => d.trim()) : ["mon"]);
      setFormData({
        name: campaign.name ?? "",
        objective: campaign.objective ?? "",
        isActive: campaign.isActive ?? true,
        minRelevanceScore: campaign.minRelevanceScore ?? 50,
        maxSearchesPerDay: campaign.maxSearchesPerDay ?? 10,
        maxLeadsPerDay: campaign.maxLeadsPerDay ?? 50,
        maxEmailsPerDay: campaign.maxEmailsPerDay ?? 20,
        keywords: Array.isArray(campaign.keywords) ? campaign.keywords.join(", ") : (campaign.keywords ?? ""),
        countries: Array.isArray(campaign.countries) ? campaign.countries.join(", ") : (campaign.countries ?? ""),
        scheduleType: campaign.scheduleType ?? "manual",
        scheduleTime: campaign.scheduleTime ?? "09:00",
      });
      initialized.current = true;
    }
  }, [campaign]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(campaignId) });
    queryClient.invalidateQueries({ queryKey: getListCampaignRunsQueryKey({ campaignId }) });
  };

  const handleSave = () => {
    updateCampaign.mutate(
      {
        id: campaignId,
        data: {
          ...formData,
          keywords: formData.keywords.split(",").map((k) => k.trim()).filter(Boolean),
          countries: formData.countries.split(",").map((c) => c.trim()).filter(Boolean),
          scheduleDays: selectedDays.join(","),
        } as Parameters<typeof updateCampaign.mutate>[0]["data"],
      },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Campaign saved." });
        },
        onError: () => toast({ title: "Failed to save campaign.", variant: "destructive" }),
      },
    );
  };

  const handleTrigger = () => {
    triggerPipeline.mutate(
      { id: campaignId },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Campaign run started." });
        },
        onError: () => toast({ title: "Failed to start campaign run.", variant: "destructive" }),
      },
    );
  };

  const toggleDay = (day: string) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  };

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground animate-pulse">Loading campaign...</div>;
  if (!campaign) return <div className="p-8 text-sm text-destructive">Campaign not found.</div>;

  const isRunning = triggerPipeline.isPending || campaign.lastRunStatus === "running";
  const nextRunAt = campaign.nextRunAt ? new Date(campaign.nextRunAt) : null;
  const lastRunAt = campaign.lastRunAt ? new Date(campaign.lastRunAt) : null;

  return (
    <div className="space-y-8 max-w-5xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center gap-4 flex-wrap">
        <Link href="/campaigns" className="text-muted-foreground hover:text-foreground transition-colors p-2 rounded-full hover:bg-muted">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight flex-1">{campaign.name}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            onClick={handleTrigger}
            disabled={isRunning || !campaign.isActive}
            variant="secondary"
            className="rounded-xl shadow-sm gap-2 bg-primary/10 text-primary hover:bg-primary/20"
            data-testid="button-run-campaign"
          >
            {isRunning ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Running…</>
            ) : (
              <><Zap className="w-4 h-4" /> Run Campaign</>
            )}
          </Button>
          <Button onClick={handleSave} disabled={updateCampaign.isPending} className="rounded-xl shadow-sm" data-testid="button-save-campaign">
            {updateCampaign.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-muted/30 border border-border/40 rounded-xl w-fit">
        {(["overview", "leads"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all",
              activeTab === tab
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab === "leads" ? (
              <span className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Leads
              </span>
            ) : "Overview"}
          </button>
        ))}
      </div>

      {activeTab === "leads" && <CampaignLeadsSection campaignId={campaignId} />}

      {activeTab === "overview" && (<>

        {/* Current Run live card (only visible when running) */}
        <CurrentRunCard campaignId={campaignId} />

        {/* Campaign Runs history */}
        <CampaignRunsSection campaignId={campaignId} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* General settings */}
          <Card className="glass-card">
            <CardHeader className="border-b border-border/30 pb-4">
              <CardTitle className="text-sm font-medium text-foreground">General Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 pt-6">
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Name</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="rounded-xl bg-background/50"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Objective</Label>
                <Textarea
                  value={formData.objective}
                  onChange={(e) => setFormData({ ...formData, objective: e.target.value })}
                  className="rounded-xl bg-background/50 min-h-[100px] resize-y"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Keywords (comma separated)</Label>
                <Input
                  value={formData.keywords}
                  onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
                  className="rounded-xl bg-background/50 font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Countries (comma separated codes)</Label>
                <Input
                  value={formData.countries}
                  onChange={(e) => setFormData({ ...formData, countries: e.target.value })}
                  className="rounded-xl bg-background/50 font-mono text-sm"
                  placeholder="US, UK, CA"
                />
              </div>
              <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl border border-border/50">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium text-foreground">Active Status</Label>
                  <p className="text-xs text-muted-foreground">Campaign can be run when active</p>
                </div>
                <Switch
                  checked={formData.isActive}
                  onCheckedChange={(c) => setFormData({ ...formData, isActive: c })}
                />
              </div>
            </CardContent>
          </Card>

          {/* Limits + Templates */}
          <Card className="glass-card">
            <CardHeader className="border-b border-border/30 pb-4">
              <CardTitle className="text-sm font-medium text-foreground">Limits & Templates</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 pt-6">
              <div className="grid grid-cols-2 gap-4">
                {([
                  { label: "Min Relevance Score", key: "minRelevanceScore" },
                  { label: "Max Searches / Day", key: "maxSearchesPerDay" },
                  { label: "Max Leads / Day", key: "maxLeadsPerDay" },
                  { label: "Max Emails / Day", key: "maxEmailsPerDay" },
                ] as const).map((f) => (
                  <div key={f.key} className="space-y-2">
                    <Label className="text-xs font-medium text-muted-foreground">{f.label}</Label>
                    <Input
                      type="number"
                      value={formData[f.key]}
                      onChange={(e) => setFormData({ ...formData, [f.key]: Number(e.target.value) })}
                      className="rounded-xl bg-background/50"
                    />
                  </div>
                ))}
              </div>

              <div className="pt-2 border-t border-border/30">
                <p className="text-xs text-muted-foreground">
                  Email templates are now managed in the{" "}
                  <a href="/email-templates" className="text-primary hover:underline">Email Templates</a>{" "}
                  section and can be assigned when queuing outreach.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Scheduler settings */}
          <Card className="glass-card">
            <CardHeader className="border-b border-border/30 pb-4">
              <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
                <Calendar className="w-4 h-4 text-primary" /> Scheduler
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 pt-6">
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Schedule Type</Label>
                <Select
                  value={formData.scheduleType}
                  onValueChange={(v) => setFormData({ ...formData, scheduleType: v })}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual only</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formData.scheduleType !== "manual" && (
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Run Time (24h)</Label>
                  <Input
                    type="time"
                    value={formData.scheduleTime}
                    onChange={(e) => setFormData({ ...formData, scheduleTime: e.target.value })}
                    className="rounded-xl bg-background/50 w-36"
                  />
                </div>
              )}

              {formData.scheduleType === "weekly" && (
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Days of Week</Label>
                  <div className="flex gap-1.5 flex-wrap">
                    {DAYS_OF_WEEK.map((d) => (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => toggleDay(d.value)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
                          selectedDays.includes(d.value)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted/30 text-muted-foreground border-border/50 hover:border-border",
                        )}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {formData.scheduleType === "manual" && (
                <p className="text-xs text-muted-foreground">
                  No automatic schedule — click <strong>Run Campaign</strong> in the header to run manually.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Run info */}
          <Card className="glass-card">
            <CardHeader className="border-b border-border/30 pb-4">
              <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" /> Run Info
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Status</span>
                <span className={cn(
                  "font-semibold",
                  campaign.lastRunStatus === "running" ? "text-blue-500"
                    : campaign.lastRunStatus === "success" ? "text-emerald-600"
                    : campaign.lastRunStatus === "failed" ? "text-destructive"
                    : "text-muted-foreground",
                )}>
                  {campaign.lastRunStatus === "running" ? "Running…"
                    : campaign.lastRunStatus === "success" ? "Success"
                    : campaign.lastRunStatus === "failed" ? "Failed"
                    : "Idle"}
                </span>
              </div>

              {lastRunAt && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Last Run</span>
                  <span className="font-medium">{formatDistanceToNow(lastRunAt, { addSuffix: true })}</span>
                </div>
              )}

              {nextRunAt && formData.scheduleType !== "manual" && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Next Scheduled Run</span>
                  <span className="font-medium text-primary flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    {format(nextRunAt, "MMM d, HH:mm")}
                  </span>
                </div>
              )}

              {!lastRunAt && formData.scheduleType === "manual" && (
                <p className="text-xs text-muted-foreground">
                  No runs yet for this campaign.
                </p>
              )}

              <div className="pt-2 border-t border-border/30">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full rounded-xl gap-2"
                  onClick={handleTrigger}
                  disabled={isRunning || !campaign.isActive}
                  data-testid="button-run-campaign-card"
                >
                  {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  Run Campaign Now
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </>)}
    </div>
  );
}
