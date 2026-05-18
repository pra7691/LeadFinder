import {
  useGetCampaign,
  useUpdateCampaign,
  useRunDiscovery,
  useTriggerCampaignPipeline,
  usePauseCampaign,
  useResumeCampaign,
  useListCampaignRuns,
  useListLeads,
  useListLeadLists,
  useAddLeadsToList,
  getListCampaignRunsQueryKey,
  getGetCampaignQueryKey,
  getGetSchedulerStatusQueryKey,
  getListLeadsQueryKey,
} from "@workspace/api-client-react";
import type { CampaignRun } from "@workspace/api-client-react";
import type {
  Campaign,
  DiscoverySummary,
} from "@workspace/api-client-react";
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
  Play,
  AlertCircle,
  CheckCircle2,
  Zap,
  Pause,
  RefreshCw,
  Clock,
  Calendar,
  Activity,
  Loader2,
  History,
  ArrowRight,
  Users,
  Plus,
  Star,
} from "lucide-react";
import { Link } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
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

const STATUS_STYLES: Record<string, { color: string; label: string }> = {
  idle: { color: "text-muted-foreground", label: "Idle" },
  running: { color: "text-blue-500", label: "Running…" },
  success: { color: "text-green-600", label: "Success" },
  failed: { color: "text-destructive", label: "Failed" },
};

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

// ── Campaign Runs history sub-component ────────────────────────────────────

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

  return (
    <Card className="glass-card">
      <CardHeader className="border-b border-border/30 pb-4">
        <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
          <History className="w-4 h-4 text-muted-foreground" />
          Pipeline Runs
          {runs?.some((r) => r.status === "running") && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded-full ml-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              Live
            </span>
          )}
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
        ) : !runs?.length ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No pipeline runs yet. Trigger the pipeline manually above to get started.
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {runs.map((run) => {
              const startedAt = run.startedAt ? new Date(run.startedAt) : null;
              const completedAt = run.completedAt ? new Date(run.completedAt) : null;
              const durationMs = startedAt && completedAt
                ? completedAt.getTime() - startedAt.getTime()
                : null;
              const durationStr = durationMs != null
                ? durationMs < 60_000
                  ? `${Math.round(durationMs / 1000)}s`
                  : `${Math.round(durationMs / 60_000)}m`
                : null;

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
                    <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                      {run.totalNewLeads != null && (
                        <span>{run.totalNewLeads} new leads</span>
                      )}
                      {durationStr && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {durationStr}
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

// ── Campaign Leads tab sub-component ────────────────────────────────────────

function CampaignLeadsSection({ campaignId }: { campaignId: number }) {
  const leadsParams = { campaignId };
  const { data: leads, isLoading } = useListLeads(leadsParams, {
    query: { queryKey: getListLeadsQueryKey(leadsParams) },
  });
  const { data: lists } = useListLeadLists();
  const addLeadsToList = useAddLeadsToList();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [addToListOpen, setAddToListOpen] = useState(false);
  const [qualFilter, setQualFilter] = useState<string>("all");

  const filtered = (leads ?? []).filter((l) => {
    if (qualFilter === "all") return true;
    if (qualFilter === "qualified") return l.qualificationStatus === "qualified";
    if (qualFilter === "rejected") return l.qualificationStatus === "rejected";
    if (qualFilter === "hasEmail") return !!l.emails;
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

  const QUAL_TABS = [
    { key: "all", label: "All" },
    { key: "qualified", label: "Qualified" },
    { key: "rejected", label: "Rejected" },
    { key: "hasEmail", label: "Has Email" },
  ];

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
        <div className="flex gap-1.5 mt-3 flex-wrap">
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
              {qualFilter === "all"
                ? "No leads yet — run the pipeline to discover leads."
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
              <span className="w-20 hidden sm:block">Score</span>
              <span className="w-24">Status</span>
            </div>
            <div className="divide-y divide-border/30">
              {filtered.map((lead) => (
                <div
                  key={lead.id}
                  className={cn(
                    "flex items-center gap-4 px-5 py-3 hover:bg-muted/10 transition-colors",
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
                  <span className="w-20 hidden sm:block">
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
                      {lead.qualificationStatus ?? "unqualified"}
                    </span>
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
  const runDiscovery = useRunDiscovery();
  const triggerPipeline = useTriggerCampaignPipeline();
  const pauseCampaign = usePauseCampaign();
  const resumeCampaign = useResumeCampaign();
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
  const [discoveryResult, setDiscoveryResult] = useState<DiscoverySummary | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [pipelineStarted, setPipelineStarted] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "leads">("overview");

  useEffect(() => {
    if (campaign && !initialized.current) {
      const days = campaign.scheduleDays;
      setSelectedDays(days ? days.split(",").map((d) => d.trim()) : ["mon"]);
      setFormData({
        name: campaign.name,
        objective: campaign.objective,
        isActive: campaign.isActive,
        minRelevanceScore: campaign.minRelevanceScore,
        maxSearchesPerDay: campaign.maxSearchesPerDay,
        maxLeadsPerDay: campaign.maxLeadsPerDay,
        maxEmailsPerDay: campaign.maxEmailsPerDay,
        keywords: campaign.keywords?.join(", ") || "",
        countries: campaign.countries?.join(", ") || "",
        scheduleType: campaign.scheduleType || "manual",
        scheduleTime: campaign.scheduleTime || "09:00",
      });
      initialized.current = true;
    }
  }, [campaign]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(campaignId) });
    queryClient.invalidateQueries({ queryKey: getGetSchedulerStatusQueryKey() });
  };

  const handleSave = () => {
    updateCampaign.mutate(
      {
        id: campaignId,
        data: {
          name: formData.name,
          objective: formData.objective,
          isActive: formData.isActive,
          minRelevanceScore: formData.minRelevanceScore,
          maxSearchesPerDay: formData.maxSearchesPerDay,
          maxLeadsPerDay: formData.maxLeadsPerDay,
          maxEmailsPerDay: formData.maxEmailsPerDay,
          keywords: formData.keywords.split(",").map((k) => k.trim()).filter(Boolean),
          countries: formData.countries.split(",").map((c) => c.trim()).filter(Boolean),
          scheduleType: formData.scheduleType as Campaign["scheduleType"],
          scheduleTime: formData.scheduleTime,
          scheduleDays: selectedDays.join(","),
        },
      },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetCampaignQueryKey(campaignId), updated);
          queryClient.invalidateQueries({ queryKey: getGetSchedulerStatusQueryKey() });
          toast({ title: "Campaign saved." });
        },
      },
    );
  };

  const handleRunDiscovery = () => {
    setDiscoveryResult(null);
    setDiscoveryError(null);
    runDiscovery.mutate(
      { id: campaignId },
      {
        onSuccess: (result) => {
          setDiscoveryResult(result as DiscoverySummary);
          toast({ title: "Discovery run complete." });
        },
        onError: (err: unknown) => {
          const msg = (err as Error).message || "An error occurred during discovery.";
          setDiscoveryError(msg);
          toast({ title: "Discovery failed.", variant: "destructive" });
        },
      },
    );
  };

  const handleTrigger = () => {
    setPipelineStarted(false);
    triggerPipeline.mutate(
      { id: campaignId },
      {
        onSuccess: () => {
          setPipelineStarted(true);
          invalidate();
          toast({ title: "Pipeline started — running in background." });
        },
        onError: () => {
          toast({ title: "Failed to start pipeline.", variant: "destructive" });
        },
      },
    );
  };

  const handlePause = () => {
    pauseCampaign.mutate(
      { id: campaignId },
      { onSuccess: () => { invalidate(); toast({ title: "Campaign paused." }); } },
    );
  };

  const handleResume = () => {
    resumeCampaign.mutate(
      { id: campaignId },
      { onSuccess: () => { invalidate(); toast({ title: "Campaign resumed." }); } },
    );
  };

  const toggleDay = (day: string) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  };

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground animate-pulse">Loading campaign...</div>;
  if (!campaign) return <div className="p-8 text-sm text-destructive">Campaign not found.</div>;

  const lastRunStatus = campaign.lastRunStatus || "idle";
  const statusStyle = STATUS_STYLES[lastRunStatus] ?? STATUS_STYLES.idle!;
  const isPaused = Boolean(campaign.isPaused);
  const nextRunAt = campaign.nextRunAt ? new Date(campaign.nextRunAt) : null;
  const lastRunAt = campaign.lastRunAt ? new Date(campaign.lastRunAt) : null;
  const isRunning = triggerPipeline.isPending || lastRunStatus === "running";

  return (
    <div className="space-y-8 max-w-5xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center gap-4 flex-wrap">
        <Link href="/campaigns" className="text-muted-foreground hover:text-foreground transition-colors p-2 rounded-full hover:bg-muted">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight flex-1">{campaign.name}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {isPaused ? (
            <Button
              variant="outline"
              className="rounded-xl gap-2 text-primary border-primary/30 hover:bg-primary/5"
              onClick={handleResume}
              disabled={resumeCampaign.isPending}
            >
              {resumeCampaign.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Resume
            </Button>
          ) : (
            <Button
              variant="outline"
              className="rounded-xl gap-2"
              onClick={handlePause}
              disabled={pauseCampaign.isPending}
            >
              {pauseCampaign.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4" />}
              Pause
            </Button>
          )}
          <Button
            onClick={handleTrigger}
            disabled={isRunning || !campaign.isActive || isPaused}
            variant="secondary"
            className="rounded-xl shadow-sm gap-2 bg-primary/10 text-primary hover:bg-primary/20"
          >
            {isRunning ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Running…</>
            ) : (
              <><Zap className="w-4 h-4" /> Run Pipeline</>
            )}
          </Button>
          <Button
            onClick={handleRunDiscovery}
            disabled={runDiscovery.isPending || !campaign.isActive}
            variant="outline"
            className="rounded-xl gap-2"
            data-testid="button-run-discovery"
          >
            {runDiscovery.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Running…</>
            ) : (
              <><Play className="w-4 h-4" /> Discovery</>
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
            {tab === "overview" ? "Overview" : (
              <span className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Leads
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === "leads" && <CampaignLeadsSection campaignId={campaignId} />}

      {activeTab === "overview" && (<>
      {/* Pipeline running banner */}
      {(isRunning || pipelineStarted) && (
        <Card className="glass-card border-primary/20 bg-primary/5 animate-in fade-in">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/20 text-primary rounded-full shrink-0">
                {lastRunStatus === "running" || triggerPipeline.isPending
                  ? <Loader2 className="w-5 h-5 animate-spin" />
                  : <CheckCircle2 className="w-5 h-5" />}
              </div>
              <div className="flex-1">
                {lastRunStatus === "running" || triggerPipeline.isPending ? (
                  <>
                    <h4 className="font-semibold text-primary">Pipeline Running</h4>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Discovery, crawling, and scoring are running in the background.
                      Check the <strong>Campaign Runs</strong> section below for results when complete.
                    </p>
                  </>
                ) : (
                  <>
                    <h4 className="font-semibold text-primary">Pipeline Started</h4>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Running in background — the Campaign Runs section below will update when complete.
                    </p>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Discovery error */}
      {discoveryError && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-2xl flex items-start gap-3 text-destructive animate-in fade-in">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-sm">Discovery Failed</h4>
            <p className="text-sm mt-1 opacity-90">{discoveryError}</p>
          </div>
        </div>
      )}

      {/* Discovery result */}
      {discoveryResult && (
        <Card className="glass-card border-primary/20 bg-primary/5 animate-in fade-in">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="p-2 bg-primary/20 text-primary rounded-full shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-primary">Discovery Run Complete</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                  {[
                    { label: "Searches", value: discoveryResult.searchesPerformed, testId: "stat-searches" },
                    { label: "New Leads", value: discoveryResult.newLeadsCreated, testId: "stat-new-leads" },
                    { label: "Blocked", value: discoveryResult.blockedSkipped, testId: "stat-blocked" },
                    { label: "Duplicates", value: discoveryResult.duplicatesSkipped, testId: "stat-duplicates" },
                  ].map((s) => (
                    <div key={s.label} className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">{s.label}</span>
                      <span className="text-2xl font-semibold" data-testid={s.testId}>
                        {s.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Campaign Runs history ─────────────────────────────────────────── */}
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
                <p className="text-xs text-muted-foreground">Campaign will run discovery when active</p>
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

            {formData.scheduleType !== "manual" && (
              <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl border border-border/50">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium text-foreground">Pause Scheduler</Label>
                  <p className="text-xs text-muted-foreground">
                    Temporarily stop automatic runs without changing the schedule
                  </p>
                </div>
                <Switch
                  checked={isPaused}
                  onCheckedChange={(c) => (c ? handlePause() : handleResume())}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Run status */}
        <Card className="glass-card">
          <CardHeader className="border-b border-border/30 pb-4">
            <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" /> Run Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Last Run Status</span>
              <span className={cn("font-semibold", statusStyle.color)}>
                {statusStyle.label}
              </span>
            </div>

            {lastRunAt && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Last Run</span>
                <span className="font-medium">{formatDistanceToNow(lastRunAt, { addSuffix: true })}</span>
              </div>
            )}

            {nextRunAt && !isPaused && formData.scheduleType !== "manual" && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Next Run</span>
                <span className="font-medium text-primary flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  {format(nextRunAt, "MMM d, HH:mm")}
                </span>
              </div>
            )}

            {isPaused && (
              <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2.5">
                <Pause className="w-4 h-4 shrink-0" />
                Scheduler is paused
              </div>
            )}

            {formData.scheduleType === "manual" && (
              <p className="text-xs text-muted-foreground">
                No automatic schedule — trigger runs manually from the header.
              </p>
            )}

            <div className="pt-2 border-t border-border/30">
              <Button
                variant="outline"
                size="sm"
                className="w-full rounded-xl gap-2"
                onClick={handleTrigger}
                disabled={isRunning || !campaign.isActive || isPaused}
              >
                {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Run Full Pipeline Now
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      </>)}
    </div>
  );
}
