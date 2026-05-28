import {
  useListCampaigns,
  useCreateCampaign,
  usePauseCampaign,
  useResumeCampaign,
  useDeleteCampaign,
  getListCampaignsQueryKey,
  getGetSchedulerStatusQueryKey,
} from "@workspace/api-client-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Pause,
  Search,
  Briefcase,
  Calendar,
  Clock,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

const SCHEDULE_LABELS: Record<string, string> = {
  manual: "Manual",
  daily: "Daily",
  weekly: "Weekly",
};

function getStatusDot(lastRunStatus: string, isActive: boolean): { dot: string; label: string } {
  if (lastRunStatus === "running") return { dot: "bg-blue-500 animate-pulse", label: "Running" };
  if (!isActive) return { dot: "bg-muted-foreground/30", label: "Inactive" };
  if (lastRunStatus === "failed") return { dot: "bg-destructive", label: "Failed" };
  if (lastRunStatus === "partial") return { dot: "bg-amber-500", label: "Partial" };
  return { dot: "bg-emerald-500", label: "Active" };
}

type Campaign = {
  id: number;
  name: string;
  objective: string;
  isActive: boolean;
  isPaused?: boolean;
  scheduleType?: string;
  scheduleTime?: string | null;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastRunStatus?: string;
  keywords?: string[];
};

export function Campaigns() {
  const [, setLocation] = useLocation();
  const { data: campaigns, isLoading } = useListCampaigns({
    query: {
      queryKey: getListCampaignsQueryKey(),
      refetchInterval: (query) => {
        const raw = query.state.data;
        const arr = Array.isArray(raw) ? (raw as Campaign[]) : [];
        return arr.some((c) => c.lastRunStatus === "running") ? 5000 : false;
      },
    },
  });
  const createCampaign = useCreateCampaign();
  const pauseCampaign = usePauseCampaign();
  const resumeCampaign = useResumeCampaign();
  const deleteCampaign = useDeleteCampaign();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [resultsPerSearch, setResultsPerSearch] = useState(10);
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetSchedulerStatusQueryKey() });
  };

  const handleCreate = () => {
    createCampaign.mutate(
      { data: { name, objective, isActive: true, resultsPerSearch: Math.min(50, Math.max(1, resultsPerSearch || 10)) } },
      {
        onSuccess: () => {
          setOpen(false);
          setName("");
          setObjective("");
          setResultsPerSearch(10);
          invalidate();
        },
      },
    );
  };

  const handlePause = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
    pauseCampaign.mutate({ id }, { onSuccess: invalidate });
  };

  const handleResume = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
    resumeCampaign.mutate({ id }, { onSuccess: invalidate });
  };

  const handleDelete = () => {
    if (deletingId === null) return;
    deleteCampaign.mutate(
      { id: deletingId },
      {
        onSuccess: () => {
          setDeletingId(null);
          invalidate();
        },
        onError: () => {
          setDeletingId(null);
        },
      },
    );
  };

  const campaignRows: Campaign[] = Array.isArray(campaigns) ? (campaigns as Campaign[]) : [];

  const deletingCampaign = campaignRows.find((c) => c.id === deletingId) ?? null;

  const filteredCampaigns = campaignRows.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );
  const campaignStats = [
    { label: "Total", value: campaignRows.length },
    { label: "Active", value: campaignRows.filter((c) => c.isActive && !c.isPaused).length },
    { label: "Running", value: campaignRows.filter((c) => c.lastRunStatus === "running").length },
    { label: "Paused", value: campaignRows.filter((c) => c.isPaused).length },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Campaigns</h1>

        <div className="flex items-center gap-4">
          <div className="relative w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search campaigns..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 rounded-xl bg-background/50 border-border/50"
            />
          </div>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-xl shadow-sm" data-testid="button-new-campaign">
                <Plus className="w-4 h-4 mr-2" /> New Campaign
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] rounded-2xl border-border/50 bg-background/80 backdrop-blur-2xl">
              <DialogHeader>
                <DialogTitle className="text-xl">Create Campaign</DialogTitle>
              </DialogHeader>
              <div className="space-y-5 py-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. CTOs in SaaS"
                    className="rounded-xl"
                    data-testid="input-campaign-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Objective</Label>
                  <Input
                    value={objective}
                    onChange={(e) => setObjective(e.target.value)}
                    placeholder="What are we selling?"
                    className="rounded-xl"
                    data-testid="input-campaign-objective"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Results Per Search</Label>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={resultsPerSearch}
                    onChange={(e) => setResultsPerSearch(Number(e.target.value))}
                    placeholder="10"
                    className="rounded-xl"
                    data-testid="input-campaign-results-per-search"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Maximum is 50 results per search query.
                  </p>
                </div>
                <Button
                  onClick={handleCreate}
                  disabled={!name || !objective || createCampaign.isPending}
                  className="w-full rounded-xl"
                  data-testid="button-create-campaign"
                >
                  {createCampaign.isPending ? "Creating..." : "Create Campaign"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {campaignStats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border/50 bg-card/50 p-4">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="text-2xl font-semibold mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-border/50 overflow-hidden bg-card/30">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Last Run</TableHead>
                <TableHead>Next Run</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    <TableCell key={j}>
                      <div className="h-4 rounded bg-muted/60 animate-pulse" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : filteredCampaigns.length ? (
        <div className="rounded-2xl border border-border/50 overflow-hidden bg-card/30">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[220px]">Campaign</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Last Run</TableHead>
                <TableHead>Next Run</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCampaigns.map((campaign) => {
                const scheduleType = campaign.scheduleType || "manual";
                const lastRunStatus = campaign.lastRunStatus || "idle";
                const isPaused = Boolean(campaign.isPaused);
                const nextRunAt = campaign.nextRunAt ? new Date(campaign.nextRunAt) : null;
                const lastRunAt = campaign.lastRunAt ? new Date(campaign.lastRunAt) : null;

                return (
                  <TableRow
                    key={campaign.id}
                    className="align-top cursor-pointer hover:bg-muted/30"
                    role="button"
                    tabIndex={0}
                    onClick={() => setLocation(`/campaigns/${campaign.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setLocation(`/campaigns/${campaign.id}`);
                      }
                    }}
                  >
                    <TableCell>
                      <span className="font-medium text-foreground" data-testid={`link-campaign-${campaign.id}`}>
                        {campaign.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                        <span>{SCHEDULE_LABELS[scheduleType] ?? scheduleType}</span>
                      </div>
                      {scheduleType !== "manual" && campaign.scheduleTime && (
                        <p className="mt-1 text-xs text-muted-foreground">@ {campaign.scheduleTime}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {lastRunAt ? formatDistanceToNow(lastRunAt, { addSuffix: true }) : "Never"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {nextRunAt && scheduleType !== "manual" && !isPaused ? (
                        <span className="inline-flex items-center gap-1.5 text-primary">
                          <Clock className="w-3.5 h-3.5" />
                          {formatDistanceToNow(nextRunAt, { addSuffix: true })}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {campaign.isActive && scheduleType !== "manual" && (
                          isPaused ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 rounded-lg gap-1.5 text-xs"
                              onClick={(e) => handleResume(e, campaign.id)}
                            >
                              <RefreshCw className="w-3 h-3" /> Resume
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 rounded-lg gap-1.5 text-xs"
                              onClick={(e) => handlePause(e, campaign.id)}
                            >
                              <Pause className="w-3 h-3" /> Pause
                            </Button>
                          )
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 rounded-lg gap-1.5 text-xs text-destructive/80 hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeletingId(campaign.id);
                          }}
                          data-testid={`button-delete-campaign-${campaign.id}`}
                        >
                          <Trash2 className="w-3 h-3" /> Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center p-12 text-center bg-muted/20 border border-border/50 rounded-2xl border-dashed">
          <Briefcase className="w-10 h-10 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-medium text-foreground">No campaigns found</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            {search ? "Try adjusting your search query." : "Get started by creating your first discovery campaign."}
          </p>
          {!search && (
            <Button variant="outline" className="mt-6 rounded-xl" onClick={() => setOpen(true)}>
              Create Campaign
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deletingId !== null}
        onOpenChange={(v) => { if (!v) setDeletingId(null); }}
        title="Delete Campaign"
        description={`Permanently delete "${deletingCampaign?.name ?? ""}" and all its runs, leads, and outreach data? This cannot be undone.`}
        confirmText={deletingCampaign?.name ?? ""}
        confirmLabel="Delete Campaign"
        onConfirm={handleDelete}
        loading={deleteCampaign.isPending}
      />
    </div>
  );
}
