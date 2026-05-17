import {
  useListLeads,
  useUpdateLead,
  useRunCrawl,
  useBulkCrawl,
  useScoreLead,
  useBulkScore,
  getListLeadsQueryKey,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useState } from "react";
import {
  Check,
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
  TrendingUp,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

type CrawlRowState = "idle" | "crawling" | "done" | "error";
type ScoreRowState = "idle" | "scoring" | "done" | "error";
type RelevanceFilter = "all" | "high" | "medium" | "low" | "unscored";

// ── Score badge ────────────────────────────────────────────────────────────

function ScoreBadge({
  score,
  reason,
  rowState,
}: {
  score?: number | null;
  reason?: string | null;
  rowState: ScoreRowState;
}) {
  if (rowState === "scoring") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-primary">
        <Loader2 className="w-3 h-3 animate-spin" /> Scoring…
      </span>
    );
  }

  if (rowState === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-destructive">
        <AlertCircle className="w-3 h-3" /> Error
      </span>
    );
  }

  const s = score ?? null;

  if (s === null) {
    return (
      <span className="inline-flex items-center text-[11px] text-muted-foreground/40 italic">
        —
      </span>
    );
  }

  const colorClass =
    s >= 80
      ? "bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/30"
      : s >= 60
        ? "bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/30"
        : s >= 40
          ? "bg-amber-500/15 text-amber-500 ring-1 ring-amber-500/30"
          : "bg-red-500/15 text-red-400 ring-1 ring-red-500/30";

  const badge = (
    <span
      className={`inline-flex items-center justify-center w-[38px] h-[22px] rounded-full text-[11px] font-semibold ${colorClass} cursor-default`}
    >
      {s}
    </span>
  );

  if (reason) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>{badge}</TooltipTrigger>
          <TooltipContent
            side="top"
            className="max-w-[260px] text-xs text-center"
          >
            {reason}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return badge;
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

  if (effective === "crawling") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-primary">
        <Loader2 className="w-3 h-3 animate-spin" /> crawling…
      </span>
    );
  }
  if (effective === "crawled") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500">
        <CheckCircle2 className="w-3 h-3" /> crawled
      </span>
    );
  }
  if (effective === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-destructive">
        <AlertCircle className="w-3 h-3" /> failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/50">
      <Clock className="w-3 h-3" /> pending
    </span>
  );
}

// ── Relevance filter tabs ──────────────────────────────────────────────────

const FILTER_OPTIONS: { value: RelevanceFilter; label: string; color?: string }[] = [
  { value: "all", label: "All" },
  { value: "high", label: "High ≥80", color: "text-emerald-500" },
  { value: "medium", label: "Medium 40–79", color: "text-amber-500" },
  { value: "low", label: "Low <40", color: "text-red-400" },
  { value: "unscored", label: "Unscored" },
];

// ── Main component ─────────────────────────────────────────────────────────

export function Leads() {
  const { data: leads, isLoading } = useListLeads({ limit: 200 });
  const updateLead = useUpdateLead();
  const runCrawl = useRunCrawl();
  const bulkCrawl = useBulkCrawl();
  const scoreLeadMut = useScoreLead();
  const bulkScoreMut = useBulkScore();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [relevanceFilter, setRelevanceFilter] = useState<RelevanceFilter>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [crawlStates, setCrawlStates] = useState<Record<number, CrawlRowState>>({});
  const [scoreStates, setScoreStates] = useState<Record<number, ScoreRowState>>({});

  const [bulkCrawlState, setBulkCrawlState] = useState<"idle" | "running" | "done">("idle");
  const [bulkCrawlSummary, setBulkCrawlSummary] = useState<{
    attempted: number;
    succeeded: number;
    failed: number;
  } | null>(null);

  const [bulkScoreState, setBulkScoreState] = useState<"idle" | "running" | "done">("idle");
  const [bulkScoreSummary, setBulkScoreSummary] = useState<{
    attempted: number;
    succeeded: number;
    failed: number;
  } | null>(null);

  const invalidateLeads = () =>
    queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleReview = (id: number, status: string) => {
    updateLead.mutate(
      { id, data: { reviewStatus: "reviewed", leadStatus: status } },
      { onSuccess: invalidateLeads },
    );
  };

  const handleSingleCrawl = (leadId: number) => {
    setCrawlStates((s) => ({ ...s, [leadId]: "crawling" }));
    runCrawl.mutate(
      { id: leadId },
      {
        onSuccess: () => {
          setCrawlStates((s) => ({ ...s, [leadId]: "done" }));
          invalidateLeads();
        },
        onError: () => {
          setCrawlStates((s) => ({ ...s, [leadId]: "error" }));
          invalidateLeads();
        },
      },
    );
  };

  const handleSingleScore = (leadId: number) => {
    setScoreStates((s) => ({ ...s, [leadId]: "scoring" }));
    scoreLeadMut.mutate(
      { id: leadId },
      {
        onSuccess: () => {
          setScoreStates((s) => ({ ...s, [leadId]: "done" }));
          invalidateLeads();
        },
        onError: () => {
          setScoreStates((s) => ({ ...s, [leadId]: "error" }));
          invalidateLeads();
        },
      },
    );
  };

  const handleBulkCrawl = () => {
    const ids =
      selected.size > 0
        ? [...selected]
        : (searchFiltered?.map((l) => l.id) ?? []);
    if (ids.length === 0) return;

    setBulkCrawlState("running");
    setBulkCrawlSummary(null);
    bulkCrawl.mutate(
      { data: { leadIds: ids } },
      {
        onSuccess: (result) => {
          setBulkCrawlState("done");
          setBulkCrawlSummary({
            attempted: result.attempted,
            succeeded: result.succeeded,
            failed: result.failed,
          });
          invalidateLeads();
        },
        onError: () => setBulkCrawlState("idle"),
      },
    );
  };

  const handleBulkScore = () => {
    const ids =
      selected.size > 0
        ? [...selected]
        : (searchFiltered?.map((l) => l.id) ?? []);
    if (ids.length === 0) return;

    setBulkScoreState("running");
    setBulkScoreSummary(null);
    bulkScoreMut.mutate(
      { data: { leadIds: ids } },
      {
        onSuccess: (result) => {
          setBulkScoreState("done");
          setBulkScoreSummary({
            attempted: result.attempted,
            succeeded: result.succeeded,
            failed: result.failed,
          });
          invalidateLeads();
        },
        onError: () => setBulkScoreState("idle"),
      },
    );
  };

  // ── Selection ─────────────────────────────────────────────────────────────

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── Filtering ─────────────────────────────────────────────────────────────

  const searchFiltered = leads?.filter(
    (l) =>
      l.companyName?.toLowerCase().includes(search.toLowerCase()) ||
      l.rootDomain?.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredLeads = searchFiltered?.filter((l) => {
    if (relevanceFilter === "all") return true;
    if (relevanceFilter === "unscored") return l.relevanceScore == null;
    const s = l.relevanceScore ?? -1;
    if (relevanceFilter === "high") return s >= 80;
    if (relevanceFilter === "medium") return s >= 40 && s < 80;
    if (relevanceFilter === "low") return s >= 0 && s < 40;
    return true;
  });

  const allSelected =
    !!filteredLeads &&
    filteredLeads.length > 0 &&
    filteredLeads.every((l) => selected.has(l.id));

  const toggleAll = () =>
    allSelected
      ? setSelected(new Set())
      : setSelected(new Set(filteredLeads?.map((l) => l.id) ?? []));

  const selectionLabel = selected.size > 0 ? `${selected.size} selected` : null;

  const crawlLabel =
    selected.size > 0 ? `Crawl ${selected.size}` : `Crawl all`;
  const scoreLabel =
    selected.size > 0 ? `Score ${selected.size}` : `Score all`;

  const isBulkBusy = bulkCrawlState === "running" || bulkScoreState === "running";

  // ── Counts for filter tabs ─────────────────────────────────────────────

  const countFor = (f: RelevanceFilter) => {
    if (!searchFiltered) return 0;
    if (f === "all") return searchFiltered.length;
    if (f === "unscored") return searchFiltered.filter((l) => l.relevanceScore == null).length;
    return searchFiltered.filter((l) => {
      const s = l.relevanceScore ?? -1;
      if (f === "high") return s >= 80;
      if (f === "medium") return s >= 40 && s < 80;
      if (f === "low") return s >= 0 && s < 40;
      return false;
    }).length;
  };

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-3xl font-semibold tracking-tight">Leads Queue</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search company or domain…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 rounded-xl bg-background/50 border-border/50"
              data-testid="lead-search"
            />
          </div>

          {/* Bulk crawl */}
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-1.5"
            onClick={handleBulkCrawl}
            disabled={isBulkBusy || (filteredLeads?.length ?? 0) === 0}
            data-testid="btn-bulk-crawl"
          >
            {bulkCrawlState === "running" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Layers className="w-4 h-4" />
            )}
            {bulkCrawlState === "running" ? "Crawling…" : crawlLabel}
          </Button>

          {/* Bulk score */}
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
            onClick={handleBulkScore}
            disabled={isBulkBusy || (filteredLeads?.length ?? 0) === 0}
            data-testid="btn-bulk-score"
          >
            {bulkScoreState === "running" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {bulkScoreState === "running" ? "Scoring…" : scoreLabel}
          </Button>
        </div>
      </div>

      {/* Relevance filter tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-muted-foreground mr-1" />
        {FILTER_OPTIONS.map((opt) => {
          const count = countFor(opt.value);
          const active = relevanceFilter === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => setRelevanceFilter(opt.value)}
              data-testid={`filter-${opt.value}`}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-medium transition-all ${
                active
                  ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}
            >
              <span className={active ? "" : (opt.color ?? "")}>{opt.label}</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  active ? "bg-primary/20" : "bg-muted"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
        {selectionLabel && (
          <span className="ml-auto text-[12px] text-muted-foreground">
            <TrendingUp className="w-3.5 h-3.5 inline mr-1 opacity-60" />
            {selectionLabel}
          </span>
        )}
      </div>

      {/* Bulk crawl result banner */}
      {bulkCrawlState === "done" && bulkCrawlSummary && (
        <div
          className="glass-card p-4 flex items-center gap-3 text-sm"
          data-testid="bulk-crawl-summary"
        >
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          <span>
            Bulk crawl complete —{" "}
            <strong>{bulkCrawlSummary.succeeded}</strong> succeeded,{" "}
            <strong>{bulkCrawlSummary.failed}</strong> failed out of{" "}
            <strong>{bulkCrawlSummary.attempted}</strong> attempted.
          </span>
          <button
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => {
              setBulkCrawlState("idle");
              setBulkCrawlSummary(null);
            }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Bulk score result banner */}
      {bulkScoreState === "done" && bulkScoreSummary && (
        <div
          className="glass-card p-4 flex items-center gap-3 text-sm border-primary/20"
          data-testid="bulk-score-summary"
        >
          <Sparkles className="w-5 h-5 text-primary shrink-0" />
          <span>
            Bulk scoring complete —{" "}
            <strong>{bulkScoreSummary.succeeded}</strong> scored,{" "}
            <strong>{bulkScoreSummary.failed}</strong> failed out of{" "}
            <strong>{bulkScoreSummary.attempted}</strong> attempted.
          </span>
          <button
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => {
              setBulkScoreState("idle");
              setBulkScoreSummary(null);
            }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="glass-card overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow className="border-border/30 hover:bg-transparent">
              <TableHead className="w-10 pl-4">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                  data-testid="checkbox-select-all"
                />
              </TableHead>
              <TableHead className="w-[190px]">Company</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead className="w-[110px]">Crawl</TableHead>
              <TableHead className="w-[130px]">Score</TableHead>
              <TableHead className="w-[160px]">Status</TableHead>
              <TableHead className="text-right w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="h-32 text-center text-muted-foreground animate-pulse"
                >
                  Loading leads…
                </TableCell>
              </TableRow>
            ) : filteredLeads?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center">
                  <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <Search className="w-6 h-6 opacity-20" />
                    <p>No leads found.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredLeads?.map((lead) => {
                const crawlRowState = crawlStates[lead.id] ?? "idle";
                const scoreRowState = scoreStates[lead.id] ?? "idle";
                const isCrawling = crawlRowState === "crawling";
                const isScoring = scoreRowState === "scoring";

                return (
                  <TableRow
                    key={lead.id}
                    className="group border-border/30 transition-colors"
                    data-testid={`lead-row-${lead.id}`}
                  >
                    {/* Select */}
                    <TableCell className="pl-4">
                      <Checkbox
                        checked={selected.has(lead.id)}
                        onCheckedChange={() => toggleSelect(lead.id)}
                        aria-label={`Select ${lead.companyName}`}
                        data-testid={`checkbox-lead-${lead.id}`}
                      />
                    </TableCell>

                    {/* Company */}
                    <TableCell className="font-medium text-foreground">
                      {lead.companyName}
                    </TableCell>

                    {/* Domain */}
                    <TableCell>
                      <a
                        href={`https://${lead.rootDomain}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center text-muted-foreground hover:text-primary transition-colors text-sm"
                      >
                        <Globe className="w-3.5 h-3.5 mr-1.5 opacity-70" />
                        {lead.rootDomain}
                      </a>
                    </TableCell>

                    {/* Contact */}
                    <TableCell>
                      <div className="space-y-0.5">
                        {lead.emails ? (
                          <div className="flex items-center text-[11px] text-muted-foreground gap-1">
                            <MailIcon className="w-3 h-3 opacity-60 shrink-0" />
                            <span className="truncate max-w-[150px] font-mono">
                              {lead.emails.split(",")[0]?.trim()}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground/40 italic">
                            No email
                          </span>
                        )}
                        {lead.phoneNumbers && (
                          <div className="flex items-center text-[11px] text-muted-foreground/70 gap-1">
                            <Phone className="w-3 h-3 opacity-60 shrink-0" />
                            <span className="truncate max-w-[150px] font-mono">
                              {lead.phoneNumbers.split(",")[0]?.trim()}
                            </span>
                          </div>
                        )}
                      </div>
                    </TableCell>

                    {/* Crawl status + per-row button */}
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <CrawlStatusBadge
                          status={lead.crawlStatus}
                          rowState={crawlRowState}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 rounded-lg text-[11px] gap-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 w-fit"
                          onClick={() => handleSingleCrawl(lead.id)}
                          disabled={isCrawling || isBulkBusy}
                          data-testid={`btn-crawl-${lead.id}`}
                        >
                          {isCrawling ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <ScanSearch className="w-3 h-3" />
                          )}
                          {isCrawling ? "Crawling" : "Crawl"}
                        </Button>
                      </div>
                    </TableCell>

                    {/* Relevance score + per-row button */}
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <ScoreBadge
                          score={lead.relevanceScore}
                          reason={lead.relevanceReason}
                          rowState={scoreRowState}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 rounded-lg text-[11px] gap-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 w-fit"
                          onClick={() => handleSingleScore(lead.id)}
                          disabled={isScoring || isBulkBusy}
                          data-testid={`btn-score-${lead.id}`}
                        >
                          {isScoring ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Sparkles className="w-3 h-3" />
                          )}
                          {isScoring ? "Scoring" : "Score"}
                        </Button>
                      </div>
                    </TableCell>

                    {/* Review + lead status */}
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[11px] font-medium capitalize ${
                            lead.reviewStatus === "pending"
                              ? "bg-amber-500/10 text-amber-500"
                              : lead.reviewStatus === "low_relevance"
                                ? "bg-red-500/10 text-red-400"
                                : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {lead.reviewStatus === "low_relevance"
                            ? "low relevance"
                            : lead.reviewStatus}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[11px] font-medium capitalize ${
                            lead.leadStatus === "approved"
                              ? "bg-primary/10 text-primary"
                              : lead.leadStatus === "rejected"
                                ? "bg-destructive/10 text-destructive"
                                : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {lead.leadStatus}
                        </span>
                      </div>
                    </TableCell>

                    {/* Approve / reject */}
                    <TableCell className="text-right">
                      {lead.reviewStatus === "pending" && (
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 rounded-full text-primary hover:bg-primary/10"
                            onClick={() => handleReview(lead.id, "approved")}
                            disabled={updateLead.isPending}
                            data-testid={`btn-approve-${lead.id}`}
                          >
                            <Check className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 rounded-full text-destructive hover:bg-destructive/10"
                            onClick={() => handleReview(lead.id, "rejected")}
                            disabled={updateLead.isPending}
                            data-testid={`btn-reject-${lead.id}`}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
