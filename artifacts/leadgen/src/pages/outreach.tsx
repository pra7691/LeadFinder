import { useListOutreach, useUpdateOutreach } from "@workspace/api-client-react";
import { getListOutreachQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Play, SquareSquare, CheckCircle, AlertCircle, Clock } from "lucide-react";

export function Outreach() {
  const { data: outreachItems, isLoading } = useListOutreach();
  const updateOutreach = useUpdateOutreach();
  const queryClient = useQueryClient();

  const handleUpdateStatus = (id: number, status: string) => {
    updateOutreach.mutate({
      id,
      data: { status }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListOutreachQueryKey() });
      }
    });
  };

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'sent': return <span className="flex items-center gap-1 text-primary bg-primary/10 px-2 py-0.5 rounded text-[10px] font-mono uppercase"><CheckCircle className="w-3 h-3"/> Sent</span>;
      case 'failed': return <span className="flex items-center gap-1 text-destructive bg-destructive/10 px-2 py-0.5 rounded text-[10px] font-mono uppercase"><AlertCircle className="w-3 h-3"/> Failed</span>;
      case 'queued': return <span className="flex items-center gap-1 text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded text-[10px] font-mono uppercase"><Clock className="w-3 h-3"/> Queued</span>;
      case 'skipped': return <span className="flex items-center gap-1 text-muted-foreground bg-muted px-2 py-0.5 rounded text-[10px] font-mono uppercase"><SquareSquare className="w-3 h-3"/> Skipped</span>;
      default: return <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-muted">{status}</span>;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">Outreach Queue</h1>
      </div>

      <div className="border border-border rounded-md bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-[180px]">Recipient</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead className="w-[160px]">Scheduled/Sent</TableHead>
              <TableHead className="text-right w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground font-mono text-xs">LOADING QUEUE...</TableCell>
              </TableRow>
            ) : outreachItems?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground font-mono text-xs">QUEUE EMPTY</TableCell>
              </TableRow>
            ) : (
              outreachItems?.map((item) => (
                <TableRow key={item.id} className="group border-border">
                  <TableCell className="font-mono text-xs truncate max-w-[180px]">{item.recipientEmail}</TableCell>
                  <TableCell className="text-sm truncate max-w-[300px]">{item.subject}</TableCell>
                  <TableCell>{getStatusBadge(item.status)}</TableCell>
                  <TableCell className="font-mono text-[10px] text-muted-foreground">
                    {item.sentAt ? format(new Date(item.sentAt), "MM/dd HH:mm") : item.scheduledAt ? format(new Date(item.scheduledAt), "MM/dd HH:mm") : "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    {item.status === 'queued' && (
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:bg-muted" onClick={() => handleUpdateStatus(item.id, 'skipped')} disabled={updateOutreach.isPending} title="Skip">
                          <SquareSquare className="w-4 h-4" />
                        </Button>
                      </div>
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
