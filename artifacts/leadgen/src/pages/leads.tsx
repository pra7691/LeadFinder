import {
  useListLeads,
  useUpdateLead,
  useRunCrawl,
  useBulkCrawl,
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
} from "lucide-react";

type CrawlRowState = "idle" | "crawling" | "done" | "error";

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

export function Leads() {
  const { data: leads, isLoading } = useListLeads({ limit: 200 });
  const updateLead = useUpdateLead();
  const runCrawl = useRunCrawl();
  const bulkCrawl = useBulkCrawl();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [crawlStates, setCrawlStates] = useState<Record<number, CrawlRowState>>({});
  const [bulkState, setBulkState] = useState<"idle" | "running" | "done">("idle");
  const [bulkSummary, setBulkSummary] = useState<{
    attempted: number;
    succeeded: number;
    failed: number;
  } | null>(null);

  const invalidateLeads = () =>
    queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });

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

  const handleBulkCrawl = () => {
    const ids =
      selected.size > 0
        ? [...selected]
        : (filteredLeads?.map((l) => l.id) ?? []);
    if (ids.length === 0) return;

    setBulkState("running");
    setBulkSummary(null);
    bulkCrawl.mutate(
      { data: { leadIds: ids } },
      {
        onSuccess: (result) => {
          setBulkState("done");
          setBulkSummary({
            attempted: result.attempted,
            succeeded: result.succeeded,
            failed: result.failed,
          });
          invalidateLeads();
        },
        onError: () => setBulkState("idle"),
      },
    );
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filteredLeads = leads?.filter(
    (l) =>
      l.companyName?.toLowerCase().includes(search.toLowerCase()) ||
      l.rootDomain?.toLowerCase().includes(search.toLowerCase()),
  );

  const allSelected =
    !!filteredLeads &&
    filteredLeads.length > 0 &&
    filteredLeads.every((l) => selected.has(l.id));

  const toggleAll = () =>
    allSelected
      ? setSelected(new Set())
      : setSelected(new Set(filteredLeads?.map((l) => l.id) ?? []));

  const crawlLabel =
    selected.size > 0
      ? `Crawl ${selected.size} selected`
      : `Crawl all ${filteredLeads?.length ?? 0}`;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-3xl font-semibold tracking-tight">Leads Queue</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search company or domain..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 rounded-xl bg-background/50 border-border/50"
              data-testid="lead-search"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-2"
            onClick={handleBulkCrawl}
            disabled={
              bulkState === "running" || (filteredLeads?.length ?? 0) === 0
            }
            data-testid="btn-bulk-crawl"
          >
            {bulkState === "running" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Layers className="w-4 h-4" />
            )}
            {bulkState === "running" ? "Crawling…" : crawlLabel}
          </Button>
        </div>
      </div>

      {/* Bulk result banner */}
      {bulkState === "done" && bulkSummary && (
        <div
          className="glass-card p-4 flex items-center gap-3 text-sm"
          data-testid="bulk-crawl-summary"
        >
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          <span>
            Bulk crawl complete — <strong>{bulkSummary.succeeded}</strong>{" "}
            succeeded, <strong>{bulkSummary.failed}</strong> failed out of{" "}
            <strong>{bulkSummary.attempted}</strong> attempted.
          </span>
          <button
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => {
              setBulkState("idle");
              setBulkSummary(null);
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
              <TableHead className="w-[200px]">Company</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead className="w-[110px]">Crawl</TableHead>
              <TableHead className="text-center w-[60px]">Score</TableHead>
              <TableHead className="w-[170px]">Status</TableHead>
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
                const rowState = crawlStates[lead.id] ?? "idle";
                const isCrawling = rowState === "crawling";

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
                            <span className="truncate max-w-[160px] font-mono">
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
                            <span className="truncate max-w-[160px] font-mono">
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
                          rowState={rowState}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 rounded-lg text-[11px] gap-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 w-fit"
                          onClick={() => handleSingleCrawl(lead.id)}
                          disabled={isCrawling || bulkState === "running"}
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

                    {/* Relevance score */}
                    <TableCell className="text-center">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          (lead.relevanceScore ?? 0) >= 80
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {lead.relevanceScore ?? 0}
                      </span>
                    </TableCell>

                    {/* Review + lead status */}
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[11px] font-medium capitalize ${
                            lead.reviewStatus === "pending"
                              ? "bg-amber-500/10 text-amber-500"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {lead.reviewStatus}
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
