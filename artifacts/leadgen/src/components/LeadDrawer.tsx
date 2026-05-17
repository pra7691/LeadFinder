import { useState } from "react";
import {
  useGetLead,
  useUpdateLead,
  useListLeadNotes,
  useAddLeadNote,
  useGetLeadStatusHistory,
  getListLeadsQueryKey,
  getGetLeadQueryKey,
  getListLeadNotesQueryKey,
  getGetLeadStatusHistoryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Globe,
  Mail,
  Phone,
  MapPin,
  Linkedin,
  Check,
  X,
  MessageSquare,
  Activity,
  Edit3,
  Save,
  ExternalLink,
  Loader2,
  SendHorizonal,
  Archive,
  AlertTriangle,
  Clock,
  BadgeCheck,
} from "lucide-react";
import { ScoreBadge } from "./ScoreBadge";

// ── Types ──────────────────────────────────────────────────────────────────

type DrawerTab = "overview" | "activity" | "edit";

interface Props {
  leadId: number | null;
  onClose: () => void;
}

// ── Status helpers ─────────────────────────────────────────────────────────

const LEAD_STATUS_META: Record<
  string,
  { label: string; color: string }
> = {
  discovered:     { label: "Discovered",     color: "bg-slate-500/10 text-slate-400" },
  crawled:        { label: "Crawled",         color: "bg-sky-500/10 text-sky-400" },
  scored:         { label: "Scored",          color: "bg-violet-500/10 text-violet-400" },
  approved:       { label: "Approved",        color: "bg-emerald-500/10 text-emerald-400" },
  rejected:       { label: "Rejected",        color: "bg-red-500/10 text-red-400" },
  contacted:      { label: "Contacted",       color: "bg-blue-500/10 text-blue-400" },
  followup_sent:  { label: "Follow-up Sent",  color: "bg-indigo-500/10 text-indigo-400" },
  invalid:        { label: "Invalid",         color: "bg-orange-500/10 text-orange-400" },
  archived:       { label: "Archived",        color: "bg-muted text-muted-foreground" },
  new:            { label: "New",             color: "bg-slate-500/10 text-slate-400" },
};

const REVIEW_STATUS_META: Record<string, { label: string; color: string }> = {
  pending:       { label: "Pending Review",  color: "bg-amber-500/10 text-amber-500" },
  approved:      { label: "Approved",         color: "bg-emerald-500/10 text-emerald-400" },
  rejected:      { label: "Rejected",         color: "bg-red-500/10 text-red-400" },
  low_relevance: { label: "Low Relevance",    color: "bg-orange-500/10 text-orange-400" },
};

function StatusChip({ status, meta }: { status: string; meta: Record<string, { label: string; color: string }> }) {
  const m = meta[status] ?? { label: status, color: "bg-muted text-muted-foreground" };
  return (
    <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${m.color}`}>
      {m.label}
    </span>
  );
}

// ── Contact quality ────────────────────────────────────────────────────────

function contactQualityBadge(emails?: string | null, phones?: string | null, linkedin?: string | null) {
  const hasEmail = !!emails;
  const hasPhone = !!phones;
  const hasLinkedin = !!linkedin;
  if (hasEmail && hasPhone && hasLinkedin) return { label: "Excellent", color: "text-emerald-400" };
  if (hasEmail && (hasPhone || hasLinkedin)) return { label: "Good", color: "text-sky-400" };
  if (hasEmail) return { label: "Email only", color: "text-amber-500" };
  if (hasPhone) return { label: "Phone only", color: "text-orange-400" };
  return { label: "No contact", color: "text-muted-foreground" };
}

// ── Timeline Entry ─────────────────────────────────────────────────────────

function TimelineEntry({
  icon,
  label,
  sub,
  time,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  time: string;
  accent?: string;
}) {
  return (
    <div className="flex gap-3 items-start">
      <div className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${accent ?? "bg-muted/50 text-muted-foreground"}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground leading-snug">{label}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{sub}</p>}
      </div>
      <span className="text-[11px] text-muted-foreground/60 shrink-0 mt-0.5">
        {new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
      </span>
    </div>
  );
}

// ── Main Drawer ────────────────────────────────────────────────────────────

export function LeadDrawer({ leadId, onClose }: Props) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<DrawerTab>("overview");
  const [noteText, setNoteText] = useState("");
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingNote, setIsAddingNote] = useState(false);

  const { data: lead, isLoading } = useGetLead(leadId ?? 0, {
    query: { enabled: !!leadId, queryKey: getGetLeadQueryKey(leadId ?? 0) },
  });
  const { data: notes } = useListLeadNotes(leadId ?? 0, {
    query: { enabled: !!leadId && tab === "activity", queryKey: getListLeadNotesQueryKey(leadId ?? 0) },
  });
  const { data: history } = useGetLeadStatusHistory(leadId ?? 0, {
    query: { enabled: !!leadId && tab === "activity", queryKey: getGetLeadStatusHistoryQueryKey(leadId ?? 0) },
  });

  const updateLead = useUpdateLead();
  const addNote = useAddLeadNote();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListLeadsQueryKey() });
    if (leadId) {
      qc.invalidateQueries({ queryKey: getGetLeadQueryKey(leadId) });
    }
  };

  const invalidateNotes = () => {
    if (leadId) {
      qc.invalidateQueries({ queryKey: getListLeadNotesQueryKey(leadId) });
      qc.invalidateQueries({ queryKey: getGetLeadStatusHistoryQueryKey(leadId) });
    }
  };

  // Quick status action
  const applyAction = (patch: { leadStatus?: string; reviewStatus?: string }) => {
    if (!leadId) return;
    updateLead.mutate({ id: leadId, data: patch }, { onSuccess: invalidate });
  };

  // Save edit form
  const handleSave = () => {
    if (!leadId) return;
    setIsSaving(true);
    updateLead.mutate(
      { id: leadId, data: editForm },
      {
        onSuccess: () => {
          setIsSaving(false);
          invalidate();
          setTab("overview");
        },
        onError: () => setIsSaving(false),
      },
    );
  };

  // Add note
  const handleAddNote = () => {
    if (!leadId || !noteText.trim()) return;
    setIsAddingNote(true);
    addNote.mutate(
      { id: leadId, data: { content: noteText.trim() } },
      {
        onSuccess: () => {
          setNoteText("");
          setIsAddingNote(false);
          invalidateNotes();
        },
        onError: () => setIsAddingNote(false),
      },
    );
  };

  // Open edit tab with current values pre-filled
  const openEdit = () => {
    if (!lead) return;
    setEditForm({
      companyName: lead.companyName ?? "",
      emails: lead.emails ?? "",
      phoneNumbers: lead.phoneNumbers ?? "",
      address: lead.address ?? "",
      linkedinUrl: lead.linkedinUrl ?? "",
      notes: lead.notes ?? "",
    });
    setTab("edit");
  };

  const quality = lead
    ? contactQualityBadge(lead.emails, lead.phoneNumbers, lead.linkedinUrl)
    : null;

  // Merge notes + history for timeline, sorted by createdAt
  const timeline = [
    ...(notes ?? []).map((n) => ({
      kind: "note" as const,
      id: `note-${n.id}`,
      time: n.createdAt,
      content: n.content,
      author: n.authorName,
    })),
    ...(history ?? []).map((h) => ({
      kind: "status" as const,
      id: `hist-${h.id}`,
      time: h.createdAt,
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      fromReviewStatus: h.fromReviewStatus,
      toReviewStatus: h.toReviewStatus,
      note: h.note,
    })),
  ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  return (
    <Sheet open={!!leadId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[520px] p-0 flex flex-col bg-background/95 backdrop-blur-xl border-l border-border/50"
      >
        {isLoading || !lead ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Header */}
            <SheetHeader className="px-6 pt-6 pb-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <SheetTitle className="text-lg font-semibold leading-tight truncate">
                    {lead.companyName}
                  </SheetTitle>
                  <a
                    href={`https://${lead.rootDomain}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors mt-0.5"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    {lead.rootDomain}
                    <ExternalLink className="w-3 h-3 opacity-50" />
                  </a>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 rounded-full"
                  onClick={onClose}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Status row */}
              <div className="flex items-center gap-2 flex-wrap">
                <StatusChip status={lead.leadStatus} meta={LEAD_STATUS_META} />
                <StatusChip status={lead.reviewStatus} meta={REVIEW_STATUS_META} />
                {lead.relevanceScore != null && (
                  <ScoreBadge score={lead.relevanceScore} reason={lead.relevanceReason} />
                )}
                {quality && (
                  <span className={`text-[11px] font-medium ${quality.color}`}>
                    <BadgeCheck className="w-3 h-3 inline mr-1" />
                    {quality.label}
                  </span>
                )}
              </div>

              {/* Quick actions */}
              <div className="flex gap-2 flex-wrap">
                {lead.reviewStatus !== "approved" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-3 text-xs rounded-lg gap-1.5 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10"
                    onClick={() =>
                      applyAction({ leadStatus: "approved", reviewStatus: "approved" })
                    }
                  >
                    <Check className="w-3 h-3" /> Approve
                  </Button>
                )}
                {lead.reviewStatus !== "rejected" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-3 text-xs rounded-lg gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() =>
                      applyAction({ leadStatus: "rejected", reviewStatus: "rejected" })
                    }
                  >
                    <X className="w-3 h-3" /> Reject
                  </Button>
                )}
                {lead.leadStatus !== "contacted" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-3 text-xs rounded-lg gap-1.5"
                    onClick={() => applyAction({ leadStatus: "contacted" })}
                  >
                    <SendHorizonal className="w-3 h-3" /> Mark Contacted
                  </Button>
                )}
                {lead.leadStatus !== "invalid" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-3 text-xs rounded-lg gap-1.5 text-orange-400 border-orange-400/30 hover:bg-orange-400/10"
                    onClick={() => applyAction({ leadStatus: "invalid" })}
                  >
                    <AlertTriangle className="w-3 h-3" /> Invalid
                  </Button>
                )}
                {lead.leadStatus !== "archived" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-3 text-xs rounded-lg gap-1.5 text-muted-foreground"
                    onClick={() => applyAction({ leadStatus: "archived" })}
                  >
                    <Archive className="w-3 h-3" /> Archive
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-3 text-xs rounded-lg gap-1.5 ml-auto"
                  onClick={openEdit}
                >
                  <Edit3 className="w-3 h-3" /> Edit
                </Button>
              </div>

              {/* Tabs */}
              <div className="flex gap-0 border-b border-border/40 -mx-0">
                {(["overview", "activity", "edit"] as DrawerTab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => { setTab(t); if (t === "edit") openEdit(); }}
                    className={`px-4 py-2 text-xs font-medium capitalize transition-colors border-b-2 ${
                      tab === t
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </SheetHeader>

            {/* Body */}
            <ScrollArea className="flex-1 px-6">
              {/* ── Overview Tab ──────────────────────────────── */}
              {tab === "overview" && (
                <div className="py-4 space-y-5">
                  {/* Contact info */}
                  <section className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Contact
                    </h3>
                    <div className="space-y-2">
                      {lead.emails ? (
                        lead.emails.split(",").map((e) => (
                          <div key={e} className="flex items-center gap-2 text-sm">
                            <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="font-mono text-foreground truncate">{e.trim()}</span>
                          </div>
                        ))
                      ) : (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground/50 italic">
                          <Mail className="w-3.5 h-3.5 shrink-0" /> No email found
                        </div>
                      )}
                      {lead.phoneNumbers &&
                        lead.phoneNumbers.split(",").map((p) => (
                          <div key={p} className="flex items-center gap-2 text-sm">
                            <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="font-mono text-foreground">{p.trim()}</span>
                          </div>
                        ))}
                      {lead.address && (
                        <div className="flex items-start gap-2 text-sm">
                          <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                          <span className="text-foreground">{lead.address}</span>
                        </div>
                      )}
                      {lead.linkedinUrl && (
                        <div className="flex items-center gap-2 text-sm">
                          <Linkedin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <a
                            href={lead.linkedinUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline truncate"
                          >
                            {lead.linkedinUrl.replace("https://", "")}
                          </a>
                        </div>
                      )}
                    </div>
                  </section>

                  <Separator className="opacity-30" />

                  {/* Relevance */}
                  <section className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Relevance
                    </h3>
                    {lead.relevanceScore != null ? (
                      <div className="glass-card p-3 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <ScoreBadge score={lead.relevanceScore} reason={null} />
                          <span className="text-sm text-muted-foreground">out of 100</span>
                        </div>
                        {lead.relevanceReason && (
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {lead.relevanceReason}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground/50 italic">Not yet scored</p>
                    )}
                  </section>

                  <Separator className="opacity-30" />

                  {/* Metadata */}
                  <section className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Discovery
                    </h3>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      {lead.country && (
                        <>
                          <dt className="text-muted-foreground">Country</dt>
                          <dd>{lead.country}</dd>
                        </>
                      )}
                      {lead.sourceKeyword && (
                        <>
                          <dt className="text-muted-foreground">Keyword</dt>
                          <dd className="truncate">{lead.sourceKeyword}</dd>
                        </>
                      )}
                      {lead.sourceQuery && (
                        <>
                          <dt className="text-muted-foreground">Query</dt>
                          <dd className="truncate text-xs">{lead.sourceQuery}</dd>
                        </>
                      )}
                      <dt className="text-muted-foreground">Added</dt>
                      <dd>
                        {new Date(lead.createdAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </dd>
                    </dl>
                  </section>

                  {lead.notes && (
                    <>
                      <Separator className="opacity-30" />
                      <section className="space-y-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Notes
                        </h3>
                        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                          {lead.notes}
                        </p>
                      </section>
                    </>
                  )}
                </div>
              )}

              {/* ── Activity Tab ──────────────────────────────── */}
              {tab === "activity" && (
                <div className="py-4 space-y-4">
                  {/* Add note */}
                  <div className="glass-card p-3 space-y-2">
                    <Textarea
                      placeholder="Add a note…"
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      className="min-h-[72px] text-sm resize-none bg-transparent border-border/40"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAddNote();
                      }}
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        className="h-7 px-3 text-xs rounded-lg gap-1.5"
                        onClick={handleAddNote}
                        disabled={!noteText.trim() || isAddingNote}
                      >
                        {isAddingNote ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <SendHorizonal className="w-3 h-3" />
                        )}
                        Add Note
                      </Button>
                    </div>
                  </div>

                  {/* Timeline */}
                  {timeline.length === 0 ? (
                    <p className="text-sm text-muted-foreground/50 text-center py-8">
                      No activity yet.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {timeline.map((entry) =>
                        entry.kind === "note" ? (
                          <TimelineEntry
                            key={entry.id}
                            icon={<MessageSquare className="w-3.5 h-3.5" />}
                            label={entry.content}
                            sub={`by ${entry.author}`}
                            time={entry.time}
                            accent="bg-primary/10 text-primary"
                          />
                        ) : (
                          <TimelineEntry
                            key={entry.id}
                            icon={<Activity className="w-3.5 h-3.5" />}
                            label={
                              entry.toStatus
                                ? `Status → ${LEAD_STATUS_META[entry.toStatus]?.label ?? entry.toStatus}`
                                : entry.note ?? "Status changed"
                            }
                            sub={
                              entry.fromStatus
                                ? `From: ${LEAD_STATUS_META[entry.fromStatus]?.label ?? entry.fromStatus}${entry.note ? ` · ${entry.note}` : ""}`
                                : entry.note ?? undefined
                            }
                            time={entry.time}
                            accent="bg-muted/50 text-muted-foreground"
                          />
                        ),
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Edit Tab ──────────────────────────────────── */}
              {tab === "edit" && (
                <div className="py-4 space-y-4">
                  {[
                    { key: "companyName", label: "Company name", type: "input" },
                    { key: "emails", label: "Emails (comma-separated)", type: "input" },
                    { key: "phoneNumbers", label: "Phone numbers (comma-separated)", type: "input" },
                    { key: "linkedinUrl", label: "LinkedIn URL", type: "input" },
                    { key: "address", label: "Address", type: "input" },
                  ].map(({ key, label, type }) => (
                    <div key={key} className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">{label}</label>
                      {type === "input" ? (
                        <Input
                          value={editForm[key] ?? ""}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, [key]: e.target.value }))
                          }
                          className="bg-background/50 border-border/50 text-sm"
                        />
                      ) : (
                        <Textarea
                          value={editForm[key] ?? ""}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, [key]: e.target.value }))
                          }
                          className="bg-background/50 border-border/50 text-sm resize-none"
                        />
                      )}
                    </div>
                  ))}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Internal notes</label>
                    <Textarea
                      value={editForm["notes"] ?? ""}
                      onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                      className="bg-background/50 border-border/50 text-sm resize-none min-h-[90px]"
                      placeholder="Private notes visible only in this tool…"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Lead status</label>
                    <select
                      value={editForm["leadStatus"] ?? lead.leadStatus}
                      onChange={(e) => setEditForm((f) => ({ ...f, leadStatus: e.target.value }))}
                      className="w-full h-9 rounded-md border border-border/50 bg-background/50 px-3 text-sm text-foreground"
                    >
                      {Object.entries(LEAD_STATUS_META).map(([v, m]) => (
                        <option key={v} value={v}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Review status</label>
                    <select
                      value={editForm["reviewStatus"] ?? lead.reviewStatus}
                      onChange={(e) => setEditForm((f) => ({ ...f, reviewStatus: e.target.value }))}
                      className="w-full h-9 rounded-md border border-border/50 bg-background/50 px-3 text-sm text-foreground"
                    >
                      {Object.entries(REVIEW_STATUS_META).map(([v, m]) => (
                        <option key={v} value={v}>{m.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 pb-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-xl"
                      onClick={() => setTab("overview")}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="rounded-xl gap-1.5"
                      onClick={handleSave}
                      disabled={isSaving}
                    >
                      {isSaving ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Save className="w-3 h-3" />
                      )}
                      Save changes
                    </Button>
                  </div>
                </div>
              )}
            </ScrollArea>

            {/* Footer hint */}
            <div className="px-6 py-3 border-t border-border/30 flex items-center gap-2 text-[11px] text-muted-foreground/50">
              <Clock className="w-3 h-3" />
              Updated {new Date(lead.updatedAt).toLocaleDateString(undefined, {
                month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
              })}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
