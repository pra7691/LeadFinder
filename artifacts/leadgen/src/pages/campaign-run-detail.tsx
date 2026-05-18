import {
  useGetCampaignRun,
  useGetCampaignRunLeads,
  useListLeadLists,
  useAddLeadsToList,
  useUpdateLead,
  getGetCampaignRunQueryKey,
  getGetCampaignRunLeadsQueryKey,
} from "@workspace/api-client-react";
import type { CampaignRun } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  Users,
  Search,
  Plus,
  Globe,
  Star,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

function RunStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    running: { label: "Running", cls: "bg-blue-500/10 text-blue-500", icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    completed: { label: "Completed", cls: "bg-emerald-500/10 text-emerald-500", icon: <CheckCircle2 className="w-3 h-3" /> },
    failed: { label: "Failed", cls: "bg-red-500/10 text-red-400", icon: <XCircle className="w-3 h-3" /> },
    cancelled: { label: "Cancelled", cls: "bg-amber-500/10 text-amber-500", icon: <AlertCircle className="w-3 h-3" /> },
  };
  const s = map[status] ?? { label: status, cls: "bg-muted/40 text-muted-foreground", icon: null };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium ${s.cls}`}>
      {s.icon}
      {s.label}
    </span>
  );
}

export function CampaignRunDetail() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const campaignId = Number(id);
  const runIdNum = Number(runId);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: run, isLoading: runLoading } = useGetCampaignRun(runIdNum, {
    query: {
      queryKey: getGetCampaignRunQueryKey(runIdNum),
      refetchInterval: (q) => {
        const r = q?.state?.data as CampaignRun | undefined;
        return r?.status === "running" ? 3000 : false;
      },
      enabled: !!runIdNum,
    },
  });

  const { data: leads, isLoading: leadsLoading } = useGetCampaignRunLeads(runIdNum, {
    query: {
      queryKey: getGetCampaignRunLeadsQueryKey(runIdNum),
      refetchInterval: run?.status === "running" ? 3000 : undefined,
      enabled: !!runIdNum,
    },
  });

  const { data: lists } = useListLeadLists();
  const addLeadsToList = useAddLeadsToList();
  const updateLead = useUpdateLead();

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [addToListOpen, setAddToListOpen] = useState(false);

  const toggleLead = (leadId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  };

  const toggleAll = () => {
    if (!leads) return;
    if (selectedIds.size === leads.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(leads.map((l) => l.id)));
  };

  const handleQualify = (leadId: number, status: "qualified" | "rejected") => {
    updateLead.mutate(
      { id: leadId, data: { qualificationStatus: status } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetCampaignRunLeadsQueryKey(runIdNum) });
        },
        onError: () => toast({ title: "Failed to update lead.", variant: "destructive" }),
      },
    );
  };

  const handleAddToList = (listId: number) => {
    const leadIds = Array.from(selectedIds);
    if (leadIds.length === 0) return;
    addLeadsToList.mutate(
      { id: listId, data: { leadIds } },
      {
        onSuccess: (result) => {
          toast({ title: `Added ${result.added} lead${result.added !== 1 ? "s" : ""} to list.` });
          setAddToListOpen(false);
          setSelectedIds(new Set());
          queryClient.invalidateQueries({ queryKey: getGetCampaignRunLeadsQueryKey(runIdNum) });
        },
        onError: () => {
          toast({ title: "Failed to add leads to list.", variant: "destructive" });
        },
      },
    );
  };

  if (runLoading) {
    return (
      <div className="space-y-6 max-w-5xl animate-in fade-in">
        <div className="flex items-center gap-4">
          <div className="h-8 w-8 rounded-full bg-muted/40 animate-pulse" />
          <div className="h-8 w-48 rounded-lg bg-muted/40 animate-pulse" />
        </div>
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded-2xl bg-muted/40 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="p-8 text-sm text-destructive">Run not found.</div>
    );
  }

  const startedAt = run.startedAt ? new Date(run.startedAt) : null;
  const completedAt = run.completedAt ? new Date(run.completedAt) : null;
  const durationMs =
    startedAt && completedAt ? completedAt.getTime() - startedAt.getTime() : null;
  const durationStr = durationMs != null
    ? durationMs < 60_000
      ? `${Math.round(durationMs / 1000)}s`
      : `${Math.round(durationMs / 60_000)}m`
    : null;

  const stats = [
    { label: "New Leads", value: run.totalNewLeads ?? 0, icon: <Users className="w-4 h-4" /> },
    { label: "Searches", value: run.totalSearches ?? 0, icon: <Search className="w-4 h-4" /> },
    { label: "Duplicates", value: run.totalDuplicates ?? 0, icon: <Globe className="w-4 h-4" /> },
    { label: "Blocked", value: run.totalBlocked ?? 0, icon: <AlertCircle className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-8 max-w-5xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center gap-4 flex-wrap">
        <Link
          href={`/campaigns/${campaignId}`}
          className="text-muted-foreground hover:text-foreground transition-colors p-2 rounded-full hover:bg-muted"
        >
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight truncate">
            {run.runName ?? `Run #${run.id}`}
          </h1>
          {startedAt && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {format(startedAt, "MMM d, yyyy · HH:mm")} ·{" "}
              {formatDistanceToNow(startedAt, { addSuffix: true })}
            </p>
          )}
        </div>
        <RunStatusBadge status={run.status} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label} className="glass-card">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                {s.icon}
                <span className="text-xs font-medium uppercase tracking-wider">{s.label}</span>
              </div>
              <p className="text-3xl font-semibold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Duration + error */}
      <div className="flex flex-wrap gap-4">
        {durationStr && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 border border-border/50 px-4 py-2 rounded-xl">
            <Clock className="w-4 h-4" />
            Duration: <span className="font-medium text-foreground">{durationStr}</span>
          </div>
        )}
        {run.status === "running" && (
          <div className="flex items-center gap-2 text-sm text-blue-500 bg-blue-500/10 border border-blue-500/20 px-4 py-2 rounded-xl">
            <Loader2 className="w-4 h-4 animate-spin" />
            Campaign is running — leads will appear as they are discovered
          </div>
        )}
        {run.errorMessage && (
          <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 px-4 py-2 rounded-xl">
            <AlertCircle className="w-4 h-4" />
            {run.errorMessage}
          </div>
        )}
      </div>

      {/* Leads table */}
      <Card className="glass-card">
        <CardHeader className="border-b border-border/30 pb-4">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              Leads from this run
              {leads && (
                <span className="text-muted-foreground font-normal">({leads.length})</span>
              )}
            </CardTitle>
            {selectedIds.size > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl gap-2 text-xs"
                onClick={() => setAddToListOpen(true)}
              >
                <Plus className="w-3.5 h-3.5" />
                Add {selectedIds.size} to List
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {leadsLoading ? (
            <div className="divide-y divide-border/30">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-3.5 animate-pulse">
                  <div className="h-4 w-4 rounded bg-muted/40" />
                  <div className="h-4 w-40 rounded bg-muted/40" />
                  <div className="h-4 w-28 rounded bg-muted/40" />
                  <div className="h-4 w-16 rounded bg-muted/40 ml-auto" />
                </div>
              ))}
            </div>
          ) : !leads?.length ? (
            <div className="py-12 text-center">
              <Users className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {run.status === "running"
                  ? "Leads will appear here as they are discovered…"
                  : "No leads were discovered in this run."}
              </p>
            </div>
          ) : (
            <>
              {/* Header row */}
              <div className="flex items-center gap-4 px-5 py-2.5 bg-muted/20 border-b border-border/30 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                <input
                  type="checkbox"
                  checked={selectedIds.size === leads.length && leads.length > 0}
                  onChange={toggleAll}
                  className="rounded accent-primary"
                />
                <span className="flex-1">Company</span>
                <span className="w-40 hidden md:block">Domain</span>
                <span className="w-16 hidden sm:block">Score</span>
                <span className="w-24">Status</span>
                <span className="w-20 text-right">Actions</span>
              </div>
              <div className="divide-y divide-border/30">
                {leads.map((lead) => (
                  <div
                    key={lead.id}
                    className={cn(
                      "flex items-center gap-4 px-5 py-3 hover:bg-muted/10 transition-colors group",
                      selectedIds.has(lead.id) && "bg-primary/5",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(lead.id)}
                      onChange={() => toggleLead(lead.id)}
                      className="rounded accent-primary shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{lead.companyName}</p>
                      {lead.emails && (
                        <p className="text-xs text-muted-foreground truncate">{lead.emails}</p>
                      )}
                    </div>
                    <span className="w-40 text-xs text-muted-foreground truncate hidden md:block">
                      {lead.rootDomain}
                    </span>
                    <span className="w-16 hidden sm:block">
                      <span className="inline-flex items-center gap-1 text-xs">
                        <Star className="w-3 h-3 text-amber-400" />
                        {lead.relevanceScore}
                      </span>
                    </span>
                    <span className="w-24 shrink-0">
                      <span className={cn(
                        "inline-block px-2 py-0.5 rounded-full text-[10px] font-medium",
                        lead.qualificationStatus === "qualified"
                          ? "bg-emerald-500/10 text-emerald-600"
                          : lead.qualificationStatus === "rejected"
                            ? "bg-red-500/10 text-red-500"
                            : "bg-muted/50 text-muted-foreground",
                      )}>
                        {lead.qualificationStatus ?? "unreviewed"}
                      </span>
                    </span>
                    <span className="w-20 shrink-0 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        title="Qualify"
                        onClick={() => handleQualify(lead.id, "qualified")}
                        disabled={lead.qualificationStatus === "qualified" || updateLead.isPending}
                        className="p-1 rounded-lg hover:bg-emerald-500/10 text-muted-foreground hover:text-emerald-600 transition-colors disabled:opacity-30"
                      >
                        <ThumbsUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        title="Reject"
                        onClick={() => handleQualify(lead.id, "rejected")}
                        disabled={lead.qualificationStatus === "rejected" || updateLead.isPending}
                        className="p-1 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-30"
                      >
                        <ThumbsDown className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Add to List dialog */}
      <Dialog open={addToListOpen} onOpenChange={setAddToListOpen}>
        <DialogContent className="sm:max-w-[380px] rounded-2xl border-border/50 bg-background/80 backdrop-blur-2xl">
          <DialogHeader>
            <DialogTitle>Add {selectedIds.size} Lead{selectedIds.size !== 1 ? "s" : ""} to List</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 mt-2">
            {!lists?.length ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No lists yet — create one in the Lists section first.
              </p>
            ) : (
              lists.map((list) => (
                <button
                  key={list.id}
                  onClick={() => handleAddToList(list.id)}
                  disabled={addLeadsToList.isPending}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-colors text-left"
                >
                  <div>
                    <p className="text-sm font-medium">{list.name}</p>
                    {list.description && (
                      <p className="text-xs text-muted-foreground">{list.description}</p>
                    )}
                  </div>
                  {addLeadsToList.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Plus className="w-4 h-4 text-muted-foreground" />
                  )}
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
