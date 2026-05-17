import { useGetDashboardStats, useListLogs } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Briefcase, Mail, Send, Users } from "lucide-react";
import { format } from "date-fns";

export function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: logs, isLoading: logsLoading } = useListLogs({ limit: 10 });

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Overview</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Total Campaigns" value={stats?.totalCampaigns} icon={Briefcase} loading={statsLoading} />
        <StatCard title="Active Campaigns" value={stats?.activeCampaigns} icon={Activity} loading={statsLoading} valueClassName="text-primary" />
        <StatCard title="Total Leads" value={stats?.totalLeads} icon={Users} loading={statsLoading} />
        <StatCard title="Leads to Review" value={stats?.leadsToReview} icon={Users} loading={statsLoading} valueClassName="text-amber-500" />
        <StatCard title="Emails Queued" value={stats?.emailsQueued} icon={Mail} loading={statsLoading} />
        <StatCard title="Emails Sent Today" value={stats?.emailsSentToday} icon={Send} loading={statsLoading} valueClassName="text-primary" />
      </div>

      <Card className="col-span-3 glass-card border-border/50">
        <CardHeader className="border-b border-border/30 pb-4">
          <CardTitle className="text-sm font-medium text-foreground">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          {logsLoading ? (
            <div className="h-32 flex items-center justify-center text-sm text-muted-foreground animate-pulse">Loading activity...</div>
          ) : (
            <div className="space-y-5">
              {logs?.map((log) => (
                <div key={log.id} className="flex items-start gap-4 text-sm group">
                  <div className="w-32 shrink-0 text-xs font-mono text-muted-foreground pt-0.5 group-hover:text-foreground transition-colors">
                    {format(new Date(log.createdAt), "MM/dd HH:mm")}
                  </div>
                  <div className="flex-1 flex items-start gap-3">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-muted text-muted-foreground uppercase tracking-wider">
                      {log.type}
                    </span>
                    <span className="text-foreground/90">{log.message}</span>
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
  );
}

function StatCard({ title, value, icon: Icon, loading, valueClassName = "" }: { title: string, value?: number, icon: any, loading: boolean, valueClassName?: string }) {
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
          <div className={`text-3xl font-semibold tracking-tight ${valueClassName}`}>
            {value !== undefined ? value.toLocaleString() : "-"}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
