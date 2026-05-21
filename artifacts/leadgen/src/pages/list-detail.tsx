import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  useGetLeadList,
  getGetLeadListQueryKey,
  useGetListLeads,
  getGetListLeadsQueryKey,
  useRemoveLeadFromList,
  useUpdateLeadList,
  useOutreachFromList,
  useListEmailTemplates,
  useListEmailAccounts,
  useGetListHealth,
  getGetListHealthQueryKey,
  getListEmailAccountsQueryKey,
  getListLeadListsQueryKey,
  getListEmailTemplatesQueryKey,
} from "@workspace/api-client-react";
import type { Lead } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  Users,
  Archive,
  RefreshCw,
  Trash2,
  ExternalLink,
  Mail,
  Send,
  Loader2,
  CheckCircle2,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  UserCheck,
  UserX,
  Copy,
  Zap,
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

function HealthTile({
  label,
  value,
  icon,
  colorClass = "text-foreground",
  bgClass = "bg-muted/30",
  suffix,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  colorClass?: string;
  bgClass?: string;
  suffix?: string;
}) {
  return (
    <div className={cn("rounded-xl p-3 flex items-center gap-3", bgClass)}>
      <div className={cn("shrink-0", colorClass)}>{icon}</div>
      <div className="min-w-0">
        <div className={cn("text-xl font-semibold leading-tight", colorClass)}>
          {value}{suffix}
        </div>
        <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{label}</div>
      </div>
    </div>
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
  const { data: health, isLoading: healthLoading } = useGetListHealth(listId, {
    query: { staleTime: 30_000, enabled: !isNaN(listId), queryKey: ["lists", listId, "health"] },
  });
  const { data: templates } = useListEmailTemplates(
    { includeInactive: false },
    { query: { queryKey: getListEmailTemplatesQueryKey({ includeInactive: false }), staleTime: 30_000 } },
  );
  const { data: emailAccounts } = useListEmailAccounts({
    query: { queryKey: getListEmailAccountsQueryKey(), staleTime: 30_000 },
  });

  const updateMut = useUpdateLeadList();
  const outreachFromListMut = useOutreachFromList();

  const [outreachOpen, setOutreachOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [outreachResult, setOutreachResult] = useState<{ queued: number; skipped: number } | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetLeadListQueryKey(listId) });
    qc.invalidateQueries({ queryKey: getGetListLeadsQueryKey(listId) });
    qc.invalidateQueries({ queryKey: getGetListHealthQueryKey(listId) });
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

  const handleCreateOutreach = () => {
    if (!selectedTemplateId) return;
    outreachFromListMut.mutate(
      {
        data: {
          listId,
          emailTemplateId: Number(selectedTemplateId),
          emailAccountId: selectedAccountId ? Number(selectedAccountId) : undefined,
        },
      },
      {
        onSuccess: (r) => {
          setOutreachResult({ queued: r.queued, skipped: r.skipped });
          qc.invalidateQueries({ queryKey: ["outreach"] });
          toast({ title: `Queued ${r.queued} outreach drafts (${r.skipped} skipped — no email)` });
        },
        onError: () => toast({ title: "Failed to create outreach", variant: "destructive" }),
      },
    );
  };

  const activeTemplates = (templates ?? []).filter((t) => t.isActive);

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

  const hasHealthIssues =
    (health?.riskyEmails ?? 0) > 0 || (health?.duplicateEmails ?? 0) > 0;

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
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              className="rounded-xl gap-2"
              onClick={() => { setOutreachOpen(true); setOutreachResult(null); }}
              disabled={(list.leadCount ?? 0) === 0}
              data-testid="button-create-outreach"
            >
              <Send className="w-3.5 h-3.5" /> Create Outreach
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl gap-2"
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
      </div>

      {/* Stats strip */}
      <div className="flex items-center gap-6 flex-wrap">
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
        {hasHealthIssues && (
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 text-xs font-medium">
            <AlertTriangle className="w-3.5 h-3.5" />
            Health issues detected
          </div>
        )}
      </div>

      {/* List Health */}
      <Card className="glass-card border-border/50">
        <CardHeader className="border-b border-border/30 pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" /> List Health
            </CardTitle>
            {health && (
              <div className="flex items-center gap-1.5">
                {health.riskyEmails === 0 && health.duplicateEmails === 0 ? (
                  <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" /> All clear
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5" /> Action needed
                  </span>
                )}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {healthLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-16 bg-muted/30 animate-pulse rounded-xl" />
              ))}
            </div>
          ) : health ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <HealthTile
                  label="Total leads"
                  value={health.totalLeads}
                  icon={<Users className="w-4 h-4" />}
                />
                <HealthTile
                  label="With email"
                  value={health.leadsWithEmail}
                  icon={<Mail className="w-4 h-4" />}
                  colorClass="text-green-600"
                  bgClass="bg-green-500/10"
                />
                <HealthTile
                  label="No email"
                  value={health.leadsWithoutEmail}
                  icon={<AlertCircle className="w-4 h-4" />}
                  colorClass={health.leadsWithoutEmail > 0 ? "text-amber-500" : "text-muted-foreground"}
                  bgClass={health.leadsWithoutEmail > 0 ? "bg-amber-500/10" : "bg-muted/30"}
                />
                <HealthTile
                  label="Qualified"
                  value={health.qualifiedLeads}
                  icon={<UserCheck className="w-4 h-4" />}
                  colorClass="text-blue-500"
                  bgClass="bg-blue-500/10"
                />
                <HealthTile
                  label="Rejected"
                  value={health.rejectedLeads}
                  icon={<UserX className="w-4 h-4" />}
                  colorClass={health.rejectedLeads > 0 ? "text-destructive" : "text-muted-foreground"}
                  bgClass={health.rejectedLeads > 0 ? "bg-destructive/10" : "bg-muted/30"}
                />
                <HealthTile
                  label="Duplicate emails"
                  value={health.duplicateEmails}
                  icon={<Copy className="w-4 h-4" />}
                  colorClass={health.duplicateEmails > 0 ? "text-destructive" : "text-muted-foreground"}
                  bgClass={health.duplicateEmails > 0 ? "bg-destructive/10" : "bg-muted/30"}
                />
                <HealthTile
                  label="Risky emails"
                  value={health.riskyEmails}
                  icon={<AlertTriangle className="w-4 h-4" />}
                  colorClass={health.riskyEmails > 0 ? "text-destructive" : "text-muted-foreground"}
                  bgClass={health.riskyEmails > 0 ? "bg-destructive/10" : "bg-muted/30"}
                />
                <HealthTile
                  label="Generic emails"
                  value={health.genericEmails}
                  icon={<Mail className="w-4 h-4" />}
                  colorClass={health.genericEmails > 0 ? "text-amber-500" : "text-muted-foreground"}
                  bgClass={health.genericEmails > 0 ? "bg-amber-500/10" : "bg-muted/30"}
                />
              </div>
              {/* Outreach queue summary */}
              {(health.pendingReviewDrafts > 0 || health.approvedDrafts > 0 || health.aiPersonalizedDrafts > 0) && (
                <div className="pt-3 border-t border-border/30">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Outreach Queue</p>
                  <div className="grid grid-cols-3 gap-3">
                    <HealthTile
                      label="Pending review"
                      value={health.pendingReviewDrafts}
                      icon={<ShieldCheck className="w-4 h-4" />}
                      colorClass={health.pendingReviewDrafts > 0 ? "text-amber-500" : "text-muted-foreground"}
                      bgClass={health.pendingReviewDrafts > 0 ? "bg-amber-500/10" : "bg-muted/30"}
                    />
                    <HealthTile
                      label="Approved"
                      value={health.approvedDrafts}
                      icon={<CheckCircle2 className="w-4 h-4" />}
                      colorClass="text-green-600"
                      bgClass="bg-green-500/10"
                    />
                    <HealthTile
                      label="AI personalized"
                      value={health.aiPersonalizedDrafts}
                      icon={<Zap className="w-4 h-4" />}
                      colorClass="text-blue-500"
                      bgClass="bg-blue-500/10"
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">Health data unavailable.</p>
          )}
        </CardContent>
      </Card>

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

      {/* Create Outreach modal */}
      <Dialog open={outreachOpen} onOpenChange={(v) => { if (!v) { setOutreachOpen(false); setOutreachResult(null); } }}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="w-4 h-4 text-primary" /> Create Outreach From List
            </DialogTitle>
            <DialogDescription>
              Queue draft outreach emails for all leads in <strong>{list.name}</strong> using a template. Leads without an email address will be skipped.
            </DialogDescription>
          </DialogHeader>

          {outreachResult ? (
            <div className="space-y-4">
              <div className="flex flex-col items-center py-6 gap-3 text-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                <div>
                  <p className="text-lg font-semibold">{outreachResult.queued} drafts created</p>
                  {outreachResult.skipped > 0 && (
                    <p className="text-sm text-muted-foreground mt-1">{outreachResult.skipped} leads skipped (no email or already queued).</p>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Review and approve them in the{" "}
                  <Link href="/outreach-review" className="text-primary hover:underline">Review Queue</Link>.
                </p>
              </div>
              <DialogFooter>
                <Button onClick={() => { setOutreachOpen(false); setOutreachResult(null); }} className="w-full rounded-xl">Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Email Template *</Label>
                {activeTemplates.length === 0 ? (
                  <p className="text-sm text-muted-foreground rounded-xl border border-border/50 px-4 py-3">
                    No active templates. <a href="/email-templates" className="text-primary hover:underline">Create one first.</a>
                  </p>
                ) : (
                  <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                    <SelectTrigger className="rounded-xl" data-testid="select-template">
                      <SelectValue placeholder="Select a template…" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeTemplates.map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Sending Account <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                  <SelectTrigger className="rounded-xl" data-testid="select-account">
                    <SelectValue placeholder="Assign later in Review Queue" />
                  </SelectTrigger>
                  <SelectContent>
                    {(emailAccounts ?? []).map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.name} ({a.email})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <DialogFooter className="pt-2">
                <Button variant="ghost" onClick={() => setOutreachOpen(false)}>Cancel</Button>
                <Button
                  onClick={handleCreateOutreach}
                  disabled={!selectedTemplateId || outreachFromListMut.isPending}
                  className="gap-2"
                  data-testid="button-confirm-outreach"
                >
                  {outreachFromListMut.isPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</>
                  ) : (
                    <><Send className="w-4 h-4" /> Create Outreach Drafts</>
                  )}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
