import { useGetDashboardStats, useListLogs } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Briefcase, Mail, Send, Users } from "lucide-react";
import { format } from "date-fns";

export function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: logs, isLoading: logsLoading } = useListLogs({ limit: 10 });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">Dashboard</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Campaigns" value={stats?.totalCampaigns} icon={Briefcase} loading={statsLoading} />
        <StatCard title="Active Campaigns" value={stats?.activeCampaigns} icon={Activity} loading={statsLoading} className="text-primary" />
        <StatCard title="Total Leads" value={stats?.totalLeads} icon={Users} loading={statsLoading} />
        <StatCard title="Leads to Review" value={stats?.leadsToReview} icon={Users} loading={statsLoading} className="text-amber-500" />
        <StatCard title="Emails Queued" value={stats?.emailsQueued} icon={Mail} loading={statsLoading} />
        <StatCard title="Emails Sent Today" value={stats?.emailsSentToday} icon={Send} loading={statsLoading} className="text-primary" />
      </div>

      <Card className="col-span-3 bg-card border-border shadow-none">
        <CardHeader>
          <CardTitle className="text-sm font-mono uppercase text-muted-foreground">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {logsLoading ? (
            <div className="h-32 flex items-center justify-center text-sm text-muted-foreground font-mono">LOADING ACTIVITY...</div>
          ) : (
            <div className="space-y-4">
              {logs?.map((log) => (
                <div key={log.id} className="flex items-start gap-4 text-sm border-b border-border/50 pb-4 last:border-0 last:pb-0">
                  <div className="w-32 shrink-0 text-xs font-mono text-muted-foreground">
                    {format(new Date(log.createdAt), "MM/dd HH:mm:ss")}
                  </div>
                  <div className="flex-1 flex items-start gap-3">
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-muted text-foreground uppercase">
                      {log.type}
                    </span>
                    <span className="text-foreground">{log.message}</span>
                  </div>
                </div>
              ))}
              {!logs?.length && <div className="text-sm text-muted-foreground font-mono">No recent activity.</div>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, loading, className }: { title: string, value?: number, icon: any, loading: boolean, className?: string }) {
  return (
    <Card className="bg-card border-border shadow-none">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-mono font-medium text-muted-foreground uppercase">{title}</CardTitle>
        <Icon className={`h-4 w-4 text-muted-foreground ${className}`} />
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-8 w-16 bg-muted animate-pulse rounded" />
        ) : (
          <div className={`text-2xl font-mono font-bold ${className}`}>{value !== undefined ? value : "-"}</div>
        )}
      </CardContent>
    </Card>
  );
}
