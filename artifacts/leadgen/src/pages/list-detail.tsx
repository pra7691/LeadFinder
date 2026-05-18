import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  useGetLeadList,
  getGetLeadListQueryKey,
  useGetListLeads,
  getGetListLeadsQueryKey,
  useRemoveLeadFromList,
  useUpdateLeadList,
  getListLeadListsQueryKey,
} from "@workspace/api-client-react";
import type { Lead } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft,
  Users,
  Archive,
  RefreshCw,
  Trash2,
  ExternalLink,
  Mail,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const REVIEW_BADGE: Record<string, { label: string; className: string }> = {
  pending:   { label: "Pending",  className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  approved:  { label: "Approved", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  rejected:  { label: "Rejected", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

const QUAL_BADGE: Record<string, { label: string; className: string }> = {
  unqualified: { label: "Unqualified", className: "bg-muted text-muted-foreground" },
  qualified:   { label: "Qualified",   className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  rejected:    { label: "Rejected",    className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

function LeadRow({ lead, listId, onRemoved }: { lead: Lead; listId: number; onRemoved: () => void }) {
  const { toast } = useToast();
  const removeMut = useRemoveLeadFromList();

  const handleRemove = () => {
    if (!confirm(`Remove "${lead.companyName}" from this list?`)) return;
    removeMut.mutate(
      { id: listId, leadId: lead.id },
      {
        onSuccess: () => {
          toast({ title: "Lead removed from list" });
          onRemoved();
        },
        onError: () => toast({ title: "Failed to remove lead", variant: "destructive" }),
      },
    );
  };

  const rev = REVIEW_BADGE[lead.reviewStatus] ?? { label: lead.reviewStatus, className: "bg-muted text-muted-foreground" };
  const qual = QUAL_BADGE[lead.qualificationStatus] ?? { label: lead.qualificationStatus, className: "bg-muted text-muted-foreground" };

  return (
    <tr className="border-b border-border/50 hover:bg-muted/20 transition-colors">
      <td className="py-3 px-4">
        <div className="font-medium text-sm">{lead.companyName}</div>
        <a
          href={lead.websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:text-primary flex items-center gap-0.5 w-fit"
        >
          {lead.rootDomain}
          <ExternalLink className="w-2.5 h-2.5" />
        </a>
      </td>
      <td className="py-3 px-4 text-sm text-muted-foreground">{lead.country ?? "—"}</td>
      <td className="py-3 px-4">
        <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", rev.className)}>
          {rev.label}
        </span>
      </td>
      <td className="py-3 px-4">
        <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", qual.className)}>
          {qual.label}
        </span>
      </td>
      <td className="py-3 px-4 text-sm">
        {lead.emails ? (
          <a
            href={`mailto:${lead.emails.split(",")[0]?.trim()}`}
            className="flex items-center gap-1 text-primary hover:underline text-xs"
          >
            <Mail className="w-3 h-3" />
            {lead.emails.split(",")[0]?.trim()}
          </a>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-1">
          <span className="text-xs font-mono text-muted-foreground">
            {lead.relevanceScore ?? "—"}
          </span>
        </div>
      </td>
      <td className="py-3 px-4">
        <Button
          variant="ghost"
          size="icon"
          className="w-7 h-7 rounded-lg text-destructive hover:bg-destructive/10"
          onClick={handleRemove}
          disabled={removeMut.isPending}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </td>
    </tr>
  );
}

export function ListDetail() {
  const params = useParams<{ id: string }>();
  const listId = Number(params.id);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: list, isLoading: listLoading } = useGetLeadList(listId, {
    query: { staleTime: 10_000, queryKey: getGetLeadListQueryKey(listId) },
  });
  const { data: leads, isLoading: leadsLoading } = useGetListLeads(listId, {
    query: { staleTime: 10_000, queryKey: getGetListLeadsQueryKey(listId) },
  });

  const updateMut = useUpdateLeadList();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetLeadListQueryKey(listId) });
    qc.invalidateQueries({ queryKey: getGetListLeadsQueryKey(listId) });
    qc.invalidateQueries({ queryKey: getListLeadListsQueryKey() });
  };

  const handleArchive = () => {
    if (!list) return;
    const next = list.listStatus === "active" ? "archived" : "active";
    updateMut.mutate(
      { id: listId, data: { listStatus: next as "active" | "archived" } },
      {
        onSuccess: () => {
          toast({ title: next === "archived" ? "List archived" : "List restored" });
          invalidate();
        },
      },
    );
  };

  if (listLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 bg-muted rounded w-48" />
        <div className="h-32 bg-muted rounded-2xl" />
      </div>
    );
  }

  if (!list) {
    return (
      <div className="text-center py-24">
        <p className="text-muted-foreground">List not found.</p>
        <Link href="/lists" className="text-primary hover:underline text-sm mt-2 block">
          Back to Lists
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/lists"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ChevronLeft className="w-4 h-4" />
          Lists
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{list.name}</h1>
              {list.listStatus === "archived" && (
                <Badge variant="secondary" className="text-xs">Archived</Badge>
              )}
            </div>
            {list.description && (
              <p className="text-sm text-muted-foreground mt-1">{list.description}</p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-2 shrink-0"
            onClick={handleArchive}
            disabled={updateMut.isPending}
          >
            {list.listStatus === "active" ? (
              <><Archive className="w-3.5 h-3.5" />Archive</>
            ) : (
              <><RefreshCw className="w-3.5 h-3.5" />Restore</>
            )}
          </Button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="flex items-center gap-6">
        <div className="glass-card rounded-xl px-4 py-3 flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">{list.leadCount}</span>
          <span className="text-xs text-muted-foreground">leads</span>
        </div>
        {list.campaignName && (
          <div className="glass-card rounded-xl px-4 py-3">
            <span className="text-xs text-muted-foreground">Campaign: </span>
            <span className="text-sm font-medium">{list.campaignName}</span>
          </div>
        )}
      </div>

      {/* Leads table */}
      <div className="glass-card rounded-2xl overflow-hidden">
        {leadsLoading ? (
          <div className="p-8 space-y-3 animate-pulse">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 bg-muted rounded-lg" />
            ))}
          </div>
        ) : (leads ?? []).length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
              <Users className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="font-medium">No leads in this list</p>
            <p className="text-sm text-muted-foreground mt-1">
              Add leads from the Leads page using "Add to list".
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="py-3 px-4 text-left text-xs font-medium text-muted-foreground">Company</th>
                  <th className="py-3 px-4 text-left text-xs font-medium text-muted-foreground">Country</th>
                  <th className="py-3 px-4 text-left text-xs font-medium text-muted-foreground">Review</th>
                  <th className="py-3 px-4 text-left text-xs font-medium text-muted-foreground">Qualification</th>
                  <th className="py-3 px-4 text-left text-xs font-medium text-muted-foreground">Email</th>
                  <th className="py-3 px-4 text-left text-xs font-medium text-muted-foreground">Score</th>
                  <th className="py-3 px-4" />
                </tr>
              </thead>
              <tbody>
                {(leads ?? []).map((lead) => (
                  <LeadRow
                    key={lead.id}
                    lead={lead}
                    listId={listId}
                    onRemoved={invalidate}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
