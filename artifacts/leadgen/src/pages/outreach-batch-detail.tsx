import { useListOutreach } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Eye, Mail, MousePointerClick, Users } from "lucide-react";
import { Link, useParams } from "wouter";
import {
  buildDisplayRows,
  formatTrackingTime,
  StatusBadge,
  type OutreachDisplayRow,
  type OutreachItem,
} from "@/pages/outreach";

function findBatch(rows: OutreachDisplayRow[], batchId: string | undefined): OutreachDisplayRow | null {
  if (!batchId) return null;
  const decoded = decodeURIComponent(batchId);
  return rows.find((row) => row.id === decoded) ?? null;
}

export function OutreachBatchDetail() {
  const params = useParams<{ batchId: string }>();
  const { data: rawItems, isLoading } = useListOutreach();
  const outreachItems = Array.isArray(rawItems) ? (rawItems as OutreachItem[]) : [];
  const rows = buildDisplayRows(outreachItems);
  const batch = findBatch(rows, params.batchId);

  if (isLoading) {
    return (
      <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="h-9 w-40 rounded-xl bg-muted/50 animate-pulse" />
        <div className="h-24 rounded-2xl bg-muted/40 animate-pulse" />
        <div className="h-96 rounded-2xl bg-muted/30 animate-pulse" />
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <Link href="/outreach">
          <Button variant="outline" className="rounded-xl gap-2">
            <ArrowLeft className="w-4 h-4" /> Back to Outreach
          </Button>
        </Link>
        <div className="rounded-2xl border border-border/50 bg-muted/20 p-8 text-center">
          <p className="text-lg font-semibold">Outreach batch not found</p>
          <p className="text-sm text-muted-foreground mt-1">The outreach group may have been deleted or filtered out.</p>
        </div>
      </div>
    );
  }

  const openedRecipients = batch.items.filter((item) => (item.openCount ?? 0) > 0).length;
  const clickedRecipients = batch.items.filter((item) => (item.clickCount ?? 0) > 0).length;

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href="/outreach">
            <Button variant="outline" size="sm" className="rounded-xl gap-2 mb-4">
              <ArrowLeft className="w-4 h-4" /> Back to Outreach
            </Button>
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">{batch.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {batch.count} recipient{batch.count === 1 ? "" : "s"}
            {batch.templateName && <> · {batch.templateName}</>}
          </p>
        </div>
        <StatusBadge status={batch.status} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-border/50 bg-muted/20 p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-widest">
            <Users className="w-4 h-4" /> Recipients
          </div>
          <p className="mt-2 text-2xl font-semibold">{batch.count}</p>
        </div>
        <div className="rounded-2xl border border-border/50 bg-muted/20 p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-widest">
            <Eye className="w-4 h-4" /> Opens
          </div>
          <p className="mt-2 text-2xl font-semibold">{batch.openCount}</p>
          <p className="text-xs text-muted-foreground">{openedRecipients} recipient{openedRecipients === 1 ? "" : "s"}</p>
        </div>
        <div className="rounded-2xl border border-border/50 bg-muted/20 p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-widest">
            <MousePointerClick className="w-4 h-4" /> Clicks
          </div>
          <p className="mt-2 text-2xl font-semibold">{batch.clickCount}</p>
          <p className="text-xs text-muted-foreground">{clickedRecipients} recipient{clickedRecipients === 1 ? "" : "s"}</p>
        </div>
        <div className="rounded-2xl border border-border/50 bg-muted/20 p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-widest">
            <Mail className="w-4 h-4" /> Subject
          </div>
          <p className="mt-2 text-sm font-medium line-clamp-2">{batch.subject}</p>
        </div>
      </div>

      <div className="glass-card overflow-hidden rounded-2xl">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow className="border-border/30 hover:bg-transparent">
              <TableHead>Recipient</TableHead>
              <TableHead className="w-[110px]">Status</TableHead>
              <TableHead className="w-[90px] text-center">Opens</TableHead>
              <TableHead className="w-[90px] text-center">Clicks</TableHead>
              <TableHead className="w-[160px]">Sent</TableHead>
              <TableHead className="w-[160px]">First Opened</TableHead>
              <TableHead className="w-[160px]">Last Opened</TableHead>
              <TableHead className="w-[160px]">Last Clicked</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {batch.items.map((item) => (
              <TableRow key={item.id} className="border-border/30">
                <TableCell>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.companyName ?? item.recipientEmail}</p>
                    <p className="truncate text-xs text-muted-foreground font-mono">{item.recipientEmail}</p>
                  </div>
                </TableCell>
                <TableCell><StatusBadge status={item.status} /></TableCell>
                <TableCell className="text-center font-semibold">{item.openCount ?? 0}</TableCell>
                <TableCell className="text-center font-semibold">{item.clickCount ?? 0}</TableCell>
                <TableCell className="text-xs">{formatTrackingTime(item.sentAt)}</TableCell>
                <TableCell className="text-xs">{formatTrackingTime(item.firstOpenedAt)}</TableCell>
                <TableCell className="text-xs">{formatTrackingTime(item.lastOpenedAt)}</TableCell>
                <TableCell className="text-xs">{formatTrackingTime(item.lastClickedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
