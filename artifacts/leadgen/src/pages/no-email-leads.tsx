import { useState } from "react";
import {
  useListLeads,
  useDeleteLead,
  getListLeadsQueryKey,
} from "@workspace/api-client-react";
import type { Lead } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
  MailX,
  Download,
  Loader2,
  Globe,
  RefreshCw,
  Trash2,
} from "lucide-react";

function SkeletonRow() {
  return (
    <TableRow>
      {Array.from({ length: 6 }).map((_, i) => (
        <TableCell key={i}>
          <div className="h-4 rounded bg-muted/60 animate-pulse" />
        </TableCell>
      ))}
    </TableRow>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mb-4">
        <MailX className="w-8 h-8 text-emerald-500/60" />
      </div>
      <h3 className="font-semibold text-lg mb-1">No leads missing emails</h3>
      <p className="text-muted-foreground text-sm max-w-xs">
        All AI-qualified leads have an email address — great coverage!
      </p>
    </div>
  );
}

export function NoEmailLeads() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const params = { qualificationStatus: "qualified", hasEmail: false, limit: 500 } as const;
  const { data: leads, isLoading, refetch, isFetching } = useListLeads(params, {
    query: {
      queryKey: getListLeadsQueryKey(params),
      staleTime: 30_000,
    },
  });

  const deleteMut = useDeleteLead();

  const rows: Lead[] = Array.isArray(leads) ? leads : [];

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

  const handleExportAll = async (format: "csv" | "xlsx" = "csv") => {
    if (!rows.length || exporting) return;
    setExporting(true);
    try {
      const ids = rows.map((l) => l.id).join(",");
      const saved = await saveExportToServer(`/api/leads/export?format=${format}&leadIds=${ids}`);
      toast({ title: `Exported ${rows.length} lead${rows.length !== 1 ? "s" : ""} → ${saved.relativePath}` });
    } catch (err: unknown) {
      toast({
        title: err instanceof Error ? err.message : "Export failed",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <MailX className="w-6 h-6 text-amber-500" />
            No Email Leads
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            AI-qualified leads that are missing an email address
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-1.5"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-1.5"
            onClick={() => handleExportAll("csv")}
            disabled={exporting || !rows.length}
          >
            {exporting
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Download className="w-3.5 h-3.5" />}
            Export CSV
          </Button>
        </div>
      </div>

      {/* Stats strip */}
      {!isLoading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Qualified, No Email", value: rows.length },
            { label: "Avg Score", value: rows.length ? Math.round(rows.reduce((s, l) => s + (l.relevanceScore ?? 0), 0) / rows.length) : "—" },
            { label: "With Website", value: rows.filter((l) => !!l.websiteUrl).length },
            { label: "Crawl Failed", value: rows.filter((l) => l.crawlStatus === "failed").length },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-border/50 bg-card/50 p-4">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className="text-2xl font-semibold mt-1">{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Callout */}
      {!isLoading && rows.length > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400 flex items-start gap-2">
          <MailX className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            These leads were scored and qualified by AI, but their email addresses could not be extracted during crawling.
            You can manually add emails by clicking a lead, or retry crawling through the campaign run detail.
          </span>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="rounded-2xl border border-border/50 overflow-hidden bg-card/30">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Crawl</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead>Source Keyword</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}
            </TableBody>
          </Table>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="rounded-2xl border border-border/50 overflow-hidden bg-card/30">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[240px]">Company</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Crawl</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead>Source Keyword</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((lead) => (
                <TableRow
                  key={lead.id}
                  className="cursor-pointer hover:bg-muted/30"
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedLeadId(lead.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedLeadId(lead.id);
                    }
                  }}
                >
                  <TableCell>
                    <div>
                      <span className="font-medium text-foreground">
                        {lead.companyName || (
                          <span className="italic text-muted-foreground/60">
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
                    <Badge
                      variant="secondary"
                      className={`rounded-md text-[11px] capitalize ${
                        lead.crawlStatus === "failed"
                          ? "bg-red-500/10 text-red-500"
                          : lead.crawlStatus === "done"
                            ? "bg-emerald-500/10 text-emerald-600"
                            : "bg-muted/50 text-muted-foreground"
                      }`}
                    >
                      {lead.crawlStatus ?? "pending"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {lead.campaignId ? (
                      <span className="text-xs text-muted-foreground">#{lead.campaignId}</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {lead.sourceKeyword || lead.sourceQuery || "—"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 rounded-lg text-destructive/70 hover:text-destructive"
                      aria-label={`Delete ${lead.companyName || lead.rootDomain}`}
                      disabled={deletingId === lead.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(lead);
                      }}
                    >
                      {deletingId === lead.id
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Trash2 className="w-4 h-4" />}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Lead detail drawer */}
      <LeadDetailDrawer
        leadId={selectedLeadId}
        onClose={() => setSelectedLeadId(null)}
        onLeadUpdate={() => refetch()}
      />
    </div>
  );
}
