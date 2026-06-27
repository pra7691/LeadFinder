import {
  useGetCampaign,
  useUpdateCampaign,
  useListCampaignRuns,
  useCancelCampaignRun,
  useDeleteCampaignRun,
  getListCampaignRunsQueryKey,
  getGetCampaignQueryKey,
  getListCampaignsQueryKey,
  useDeleteCampaign,
  useResetCampaignData,
  useListEmailTemplates,
  useListEmailAccounts,
  useListCampaignEmailAccounts,
  useAssignCampaignEmailAccount,
  useUnassignCampaignEmailAccount,
  useRerunCampaignRun,
  getListCampaignEmailAccountsQueryKey,
  getListEmailAccountsQueryKey,
} from "@workspace/api-client-react";
import type { CampaignRun } from "@workspace/api-client-react";
import type { Campaign } from "@workspace/api-client-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft,
  Zap,
  Clock,
  Calendar,
  Loader2,
  History,
  ArrowRight,
  Users,
  Trash2,
  RotateCcw,
  Square,
  Settings,
  Upload,
  Search,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { format, formatDuration, intervalToDuration } from "date-fns";
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
  resultsPerSearch: number;
  discoveryInputMode: "search" | "upload";
  uploadedDomains: string;
  uploadedDomainsApplyBlockLogic: boolean;
  queryRefreshDays: number;
  discoverySourceRefreshDays: number;
  keywords: string;
  countries: string;
  scheduleType: string;
  scheduleTime: string;
  // Crawler Settings
  crawlPaths: string;
  internalLinkKeywords: string;
  maxPagesPerDomain: number;
  maxCrawlDepth: number;
  // Auto-outreach
  emailTemplateId: number | null;
  emailAccountId: number | null;
};

const DEFAULT_CRAWL_PATHS = "/\n/contact\n/contact-us\n/about\n/about-us\n/team";
const DEFAULT_INTERNAL_LINK_KEYWORDS = "contact\nabout\nteam\npeople\nresearch\nproject\nprojects\nlab\nlabs\nfaculty\npublication\npublications\nrobotics\nvision\nperception\negocentric\nembodied\ndataset";

function extractDomainLines(text: string): string[] {
  const matches = text.match(/(?:https?:\/\/)?(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?:\/[^\s"',;]*)?/gi) ?? [];
  const seen = new Set<string>();
  const domains: string[] = [];

  for (const match of matches) {
    const token = match.trim().replace(/[)\].,;]+$/g, "");
    try {
      const url = token.startsWith("http") ? new URL(token) : new URL(`https://${token}`);
      const domain = url.hostname.replace(/^www\./, "").toLowerCase();
      if (!domain.includes(".") || seen.has(domain)) continue;
      seen.add(domain);
      domains.push(domain);
    } catch {
      // ignore invalid tokens
    }
  }

  return domains;
}

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
    partial: { label: "Partial", cls: "bg-amber-500/10 text-amber-500" },
    cancelling: { label: "Stopping", cls: "bg-amber-500/10 text-amber-500" },
    cancelled: { label: "Cancelled", cls: "bg-amber-500/10 text-amber-500" },
  };
  const s = map[status] ?? { label: status, cls: "bg-muted/40 text-muted-foreground" };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${s.cls}`}>{s.label}</span>
  );
}

// ── Live elapsed-seconds ticker ──────────────────────────────────────────────

function useElapsedTicker(startedAt: string | null | undefined): string {
  const [elapsed, setElapsed] = useState("");
  useEffect(() => {
    if (!startedAt) { setElapsed(""); return; }
    const t0 = new Date(startedAt).getTime();
    const tick = () => {
      const s = Math.floor((Date.now() - t0) / 1000);
      if (s < 60) setElapsed(`${s}s`);
      else if (s < 3600) setElapsed(`${Math.floor(s / 60)}m ${s % 60}s`);
      else setElapsed(`${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return elapsed;
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

  const [stopOpen, setStopOpen] = useState(false);
  const cancelRun = useCancelCampaignRun();
  const queryClientCRC = useQueryClient();
  const { toast: toastCRC } = useToast();

  const runRows = Array.isArray(runs) ? runs : [];
  const activeRun = runRows.find((r) => {
    const status = String(r.status);
    return status === "running" || status === "cancelling";
  });
  const elapsed = useElapsedTicker(activeRun?.startedAt);

  if (!activeRun) return null;

  const isStopping = String(activeRun.status) === "cancelling";
  const startedAt = activeRun.startedAt ? new Date(activeRun.startedAt) : null;
  const progressPercent = activeRun.progressPercent ?? 0;
  const totalWorkUnits = activeRun.totalWorkUnits ?? 0;
  const completedWorkUnits = activeRun.completedWorkUnits ?? 0;
  const counters = [
    { label: "New Leads", value: activeRun.totalNewLeads ?? 0 },
    { label: "Searched", value: activeRun.totalSearches ?? 0 },
    { label: "Skipped", value: activeRun.totalSearchesSkipped ?? 0 },
    { label: "Sources", value: activeRun.totalDiscoverySourcesMined ?? 0 },
    { label: "Blocked", value: activeRun.totalBlocked ?? 0 },
    { label: "Dupes", value: activeRun.totalDuplicates ?? 0 },
  ];

  return (
    <Card className="glass-card border-blue-500/20 bg-blue-500/5 animate-in fade-in">
      <CardHeader className="border-b border-blue-500/10 pb-3">
        <CardTitle className="text-sm font-medium text-blue-600 dark:text-blue-400 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Current Run
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded-full ml-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            Live
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl gap-1.5 text-xs border-amber-500/40 text-amber-600 hover:bg-amber-500/10"
              onClick={() => {
                if (!isStopping) setStopOpen(true);
              }}
              disabled={cancelRun.isPending || isStopping}
            >
              {cancelRun.isPending || isStopping ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3 fill-current" />}
              {cancelRun.isPending || isStopping ? "Stopping..." : "Stop"}
            </Button>
            <Link href={`/campaigns/${campaignId}/runs/${activeRun.id}`}>
              <Button size="sm" variant="outline" className="rounded-xl gap-1.5 text-xs border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10">
                View Run <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>
          <ConfirmDialog
            open={stopOpen}
            onOpenChange={setStopOpen}
            title="Stop Campaign Run?"
            description="The pipeline will stop at its next safe checkpoint. All leads discovered so far will be kept."
            confirmLabel="Stop Run"
            loading={cancelRun.isPending}
            onConfirm={() => {
              cancelRun.mutate(
                { id: activeRun.id },
                {
                  onSuccess: () => {
                    toastCRC({ title: "Run is stopping. It will cancel at the next safe checkpoint." });
                    setStopOpen(false);
                    queryClientCRC.invalidateQueries({ queryKey: getListCampaignRunsQueryKey(params) });
                  },
                  onError: () => toastCRC({ title: "Failed to stop run.", variant: "destructive" }),
                },
              );
            }}
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">

        {/* Progress bar */}
        {totalWorkUnits > 0 && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">
                Queries processed: <span className="font-medium text-foreground">{completedWorkUnits} / {totalWorkUnits}</span>
              </span>
              <span className="font-semibold text-blue-500">{Math.round(progressPercent)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-blue-500/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-700"
                style={{ width: `${Math.min(100, progressPercent)}%` }}
              />
            </div>
          </div>
        )}

        {/* Timing row */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
          {startedAt && (
            <span className="text-muted-foreground">
              Started <span className="font-medium text-foreground">{format(startedAt, "HH:mm")}</span>
            </span>
          )}
          {elapsed && (
            <span className="text-muted-foreground">
              Running for <span className="font-medium text-foreground tabular-nums">{elapsed}</span>
            </span>
          )}
        </div>

        {/* Counters */}
        <div className="flex flex-wrap gap-5 pt-1 border-t border-blue-500/10">
          {counters.map((s) => (
            <div key={s.label} className="text-center">
              <p className="text-2xl font-semibold text-foreground">{s.value}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{s.label}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Campaign Runs history ────────────────────────────────────────────────────

type RunWithList = CampaignRun & { totalAddedToList?: number };

function isResumedRun(run: CampaignRun): boolean {
  try {
    if (!run.metadataJson) return false;
    const meta = JSON.parse(run.metadataJson) as { resumedRun?: boolean };
    return meta?.resumedRun === true;
  } catch {
    return false;
  }
}

function getRunCrawlCounts(run: CampaignRun): { crawledCount: number; crawlFailedCount: number } | null {
  try {
    if (!run.metadataJson) return null;
    const meta = JSON.parse(run.metadataJson) as { crawledCount?: number; crawlFailedCount?: number };
    const crawledCount = typeof meta?.crawledCount === "number" ? meta.crawledCount : 0;
    const crawlFailedCount = typeof meta?.crawlFailedCount === "number" ? meta.crawlFailedCount : 0;
    return { crawledCount, crawlFailedCount };
  } catch {
    return null;
  }
}

function CampaignRunsSection({ campaignId }: { campaignId: number }) {
  const params = { campaignId };
  const { data: runs, isLoading } = useListCampaignRuns(params, {
    query: {
      queryKey: getListCampaignRunsQueryKey(params),
      refetchInterval: (data) => {
        const arr = data?.state?.data;
        return Array.isArray(arr) && arr.some((r) => ["running", "cancelling"].includes(String(r.status))) ? 3000 : false;
      },
    },
  });
  const deleteRun = useDeleteCampaignRun();
  const rerunRun = useRerunCampaignRun();
  const qc = useQueryClient();
  const { toast: toastRuns } = useToast();
  const [, navigate] = useLocation();
  const [deletingRunId, setDeletingRunId] = useState<number | null>(null);
  const [rerunningRunId, setRerunningRunId] = useState<number | null>(null);
  const rerunGuard = useRef(new Set<number>());

  const handleDeleteRun = (e: React.MouseEvent, runId: number) => {
    e.stopPropagation();
    if (!confirm("Delete this run? This cannot be undone.")) return;
    setDeletingRunId(runId);
    deleteRun.mutate(
      { id: runId },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListCampaignRunsQueryKey(params) });
          toastRuns({ title: "Run deleted." });
        },
        onError: () => toastRuns({ title: "Failed to delete run.", variant: "destructive" }),
        onSettled: () => setDeletingRunId(null),
      },
    );
  };

  const handleRerun = (e: React.MouseEvent, run: CampaignRun) => {
    e.stopPropagation();
    const terminal = ["completed", "partial", "failed", "cancelled"].includes(String(run.status));
    if (!terminal) return;
    if (!run.canRerun) {
      toastRuns({
        title: "Exact rerun unavailable",
        description: "This older run has no saved configuration, so it cannot be rerun exactly.",
        variant: "destructive",
      });
      return;
    }
    if (!confirm("Create a new run using the exact saved settings from this run?")) return;
    if (rerunGuard.current.has(run.id)) return;
    rerunGuard.current.add(run.id);
    setRerunningRunId(run.id);
    const requestKey = globalThis.crypto?.randomUUID?.() ?? `${run.id}-${Date.now()}-${Math.random()}`;
    rerunRun.mutate(
      { id: run.id, requestKey },
      {
        onSuccess: (result) => {
          qc.invalidateQueries({ queryKey: getListCampaignRunsQueryKey(params) });
          toastRuns({ title: "Rerun created", description: `Started ${run.runName ?? `Run #${run.id}`} as a fresh run.` });
          navigate(`/campaigns/${campaignId}/runs/${result.runId}`);
        },
        onError: (error: unknown) => {
          toastRuns({
            title: "Rerun failed",
            description: (error as { message?: string })?.message ?? "Failed to create rerun.",
            variant: "destructive",
          });
        },
        onSettled: () => {
          rerunGuard.current.delete(run.id);
          setRerunningRunId(null);
        },
      },
    );
  };

  const runRows = (Array.isArray(runs) ? runs : []) as RunWithList[];
  const completedRuns = runRows.filter((r) => r.status !== "running");

  return (
    <Card className="glass-card overflow-hidden">
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
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow className="border-border/30 hover:bg-transparent">
                <TableHead>Run Name</TableHead>
                <TableHead className="w-[150px]">Date</TableHead>
                <TableHead className="w-[80px] text-right">Leads</TableHead>
                <TableHead className="w-[80px] text-right">Queries</TableHead>
                <TableHead className="w-[80px] text-right">Sources</TableHead>
                <TableHead className="w-[80px] text-right">Dupes</TableHead>
                <TableHead className="w-[80px] text-right">Blocked</TableHead>
                <TableHead className="w-[80px] text-right">Duration</TableHead>
                <TableHead className="w-[100px] text-center">Status</TableHead>
                <TableHead className="w-[80px] text-center">In List</TableHead>
                <TableHead className="w-[40px]" />
                <TableHead className="w-[48px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {completedRuns.map((run) => {
                const startedAt = run.startedAt ? new Date(run.startedAt) : null;
                const completedAt = run.completedAt ? new Date(run.completedAt) : null;
                const dur = run.durationSeconds != null
                  ? (run.durationSeconds < 60
                      ? `${run.durationSeconds}s`
                      : `${Math.floor(run.durationSeconds / 60)}m ${run.durationSeconds % 60}s`)
                  : (startedAt ? durationStr(startedAt, completedAt) : null);

                const resumed = isResumedRun(run);
                const crawlCounts = resumed ? getRunCrawlCounts(run) : null;
                const addedToList = (run as RunWithList).totalAddedToList ?? 0;

                return (
                  <TableRow
                    key={run.id}
                    className="border-border/30 hover:bg-muted/10 cursor-pointer group"
                    onClick={() => window.location.href = `/campaigns/${campaignId}/runs/${run.id}`}
                  >
                    <TableCell>
                      <Link href={`/campaigns/${campaignId}/runs/${run.id}`}>
                        <span className="text-sm font-medium group-hover:text-primary transition-colors">
                          {run.runName ?? `Run #${run.id}`}
                        </span>
                      </Link>
                      {resumed && (
                        <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-500/10 text-violet-500">
                          Resumed
                        </span>
                      )}
                      {run.rerunOfRunId != null && (
                        <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-500">
                          Rerun of Run #{run.rerunOfRunId}
                          {run.rerunNumber != null ? ` · #${run.rerunNumber}` : ""}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {startedAt ? format(startedAt, "MMM d, yyyy · HH:mm") : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      {resumed
                        ? (crawlCounts
                            ? <span className="text-muted-foreground text-xs">{crawlCounts.crawledCount + crawlCounts.crawlFailedCount} crawled</span>
                            : "—")
                        : (run.totalNewLeads ?? 0)}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {run.totalSearches ?? 0}
                      {(run.totalSearchesSkipped ?? 0) > 0 && (
                        <span className="text-xs ml-1 opacity-60">+{run.totalSearchesSkipped}sk</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {(run.totalDiscoverySourcesMined ?? 0) > 0 ? run.totalDiscoverySourcesMined : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {(run.totalDuplicates ?? 0) > 0 ? run.totalDuplicates : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {(run.totalBlocked ?? 0) > 0 ? run.totalBlocked : "—"}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {dur ?? "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      <RunStatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className="text-center">
                      {addedToList > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-600">
                          <Users className="w-3 h-3" />
                          {addedToList}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {["completed", "partial", "failed", "cancelled"].includes(String(run.status)) ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10"
                          disabled={rerunningRunId === run.id}
                          onClick={(e) => handleRerun(e, run)}
                          title={run.canRerun
                            ? "Rerun with exact saved settings"
                            : "Exact rerun unavailable: this older run has no saved configuration"}
                          data-testid={`button-rerun-${run.id}`}
                        >
                          {rerunningRunId === run.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <RotateCcw className="w-3.5 h-3.5" />}
                        </Button>
                      ) : (
                        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-primary transition-colors" />
                      )}
                    </TableCell>
                    <TableCell className="pr-2">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 rounded-lg text-destructive/50 hover:text-destructive hover:bg-destructive/10"
                        disabled={deletingRunId === run.id || ["running", "cancelling"].includes(String(run.status))}
                        onClick={(e) => handleDeleteRun(e, run.id)}
                        title="Delete run"
                      >
                        {deletingRunId === run.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Trash2 className="w-3.5 h-3.5" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ── Settings tab content ─────────────────────────────────────────────────────

interface SettingsTabProps {
  formData: FormData;
  setFormData: React.Dispatch<React.SetStateAction<FormData>>;
  selectedDays: string[];
  toggleDay: (day: string) => void;
  nextRunAt: Date | null;
  campaign: Campaign;
  handleSave: () => void;
  isSaving: boolean;
  emailTemplates: Array<{ id: number; name: string }>;
  emailAccounts: Array<{ id: number; name: string; email: string }>;
}

function SettingsTab({
  formData, setFormData, selectedDays, toggleDay, nextRunAt, campaign,
  handleSave, isSaving, emailTemplates, emailAccounts,
}: SettingsTabProps) {
  const uploadedDomainCount = extractDomainLines(formData.uploadedDomains).length;
  const handleDomainFileChange = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const domains = extractDomainLines(text);
    setFormData((prev) => ({
      ...prev,
      discoveryInputMode: "upload",
      uploadedDomains: domains.join("\n"),
    }));
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* General Settings */}
        <Card className="glass-card">
          <CardHeader className="border-b border-border/30 pb-3">
            <h3 className="text-sm font-medium text-foreground">General</h3>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Campaign Name</Label>
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
            <div className="space-y-3">
              <Label className="text-xs font-medium text-muted-foreground">Lead Source</Label>
              <RadioGroup
                value={formData.discoveryInputMode}
                onValueChange={(value) => setFormData({ ...formData, discoveryInputMode: value as "search" | "upload" })}
                className="grid grid-cols-1 sm:grid-cols-2 gap-2"
              >
                <label className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                  formData.discoveryInputMode === "search" ? "border-primary bg-primary/5" : "border-border/50 bg-background/40 hover:bg-muted/30",
                )}>
                  <RadioGroupItem value="search" className="mt-0.5" />
                  <span className="space-y-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      <Search className="h-3.5 w-3.5" /> Search
                    </span>
                    <span className="block text-xs text-muted-foreground">Use keywords and countries with Serper.</span>
                  </span>
                </label>
                <label className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                  formData.discoveryInputMode === "upload" ? "border-primary bg-primary/5" : "border-border/50 bg-background/40 hover:bg-muted/30",
                )}>
                  <RadioGroupItem value="upload" className="mt-0.5" />
                  <span className="space-y-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      <Upload className="h-3.5 w-3.5" /> Upload Domains
                    </span>
                    <span className="block text-xs text-muted-foreground">Use a TXT or CSV domain list.</span>
                  </span>
                </label>
              </RadioGroup>
            </div>

            {formData.discoveryInputMode === "search" ? (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Keywords (comma separated)</Label>
                  <Input
                    value={formData.keywords}
                    onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
                    className="rounded-xl bg-background/50 font-mono text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Countries (optional, comma separated codes)</Label>
                  <Input
                    value={formData.countries}
                    onChange={(e) => setFormData({ ...formData, countries: e.target.value })}
                    className="rounded-xl bg-background/50 font-mono text-sm"
                    placeholder="US, UK, CA"
                  />
                </div>
              </>
            ) : (
              <div className="space-y-3 rounded-xl border border-border/50 bg-muted/20 p-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Upload TXT or CSV</Label>
                  <Input
                    type="file"
                    accept=".txt,.csv,text/plain,text/csv"
                    onChange={(e) => handleDomainFileChange(e.target.files?.[0])}
                    className="rounded-xl bg-background/50"
                  />
                  <p className="text-[11px] text-muted-foreground/70">
                    CSV can have any columns; the system extracts website domains from the whole file.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs font-medium text-muted-foreground">Uploaded Domains</Label>
                    <span className="text-[11px] text-muted-foreground">{uploadedDomainCount} detected</span>
                  </div>
                  <Textarea
                    value={formData.uploadedDomains}
                    onChange={(e) => setFormData({ ...formData, uploadedDomains: e.target.value })}
                    className="min-h-[150px] rounded-xl bg-background/50 font-mono text-xs"
                    placeholder={"example.com\nhttps://another-company.com"}
                  />
                </div>
                <div className="flex items-center justify-between gap-4 rounded-xl border border-border/50 bg-background/40 p-3">
                  <div className="min-w-0">
                    <Label className="text-sm font-medium text-foreground">Apply blocked-domain logic</Label>
                    <p className="text-xs text-muted-foreground">
                      Turn off to trust uploaded domains and bypass blocklist/classifier filters.
                    </p>
                  </div>
                  <Switch
                    checked={formData.uploadedDomainsApplyBlockLogic}
                    onCheckedChange={(checked) => setFormData({ ...formData, uploadedDomainsApplyBlockLogic: checked })}
                  />
                </div>
              </div>
            )}
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

        {/* Search & Scoring + Scheduler Settings */}
        <Card className="glass-card">
          <CardHeader className="border-b border-border/30 pb-3">
            <h3 className="text-sm font-medium text-foreground">Search & Scoring</h3>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Min Relevance Score</Label>
                <Input
                  type="number"
                  value={formData.minRelevanceScore}
                  onChange={(e) => setFormData({ ...formData, minRelevanceScore: Number(e.target.value) })}
                  className="rounded-xl bg-background/50"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Results Per Search</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={formData.resultsPerSearch}
                  onChange={(e) => setFormData({ ...formData, resultsPerSearch: Number(e.target.value) })}
                  placeholder="10"
                  className="rounded-xl bg-background/50"
                />
                <p className="text-[11px] text-muted-foreground/70">Max 50 per query</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
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
                <p className="text-[11px] text-muted-foreground/70">Days before re-searching same keyword</p>
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
                <p className="text-[11px] text-muted-foreground/70">Days before re-mining a source URL</p>
              </div>
            </div>

            {/* Scheduler */}
            <div className="border-t border-border/30 pt-4 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-primary" /> Scheduler
              </p>
              <div className="grid grid-cols-2 gap-3">
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
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs font-medium text-muted-foreground">Next Run</Label>
                    <div className="flex items-center gap-1.5 text-sm font-medium text-primary">
                      <Clock className="w-3.5 h-3.5" />
                      {format(nextRunAt, "MMM d, HH:mm")}
                    </div>
                  </div>
                )}
              </div>

              {formData.scheduleType === "weekly" && (
                <div className="space-y-1.5">
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
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Crawler Settings */}
      <Card className="glass-card">
        <CardHeader className="border-b border-border/30 pb-3">
          <h3 className="text-sm font-medium text-foreground">Crawler Settings</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Configure which pages the crawler visits per lead and how aggressively to follow internal links.
            Tune this for different campaign types (e.g. research labs vs SaaS companies).
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Crawl Paths</Label>
              <Textarea
                value={formData.crawlPaths}
                onChange={(e) => setFormData({ ...formData, crawlPaths: e.target.value })}
                placeholder={DEFAULT_CRAWL_PATHS}
                rows={6}
                className="rounded-xl bg-background/50 font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground/70">
                One path per line (e.g. <code>/contact</code>). Always crawled first.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Internal Link Keywords</Label>
              <Textarea
                value={formData.internalLinkKeywords}
                onChange={(e) => setFormData({ ...formData, internalLinkKeywords: e.target.value })}
                placeholder={DEFAULT_INTERNAL_LINK_KEYWORDS}
                rows={6}
                className="rounded-xl bg-background/50 font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground/70">
                One keyword per line. Only follow same-domain links whose URL or text contains a keyword.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-border/30 pt-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Max Pages Per Domain</Label>
              <Input
                type="number"
                min={1}
                value={formData.maxPagesPerDomain}
                onChange={(e) => setFormData({ ...formData, maxPagesPerDomain: Math.max(1, Number(e.target.value) || 1) })}
                className="rounded-xl bg-background/50"
              />
              <p className="text-[11px] text-muted-foreground/70">Includes configured paths + followed links.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Max Crawl Depth</Label>
              <Select
                value={String(formData.maxCrawlDepth)}
                onValueChange={(v) => setFormData({ ...formData, maxCrawlDepth: Number(v) })}
              >
                <SelectTrigger className="rounded-xl bg-background/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">0 — Configured paths only</SelectItem>
                  <SelectItem value="1">1 — Paths + matching internal links</SelectItem>
                  <SelectItem value="2">2 — Also follow links-of-links</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground/70">How many hops to follow internal links.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Auto-Outreach Settings */}
      <Card className="glass-card">
        <CardHeader className="border-b border-border/30 pb-3">
          <h3 className="text-sm font-medium text-foreground">Auto-Outreach</h3>
          <p className="text-xs text-muted-foreground mt-1">
            As qualified processing batches finish, automatically create <strong>pending review</strong> outreach
            drafts for eligible extracted emails. Select both an email template and a sender account.
          </p>
        </CardHeader>
        <CardContent className="pt-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Email Template</Label>
              <Select
                value={formData.emailTemplateId != null ? String(formData.emailTemplateId) : "none"}
                onValueChange={(v) => setFormData({ ...formData, emailTemplateId: v === "none" ? null : Number(v) })}
              >
                <SelectTrigger className="rounded-xl bg-background/50">
                  <SelectValue placeholder="None — auto-outreach disabled" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None — auto-outreach disabled</SelectItem>
                  {emailTemplates.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Email Account</Label>
              <Select
                value={formData.emailAccountId != null ? String(formData.emailAccountId) : "none"}
                onValueChange={(v) => setFormData({ ...formData, emailAccountId: v === "none" ? null : Number(v) })}
              >
                <SelectTrigger className="rounded-xl bg-background/50">
                  <SelectValue placeholder="None — auto-outreach disabled" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None — auto-outreach disabled</SelectItem>
                  {emailAccounts.map((account) => (
                    <SelectItem key={account.id} value={String(account.id)}>
                      {account.name} ({account.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-2 space-y-1">
            <p className="text-[11px] text-muted-foreground/70">
              Outreach drafts will be AI-personalised if an OpenAI key is configured. You review and approve them before sending.
            </p>
            <p className="text-[11px] text-muted-foreground/70">
              Auto-outreach runs only when both fields are selected.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Save button */}
      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={isSaving} className="rounded-xl shadow-sm">
          {isSaving ? "Saving…" : "Save Changes"}
        </Button>
      </div>
    </div>
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
  const deleteCampaign = useDeleteCampaign();
  const resetData = useResetCampaignData();
  const assignCampaignEmailAccount = useAssignCampaignEmailAccount();
  const unassignCampaignEmailAccount = useUnassignCampaignEmailAccount();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [formData, setFormData] = useState<FormData>({
    name: "",
    objective: "",
    isActive: true,
    minRelevanceScore: 50,
    resultsPerSearch: 10,
    discoveryInputMode: "search",
    uploadedDomains: "",
    uploadedDomainsApplyBlockLogic: true,
    queryRefreshDays: 30,
    discoverySourceRefreshDays: 30,
    keywords: "",
    countries: "",
    scheduleType: "manual",
    scheduleTime: "09:00",
    crawlPaths: DEFAULT_CRAWL_PATHS,
    internalLinkKeywords: DEFAULT_INTERNAL_LINK_KEYWORDS,
    maxPagesPerDomain: 10,
    maxCrawlDepth: 1,
    emailTemplateId: null,
    emailAccountId: null,
  });
  const initialized = useRef(false);
  const initializedAccount = useRef(false);
  const [selectedDays, setSelectedDays] = useState<string[]>(["mon"]);
  const { data: emailTemplatesData } = useListEmailTemplates({ query: {} });
  const emailTemplates = (emailTemplatesData ?? []).map((t) => ({ id: t.id, name: t.name }));
  const { data: emailAccountsData } = useListEmailAccounts({
    query: { queryKey: getListEmailAccountsQueryKey(), staleTime: 30_000 },
  });
  const { data: assignedEmailAccounts } = useListCampaignEmailAccounts(campaignId, {
    query: { enabled: !!campaignId, queryKey: getListCampaignEmailAccountsQueryKey(campaignId), staleTime: 10_000 },
  });
  const emailAccounts = (emailAccountsData ?? []).map((account) => ({
    id: account.id,
    name: account.name,
    email: account.email,
  }));
  const [deleteCampaignOpen, setDeleteCampaignOpen] = useState(false);
  const [resetDataOpen, setResetDataOpen] = useState(false);

  // Run name dialog state
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [runName, setRunName] = useState("");
  const [isTriggering, setIsTriggering] = useState(false);

  useEffect(() => {
    if (campaign && !initialized.current) {
      const days = campaign.scheduleDays;
      setSelectedDays(days ? days.split(",").map((d) => d.trim()) : ["mon"]);
      setFormData({
        name: campaign.name ?? "",
        objective: campaign.objective ?? "",
        isActive: campaign.isActive ?? true,
        minRelevanceScore: campaign.minRelevanceScore ?? 50,
        resultsPerSearch: campaign.resultsPerSearch ?? 10,
        discoveryInputMode: (campaign.discoveryInputMode ?? "search") as "search" | "upload",
        uploadedDomains: campaign.uploadedDomains ?? "",
        uploadedDomainsApplyBlockLogic: campaign.uploadedDomainsApplyBlockLogic ?? true,
        queryRefreshDays: campaign.queryRefreshDays ?? 30,
        discoverySourceRefreshDays: campaign.discoverySourceRefreshDays ?? 30,
        keywords: Array.isArray(campaign.keywords) ? campaign.keywords.join(", ") : (campaign.keywords ?? ""),
        countries: Array.isArray(campaign.countries) ? campaign.countries.join(", ") : (campaign.countries ?? ""),
        scheduleType: campaign.scheduleType ?? "manual",
        scheduleTime: campaign.scheduleTime ?? "09:00",
        crawlPaths: campaign.crawlPaths ?? DEFAULT_CRAWL_PATHS,
        internalLinkKeywords: campaign.internalLinkKeywords ?? DEFAULT_INTERNAL_LINK_KEYWORDS,
        maxPagesPerDomain: campaign.maxPagesPerDomain ?? 10,
        maxCrawlDepth: campaign.maxCrawlDepth ?? 1,
        emailTemplateId: (campaign as Record<string, unknown>).emailTemplateId as number | null ?? null,
        emailAccountId: null,
      });
      initialized.current = true;
    }
  }, [campaign]);

  useEffect(() => {
    if (!initialized.current || initializedAccount.current) return;
    if (assignedEmailAccounts === undefined) return;
    setFormData((prev) => ({
      ...prev,
      emailAccountId: assignedEmailAccounts[0]?.id ?? null,
    }));
    initializedAccount.current = true;
  }, [assignedEmailAccounts]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(campaignId) });
    queryClient.invalidateQueries({ queryKey: getListCampaignRunsQueryKey({ campaignId }) });
    queryClient.invalidateQueries({ queryKey: getListCampaignEmailAccountsQueryKey(campaignId) });
  };

  const saveCampaignSettings = async (showToast = true) => {
    await updateCampaign.mutateAsync({
      id: campaignId,
      data: {
        ...formData,
        resultsPerSearch: Math.min(50, Math.max(1, formData.resultsPerSearch || 10)),
        discoveryInputMode: formData.discoveryInputMode,
        uploadedDomains: formData.uploadedDomains,
        uploadedDomainsApplyBlockLogic: formData.uploadedDomainsApplyBlockLogic,
        keywords: formData.keywords.split(",").map((k) => k.trim()).filter(Boolean),
        countries: formData.countries.split(",").map((c) => c.trim()).filter(Boolean),
        scheduleDays: selectedDays.join(","),
      } as Parameters<typeof updateCampaign.mutate>[0]["data"],
    });

    const currentAssignedIds = (assignedEmailAccounts ?? []).map((account) => account.id);
    const desiredAccountId = formData.emailAccountId;

    const idsToRemove = currentAssignedIds.filter((accountId) => accountId !== desiredAccountId);
    for (const accountId of idsToRemove) {
      await unassignCampaignEmailAccount.mutateAsync({ id: campaignId, accountId });
    }

    if (desiredAccountId != null && !currentAssignedIds.includes(desiredAccountId)) {
      await assignCampaignEmailAccount.mutateAsync({
        id: campaignId,
        data: { emailAccountId: desiredAccountId },
      });
    }

    invalidate();
    if (showToast) toast({ title: "Campaign saved." });
  };

  const handleSave = async () => {
    try {
      await saveCampaignSettings(true);
    } catch {
      toast({ title: "Failed to save campaign.", variant: "destructive" });
    }
  };

  const openRunDialog = () => {
    setRunName(`Campaign Run – ${new Date().toISOString().slice(0, 10)}`);
    setRunDialogOpen(true);
  };

  const handleTrigger = async () => {
    setIsTriggering(true);
    try {
      if (formData.discoveryInputMode === "upload" && extractDomainLines(formData.uploadedDomains).length === 0) {
        throw new Error("Upload mode needs at least one valid domain.");
      }
      await saveCampaignSettings(false);
      const res = await fetch(`${import.meta.env.BASE_URL}api/campaigns/${campaignId}/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runName: runName.trim() || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setRunDialogOpen(false);
      invalidate();
      toast({ title: "Campaign run started." });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Failed to start campaign run.", variant: "destructive" });
    } finally {
      setIsTriggering(false);
    }
  };

  const handleDeleteCampaign = () => {
    deleteCampaign.mutate(
      { id: campaignId },
      {
        onSuccess: () => {
          toast({ title: "Campaign deleted." });
          setDeleteCampaignOpen(false);
          queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
          navigate("/campaigns");
        },
        onError: () => toast({ title: "Failed to delete campaign.", variant: "destructive" }),
      },
    );
  };

  const handleResetData = () => {
    resetData.mutate(
      { id: campaignId },
      {
        onSuccess: (result) => {
          toast({ title: `Reset complete: ${result.deletedRuns} run(s) and ${result.deletedLeads} lead(s) removed.` });
          setResetDataOpen(false);
          invalidate();
        },
        onError: () => toast({ title: "Failed to reset campaign data.", variant: "destructive" }),
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

  const isRunning = isTriggering || campaign.lastRunStatus === "running";
  const nextRunAt = campaign.nextRunAt ? new Date(campaign.nextRunAt) : null;
  const isSavingSettings =
    updateCampaign.isPending ||
    assignCampaignEmailAccount.isPending ||
    unassignCampaignEmailAccount.isPending;

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
            onClick={openRunDialog}
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
        </div>
      </div>

      {/* Run name dialog */}
      <Dialog open={runDialogOpen} onOpenChange={setRunDialogOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Start Campaign Run</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label className="text-xs font-medium text-muted-foreground">Run Name</Label>
            <Input
              value={runName}
              onChange={(e) => setRunName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !isTriggering) handleTrigger(); }}
              className="rounded-xl bg-background/50"
              placeholder="Campaign Run – 2026-05-28"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Give this run a descriptive name so you can identify it in the history.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setRunDialogOpen(false)} disabled={isTriggering}>
              Cancel
            </Button>
            <Button className="rounded-xl gap-2" onClick={handleTrigger} disabled={isTriggering}>
              {isTriggering ? <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</> : <><Zap className="w-4 h-4" /> Start Run</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteCampaignOpen}
        onOpenChange={setDeleteCampaignOpen}
        title="Delete Campaign"
        description={`This will permanently delete the campaign "${campaign?.name ?? ""}" along with all its runs, leads, and outreach data. This cannot be undone.`}
        confirmText={campaign?.name ?? ""}
        confirmLabel="Delete Campaign"
        onConfirm={handleDeleteCampaign}
        loading={deleteCampaign.isPending}
      />

      <ConfirmDialog
        open={resetDataOpen}
        onOpenChange={setResetDataOpen}
        title="Reset Campaign Data"
        description={`This will delete all runs and leads for "${campaign?.name ?? ""}" while keeping the campaign settings. This cannot be undone.`}
        confirmText="RESET DATA"
        confirmLabel="Reset Data"
        onConfirm={handleResetData}
        loading={resetData.isPending}
      />

      {/* Tabs */}
      <Tabs defaultValue="runs">
        <TabsList className="rounded-xl">
          <TabsTrigger value="runs" className="rounded-lg gap-1.5">
            <History className="w-3.5 h-3.5" /> Runs
          </TabsTrigger>
          <TabsTrigger value="settings" className="rounded-lg gap-1.5">
            <Settings className="w-3.5 h-3.5" /> Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="runs" className="space-y-5 mt-4">
          <CurrentRunCard campaignId={campaignId} />
          <CampaignRunsSection campaignId={campaignId} />
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <SettingsTab
            formData={formData}
            setFormData={setFormData}
            selectedDays={selectedDays}
            toggleDay={toggleDay}
            nextRunAt={nextRunAt}
            campaign={campaign}
            handleSave={handleSave}
            isSaving={isSavingSettings}
            emailTemplates={emailTemplates}
            emailAccounts={emailAccounts}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
