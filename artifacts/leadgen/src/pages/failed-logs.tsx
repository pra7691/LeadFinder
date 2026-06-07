import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, ArrowLeft, Download, ExternalLink, Globe, Loader2, SearchX } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { saveExportToServer } from "@/lib/export-files";

type FailedCrawlLead = {
  id: number;
  campaignId: number;
  campaignRunId?: number | null;
  companyName: string;
  rootDomain: string;
  websiteUrl: string;
  sourceQuery?: string | null;
  crawlError?: string | null;
  createdAt: string;
  updatedAt: string;
};

type FailedCrawlGroup = {
  campaignId: number;
  campaignRunId?: number | null;
  campaignName?: string | null;
  runName?: string | null;
  runStatus?: string | null;
  runStartedAt?: string | null;
  runCompletedAt?: string | null;
  failedCount: number;
  withErrorCount: number;
  latestFailedAt?: string | null;
};

async function fetchFailedCrawlGroups(): Promise<FailedCrawlGroup[]> {
  const response = await fetch("/api/leads/failed-crawls/groups");
  if (!response.ok) throw new Error("Failed to load failed crawl collections");
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function fetchFailedCrawls(campaignRunId: number): Promise<FailedCrawlLead[]> {
  const response = await fetch(`/api/leads/failed-crawls?limit=1000&campaignRunId=${campaignRunId}`);
  if (!response.ok) throw new Error("Failed to load failed crawl logs");
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function collectionName(group: FailedCrawlGroup) {
  const campaign = group.campaignName || `Campaign #${group.campaignId}`;
  const startedAt = group.runStartedAt ? format(new Date(group.runStartedAt), "MMM d, yyyy · HH:mm") : `Run #${group.campaignRunId ?? "unknown"}`;
  return `${campaign} - ${startedAt}`;
}

function exportUrl(campaignRunId: number) {
  return `/api/leads/failed-crawls/export?campaignRunId=${campaignRunId}`;
}

export function FailedLogs() {
  const params = useParams<{ runId?: string }>();
  const { toast } = useToast();
  const selectedRunId = params.runId ? Number(params.runId) : null;
  const isDetail = Number.isFinite(selectedRunId) && selectedRunId !== null;

  const {
    data: groups = [],
    isLoading: groupsLoading,
    isError: groupsError,
  } = useQuery({
    queryKey: ["/api/leads/failed-crawls/groups"],
    queryFn: fetchFailedCrawlGroups,
    refetchInterval: 10_000,
  });

  const {
    data: failedLeads = [],
    isLoading: leadsLoading,
    isError: leadsError,
  } = useQuery({
    queryKey: ["/api/leads/failed-crawls", selectedRunId],
    queryFn: () => fetchFailedCrawls(selectedRunId!),
    enabled: isDetail,
    refetchInterval: 10_000,
  });

  const sortedGroups = [...groups].sort((a, b) => {
    const aTime = new Date(a.latestFailedAt || a.runStartedAt || 0).getTime();
    const bTime = new Date(b.latestFailedAt || b.runStartedAt || 0).getTime();
    return bTime - aTime;
  });
  const selectedGroup = selectedRunId
    ? sortedGroups.find((group) => group.campaignRunId === selectedRunId)
    : undefined;
  const sortedFailedLeads = [...failedLeads].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const totalFailed = sortedGroups.reduce((sum, group) => sum + Number(group.failedCount || 0), 0);
  const totalWithError = sortedGroups.reduce((sum, group) => sum + Number(group.withErrorCount || 0), 0);
  const byCampaign = new Set(sortedGroups.map((group) => group.campaignId)).size;
  const detailWithError = sortedFailedLeads.filter((lead) => Boolean(lead.crawlError?.trim())).length;

  const [exportingAll, setExportingAll] = useState(false);

  const handleExportFailedLogs = async (campaignRunId: number) => {
    try {
      const saved = await saveExportToServer(exportUrl(campaignRunId));
      toast({ title: `Export saved to ${saved.relativePath}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Export failed";
      toast({ title: message, variant: "destructive" });
    }
  };

  const handleExportAll = async () => {
    setExportingAll(true);
    try {
      const saved = await saveExportToServer("/api/leads/failed-crawls/export");
      toast({ title: `Export saved to ${saved.relativePath}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Export failed";
      toast({ title: message, variant: "destructive" });
    } finally {
      setExportingAll(false);
    }
  };

  if (isDetail) {
    const title = selectedGroup ? collectionName(selectedGroup) : `Run #${selectedRunId}`;
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-3">
            <Button asChild variant="ghost" className="rounded-xl gap-2 -ml-3">
              <Link href="/failed-logs">
                <ArrowLeft className="w-4 h-4" />
                Back to Collections
              </Link>
            </Button>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Failed crawl logs for this campaign run only.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            className="rounded-xl gap-2 shrink-0"
            onClick={() => handleExportFailedLogs(selectedRunId!)}
          >
            <Download className="w-4 h-4" />
            Export CSV
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard icon={SearchX} label="Failed Crawls" value={sortedFailedLeads.length} />
          <StatCard icon={AlertTriangle} label="With Error" value={detailWithError} />
          <StatCard icon={Globe} label="Campaign" value={selectedGroup?.campaignId ?? sortedFailedLeads[0]?.campaignId ?? selectedRunId ?? 0} />
        </div>

        <div className="rounded-2xl border border-border/50 overflow-hidden bg-card/30">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[220px]">Website</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Source Query</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Open Run</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leadsLoading ? (
                <LoadingRows columns={5} />
              ) : leadsError ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-sm text-destructive">
                    Failed to load failed crawl logs.
                  </TableCell>
                </TableRow>
              ) : sortedFailedLeads.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-sm text-muted-foreground">
                    No failed crawls found for this run.
                  </TableCell>
                </TableRow>
              ) : (
                sortedFailedLeads.map((lead) => (
                  <TableRow key={lead.id} className="align-top">
                    <TableCell>
                      <p className="font-medium">{lead.companyName || lead.rootDomain}</p>
                      <a
                        href={lead.websiteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 block text-xs text-primary/70 hover:text-primary truncate max-w-[300px]"
                      >
                        {lead.websiteUrl}
                      </a>
                    </TableCell>
                    <TableCell className="max-w-[360px] text-sm text-muted-foreground">
                      <span className="line-clamp-3">{lead.crawlError || "Crawl failed without a detailed error."}</span>
                    </TableCell>
                    <TableCell className="max-w-[280px] text-sm text-muted-foreground">
                      <span className="line-clamp-2">{lead.sourceQuery || "-"}</span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDistanceToNow(new Date(lead.updatedAt), { addSuffix: true })}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/campaigns/${lead.campaignId}/runs/${lead.campaignRunId}`}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs hover:bg-muted"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        View
                      </Link>
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

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Failed Logs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Failed crawl collections grouped by campaign run. Open a collection to export only that run.
          </p>
        </div>
        <Button
          variant="outline"
          className="rounded-xl gap-2 shrink-0"
          onClick={handleExportAll}
          disabled={exportingAll}
        >
          {exportingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Export All
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={SearchX} label="Failed Crawls" value={totalFailed} />
        <StatCard icon={AlertTriangle} label="With Error" value={totalWithError} />
        <StatCard icon={Globe} label="Campaigns" value={byCampaign} />
      </div>

      <div className="rounded-2xl border border-border/50 overflow-hidden bg-card/30">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px]">Campaign Run</TableHead>
              <TableHead>Campaign</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Failed Crawls</TableHead>
              <TableHead>Latest Failure</TableHead>
              <TableHead className="text-right">Export</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groupsLoading ? (
              <LoadingRows columns={6} />
            ) : groupsError ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-sm text-destructive">
                  Failed to load failed crawl collections. Restart the API server if this page was just added.
                </TableCell>
              </TableRow>
            ) : sortedGroups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-sm text-muted-foreground">
                  No failed crawls found.
                </TableCell>
              </TableRow>
            ) : (
              sortedGroups.map((group) => (
                <TableRow key={`${group.campaignId}-${group.campaignRunId ?? "no-run"}`} className="align-top">
                  <TableCell>
                    {group.campaignRunId ? (
                      <Link href={`/failed-logs/runs/${group.campaignRunId}`} className="font-medium text-primary hover:underline">
                        {group.runName || `Run #${group.campaignRunId}`}
                      </Link>
                    ) : (
                      <span className="font-medium text-muted-foreground">No run</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    <Link href={`/campaigns/${group.campaignId}`} className="text-primary hover:underline">
                      {group.campaignName || `Campaign #${group.campaignId}`}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {group.runStartedAt ? format(new Date(group.runStartedAt), "MMM d, yyyy · HH:mm") : "—"}
                  </TableCell>
                  <TableCell className="text-sm font-medium">{group.failedCount}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {group.latestFailedAt ? formatDistanceToNow(new Date(group.latestFailedAt), { addSuffix: true }) : "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    {group.campaignRunId ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-lg gap-1.5"
                        onClick={() => handleExportFailedLogs(group.campaignRunId!)}
                      >
                        <Download className="w-3.5 h-3.5" />
                        CSV
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">No run</span>
                    )}
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

function StatCard({ icon: Icon, label, value }: { icon: typeof SearchX; label: string; value: number }) {
  return (
    <Card className="glass-card">
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          <Icon className="w-4 h-4" />
          <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
        </div>
        <p className="text-3xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function LoadingRows({ columns }: { columns: number }) {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: columns }).map((__, j) => (
            <TableCell key={j}>
              <div className="h-4 rounded bg-muted/60 animate-pulse" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
