import { useListLogs } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Activity } from "lucide-react";

export function Logs() {
  const { data: logs, isLoading } = useListLogs({ limit: 200 });

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Activity Logs</h1>
      </div>

      <div className="glass-card overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow className="border-border/30 hover:bg-transparent">
              <TableHead className="w-[180px]">Timestamp</TableHead>
              <TableHead className="w-[140px]">Type</TableHead>
              <TableHead>Message</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={3} className="h-32 text-center text-muted-foreground animate-pulse">Loading logs...</TableCell>
              </TableRow>
            ) : logs?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="h-32 text-center text-muted-foreground">
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <Activity className="w-6 h-6 opacity-20" />
                    <p>No logs found.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              logs?.map((log) => (
                <TableRow key={log.id} className="border-border/20 transition-colors">
                  <TableCell className="text-sm text-muted-foreground font-mono">
                    {format(new Date(log.createdAt), "MMM dd, HH:mm:ss")}
                  </TableCell>
                  <TableCell>
                    <span className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-muted/50 text-muted-foreground uppercase tracking-wider">
                      {log.type}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-foreground/90">{log.message}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
