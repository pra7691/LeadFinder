import {
  useListLeads,
  useRunCrawl,
  useBulkCrawl,
  useScoreLead,
  useBulkScore,
  useBulkLeadAction,
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
} from "lucide-react";
import { ScoreBadge } from "@/components/ScoreBadge";
import { LeadDrawer } from "@/components/LeadDrawer";

// ── Types ──────────────────────────────────────────────────────────────────

type CrawlRowState = "idle" | "crawling" | "done" | "error";
type ScoreRowState = "idle" | "scoring" | "done" | "error";

type QuickFilter =
  | "all"
  | "pending"
  | "approved"
  | "contacted"
  | "high_relevance"
  | "no_email"
  | "invalid"
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
  { value: "pending",       label: "Pending",        color: "text-amber-500" },
  { value: "approved",      label: "Approved",       color: "text-emerald-500" },
  { value: "contacted",     label: "Contacted",      color: "text-blue-400" },
  { value: "high_relevance",label: "Score ≥80",      color: "text-emerald-400" },
  { value: "low_relevance", label: "Low Relevance",  color: "text-orange-400" },
  { value: "no_email",      label: "No Email",       color: "text-muted-foreground" },
  { value: "invalid",       label: "Invalid",        color: "text-orange-400" },
];

// ── Main component ─────────────────────────────────────────────────────────

export function Leads() {
  const { data: leads, isLoading } = useListLeads({ limit: 200 });
  const runCrawl = useRunCrawl();
  const bulkCrawl = useBulkCrawl();
  const scoreLeadMut = useScoreLead();
  const bulkScoreMut = useBulkScore();
  const bulkAction = useBulkLeadAction();
  const queryClient = useQueryClient();

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
    const ids = selectedIds.length > 0 ? selectedIds : (searchFiltered?.map((l) => l.id) ?? []);
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
    const ids = selectedIds.length > 0 ? selectedIds : (searchFiltered?.map((l) => l.id) ?? []);
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

  const searchFiltered = leads?.filter(
    (l) =>
      l.companyName?.toLowerCase().includes(search.toLowerCase()) ||
      l.rootDomain?.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredLeads = searchFiltered?.filter((l) => {
    switch (activeFilter) {
      case "pending":        return l.reviewStatus === "pending";
      case "approved":       return l.reviewStatus === "approved" || l.leadStatus === "approved";
      case "contacted":      return l.leadStatus === "contacted" || l.leadStatus === "followup_sent";
      case "high_relevance": return (l.relevanceScore ?? -1) >= 80;
      case "low_relevance":  return l.reviewStatus === "low_relevance";
      case "no_email":       return !l.emails;
      case "invalid":        return l.leadStatus === "invalid";
      default:               return true;
    }
  });

  const allSelected =
    !!filteredLeads && filteredLeads.length > 0 && filteredLeads.every((l) => selected.has(l.id));

  const toggleAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    allSelected
      ? setSelected(new Set())
      : setSelected(new Set(filteredLeads?.map((l) => l.id) ?? []));
  };

  const countFor = (f: QuickFilter) => {
    if (!searchFiltered) return 0;
    switch (f) {
      case "all":            return searchFiltered.length;
      case "pending":        return searchFiltered.filter((l) => l.reviewStatus === "pending").length;
      case "approved":       return searchFiltered.filter((l) => l.reviewStatus === "approved" || l.leadStatus === "approved").length;
      case "contacted":      return searchFiltered.filter((l) => l.leadStatus === "contacted" || l.leadStatus === "followup_sent").length;
      case "high_relevance": return searchFiltered.filter((l) => (l.relevanceScore ?? -1) >= 80).length;
      case "low_relevance":  return searchFiltered.filter((l) => l.reviewStatus === "low_relevance").length;
      case "no_email":       return searchFiltered.filter((l) => !l.emails).length;
      case "invalid":        return searchFiltered.filter((l) => l.leadStatus === "invalid").length;
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
          <Button variant="outline" size="sm" className="rounded-xl gap-1.5" onClick={handleBulkCrawl}
            disabled={isBulkBusy || (filteredLeads?.length ?? 0) === 0} data-testid="btn-bulk-crawl">
            {bulkCrawlState === "running" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
            {bulkCrawlState === "running" ? "Crawling…" : crawlLabel}
          </Button>
          <Button variant="outline" size="sm"
            className="rounded-xl gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
            onClick={handleBulkScore} disabled={isBulkBusy || (filteredLeads?.length ?? 0) === 0} data-testid="btn-bulk-score">
            {bulkScoreState === "running" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {bulkScoreState === "running" ? "Scoring…" : scoreLabel}
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
            disabled={isBulkBusy} onClick={() => handleBulkActionOp("approve")}>
            <Check className="w-3 h-3" /> Approve
          </Button>
          <Button size="sm" variant="outline"
            className="h-7 px-3 text-xs rounded-lg gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
            disabled={isBulkBusy} onClick={() => handleBulkActionOp("reject")}>
            <X className="w-3 h-3" /> Reject
          </Button>
          <Button size="sm" variant="outline"
            className="h-7 px-3 text-xs rounded-lg gap-1.5 text-orange-400 border-orange-400/30 hover:bg-orange-400/10"
            disabled={isBulkBusy} onClick={() => handleBulkActionOp("invalid")}>
            <AlertTriangle className="w-3 h-3" /> Invalid
          </Button>
          <Button size="sm" variant="outline"
            className="h-7 px-3 text-xs rounded-lg gap-1.5 text-muted-foreground"
            disabled={isBulkBusy} onClick={() => handleBulkActionOp("archive")}>
            <Archive className="w-3 h-3" /> Archive
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
            ) : filteredLeads?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center">
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
                      <div>{lead.companyName}</div>
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
                        ) : lead.relevanceScore != null ? (
                          <ScoreBadge score={lead.relevanceScore} reason={lead.relevanceReason} />
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
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium w-fit ${lsMeta.color}`}>
                          {lsMeta.label}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium w-fit ${rvMeta.color}`}>
                          {rvMeta.label}
                        </span>
                      </div>
                    </TableCell>

                    {/* Open chevron */}
                    <TableCell className="text-right pr-3">
                      <ChevronRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Lead detail drawer */}
      <LeadDrawer leadId={openLeadId} onClose={() => setOpenLeadId(null)} />
    </div>
  );
}
