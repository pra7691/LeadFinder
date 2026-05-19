import {
  useGetLead,
  useUpdateLead,
  useListLeadLists,
  useAddLeadsToList,
  getGetLeadQueryKey,
} from "@workspace/api-client-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  Globe,
  Mail,
  Phone,
  MapPin,
  Linkedin,
  Star,
  ThumbsUp,
  ThumbsDown,
  Plus,
  Loader2,
  ExternalLink,
  Tag,
  Search as SearchIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

interface LeadDetailDrawerProps {
  leadId: number | null;
  onClose: () => void;
  onLeadUpdate?: () => void;
}

function QualBadge({ status }: { status: string | null | undefined }) {
  const map: Record<string, string> = {
    qualified: "bg-emerald-500/10 text-emerald-600",
    rejected: "bg-red-500/10 text-red-500",
    unqualified: "bg-muted/50 text-muted-foreground",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium", map[status ?? "unqualified"] ?? map.unqualified)}>
      {status ?? "unreviewed"}
    </span>
  );
}

function OutreachBadge({ status }: { status: string | null | undefined }) {
  const map: Record<string, string> = {
    not_queued: "bg-muted/50 text-muted-foreground",
    queued: "bg-blue-500/10 text-blue-500",
    contacted: "bg-violet-500/10 text-violet-600",
    followup_sent: "bg-amber-500/10 text-amber-600",
    closed: "bg-emerald-500/10 text-emerald-600",
  };
  const label = (status ?? "not_queued").replace("_", " ");
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium capitalize", map[status ?? "not_queued"] ?? map.not_queued)}>
      {label}
    </span>
  );
}

export function LeadDetailDrawer({ leadId, onClose, onLeadUpdate }: LeadDetailDrawerProps) {
  const { data: lead, isLoading } = useGetLead(leadId ?? 0, {
    query: { queryKey: getGetLeadQueryKey(leadId ?? 0), enabled: !!leadId },
  });
  const updateLead = useUpdateLead();
  const { data: lists } = useListLeadLists();
  const addToList = useAddLeadsToList();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState("");
  const [addToListOpen, setAddToListOpen] = useState(false);

  const handleQualify = (status: "qualified" | "rejected") => {
    if (!lead) return;
    updateLead.mutate(
      { id: lead.id, data: { qualificationStatus: status } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries();
          onLeadUpdate?.();
          toast({ title: `Lead marked as ${status}.` });
        },
        onError: () => toast({ title: "Failed to update lead.", variant: "destructive" }),
      },
    );
  };

  const handleSaveNotes = () => {
    if (!lead) return;
    updateLead.mutate(
      { id: lead.id, data: { notes } },
      {
        onSuccess: () => {
          setEditingNotes(false);
          queryClient.invalidateQueries();
          onLeadUpdate?.();
          toast({ title: "Notes saved." });
        },
        onError: () => toast({ title: "Failed to save notes.", variant: "destructive" }),
      },
    );
  };

  const handleAddToList = (listId: number) => {
    if (!lead) return;
    addToList.mutate(
      { id: listId, data: { leadIds: [lead.id] } },
      {
        onSuccess: (result) => {
          toast({ title: `Added to list (${result.added} new).` });
          setAddToListOpen(false);
        },
        onError: () => toast({ title: "Failed to add to list.", variant: "destructive" }),
      },
    );
  };

  const openNotes = () => {
    setNotes(lead?.notes ?? "");
    setEditingNotes(true);
  };

  return (
    <>
      <Sheet open={!!leadId} onOpenChange={(o) => { if (!o) onClose(); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto flex flex-col gap-0 p-0 bg-background/95 backdrop-blur-xl border-l border-border/50">
          <SheetHeader className="px-6 py-5 border-b border-border/30 shrink-0">
            {isLoading || !lead ? (
              <div className="space-y-2 animate-pulse">
                <div className="h-6 w-48 bg-muted/40 rounded-lg" />
                <div className="h-4 w-32 bg-muted/30 rounded" />
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <SheetTitle className="text-lg font-semibold leading-tight">
                    {lead.companyName || <span className="italic text-muted-foreground/60 font-normal text-base">Pending crawl</span>}
                  </SheetTitle>
                  {lead.websiteUrl && (
                    <a
                      href={lead.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline flex items-center gap-1 mt-0.5 w-fit"
                    >
                      {lead.rootDomain}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <QualBadge status={lead.qualificationStatus} />
                  <OutreachBadge status={lead.outreachStatus} />
                </div>
              </div>
            )}
          </SheetHeader>

          {!isLoading && lead && (
            <div className="flex-1 overflow-y-auto">
              {/* Quick actions */}
              <div className="px-6 py-4 border-b border-border/20 flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant={lead.qualificationStatus === "qualified" ? "default" : "outline"}
                  className="rounded-xl gap-1.5 h-8 text-xs"
                  onClick={() => handleQualify("qualified")}
                  disabled={lead.qualificationStatus === "qualified" || updateLead.isPending}
                >
                  <ThumbsUp className="w-3.5 h-3.5" /> Qualify
                </Button>
                <Button
                  size="sm"
                  variant={lead.qualificationStatus === "rejected" ? "destructive" : "outline"}
                  className="rounded-xl gap-1.5 h-8 text-xs"
                  onClick={() => handleQualify("rejected")}
                  disabled={lead.qualificationStatus === "rejected" || updateLead.isPending}
                >
                  <ThumbsDown className="w-3.5 h-3.5" /> Reject
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl gap-1.5 h-8 text-xs"
                  onClick={() => setAddToListOpen(true)}
                >
                  <Plus className="w-3.5 h-3.5" /> Add to List
                </Button>
              </div>

              {/* Detail fields */}
              <div className="px-6 py-5 space-y-5">
                {/* Contact info */}
                <section className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contact</h4>
                  <div className="space-y-2">
                    {lead.emails && (
                      <div className="flex items-start gap-2.5 text-sm">
                        <Mail className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                        <span className="break-all">{lead.emails}</span>
                      </div>
                    )}
                    {lead.phoneNumbers && (
                      <div className="flex items-start gap-2.5 text-sm">
                        <Phone className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                        <span>{lead.phoneNumbers}</span>
                      </div>
                    )}
                    {lead.address && (
                      <div className="flex items-start gap-2.5 text-sm">
                        <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                        <span>{lead.address}</span>
                      </div>
                    )}
                    {lead.country && (
                      <div className="flex items-start gap-2.5 text-sm">
                        <Globe className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                        <span className="text-muted-foreground">Company Country: <span className="text-foreground">{lead.country}</span></span>
                      </div>
                    )}
                    {(lead.emailDomainStatus === "external_domain" || lead.emailDomainStatus === "mixed") && (
                      <div className="flex items-start gap-2 text-xs text-amber-600 bg-amber-500/10 rounded-xl px-3 py-2 mt-1">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>
                          {lead.emailDomainStatus === "external_domain"
                            ? "Emails are from a different domain — verify before outreach."
                            : "Some emails are from external domains — matching-domain ones are shown."}
                        </span>
                      </div>
                    )}
                    {lead.linkedinUrl && (
                      <div className="flex items-start gap-2.5 text-sm">
                        <Linkedin className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                        <a href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">
                          LinkedIn Profile
                        </a>
                      </div>
                    )}
                    {!lead.emails && !lead.phoneNumbers && !lead.address && !lead.country && !lead.linkedinUrl && (
                      <p className="text-sm text-muted-foreground italic">No contact info crawled yet.</p>
                    )}
                  </div>
                </section>

                {/* Relevance */}
                <section className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Relevance</h4>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Star className="w-4 h-4 text-amber-400 shrink-0" />
                      <span className="font-semibold">{lead.relevanceScore ?? 0}</span>
                      <span className="text-muted-foreground">/ 100</span>
                    </div>
                    {lead.relevanceReason && (
                      <p className="text-sm text-muted-foreground leading-relaxed">{lead.relevanceReason}</p>
                    )}
                  </div>
                </section>

                {/* Source */}
                <section className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Source</h4>
                  <div className="space-y-2">
                    {lead.sourceQuery && (
                      <div className="flex items-start gap-2.5 text-sm">
                        <SearchIcon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                        <span className="text-muted-foreground">Query: <span className="text-foreground">{lead.sourceQuery}</span></span>
                      </div>
                    )}
                    {lead.sourceKeyword && (
                      <div className="flex items-start gap-2.5 text-sm">
                        <Tag className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                        <span className="text-muted-foreground">Keyword: <span className="text-foreground">{lead.sourceKeyword}</span></span>
                      </div>
                    )}
                    {lead.sourceCountry && (
                      <div className="flex items-start gap-2.5 text-sm">
                        <Globe className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                        <span className="text-muted-foreground">Target Country: <span className="text-foreground">{lead.sourceCountry}</span></span>
                      </div>
                    )}
                  </div>
                </section>

                {/* Status */}
                <section className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</h4>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Lead Type", value: (lead.leadType ?? "company").replace("_", " ") },
                      { label: "Crawl", value: lead.crawlStatus ?? "pending" },
                      { label: "Lead", value: lead.leadStatus },
                      { label: "Qualification", value: lead.qualificationStatus },
                      { label: "Outreach", value: (lead.outreachStatus ?? "not_queued").replace("_", " ") },
                    ].map((f) => (
                      <div key={f.label} className="bg-muted/20 rounded-xl px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">{f.label}</p>
                        <p className="text-xs font-medium capitalize">{f.value}</p>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Notes */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notes</h4>
                    {!editingNotes && (
                      <button onClick={openNotes} className="text-[11px] text-primary hover:underline">
                        {lead.notes ? "Edit" : "Add note"}
                      </button>
                    )}
                  </div>
                  {editingNotes ? (
                    <div className="space-y-2">
                      <Textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className="rounded-xl bg-background/50 resize-none min-h-[100px] text-sm"
                        placeholder="Add notes about this lead…"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" className="rounded-xl h-7 text-xs" onClick={handleSaveNotes} disabled={updateLead.isPending}>
                          {updateLead.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                        </Button>
                        <Button size="sm" variant="ghost" className="rounded-xl h-7 text-xs" onClick={() => setEditingNotes(false)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {lead.notes || <span className="italic">No notes yet.</span>}
                    </p>
                  )}
                </section>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Add to List dialog */}
      <Dialog open={addToListOpen} onOpenChange={setAddToListOpen}>
        <DialogContent className="sm:max-w-[360px] rounded-2xl border-border/50 bg-background/80 backdrop-blur-2xl">
          <DialogHeader>
            <DialogTitle>Add to List</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 mt-2">
            {!lists?.length ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No lists yet — create one in the Lists section first.
              </p>
            ) : (
              lists.map((list) => (
                <button
                  key={list.id}
                  onClick={() => handleAddToList(list.id)}
                  disabled={addToList.isPending}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-colors text-left"
                >
                  <div>
                    <p className="text-sm font-medium">{list.name}</p>
                    {list.description && (
                      <p className="text-xs text-muted-foreground">{list.description}</p>
                    )}
                  </div>
                  {addToList.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Plus className="w-4 h-4 text-muted-foreground" />
                  )}
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
