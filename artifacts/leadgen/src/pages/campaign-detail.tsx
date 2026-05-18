import {
  useGetCampaign,
  useUpdateCampaign,
  useTriggerCampaignPipeline,
  useListCampaignRuns,
  getListCampaignRunsQueryKey,
  getGetCampaignQueryKey,
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
import { useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft,
  Zap,
  Clock,
  Calendar,
  Activity,
  Loader2,
  History,
  ArrowRight,
  Users,
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
  resultsPerSearch: number;
  queryRefreshDays: number;
  discoverySourceRefreshDays: number;
  keywords: string;
  countries: string;
  scheduleType: string;
  scheduleTime: string;
};

// ── Shared helpers ───────────────────────────────────────────────────────────

function durationStr(startedAt: Date, completedAt: Date | null): string | null {
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
    { label: "Searched", value: activeRun.totalSearches ?? 0 },
    { label: "Skipped", value: activeRun.totalSearchesSkipped ?? 0 },
    { label: "Sources", value: activeRun.totalDiscoverySourcesMined ?? 0 },
    { label: "Blocked", value: activeRun.totalBlocked ?? 0 },
    { label: "Dupes", value: activeRun.totalDuplicates ?? 0 },
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
            No runs yet. Click <strong>Run Campaign</strong> to get started.
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {completedRuns.map((run) => {
              const startedAt = run.startedAt ? new Date(run.startedAt) : null;
              const completedAt = run.completedAt ? new Date(run.completedAt) : null;
              const dur = startedAt ? durationStr(startedAt, completedAt) : null;

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
                        <span>{run.totalSearches} searched</span>
                      )}
                      {(run.totalSearchesSkipped ?? 0) > 0 && (
                        <span>{run.totalSearchesSkipped} skipped</span>
                      )}
                      {(run.totalDiscoverySourcesMined ?? 0) > 0 && (
                        <span>{run.totalDiscoverySourcesMined} sources mined</span>
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
    resultsPerSearch: 10,
    queryRefreshDays: 30,
    discoverySourceRefreshDays: 30,
    keywords: "",
    countries: "",
    scheduleType: "manual",
    scheduleTime: "09:00",
  });
  const initialized = useRef(false);
  const [selectedDays, setSelectedDays] = useState<string[]>(["mon"]);

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
        resultsPerSearch: campaign.resultsPerSearch ?? 10,
        queryRefreshDays: campaign.queryRefreshDays ?? 30,
        discoverySourceRefreshDays: campaign.discoverySourceRefreshDays ?? 30,
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

  return (
    <div className="space-y-6 max-w-5xl animate-in fade-in slide-in-from-bottom-4 duration-500">
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

      {/* Current Run live card (only shows when running) */}
      <CurrentRunCard campaignId={campaignId} />

      {/* Campaign Runs history */}
      <CampaignRunsSection campaignId={campaignId} />

      {/* Settings grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* General settings */}
        <Card className="glass-card">
          <CardHeader className="border-b border-border/30 pb-3">
            <h3 className="text-sm font-medium text-foreground">General Settings</h3>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Name</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="rounded-xl bg-background/50"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Objective</Label>
              <Textarea
                value={formData.objective}
                onChange={(e) => setFormData({ ...formData, objective: e.target.value })}
                className="rounded-xl bg-background/50 min-h-[80px] resize-y"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Keywords (comma separated)</Label>
              <Input
                value={formData.keywords}
                onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
                className="rounded-xl bg-background/50 font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Countries (comma separated codes)</Label>
              <Input
                value={formData.countries}
                onChange={(e) => setFormData({ ...formData, countries: e.target.value })}
                className="rounded-xl bg-background/50 font-mono text-sm"
                placeholder="US, UK, CA"
              />
            </div>
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-xl border border-border/50">
              <div>
                <Label className="text-sm font-medium text-foreground">Active</Label>
                <p className="text-xs text-muted-foreground">Campaign can be run when active</p>
              </div>
              <Switch
                checked={formData.isActive}
                onCheckedChange={(c) => setFormData({ ...formData, isActive: c })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Limits */}
        <Card className="glass-card">
          <CardHeader className="border-b border-border/30 pb-3">
            <h3 className="text-sm font-medium text-foreground">Limits</h3>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            <div className="grid grid-cols-2 gap-3">
              {([
                { label: "Min Relevance Score", key: "minRelevanceScore" },
                { label: "Max Searches / Day", key: "maxSearchesPerDay" },
                { label: "Max Leads / Day", key: "maxLeadsPerDay" },
                { label: "Max Emails / Day", key: "maxEmailsPerDay" },
              ] as const).map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{f.label}</Label>
                  <Input
                    type="number"
                    value={formData[f.key]}
                    onChange={(e) => setFormData({ ...formData, [f.key]: Number(e.target.value) })}
                    className="rounded-xl bg-background/50"
                  />
                </div>
              ))}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Results Per Search</Label>
                <Select
                  value={String(formData.resultsPerSearch)}
                  onValueChange={(v) => setFormData({ ...formData, resultsPerSearch: Number(v) })}
                >
                  <SelectTrigger className="rounded-xl bg-background/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 20, 30, 50].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground/70">
                  Serper results per keyword-country query
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Query Refresh (days)</Label>
                <Select
                  value={String(formData.queryRefreshDays)}
                  onValueChange={(v) => setFormData({ ...formData, queryRefreshDays: Number(v) })}
                >
                  <SelectTrigger className="rounded-xl bg-background/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[7, 14, 30, 60, 90].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n} days</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground/70">
                  Days before re-searching the same keyword
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Source Refresh (days)</Label>
                <Select
                  value={String(formData.discoverySourceRefreshDays)}
                  onValueChange={(v) => setFormData({ ...formData, discoverySourceRefreshDays: Number(v) })}
                >
                  <SelectTrigger className="rounded-xl bg-background/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[7, 14, 30, 60, 90].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n} days</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground/70">
                  Days before re-mining a discovery source URL
                </p>
              </div>
            </div>
            <div className="pt-1 border-t border-border/30">
              <p className="text-xs text-muted-foreground">
                Email templates are managed in the{" "}
                <a href="/email-templates" className="text-primary hover:underline">Email Templates</a>{" "}
                section.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Scheduler — spans full width */}
        <Card className="glass-card md:col-span-2">
          <CardHeader className="border-b border-border/30 pb-3">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
              <Calendar className="w-4 h-4 text-primary" /> Scheduler
            </h3>
          </CardHeader>
          <CardContent className="pt-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1.5">
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
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Run Time (24h)</Label>
                  <Input
                    type="time"
                    value={formData.scheduleTime}
                    onChange={(e) => setFormData({ ...formData, scheduleTime: e.target.value })}
                    className="rounded-xl bg-background/50"
                  />
                </div>
              )}

              {nextRunAt && formData.scheduleType !== "manual" && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Next Run</Label>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-primary pt-2">
                    <Clock className="w-3.5 h-3.5" />
                    {format(nextRunAt, "MMM d, HH:mm")}
                  </div>
                </div>
              )}

              {formData.scheduleType === "manual" && (
                <div className="space-y-1.5 sm:col-span-3">
                  <Label className="text-xs font-medium text-muted-foreground">Schedule</Label>
                  <p className="text-sm text-muted-foreground pt-2">Manual — click <strong>Run Campaign</strong> above to run.</p>
                </div>
              )}
            </div>

            {formData.scheduleType === "weekly" && (
              <div className="mt-4 space-y-1.5">
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
