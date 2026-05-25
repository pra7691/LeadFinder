import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, MailX, Trash2, Search, UserX, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UnsubscribeRow {
  id: number;
  email: string;
  company_name: string | null;
  unsubscribed_at: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function fetchUnsubscribes(): Promise<UnsubscribeRow[]> {
  const res = await fetch(`${BASE}/api/unsubscribes`);
  if (!res.ok) throw new Error("Failed to load unsubscribe list");
  return res.json();
}

async function deleteUnsubscribe(email: string): Promise<void> {
  const res = await fetch(`${BASE}/api/unsubscribes/${encodeURIComponent(email)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) throw new Error("Failed to remove");
}

async function syncUnsubscribes(): Promise<{ synced: number; total: number }> {
  const res = await fetch(`${BASE}/api/unsubscribes/sync`, { method: "POST" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Sync failed");
  return json;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Unsubscribes() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [deletingEmail, setDeletingEmail] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const { data, isLoading, isError } = useQuery<UnsubscribeRow[]>({
    queryKey: ["unsubscribes"],
    queryFn: fetchUnsubscribes,
    staleTime: 30_000,
  });

  const rows = (data ?? []).filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      r.email.toLowerCase().includes(q) ||
      (r.company_name ?? "").toLowerCase().includes(q)
    );
  });

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const result = await syncUnsubscribes();
      qc.invalidateQueries({ queryKey: ["unsubscribes"] });
      toast({
        title: result.synced > 0
          ? `Synced ${result.synced} new unsubscribe${result.synced === 1 ? "" : "s"}.`
          : "Already up to date — no new unsubscribes.",
      });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Sync failed. Check your settings.",
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDelete = async (email: string) => {
    if (!confirm(`Remove "${email}" from the unsubscribe list?\n\nThey may receive outreach emails again.`)) return;
    setDeletingEmail(email);
    try {
      await deleteUnsubscribe(email);
      qc.invalidateQueries({ queryKey: ["unsubscribes"] });
      toast({ title: `${email} removed from unsubscribe list.` });
    } catch {
      toast({ title: "Failed to remove. Please try again.", variant: "destructive" });
    } finally {
      setDeletingEmail(null);
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-3">
            <MailX className="w-7 h-7 text-muted-foreground" />
            Unsubscribes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Recipients who opted out. These emails are automatically skipped when creating outreach.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && data.length > 0 && (
            <div className="rounded-full bg-muted px-3 py-1 text-sm font-medium tabular-nums">
              {data.length} unsubscribed
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-2"
            onClick={handleSync}
            disabled={isSyncing}
          >
            {isSyncing
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <RefreshCw className="w-4 h-4" />}
            Sync from Hosting
          </Button>
        </div>
      </div>

      {/* Search */}
      {data && data.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by email or company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 rounded-xl bg-background/50"
          />
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center gap-3 text-sm text-muted-foreground py-12 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading…
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive text-center">
          Failed to load unsubscribe list. Check the server logs.
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && data?.length === 0 && (
        <div className="rounded-2xl border border-border/50 bg-muted/20 p-12 text-center space-y-3">
          <UserX className="w-10 h-10 text-muted-foreground/40 mx-auto" />
          <p className="text-base font-medium text-muted-foreground">No unsubscribes yet</p>
          <p className="text-sm text-muted-foreground/70">
            When recipients click the unsubscribe link in your emails, they'll appear here.
          </p>
        </div>
      )}

      {/* No search results */}
      {!isLoading && !isError && (data?.length ?? 0) > 0 && rows.length === 0 && (
        <div className="rounded-2xl border border-border/50 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          No results for &ldquo;{search}&rdquo;
        </div>
      )}

      {/* Table */}
      {rows.length > 0 && (
        <div className="glass-card overflow-hidden rounded-2xl">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow className="border-border/30 hover:bg-transparent">
                <TableHead>Email</TableHead>
                <TableHead>Company</TableHead>
                <TableHead className="w-[200px]">Unsubscribed</TableHead>
                <TableHead className="w-[56px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} className="border-border/30">
                  <TableCell>
                    <span className="font-mono text-sm">{row.email}</span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.company_name ?? <span className="opacity-40">—</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(row.unsubscribed_at)}
                  </TableCell>
                  <TableCell className="text-right pr-3">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 rounded-lg text-destructive/60 hover:text-destructive"
                      disabled={deletingEmail === row.email}
                      onClick={() => handleDelete(row.email)}
                      title="Remove from list"
                    >
                      {deletingEmail === row.email
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
