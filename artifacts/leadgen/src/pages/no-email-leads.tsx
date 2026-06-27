import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useListCampaigns, useListCampaignRuns } from "@workspace/api-client-react";
import type { Lead } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Globe,
  Loader2,
  MailX,
  Phone,
  RefreshCw,
  Search,
} from "lucide-react";

const PAGE_SIZE = 50;

type QualifiedNoEmailLead = Lead & {
  campaignName: string;
  campaignMinRelevanceScore: number;
  addedToList: boolean;
};

type QualifiedNoEmailResponse = {
  items: QualifiedNoEmailLead[];
  total: number;
  limit: number;
  offset: number;
};

function SkeletonRows() {
  return Array.from({ length: 8 }).map((_, index) => (
    <TableRow key={index}>
      {Array.from({ length: 8 }).map((__, cell) => (
        <TableCell key={cell}><div className="h-4 rounded bg-muted/60 animate-pulse" /></TableCell>
      ))}
    </TableRow>
  ));
}

export function NoEmailLeads() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [runFilter, setRunFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [hasPhone, setHasPhone] = useState(false);
  const [notInList, setNotInList] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const { data: campaigns } = useListCampaigns();
  const campaignRows = Array.isArray(campaigns) ? campaigns : [];
  const campaignId = campaignFilter === "all" ? undefined : Number(campaignFilter);

  const { data: runs } = useListCampaignRuns(campaignId ? { campaignId } : undefined);
  const runRows = Array.isArray(runs) ? runs : [];
  const runMap = useMemo(() => new Map(runRows.map((run) => [run.id, run.runName ?? `Run #${run.id}`])), [runRows]);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    });
    if (campaignId) params.set("campaignId", String(campaignId));
    if (runFilter !== "all") params.set("campaignRunId", runFilter);
    if (searchQuery.trim()) params.set("search", searchQuery.trim());
    if (hasPhone) params.set("hasPhone", "true");
    if (notInList) params.set("notInList", "true");
    return params;
  }, [campaignId, hasPhone, notInList, page, runFilter, searchQuery]);

  const queryKey = ["qualified-no-email-leads", queryParams.toString()] as const;
  const { data, isLoading, isFetching, refetch } = useQuery<QualifiedNoEmailResponse>({
    queryKey,
    queryFn: async () => {
      const response = await fetch(`${import.meta.env.BASE_URL}api/leads/qualified-no-email?${queryParams}`);
      if (!response.ok) throw new Error("Failed to load qualified no-email leads");
      return response.json() as Promise<QualifiedNoEmailResponse>;
    },
    staleTime: 30_000,
  });

  const items = Array.isArray(data?.items) ? data.items : [];
  const total = data?.total ?? 0;
  const firstResult = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastResult = Math.min((page + 1) * PAGE_SIZE, total);
  const hasPrevious = page > 0;
  const hasNext = (page + 1) * PAGE_SIZE < total;

  const resetPage = () => setPage(0);

  const handleExport = async () => {
    if (exporting || total === 0) return;
    setExporting(true);
    try {
      const params = new URLSearchParams({
        format: "csv",
        qualifiedNoEmail: "true",
        limit: "50000",
      });
      if (campaignId) params.set("campaignId", String(campaignId));
      if (runFilter !== "all") params.set("campaignRunId", runFilter);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      if (hasPhone) params.set("hasPhone", "true");
      if (notInList) params.set("notInList", "true");
      const saved = await saveExportToServer(`/api/leads/export?${params}`);
      toast({ title: `Exported ${total} qualified no-email lead${total === 1 ? "" : "s"} → ${saved.relativePath}` });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "Export failed",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <MailX className="w-6 h-6 text-amber-500" />
            No Email Leads
            {!isLoading && (
              <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-sm font-semibold text-amber-600">
                {total}
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            AI-qualified, successfully crawled leads where no email was extracted
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="rounded-xl gap-1.5" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="outline" size="sm" className="rounded-xl gap-1.5" onClick={handleExport} disabled={exporting || total === 0}>
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Export CSV
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap border-y border-border/40 py-3">
        <Select value={campaignFilter} onValueChange={(value) => {
          setCampaignFilter(value);
          setRunFilter("all");
          resetPage();
        }}>
          <SelectTrigger className="w-[220px] rounded-xl"><SelectValue placeholder="All campaigns" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All campaigns</SelectItem>
            {campaignRows.map((campaign) => <SelectItem key={campaign.id} value={String(campaign.id)}>{campaign.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={runFilter} onValueChange={(value) => { setRunFilter(value); resetPage(); }}>
          <SelectTrigger className="w-[220px] rounded-xl"><SelectValue placeholder="All campaign runs" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All campaign runs</SelectItem>
            {runRows.map((run) => <SelectItem key={run.id} value={String(run.id)}>{run.runName ?? `Run #${run.id}`}</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(event) => { setSearchQuery(event.target.value); resetPage(); }}
            placeholder="Search company or domain"
            className="pl-9 rounded-xl"
          />
        </div>

        <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox checked={hasPhone} onCheckedChange={(checked) => { setHasPhone(checked === true); resetPage(); }} />
          Has phone
        </label>
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox checked={notInList} onCheckedChange={(checked) => { setNotInList(checked === true); resetPage(); }} />
          Not in list
        </label>
      </div>

      <div className="rounded-xl border border-border/50 overflow-hidden bg-card/30">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[220px]">Company</TableHead>
              <TableHead>Campaign</TableHead>
              <TableHead>Campaign Run</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Country</TableHead>
              <TableHead className="text-center">Phone</TableHead>
              <TableHead className="text-center">In List</TableHead>
              <TableHead>Crawl</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? <SkeletonRows /> : items.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="h-32 text-center text-sm text-muted-foreground">No qualified no-email leads match these filters.</TableCell></TableRow>
            ) : items.map((lead) => (
              <TableRow key={lead.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setSelectedLeadId(lead.id)}>
                <TableCell>
                  <p className="font-medium">{lead.companyName}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><Globe className="w-3 h-3" />{lead.rootDomain}</p>
                </TableCell>
                <TableCell className="text-sm">{lead.campaignName}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{lead.campaignRunId ? runMap.get(lead.campaignRunId) ?? `Run #${lead.campaignRunId}` : "—"}</TableCell>
                <TableCell><ScoreBadge score={lead.relevanceScore} reason={lead.relevanceReason} scoringMethod={lead.scoringMethod} /></TableCell>
                <TableCell className="text-sm text-muted-foreground">{lead.country || "—"}</TableCell>
                <TableCell className="text-center">{lead.phoneNumbers ? <Phone className="w-3.5 h-3.5 text-blue-500 mx-auto" /> : <span className="text-muted-foreground/40">—</span>}</TableCell>
                <TableCell className="text-center"><Badge variant="secondary" className="rounded-md text-[11px]">{lead.addedToList ? "Yes" : "No"}</Badge></TableCell>
                <TableCell><Badge variant="secondary" className="rounded-md text-[11px] bg-emerald-500/10 text-emerald-600">Crawled</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">Showing {firstResult}–{lastResult} of {total}</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="rounded-xl gap-1" disabled={!hasPrevious || isFetching} onClick={() => setPage((value) => Math.max(0, value - 1))}>
            <ChevronLeft className="w-4 h-4" /> Previous
          </Button>
          <Button variant="outline" size="sm" className="rounded-xl gap-1" disabled={!hasNext || isFetching} onClick={() => setPage((value) => value + 1)}>
            Next <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <LeadDetailDrawer
        leadId={selectedLeadId}
        onClose={() => setSelectedLeadId(null)}
        onLeadUpdate={() => queryClient.invalidateQueries({ queryKey: ["qualified-no-email-leads"] })}
      />
    </div>
  );
}
