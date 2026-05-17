import { useListLogs } from "@workspace/api-client-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { Activity, Search } from "lucide-react";
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";

// ── Type badge config ──────────────────────────────────────────────────────

const LOG_TYPE_CONFIG: Record<
  string,
  { label: string; color: string; dot: string }
> = {
  discovery:  { label: "Discovery",  color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",  dot: "bg-indigo-500" },
  crawl:      { label: "Crawl",      color: "bg-sky-500/10 text-sky-600 dark:text-sky-400",            dot: "bg-sky-500" },
  score:      { label: "Score",      color: "bg-violet-500/10 text-violet-600 dark:text-violet-400",   dot: "bg-violet-500" },
  export:     { label: "Export",     color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",dot: "bg-emerald-500" },
  scheduler:  { label: "Scheduler",  color: "bg-primary/10 text-primary",                              dot: "bg-primary" },
  workflow:   { label: "Workflow",   color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",         dot: "bg-blue-500" },
  outreach:   { label: "Outreach",   color: "bg-orange-500/10 text-orange-600 dark:text-orange-400",   dot: "bg-orange-500" },
  campaign:   { label: "Campaign",   color: "bg-slate-500/10 text-slate-600 dark:text-slate-400",      dot: "bg-slate-500" },
  lead:       { label: "Lead",       color: "bg-teal-500/10 text-teal-600 dark:text-teal-400",         dot: "bg-teal-500" },
  filter:     { label: "Filter",     color: "bg-rose-500/10 text-rose-600 dark:text-rose-400",         dot: "bg-rose-500" },
  email:      { label: "Email",      color: "bg-pink-500/10 text-pink-600 dark:text-pink-400",         dot: "bg-pink-500" },
};

function TypeBadge({ type }: { type: string }) {
  const cfg = LOG_TYPE_CONFIG[type] ?? {
    label: type,
    color: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium uppercase tracking-wider",
        cfg.color,
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

// ── Skeleton rows ─────────────────────────────────────────────────────────

const SKELETON_WIDTHS = [55, 70, 45, 80, 60, 75, 50, 65];

function SkeletonRows() {
  return (
    <>
      {SKELETON_WIDTHS.map((w, i) => (
        <TableRow key={i} className="border-border/20">
          <TableCell>
            <div className="h-4 w-36 bg-muted/50 rounded animate-pulse" />
          </TableCell>
          <TableCell>
            <div className="h-5 w-20 bg-muted/50 rounded-md animate-pulse" />
          </TableCell>
          <TableCell>
            <div
              className="h-4 bg-muted/50 rounded animate-pulse"
              style={{ width: `${w}%` }}
            />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export function Logs() {
  const { data: logs, isLoading } = useListLogs({ limit: 500 });
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const allTypes = useMemo(() => {
    const types = new Set((logs ?? []).map((l) => l.type));
    return ["all", ...Array.from(types).sort()];
  }, [logs]);

  const filtered = useMemo(() => {
    let rows = logs ?? [];
    if (typeFilter !== "all") rows = rows.filter((l) => l.type === typeFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (l) =>
          l.message.toLowerCase().includes(q) ||
          l.type.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [logs, typeFilter, search]);

  const countByType = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of logs ?? []) map[l.type] = (map[l.type] ?? 0) + 1;
    return map;
  }, [logs]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Activity Logs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Full audit trail
            {logs && logs.length > 0 && (
              <span> · {logs.length.toLocaleString()} events</span>
            )}
          </p>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search logs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 w-56 rounded-xl bg-background/50 border-border/50"
          />
        </div>
      </div>

      {/* Type filter pills */}
      {!isLoading && allTypes.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          {allTypes.map((type) => {
            const cfg = type === "all" ? null : LOG_TYPE_CONFIG[type];
            const count =
              type === "all" ? (logs?.length ?? 0) : (countByType[type] ?? 0);
            return (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all border",
                  typeFilter === type
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-background/50 text-muted-foreground border-border/50 hover:border-border hover:text-foreground",
                )}
              >
                {cfg && (
                  <span
                    className={cn("w-1.5 h-1.5 rounded-full shrink-0", cfg.dot)}
                  />
                )}
                {type === "all" ? "All" : (cfg?.label ?? type)}
                <span
                  className={cn(
                    "ml-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-semibold min-w-[18px] text-center",
                    typeFilter === type
                      ? "bg-white/20"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Table */}
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
              <SkeletonRows />
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="h-48 text-center">
                  <div className="flex flex-col items-center justify-center space-y-3 text-muted-foreground">
                    <div className="w-11 h-11 rounded-xl bg-muted/50 flex items-center justify-center">
                      <Activity className="w-5 h-5 opacity-30" />
                    </div>
                    <div>
                      <p className="font-medium text-sm text-foreground">
                        No logs found
                      </p>
                      <p className="text-xs mt-0.5">
                        {search || typeFilter !== "all"
                          ? "Try adjusting your filters"
                          : "Activity will appear here as the system runs"}
                      </p>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((log) => (
                <TableRow
                  key={log.id}
                  className="border-border/20 transition-colors group"
                >
                  <TableCell className="text-sm text-muted-foreground font-mono whitespace-nowrap group-hover:text-foreground/70 transition-colors">
                    {format(new Date(log.createdAt), "MMM dd, HH:mm:ss")}
                  </TableCell>
                  <TableCell>
                    <TypeBadge type={log.type} />
                  </TableCell>
                  <TableCell className="text-sm text-foreground/90">
                    {log.message}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {/* Footer count */}
        {!isLoading && filtered.length > 0 && (
          <div className="px-4 py-2 border-t border-border/20 bg-muted/10 text-xs text-muted-foreground flex items-center justify-between">
            <span>
              {typeFilter !== "all" || search
                ? `${filtered.length} of ${logs?.length ?? 0} events`
                : `${filtered.length} events`}
            </span>
            {(typeFilter !== "all" || search) && (
              <button
                className="text-primary hover:underline"
                onClick={() => { setTypeFilter("all"); setSearch(""); }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
