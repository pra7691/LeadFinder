import { useListOutreach, useUpdateOutreach } from "@workspace/api-client-react";
import { getListOutreachQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Play, SquareSquare, CheckCircle, AlertCircle, Clock, Send } from "lucide-react";

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
      case 'sent': return <span className="flex items-center gap-1.5 text-primary bg-primary/10 px-2.5 py-1 rounded-full text-xs font-medium capitalize"><CheckCircle className="w-3.5 h-3.5"/> Sent</span>;
      case 'failed': return <span className="flex items-center gap-1.5 text-destructive bg-destructive/10 px-2.5 py-1 rounded-full text-xs font-medium capitalize"><AlertCircle className="w-3.5 h-3.5"/> Failed</span>;
      case 'queued': return <span className="flex items-center gap-1.5 text-amber-500 bg-amber-500/10 px-2.5 py-1 rounded-full text-xs font-medium capitalize"><Clock className="w-3.5 h-3.5"/> Queued</span>;
      case 'skipped': return <span className="flex items-center gap-1.5 text-muted-foreground bg-muted px-2.5 py-1 rounded-full text-xs font-medium capitalize"><SquareSquare className="w-3.5 h-3.5"/> Skipped</span>;
      default: return <span className="px-2.5 py-1 rounded-full text-xs font-medium capitalize bg-muted">{status}</span>;
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Outreach Queue</h1>
      </div>

      <div className="glass-card overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow className="border-border/30 hover:bg-transparent">
              <TableHead className="w-[250px]">Recipient</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead className="w-[140px]">Status</TableHead>
              <TableHead className="w-[180px]">Timing</TableHead>
              <TableHead className="text-right w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground animate-pulse">Loading queue...</TableCell>
              </TableRow>
            ) : outreachItems?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <Send className="w-6 h-6 opacity-20" />
                    <p>Queue is empty.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              outreachItems?.map((item) => (
                <TableRow key={item.id} className="group border-border/30 transition-colors">
                  <TableCell className="font-medium text-foreground truncate max-w-[250px]">{item.recipientEmail}</TableCell>
                  <TableCell className="text-muted-foreground truncate max-w-[400px]">{item.subject}</TableCell>
                  <TableCell>{getStatusBadge(item.status)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {item.sentAt ? (
                      <span className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 opacity-50"/> {format(new Date(item.sentAt), "MMM d, HH:mm")}</span>
                    ) : item.scheduledAt ? (
                      <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 opacity-50"/> {format(new Date(item.scheduledAt), "MMM d, HH:mm")}</span>
                    ) : "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    {item.status === 'queued' && (
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-8 w-8 rounded-full text-muted-foreground hover:bg-muted" 
                          onClick={() => handleUpdateStatus(item.id, 'skipped')} 
                          disabled={updateOutreach.isPending} 
                          title="Skip"
                          data-testid={`btn-skip-${item.id}`}
                        >
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
