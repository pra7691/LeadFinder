import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
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
import { Ban, ArrowLeft, Download, ExternalLink, Globe, Loader2 } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { saveExportToServer } from "@/lib/export-files";

type BlockedResultGroup = {
  campaignRunId?: number | null;
  campaignId?: number | null;
  campaignName?: string | null;
  runName?: string | null;
  runStartedAt?: string | null;
  blockedCount: number;
};

type BlockedResult = {
  id: number;
  campaignId?: number | null;
  campaignRunId?: number | null;
  url?: string | null;
  rootDomain?: string | null;
  title?: string | null;
  sourceQuery?: string | null;
  reason?: string | null;
  createdAt?: string | null;
  campaignName?: string | null;
  runName?: string | null;
};

async function fetchBlockedGroups(): Promise<BlockedResultGroup[]> {
  const response = await fetch("/api/blocked-results");
  if (!response.ok) throw new Error("Failed to load blocked result groups");
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function fetchBlockedResults(campaignRunId: number): Promise<BlockedResult[]> {
  const response = await fetch(`/api/blocked-results?runId=${campaignRunId}`);
  if (!response.ok) throw new Error("Failed to load blocked results");
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function groupName(group: BlockedResultGroup) {
  const campaign = group.campaignName || `Campaign #${group.campaignId}`;
  const startedAt = group.runStartedAt
    ? format(new Date(group.runStartedAt), "MMM d, yyyy · HH:mm")
    : `Run #${group.campaignRunId ?? "unknown"}`;
  return `${campaign} — ${startedAt}`;
}

export function BlockedLeads() {
  const { toast } = useToast();
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const isDetail = selectedRunId !== null;
  const [exportingAll, setExportingAll] = useState(false);
  const [exportingRunId, setExportingRunId] = useState<number | null>(null);

  const {
    data: groups = [],
    isLoading: groupsLoading,
    isError: groupsError,
  } = useQuery({
    queryKey: ["/api/blocked-results"],
    queryFn: fetchBlockedGroups,
    refetchInterval: 15_000,
  });

  const {
    data: blockedItems = [],
    isLoading: itemsLoading,
    isError: itemsError,
  } = useQuery({
    queryKey: ["/api/blocked-results", selectedRunId],
    queryFn: () => fetchBlockedResults(selectedRunId!),
    enabled: isDetail,
    refetchInterval: 15_000,
  });

  const sortedGroups = [...groups].sort((a, b) => {
    const aTime = new Date(a.runStartedAt || 0).getTime();
    const bTime = new Date(b.runStartedAt || 0).getTime();
    return bTime - aTime;
  });

  const selectedGroup = selectedRunId
    ? sortedGroups.find((g) => g.campaignRunId === selectedRunId)
    : undefined;

  const totalBlocked = sortedGroups.reduce((sum, g) => sum + Number(g.blockedCount || 0), 0);
  const byCampaign = new Set(sortedGroups.map((g) => g.campaignId)).size;

  const handleExportRun = async (runId: number) => {
    setExportingRunId(runId);
    try {
      const saved = await saveExportToServer(`/api/blocked-results/export?runId=${runId}`);
      toast({ title: `Export saved to ${saved.relativePath}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Export failed";
      toast({ title: message, variant: "destructive" });
    } finally {
      setExportingRunId(null);
    }
  };

  const handleExportAll = async () => {
    setExportingAll(true);
    try {
      const saved = await saveExportToServer("/api/blocked-results/export");
      toast({ title: `Export saved to ${saved.relativePath}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Export failed";
      toast({ title: message, variant: "destructive" });
    } finally {
      setExportingAll(false);
    }
  };

  if (isDetail) {
    const title = selectedGroup ? groupName(selectedGroup) : `Run #${selectedRunId}`;
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-3">
            <Button variant="ghost" className="rounded-xl gap-2 -ml-3" onClick={() => setSelectedRunId(null)}>
              <ArrowLeft className="w-4 h-4" />
              Back to Runs
            </Button>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Blocked results for this campaign run.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            className="rounded-xl gap-2 shrink-0"
            onClick={() => handleExportRun(selectedRunId!)}
            disabled={exportingRunId === selectedRunId}
          >
            {exportingRunId === selectedRunId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export Run CSV
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard icon={Ban} label="Blocked Results" value={blockedItems.length} />
          <StatCard icon={Globe} label="Unique Domains" value={new Set(blockedItems.map((r) => r.rootDomain).filter(Boolean)).size} />
          <StatCard icon={Ban} label="Campaign" value={selectedGroup?.campaignId ?? blockedItems[0]?.campaignId ?? 0} />
        </div>

        <div className="rounded-2xl border border-border/50 overflow-hidden bg-card/30">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[220px]">Domain / Title</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Source Query</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Open Run</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itemsLoading ? (
                <LoadingRows columns={5} />
              ) : itemsError ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-sm text-destructive">
                    Failed to load blocked results.
                  </TableCell>
                </TableRow>
              ) : blockedItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-sm text-muted-foreground">
                    No blocked results found for this run.
                  </TableCell>
                </TableRow>
              ) : (
                blockedItems.map((item) => (
                  <TableRow key={item.id} className="align-top">
                    <TableCell>
                      <p className="font-medium">{item.rootDomain || item.title || "—"}</p>
                      {item.title && item.title !== item.rootDomain && (
                        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{item.title}</p>
                      )}
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 block text-xs text-primary/70 hover:text-primary truncate max-w-[300px]"
                        >
                          {item.url}
                        </a>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[300px] text-sm text-muted-foreground">
                      <span className="line-clamp-3">{item.reason || "—"}</span>
                    </TableCell>
                    <TableCell className="max-w-[240px] text-sm text-muted-foreground">
                      <span className="line-clamp-2">{item.sourceQuery || "—"}</span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {item.createdAt ? formatDistanceToNow(new Date(item.createdAt), { addSuffix: true }) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.campaignId && item.campaignRunId ? (
                        <Link
                          href={`/campaigns/${item.campaignId}/runs/${item.campaignRunId}`}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs hover:bg-muted"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          View
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
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

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Blocked Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Blocked search results grouped by campaign run.
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
        <StatCard icon={Ban} label="Total Blocked" value={totalBlocked} />
        <StatCard icon={Globe} label="Campaigns" value={byCampaign} />
        <StatCard icon={Ban} label="Runs" value={sortedGroups.length} />
      </div>

      <div className="rounded-2xl border border-border/50 overflow-hidden bg-card/30">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px]">Campaign Run</TableHead>
              <TableHead>Campaign</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Blocked</TableHead>
              <TableHead className="text-right">Export</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groupsLoading ? (
              <LoadingRows columns={5} />
            ) : groupsError ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-sm text-destructive">
                  Failed to load blocked result groups. Restart the API server if this page was just added.
                </TableCell>
              </TableRow>
            ) : sortedGroups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-sm text-muted-foreground">
                  No blocked results found.
                </TableCell>
              </TableRow>
            ) : (
              sortedGroups.map((group) => (
                <TableRow
                  key={`${group.campaignId}-${group.campaignRunId ?? "no-run"}`}
                  className="align-top cursor-pointer hover:bg-muted/20 transition-colors"
                  onClick={() => { if (group.campaignRunId) setSelectedRunId(group.campaignRunId); }}
                >
                  <TableCell>
                    {group.campaignRunId ? (
                      <span className="font-medium text-primary hover:underline">
                        {group.runName || `Run #${group.campaignRunId}`}
                      </span>
                    ) : (
                      <span className="font-medium text-muted-foreground">No run</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {group.campaignId ? (
                      <Link
                        href={`/campaigns/${group.campaignId}`}
                        className="text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {group.campaignName || `Campaign #${group.campaignId}`}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {group.runStartedAt ? format(new Date(group.runStartedAt), "MMM d, yyyy · HH:mm") : "—"}
                  </TableCell>
                  <TableCell className="text-sm font-medium">{group.blockedCount}</TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    {group.campaignRunId ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-lg gap-1.5"
                        disabled={exportingRunId === group.campaignRunId}
                        onClick={() => handleExportRun(group.campaignRunId!)}
                      >
                        {exportingRunId === group.campaignRunId
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Download className="w-3.5 h-3.5" />}
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

function StatCard({ icon: Icon, label, value }: { icon: typeof Ban; label: string; value: number }) {
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
