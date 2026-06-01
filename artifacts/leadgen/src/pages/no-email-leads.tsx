import { useState, useMemo } from "react";
import {
  useListLeads,
  useDeleteLead,
  useListCampaigns,
  useListLeadLists,
  useListCampaignRuns,
  getListLeadsQueryKey,
} from "@workspace/api-client-react";
import type { Lead } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScoreBadge } from "@/components/ScoreBadge";
import { LeadDetailDrawer } from "@/components/lead-detail-drawer";
import { useToast } from "@/hooks/use-toast";
import { saveExportToServer } from "@/lib/export-files";
import { cn } from "@/lib/utils";
import {
  MailX,
  Download,
  Loader2,
  Globe,
  RefreshCw,
  Trash2,
  ChevronLeft,
  Search,
  Mail,
  Phone,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

type QualFilter = "all" | "qualified" | "unqualified" | "rejected";
type LeadFilter = "hasPhone" | "aboveMinScore" | "belowMinScore" | "notInList";

const QUAL_TABS: { key: QualFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "qualified", label: "Qualified" },
  { key: "unqualified", label: "Unqualified" },
  { key: "rejected", label: "Rejected" },
];

const MIN_SCORE = 50;

// ── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonRow({ cols = 7 }: { cols?: number }) {
  return (
    <TableRow>
      {Array.from({ length: cols }).map((_, i) => (
        <TableCell key={i}>
          <div className="h-4 rounded bg-muted/60 animate-pulse" />
        </TableCell>
      ))}
    </TableRow>
  );
}

// ── Campaign listing ──────────────────────────────────────────────────────────

function CampaignList({
  allLeads,
  isLoading,
  onSelect,
}: {
  allLeads: Lead[];
  isLoading: boolean;
  onSelect: (campaignId: number | null) => void;
}) {
  const { data: campaigns } = useListCampaigns();
  const campaignRows = Array.isArray(campaigns) ? campaigns : [];

  type CampaignStat = {
    id: number | null;
    name: string;
    noEmailCount: number;
    avgScore: number | null;
    qualified: number;
    unqualified: number;
    rejected: number;
    crawlFailed: number;
  };

  const stats = useMemo((): CampaignStat[] => {
    const map = new Map<number | null, Lead[]>();
    for (const l of allLeads) {
      const key = l.campaignId ?? null;
      map.set(key, [...(map.get(key) ?? []), l]);
    }

    const rows: CampaignStat[] = [];
    for (const [campaignId, leads] of map.entries()) {
      const campaign = campaignId !== null ? campaignRows.find((c) => c.id === campaignId) : null;
      const scored = leads.filter((l) => typeof l.relevanceScore === "number");
      rows.push({
        id: campaignId,
        name: campaign?.name ?? (campaignId === null ? "No campaign" : `Campaign #${campaignId}`),
        noEmailCount: leads.length,
        avgScore: scored.length ? Math.round(scored.reduce((s, l) => s + (l.relevanceScore ?? 0), 0) / scored.length) : null,
        qualified: leads.filter((l) => l.qualificationStatus === "qualified").length,
        unqualified: leads.filter((l) => !l.qualificationStatus || l.qualificationStatus === "unqualified").length,
        rejected: leads.filter((l) => l.qualificationStatus === "rejected").length,
        crawlFailed: leads.filter((l) => l.crawlStatus === "failed").length,
      });
    }
    return rows.sort((a, b) => b.noEmailCount - a.noEmailCount);
  }, [allLeads, campaignRows]);

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-border/50 overflow-hidden bg-card/30">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Campaign</TableHead>
              <TableHead className="text-center">No Email</TableHead>
              <TableHead className="text-center">Avg Score</TableHead>
              <TableHead className="text-center">Qualified</TableHead>
              <TableHead className="text-center">Unqualified</TableHead>
              <TableHead className="text-center">Rejected</TableHead>
              <TableHead className="text-center">Crawl Failed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={7} />)}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (stats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mb-4">
          <MailX className="w-8 h-8 text-emerald-500/60" />
        </div>
        <h3 className="font-semibold text-lg mb-1">No leads missing emails</h3>
        <p className="text-muted-foreground text-sm max-w-xs">
          All leads have an email address — great coverage!
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/50 overflow-hidden bg-card/30">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[200px]">Campaign</TableHead>
            <TableHead className="text-center w-[100px]">No Email</TableHead>
            <TableHead className="text-center w-[100px]">Avg Score</TableHead>
            <TableHead className="text-center w-[100px]">Qualified</TableHead>
            <TableHead className="text-center w-[110px]">Unqualified</TableHead>
            <TableHead className="text-center w-[100px]">Rejected</TableHead>
            <TableHead className="text-center w-[110px]">Crawl Failed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stats.map((row) => (
            <TableRow
              key={String(row.id)}
              className="cursor-pointer hover:bg-muted/30 transition-colors"
              role="button"
              tabIndex={0}
              onClick={() => onSelect(row.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(row.id); } }}
            >
              <TableCell>
                <span className={cn("font-medium text-sm", row.id === null && "italic text-muted-foreground")}>
                  {row.name}
                </span>
              </TableCell>
              <TableCell className="text-center">
                <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-600">
                  {row.noEmailCount}
                </span>
              </TableCell>
              <TableCell className="text-center text-sm font-medium">
                {row.avgScore !== null ? row.avgScore : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-center">
                {row.qualified > 0
                  ? <span className="text-sm font-medium text-emerald-600">{row.qualified}</span>
                  : <span className="text-muted-foreground text-sm">0</span>}
              </TableCell>
              <TableCell className="text-center">
                <span className="text-sm text-muted-foreground">{row.unqualified}</span>
              </TableCell>
              <TableCell className="text-center">
                {row.rejected > 0
                  ? <span className="text-sm font-medium text-red-500">{row.rejected}</span>
                  : <span className="text-muted-foreground text-sm">0</span>}
              </TableCell>
              <TableCell className="text-center">
                {row.crawlFailed > 0
                  ? <span className="text-sm font-medium text-orange-500">{row.crawlFailed}</span>
                  : <span className="text-muted-foreground text-sm">0</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Campaign Run listing (second level) ──────────────────────────────────────

function CampaignRunList({
  campaignId,
  allLeads,
  campaignName,
  onSelectRun,
  onBack,
}: {
  campaignId: number | null;
  allLeads: Lead[];
  campaignName: string;
  onSelectRun: (runId: number | null, runName: string) => void;
  onBack: () => void;
}) {
  const { data: runs } = useListCampaignRuns(
    campaignId !== null ? { campaignId } : undefined,
  );
  const runRows = Array.isArray(runs) ? runs : [];

  // Filter leads for this campaign
  const campaignLeads = useMemo(
    () => allLeads.filter((l) => campaignId === null ? l.campaignId == null : l.campaignId === campaignId),
    [allLeads, campaignId],
  );

  type RunStat = {
    runId: number | null;
    runName: string;
    count: number;
    qualified: number;
    rejected: number;
    crawlFailed: number;
    startedAt: string | null;
  };

  const stats = useMemo((): RunStat[] => {
    const map = new Map<number | null, Lead[]>();
    for (const l of campaignLeads) {
      const key = (l as Lead & { campaignRunId?: number | null }).campaignRunId ?? null;
      map.set(key, [...(map.get(key) ?? []), l]);
    }
    const rows: RunStat[] = [];
    for (const [runId, leads] of map.entries()) {
      const run = runId !== null ? runRows.find((r) => r.id === runId) : null;
      rows.push({
        runId,
        runName: run?.runName ?? (runId === null ? "No run" : `Run #${runId}`),
        count: leads.length,
        qualified: leads.filter((l) => l.qualificationStatus === "qualified").length,
        rejected: leads.filter((l) => l.qualificationStatus === "rejected").length,
        crawlFailed: leads.filter((l) => l.crawlStatus === "failed").length,
        startedAt: run?.startedAt ?? null,
      });
    }
    return rows.sort((a, b) => {
      if (a.startedAt && b.startedAt) return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
      return b.count - a.count;
    });
  }, [campaignLeads, runRows]);

  return (
    <div className="space-y-5">
      <div>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ChevronLeft className="w-4 h-4" /> Back to campaigns
        </button>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <MailX className="w-5 h-5 text-amber-500" />
          {campaignName}
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">Select a campaign run to view its no-email leads</p>
      </div>
      <div className="rounded-2xl border border-border/50 overflow-hidden bg-card/30">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px]">Campaign Run</TableHead>
              <TableHead className="text-center">No Email</TableHead>
              <TableHead className="text-center">Qualified</TableHead>
              <TableHead className="text-center">Rejected</TableHead>
              <TableHead className="text-center">Crawl Failed</TableHead>
              <TableHead>Started</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                  No leads missing emails in this campaign.
                </TableCell>
              </TableRow>
            ) : (
              stats.map((row) => (
                <TableRow
                  key={String(row.runId)}
                  className="cursor-pointer hover:bg-muted/30"
                  role="button" tabIndex={0}
                  onClick={() => onSelectRun(row.runId, row.runName)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectRun(row.runId, row.runName); } }}
                >
                  <TableCell>
                    <span className="font-medium text-sm">{row.runName}</span>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-600">
                      {row.count}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    {row.qualified > 0
                      ? <span className="text-sm font-medium text-emerald-600">{row.qualified}</span>
                      : <span className="text-muted-foreground text-sm">0</span>}
                  </TableCell>
                  <TableCell className="text-center">
                    {row.rejected > 0
                      ? <span className="text-sm font-medium text-red-500">{row.rejected}</span>
                      : <span className="text-muted-foreground text-sm">0</span>}
                  </TableCell>
                  <TableCell className="text-center">
                    {row.crawlFailed > 0
                      ? <span className="text-sm font-medium text-orange-500">{row.crawlFailed}</span>
                      : <span className="text-muted-foreground text-sm">0</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.startedAt ? new Date(row.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ── Campaign lead table ───────────────────────────────────────────────────────

function CampaignLeadTable({
  campaignId,
  runId,
  allLeads,
  isLoading,
  refetch,
  isFetching,
  campaignName,
  onBack,
}: {
  campaignId: number | null;
  runId?: number | null;
  allLeads: Lead[];
  isLoading: boolean;
  refetch: () => void;
  isFetching: boolean;
  campaignName: string;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const params = { hasEmail: false, limit: 2000 } as const;

  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [qualFilter, setQualFilter] = useState<QualFilter>("all");
  const [leadFilters, setLeadFilters] = useState<Set<LeadFilter>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [minScoreFilter, setMinScoreFilter] = useState("");
  const [maxScoreFilter, setMaxScoreFilter] = useState("");

  const { data: lists } = useListLeadLists();
  const listRows = Array.isArray(lists) ? lists : [];

  const deleteMut = useDeleteLead();

  // Filter to this campaign (and optionally run)
  const campaignLeads = useMemo(
    () => allLeads.filter((l) => {
      if (campaignId === null ? l.campaignId != null : l.campaignId !== campaignId) return false;
      if (runId !== undefined) {
        const leadRunId = (l as Lead & { campaignRunId?: number | null }).campaignRunId ?? null;
        if (runId === null ? leadRunId !== null : leadRunId !== runId) return false;
      }
      return true;
    }),
    [allLeads, campaignId, runId],
  );

  const qualCounts = useMemo(() => ({
    all: campaignLeads.length,
    qualified: campaignLeads.filter((l) => l.qualificationStatus === "qualified").length,
    unqualified: campaignLeads.filter((l) => !l.qualificationStatus || l.qualificationStatus === "unqualified").length,
    rejected: campaignLeads.filter((l) => l.qualificationStatus === "rejected").length,
  }), [campaignLeads]);

  const rows = useMemo(() => {
    return campaignLeads.filter((l) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!l.companyName?.toLowerCase().includes(q) && !l.rootDomain?.toLowerCase().includes(q)) return false;
      }
      if (qualFilter !== "all" && (l.qualificationStatus ?? "unqualified") !== qualFilter) return false;
      if (leadFilters.has("hasPhone") && !l.phoneNumbers) return false;
      if (leadFilters.has("aboveMinScore") && (typeof l.relevanceScore !== "number" || l.relevanceScore < MIN_SCORE)) return false;
      if (leadFilters.has("belowMinScore") && (typeof l.relevanceScore !== "number" || l.relevanceScore >= MIN_SCORE)) return false;
      if (leadFilters.has("notInList")) {
        // "not in list" — treat addedToList field if present
        const lead = l as Lead & { addedToList?: boolean };
        if (lead.addedToList) return false;
      }
      if (minScoreFilter !== "" && (typeof l.relevanceScore !== "number" || l.relevanceScore < Number(minScoreFilter))) return false;
      if (maxScoreFilter !== "" && (typeof l.relevanceScore !== "number" || l.relevanceScore > Number(maxScoreFilter))) return false;
      return true;
    });
  }, [campaignLeads, searchQuery, qualFilter, leadFilters, minScoreFilter, maxScoreFilter]);

  const toggleFilter = (f: LeadFilter) => {
    setLeadFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f); else next.add(f);
      return next;
    });
  };

  const handleDelete = (lead: Lead) => {
    if (!confirm(`Delete "${lead.companyName || lead.rootDomain}"? This cannot be undone.`)) return;
    setDeletingId(lead.id);
    deleteMut.mutate(
      { id: lead.id },
      {
        onSuccess: () => {
          toast({ title: "Lead deleted" });
          qc.invalidateQueries({ queryKey: getListLeadsQueryKey(params) });
          if (selectedLeadId === lead.id) setSelectedLeadId(null);
        },
        onError: () => toast({ title: "Failed to delete lead", variant: "destructive" }),
        onSettled: () => setDeletingId(null),
      },
    );
  };

  const handleExport = async () => {
    if (!rows.length || exporting) return;
    setExporting(true);
    try {
      const ids = rows.map((l) => l.id).join(",");
      const saved = await saveExportToServer(`/api/leads/export?format=csv&leadIds=${ids}`);
      toast({ title: `Exported ${rows.length} lead${rows.length !== 1 ? "s" : ""} → ${saved.relativePath}` });
    } catch (err: unknown) {
      toast({ title: err instanceof Error ? err.message : "Export failed", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const LEAD_FILTER_TABS: { key: LeadFilter; label: string }[] = [
    { key: "hasPhone", label: "Has Phone" },
    { key: "aboveMinScore", label: `Score ≥ ${MIN_SCORE}` },
    { key: "belowMinScore", label: `Score < ${MIN_SCORE}` },
    { key: "notInList", label: "Not in List" },
  ];

  return (
    <div className="space-y-5">
      {/* Back + header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Button variant="outline" size="sm" className="rounded-xl gap-2 mb-3" onClick={onBack}>
            <ChevronLeft className="w-4 h-4" /> {runId !== undefined ? "Back to runs" : "Back to campaigns"}
          </Button>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <MailX className="w-5 h-5 text-amber-500" />
            {campaignName}
            {!isLoading && campaignLeads.length > 0 && (
              <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-sm font-semibold text-amber-600">
                {campaignLeads.length}
              </span>
            )}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">Leads in this campaign missing an email address</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" className="rounded-xl gap-1.5" onClick={refetch} disabled={isFetching}>
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" className="rounded-xl gap-1.5" onClick={handleExport} disabled={exporting || !rows.length}>
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-2">
        {/* Search + score range */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search company or domain…"
              className="pl-8 h-8 text-xs rounded-xl bg-background/50"
            />
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Score</span>
            <Input
              type="number" min={0} max={100} placeholder="Min"
              value={minScoreFilter}
              onChange={(e) => setMinScoreFilter(e.target.value)}
              className="w-14 h-8 text-xs rounded-xl bg-background/50 text-center px-1"
            />
            <span className="text-xs text-muted-foreground">–</span>
            <Input
              type="number" min={0} max={100} placeholder="Max"
              value={maxScoreFilter}
              onChange={(e) => setMaxScoreFilter(e.target.value)}
              className="w-14 h-8 text-xs rounded-xl bg-background/50 text-center px-1"
            />
          </div>
        </div>

        {/* Qual status + lead filter chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground mr-1">Status:</span>
          {QUAL_TABS.map((tab) => (
            <button key={tab.key} onClick={() => setQualFilter(tab.key)}
              className={cn("px-3 py-1 rounded-full text-xs font-medium transition-all",
                qualFilter === tab.key ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:bg-muted/60")}>
              {tab.label}
              <span className="ml-1.5 opacity-70">{qualCounts[tab.key]}</span>
            </button>
          ))}
          <span className="mx-1 text-border">|</span>
          {LEAD_FILTER_TABS.map((tab) => (
            <button key={tab.key} onClick={() => toggleFilter(tab.key)}
              className={cn("px-3 py-1 rounded-full text-xs font-medium transition-all",
                leadFilters.has(tab.key) ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:bg-muted/60")}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="rounded-2xl border border-border/50 overflow-hidden bg-card/30">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Crawl</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>{Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} cols={7} />)}</TableBody>
          </Table>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <MailX className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No leads match the current filters.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border/50 overflow-hidden bg-card/30">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[200px]">Company</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Crawl</TableHead>
                <TableHead className="text-center">Email</TableHead>
                <TableHead className="text-center">Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((lead) => (
                <TableRow key={lead.id} className="cursor-pointer hover:bg-muted/30"
                  role="button" tabIndex={0}
                  onClick={() => setSelectedLeadId(lead.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedLeadId(lead.id); } }}>
                  <TableCell>
                    <div>
                      <span className="font-medium text-foreground">
                        {lead.companyName || (
                          <span className="italic text-muted-foreground/60 text-sm">
                            {lead.crawlStatus === "failed" ? "Crawl failed" : "Pending crawl"}
                          </span>
                        )}
                      </span>
                      {lead.websiteUrl && (
                        <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                          <Globe className="w-3 h-3" />
                          {lead.rootDomain}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <ScoreBadge score={lead.relevanceScore} reason={lead.relevanceReason} scoringMethod={lead.scoringMethod} />
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">{lead.country || "—"}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={`rounded-md text-[11px] capitalize ${
                      lead.crawlStatus === "failed" ? "bg-red-500/10 text-red-500"
                        : lead.crawlStatus === "done" ? "bg-emerald-500/10 text-emerald-600"
                          : "bg-muted/50 text-muted-foreground"}`}>
                      {lead.crawlStatus ?? "pending"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    {lead.emails
                      ? <Mail className="w-3.5 h-3.5 text-emerald-500 mx-auto" />
                      : <span className="text-muted-foreground/40 text-xs">—</span>}
                  </TableCell>
                  <TableCell className="text-center">
                    {lead.phoneNumbers
                      ? <Phone className="w-3.5 h-3.5 text-blue-500 mx-auto" />
                      : <span className="text-muted-foreground/40 text-xs">—</span>}
                  </TableCell>
                  <TableCell>
                    <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium",
                      lead.qualificationStatus === "qualified" ? "bg-emerald-500/10 text-emerald-600"
                        : lead.qualificationStatus === "rejected" ? "bg-red-500/10 text-red-500"
                          : "bg-muted/40 text-muted-foreground")}>
                      {lead.qualificationStatus ?? "unreviewed"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost"
                      className="h-8 w-8 rounded-lg text-destructive/70 hover:text-destructive"
                      aria-label={`Delete ${lead.companyName || lead.rootDomain}`}
                      disabled={deletingId === lead.id}
                      onClick={(e) => { e.stopPropagation(); handleDelete(lead); }}>
                      {deletingId === lead.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <LeadDetailDrawer leadId={selectedLeadId} onClose={() => setSelectedLeadId(null)} onLeadUpdate={refetch} />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function NoEmailLeads() {
  // Navigation: undefined = campaign list; number|null = campaign selected; then run selected
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null | undefined>(undefined);
  const [selectedRun, setSelectedRun] = useState<{ id: number | null; name: string } | undefined>(undefined);

  const params = { hasEmail: false, limit: 2000 } as const;
  const { data: leads, isLoading, refetch, isFetching } = useListLeads(params, {
    query: { queryKey: getListLeadsQueryKey(params), staleTime: 30_000 },
  });
  const allRows: Lead[] = Array.isArray(leads) ? leads : [];

  const { data: campaigns } = useListCampaigns();
  const campaignMap = useMemo(() => {
    const map = new Map<number, string>();
    if (Array.isArray(campaigns)) for (const c of campaigns) map.set(c.id, c.name);
    return map;
  }, [campaigns]);

  const campaignName = useMemo(() => {
    if (selectedCampaignId === undefined) return "";
    if (selectedCampaignId === null) return "No Campaign";
    return campaignMap.get(selectedCampaignId) ?? `Campaign #${selectedCampaignId}`;
  }, [selectedCampaignId, campaignMap]);

  const handleSelectCampaign = (id: number | null) => {
    setSelectedCampaignId(id);
    setSelectedRun(undefined);
  };

  const handleSelectRun = (runId: number | null, runName: string) => {
    setSelectedRun({ id: runId, name: runName });
  };

  const handleBackFromRun = () => {
    setSelectedRun(undefined);
  };

  const handleBackFromCampaign = () => {
    setSelectedCampaignId(undefined);
    setSelectedRun(undefined);
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <MailX className="w-6 h-6 text-amber-500" />
            No Email Leads
            {!isLoading && allRows.length > 0 && selectedCampaignId === undefined && (
              <span className="ml-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-sm font-semibold text-amber-600">
                {allRows.length}
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {selectedCampaignId === undefined
              ? "Select a campaign to review leads missing an email address"
              : selectedRun === undefined
                ? "Select a campaign run to drill into its leads"
                : "Leads missing an email address in this run"}
          </p>
        </div>
      </div>

      {/* Stats strip (campaign list view only) */}
      {!isLoading && selectedCampaignId === undefined && allRows.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Total, No Email", value: allRows.length },
            { label: "Avg Score", value: allRows.length ? Math.round(allRows.reduce((s, l) => s + (l.relevanceScore ?? 0), 0) / allRows.length) : "—" },
            { label: "With Website", value: allRows.filter((l) => !!l.websiteUrl).length },
            { label: "Crawl Failed", value: allRows.filter((l) => l.crawlStatus === "failed").length },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-border/50 bg-card/50 p-4">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className="text-2xl font-semibold mt-1">{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Three-level navigation */}
      {selectedCampaignId === undefined ? (
        <CampaignList allLeads={allRows} isLoading={isLoading} onSelect={handleSelectCampaign} />
      ) : selectedRun === undefined ? (
        <CampaignRunList
          campaignId={selectedCampaignId}
          allLeads={allRows}
          campaignName={campaignName}
          onSelectRun={handleSelectRun}
          onBack={handleBackFromCampaign}
        />
      ) : (
        <CampaignLeadTable
          campaignId={selectedCampaignId}
          runId={selectedRun.id}
          allLeads={allRows}
          isLoading={isLoading}
          refetch={refetch}
          isFetching={isFetching}
          campaignName={`${campaignName} › ${selectedRun.name}`}
          onBack={handleBackFromRun}
        />
      )}
    </div>
  );
}
