import {
  useGetCampaign,
  useUpdateCampaign,
  useRunDiscovery,
  useTriggerCampaignPipeline,
  usePauseCampaign,
  useResumeCampaign,
  getGetCampaignQueryKey,
  getGetSchedulerStatusQueryKey,
} from "@workspace/api-client-react";
import type {
  Campaign,
  PipelineResult,
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
  subjectTemplate: string;
  emailTemplate: string;
  keywords: string;
  countries: string;
  scheduleType: string;
  scheduleTime: string;
};

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
    subjectTemplate: "",
    emailTemplate: "",
    keywords: "",
    countries: "",
    scheduleType: "manual",
    scheduleTime: "09:00",
  });
  const initialized = useRef(false);
  const [selectedDays, setSelectedDays] = useState<string[]>(["mon"]);
  const [discoveryResult, setDiscoveryResult] = useState<DiscoverySummary | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(null);

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
        subjectTemplate: campaign.subjectTemplate || "",
        emailTemplate: campaign.emailTemplate || "",
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
          subjectTemplate: formData.subjectTemplate,
          emailTemplate: formData.emailTemplate,
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
    setPipelineResult(null);
    triggerPipeline.mutate(
      { id: campaignId },
      {
        onSuccess: (result) => {
          setPipelineResult(result as PipelineResult);
          invalidate();
          toast({ title: "Pipeline run complete." });
        },
        onError: () => {
          toast({ title: "Pipeline failed.", variant: "destructive" });
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

      {/* Pipeline result banner */}
      {pipelineResult && (
        <Card className="glass-card border-primary/20 bg-primary/5 animate-in fade-in">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-primary/20 text-primary rounded-full shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-primary mb-3">Pipeline Complete</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Discovered", value: pipelineResult.discoveryLeadsCreated },
                    { label: "Crawled", value: pipelineResult.crawledCount },
                    { label: "Scored", value: pipelineResult.scoredCount },
                    { label: "Emailed", value: pipelineResult.emailsSent },
                  ].map((s) => (
                    <div key={s.label} className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">{s.label}</span>
                      <span className="text-2xl font-semibold">{s.value ?? 0}</span>
                    </div>
                  ))}
                </div>
                {(pipelineResult.errors?.length ?? 0) > 0 && (
                  <div className="mt-3 text-xs text-destructive space-y-1">
                    {pipelineResult.errors!.slice(0, 3).map((e, i) => (
                      <p key={i}>⚠ {e}</p>
                    ))}
                  </div>
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

            <div className="space-y-2 pt-2 border-t border-border/30">
              <Label className="text-xs font-medium text-foreground">Subject Template</Label>
              <Input
                value={formData.subjectTemplate}
                onChange={(e) => setFormData({ ...formData, subjectTemplate: e.target.value })}
                className="rounded-xl bg-background/50 border-primary/20"
                placeholder="Outreach from {{campaign_name}} — {{company_name}}"
              />
              <p className="text-[11px] text-muted-foreground">Variables: {"{{company_name}}"}, {"{{country}}"}, {"{{campaign_name}}"}</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-foreground">Email Body Template</Label>
              <Textarea
                value={formData.emailTemplate}
                onChange={(e) => setFormData({ ...formData, emailTemplate: e.target.value })}
                className="rounded-xl bg-background/50 min-h-[200px] resize-y font-mono text-sm leading-relaxed border-primary/20"
                placeholder={"Hi,\n\nI noticed {{company_name}} and wanted to reach out…"}
              />
              <p className="text-[11px] text-muted-foreground">Variables: {"{{company_name}}"}, {"{{country}}"}, {"{{campaign_name}}"}</p>
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
    </div>
  );
}
