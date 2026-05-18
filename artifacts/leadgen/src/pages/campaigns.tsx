import {
  useListCampaigns,
  useCreateCampaign,
  usePauseCampaign,
  useResumeCampaign,
  getListCampaignsQueryKey,
  getGetSchedulerStatusQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Activity,
  Pause,
  Search,
  Briefcase,
  Calendar,
  Clock,
  RefreshCw,
  Loader2,
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
  const { data: campaigns, isLoading } = useListCampaigns();
  const createCampaign = useCreateCampaign();
  const pauseCampaign = usePauseCampaign();
  const resumeCampaign = useResumeCampaign();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [search, setSearch] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetSchedulerStatusQueryKey() });
  };

  const handleCreate = () => {
    createCampaign.mutate(
      { data: { name, objective, isActive: true } },
      {
        onSuccess: () => {
          setOpen(false);
          setName("");
          setObjective("");
          invalidate();
        },
      },
    );
  };

  const handlePause = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    pauseCampaign.mutate({ id }, { onSuccess: invalidate });
  };

  const handleResume = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    resumeCampaign.mutate({ id }, { onSuccess: invalidate });
  };

  const filteredCampaigns = (campaigns as Campaign[] | undefined)?.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );

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

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="glass-card">
              <CardContent className="p-6 space-y-4">
                <div className="flex justify-between items-start">
                  <div className="h-6 w-40 bg-muted/50 rounded-lg animate-pulse" />
                  <div className="h-6 w-16 bg-muted/50 rounded-full animate-pulse" />
                </div>
                <div className="space-y-2">
                  <div className="h-4 w-full bg-muted/50 rounded animate-pulse" />
                  <div className="h-4 w-3/4 bg-muted/50 rounded animate-pulse" />
                </div>
                <div className="h-4 w-28 bg-muted/50 rounded animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCampaigns?.map((campaign) => {
            const scheduleType = campaign.scheduleType || "manual";
            const lastRunStatus = campaign.lastRunStatus || "idle";
            const isPaused = Boolean(campaign.isPaused);
            const nextRunAt = campaign.nextRunAt ? new Date(campaign.nextRunAt) : null;
            const lastRunAt = campaign.lastRunAt ? new Date(campaign.lastRunAt) : null;
            const { dot, label: dotLabel } = getStatusDot(lastRunStatus, campaign.isActive);

            return (
              <Link key={campaign.id} href={`/campaigns/${campaign.id}`} data-testid={`link-campaign-${campaign.id}`}>
                <Card className="glass-card hover:shadow-md hover:border-primary/30 transition-all duration-300 cursor-pointer group h-full flex flex-col">
                  <CardContent className="p-6 flex flex-col h-full">
                    <div className="flex justify-between items-start mb-3">
                      <h3 className="font-semibold text-lg leading-tight group-hover:text-primary transition-colors">
                        {campaign.name}
                      </h3>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        {lastRunStatus === "running" ? (
                          <span className="flex items-center text-[11px] font-medium text-blue-500 bg-blue-500/10 px-2.5 py-1 rounded-full gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" /> Running
                          </span>
                        ) : campaign.isActive && !isPaused ? (
                          <span className="flex items-center text-[11px] font-medium text-emerald-600 bg-emerald-500/10 px-2.5 py-1 rounded-full gap-1">
                            <Activity className="w-3 h-3" /> Active
                          </span>
                        ) : lastRunStatus === "failed" ? (
                          <span className="flex items-center text-[11px] font-medium text-destructive bg-destructive/10 px-2.5 py-1 rounded-full gap-1">
                            <Activity className="w-3 h-3" /> Failed
                          </span>
                        ) : isPaused ? (
                          <span className="flex items-center text-[11px] font-medium text-amber-600 bg-amber-500/10 px-2.5 py-1 rounded-full gap-1">
                            <Pause className="w-3 h-3" /> Paused
                          </span>
                        ) : (
                          <span className="flex items-center text-[11px] font-medium text-muted-foreground bg-muted px-2.5 py-1 rounded-full gap-1">
                            <Pause className="w-3 h-3" /> Inactive
                          </span>
                        )}
                      </div>
                    </div>

                    <p className="text-sm text-muted-foreground mb-4 line-clamp-2 flex-1">
                      {campaign.objective}
                    </p>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                      <Calendar className="w-3.5 h-3.5 shrink-0" />
                      <span>{SCHEDULE_LABELS[scheduleType] ?? scheduleType}</span>
                      {scheduleType !== "manual" && campaign.scheduleTime && (
                        <span className="opacity-60">@ {campaign.scheduleTime}</span>
                      )}
                      <span className="flex items-center gap-1.5 ml-auto">
                        <span className={cn("w-2 h-2 rounded-full shrink-0", dot)} />
                        <span className="text-[10px] text-muted-foreground">{dotLabel}</span>
                      </span>
                    </div>

                    {nextRunAt && scheduleType !== "manual" && !isPaused && (
                      <div className="flex items-center gap-1.5 text-xs text-primary mb-2">
                        <Clock className="w-3.5 h-3.5" />
                        Next: {formatDistanceToNow(nextRunAt, { addSuffix: true })}
                      </div>
                    )}

                    {lastRunAt && (
                      <p className="text-[11px] text-muted-foreground/60 mb-3">
                        Last run {formatDistanceToNow(lastRunAt, { addSuffix: true })}
                      </p>
                    )}

                    <div className="flex gap-2 flex-wrap mt-auto pt-4 border-t border-border/30">
                      {(campaign.keywords || []).slice(0, 3).map((kw, i) => (
                        <span key={i} className="text-[11px] font-medium bg-muted/50 text-muted-foreground px-2 py-1 rounded-md">
                          {kw}
                        </span>
                      ))}
                      {(campaign.keywords?.length || 0) > 3 && (
                        <span className="text-[11px] font-medium text-muted-foreground px-1 py-1">
                          +{campaign.keywords!.length - 3}
                        </span>
                      )}
                      {(!campaign.keywords || campaign.keywords.length === 0) && (
                        <span className="text-[11px] font-medium text-muted-foreground/50 italic px-1 py-1">No keywords</span>
                      )}
                    </div>

                    {campaign.isActive && scheduleType !== "manual" && (
                      <div className="mt-3 pt-3 border-t border-border/20">
                        {isPaused ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs rounded-lg gap-1.5 w-full text-primary border-primary/30 hover:bg-primary/5"
                            onClick={(e) => handleResume(e, campaign.id)}
                          >
                            <RefreshCw className="w-3 h-3" /> Resume Scheduler
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs rounded-lg gap-1.5 w-full text-muted-foreground hover:text-foreground"
                            onClick={(e) => handlePause(e, campaign.id)}
                          >
                            <Pause className="w-3 h-3" /> Pause Scheduler
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}

          {!filteredCampaigns?.length && (
            <div className="col-span-full flex flex-col items-center justify-center p-12 text-center bg-muted/20 border border-border/50 rounded-2xl border-dashed">
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
        </div>
      )}
    </div>
  );
}
