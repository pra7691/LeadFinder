import {
  useGetDashboardStats,
  useListLogs,
  useGetSchedulerStatus,
  useTriggerCampaignPipeline,
  getGetSchedulerStatusQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Activity,
  Briefcase,
  Mail,
  Send,
  Users,
  Calendar,
  Clock,
  CheckCircle,
  AlertCircle,
  Loader2,
  Zap,
  Pause,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

type SchedulerRow = {
  campaignId: number;
  campaignName: string;
  scheduleType: string;
  scheduleDays?: string | null;
  scheduleTime?: string | null;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastRunStatus: string;
  isPaused: boolean;
  isActive: boolean;
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  idle: <span className="w-2 h-2 rounded-full bg-muted-foreground/40 inline-block" />,
  running: <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />,
  success: <CheckCircle className="w-3.5 h-3.5 text-green-500" />,
  failed: <AlertCircle className="w-3.5 h-3.5 text-destructive" />,
};

const STATUS_TEXT: Record<string, string> = {
  idle: "text-muted-foreground",
  running: "text-blue-500",
  success: "text-green-600",
  failed: "text-destructive",
};

export function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: logs, isLoading: logsLoading } = useListLogs({ limit: 8 });
  const { data: schedulerStatus } = useGetSchedulerStatus();
  const triggerPipeline = useTriggerCampaignPipeline();
  const qc = useQueryClient();

  const scheduledCampaigns = (schedulerStatus as SchedulerRow[] | undefined)?.filter(
    (c) => c.scheduleType !== "manual" && c.isActive,
  ) ?? [];

  const runningCount = scheduledCampaigns.filter((c) => c.lastRunStatus === "running").length;
  const pausedCount = scheduledCampaigns.filter((c) => c.isPaused).length;
  const nextRun = scheduledCampaigns
    .filter((c) => c.nextRunAt && !c.isPaused)
    .sort((a, b) => new Date(a.nextRunAt!).getTime() - new Date(b.nextRunAt!).getTime())[0];

  const handleTrigger = (campaignId: number) => {
    triggerPipeline.mutate(
      { id: campaignId },
      { onSuccess: () => qc.invalidateQueries({ queryKey: getGetSchedulerStatusQueryKey() }) },
    );
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h1 className="text-3xl font-semibold tracking-tight">Overview</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Total Campaigns" value={stats?.totalCampaigns} icon={Briefcase} loading={statsLoading} />
        <StatCard title="Active Campaigns" value={stats?.activeCampaigns} icon={Activity} loading={statsLoading} valueClassName="text-primary" />
        <StatCard title="Total Leads" value={stats?.totalLeads} icon={Users} loading={statsLoading} />
        <StatCard title="Leads to Review" value={stats?.leadsToReview} icon={Users} loading={statsLoading} valueClassName="text-amber-500" />
        <StatCard title="Emails Queued" value={stats?.emailsQueued} icon={Mail} loading={statsLoading} />
        <StatCard title="Emails Sent Today" value={stats?.emailsSentToday} icon={Send} loading={statsLoading} valueClassName="text-primary" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Scheduler status card */}
        <Card className="glass-card border-border/50 lg:col-span-1">
          <CardHeader className="border-b border-border/30 pb-4">
            <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
              <Calendar className="w-4 h-4 text-primary" /> Scheduler
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-5 space-y-4">
            {/* Summary row */}
            <div className="flex gap-3 text-xs">
              <div className="flex-1 bg-muted/30 rounded-xl px-3 py-2.5 text-center">
                <div className="font-semibold text-lg">{scheduledCampaigns.length}</div>
                <div className="text-muted-foreground">scheduled</div>
              </div>
              <div className="flex-1 bg-muted/30 rounded-xl px-3 py-2.5 text-center">
                <div className={cn("font-semibold text-lg", runningCount > 0 ? "text-blue-500" : "")}>
                  {runningCount}
                </div>
                <div className="text-muted-foreground">running</div>
              </div>
              <div className="flex-1 bg-muted/30 rounded-xl px-3 py-2.5 text-center">
                <div className={cn("font-semibold text-lg", pausedCount > 0 ? "text-amber-500" : "")}>
                  {pausedCount}
                </div>
                <div className="text-muted-foreground">paused</div>
              </div>
            </div>

            {/* Next run */}
            {nextRun?.nextRunAt && (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-primary/5 border border-primary/20 rounded-xl text-sm">
                <Clock className="w-4 h-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium text-primary text-xs truncate">{nextRun.campaignName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(nextRun.nextRunAt), { addSuffix: true })}
                  </p>
                </div>
              </div>
            )}

            {/* Campaign list */}
            {scheduledCampaigns.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                No scheduled campaigns. Set a schedule in Campaign Settings.
              </p>
            ) : (
              <div className="space-y-2">
                {scheduledCampaigns.slice(0, 5).map((c) => (
                  <div
                    key={c.campaignId}
                    className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-muted/30 transition-colors group"
                  >
                    <div className="shrink-0">
                      {c.isPaused ? (
                        <Pause className="w-3.5 h-3.5 text-amber-500" />
                      ) : (
                        STATUS_ICON[c.lastRunStatus] ?? STATUS_ICON.idle
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{c.campaignName}</p>
                      <p className={cn("text-[10px]", c.isPaused ? "text-amber-500" : STATUS_TEXT[c.lastRunStatus] ?? "text-muted-foreground")}>
                        {c.isPaused
                          ? "Paused"
                          : c.lastRunStatus === "running"
                            ? "Running…"
                            : c.nextRunAt
                              ? `Next: ${format(new Date(c.nextRunAt), "MMM d, HH:mm")}`
                              : c.scheduleType}
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      onClick={() => handleTrigger(c.campaignId)}
                      disabled={c.lastRunStatus === "running" || c.isPaused || triggerPipeline.isPending}
                      title="Run now"
                    >
                      <Zap className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card className="glass-card border-border/50 lg:col-span-2">
          <CardHeader className="border-b border-border/30 pb-4">
            <CardTitle className="text-sm font-medium text-foreground">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {logsLoading ? (
              <div className="h-32 flex items-center justify-center text-sm text-muted-foreground animate-pulse">
                Loading activity...
              </div>
            ) : (
              <div className="space-y-4">
                {logs?.map((log) => (
                  <div key={log.id} className="flex items-start gap-4 text-sm group">
                    <div className="w-28 shrink-0 text-xs font-mono text-muted-foreground pt-0.5 group-hover:text-foreground transition-colors">
                      {format(new Date(log.createdAt), "MM/dd HH:mm")}
                    </div>
                    <div className="flex-1 flex items-start gap-3 min-w-0">
                      <span className={cn(
                        "px-2 py-0.5 rounded-md text-[10px] font-medium uppercase tracking-wider shrink-0",
                        log.type === "scheduler"
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}>
                        {log.type}
                      </span>
                      <span className="text-foreground/90 text-xs leading-relaxed">{log.message}</span>
                    </div>
                  </div>
                ))}
                {!logs?.length && (
                  <div className="flex flex-col items-center justify-center h-32 text-muted-foreground space-y-2">
                    <Activity className="w-6 h-6 opacity-20" />
                    <p className="text-sm">No recent activity.</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  loading,
  valueClassName = "",
}: {
  title: string;
  value?: number;
  icon: React.ElementType;
  loading: boolean;
  valueClassName?: string;
}) {
  return (
    <Card className="glass-card">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className="p-2 bg-muted/50 rounded-lg">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-8 w-16 bg-muted/50 animate-pulse rounded-md" />
        ) : (
          <div className={cn("text-3xl font-semibold tracking-tight", valueClassName)}>
            {value !== undefined ? value.toLocaleString() : "-"}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
