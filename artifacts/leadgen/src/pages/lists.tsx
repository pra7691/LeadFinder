import { useState, useRef } from "react";
import { useLocation } from "wouter";
import {
  useListLeadLists,
  useCreateLeadList,
  useUpdateLeadList,
  useDeleteLeadList,
  useOutreachFromList,
  useListEmailTemplates,
  useListEmailAccounts,
  getListLeadListsQueryKey,
  getListEmailTemplatesQueryKey,
  getListEmailAccountsQueryKey,
} from "@workspace/api-client-react";
import type { LeadList } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { saveExportToServer } from "@/lib/export-files";
import {
  List,
  Plus,
  Trash2,
  Edit2,
  Users,
  Download,
  Loader2,
  Mail,
  Search,
  Send,
  ChevronDown,
  Upload,
  ClipboardList,
} from "lucide-react";

// ── Email parsing helpers ────────────────────────────────────────────────────

type ParsedEmail = { email: string; companyName?: string };

/** Parse a raw string (textarea or CSV text) into email+companyName pairs. */
function parseEmailInput(raw: string): ParsedEmail[] {
  const results: ParsedEmail[] = [];
  const lines = raw.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);

  // Detect if first line looks like a CSV header
  const firstLower = lines[0]?.toLowerCase() ?? "";
  let emailColIdx = -1;
  let nameColIdx = -1;
  let skipFirst = false;

  if (firstLower.includes("email")) {
    const cols = firstLower.split(",").map((c) => c.trim().replace(/"/g, ""));
    emailColIdx = cols.findIndex((c) => c === "email");
    nameColIdx = cols.findIndex((c) => c.includes("company") || c.includes("name"));
    skipFirst = true;
  }

  for (let i = skipFirst ? 1 : 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // CSV row (has commas)
    if (line.includes(",")) {
      const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      let email = "";
      let companyName = "";

      if (emailColIdx >= 0) {
        // Header-guided: we know which column is email
        email = cols[emailColIdx] ?? "";
        companyName = nameColIdx >= 0 ? (cols[nameColIdx] ?? "") : "";
      } else {
        // No header — try to figure out which column has the email
        const emailIdx = cols.findIndex((c) => c.includes("@"));
        if (emailIdx < 0) continue;
        email = cols[emailIdx];
        // Company name: first non-email, non-numeric column
        companyName = cols.find((c, idx) => idx !== emailIdx && c && !/^\d+$/.test(c) && !c.includes("@")) ?? "";
      }

      if (email && email.includes("@")) {
        results.push({ email: email.toLowerCase().trim(), companyName: companyName || undefined });
      }
    } else {
      // Plain email line
      const email = line.toLowerCase().trim();
      if (email.includes("@")) {
        results.push({ email });
      }
    }
  }

  // Deduplicate by email
  const seen = new Set<string>();
  return results.filter(({ email }) => {
    if (seen.has(email)) return false;
    seen.add(email);
    return true;
  });
}

function SkeletonRow() {
  return (
    <TableRow>
      {Array.from({ length: 7 }).map((_, i) => (
        <TableCell key={i}>
          <div className="h-4 rounded bg-muted/60 animate-pulse" />
        </TableCell>
      ))}
    </TableRow>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
        <List className="w-8 h-8 text-primary/60" />
      </div>
      <h3 className="font-semibold text-lg mb-1">No lists yet</h3>
      <p className="text-muted-foreground text-sm max-w-xs mb-6">
        Create lists to organise leads for targeted outreach campaigns.
      </p>
      <Button onClick={onNew} className="rounded-xl gap-2">
        <Plus className="w-4 h-4" />
        Create first list
      </Button>
    </div>
  );
}

type FormState = { name: string; description: string };

// ── Create List Dialog (with optional email import) ──────────────────────────

function CreateListDialog({
  open,
  onOpenChange,
  onSubmit,
  loading,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (v: FormState, emails: ParsedEmail[]) => void;
  loading: boolean;
}) {
  const [form, setForm] = useState<FormState>({ name: "", description: "" });
  const [showEmails, setShowEmails] = useState(false);
  const [emailTab, setEmailTab] = useState<"paste" | "upload">("paste");
  const [pasteText, setPasteText] = useState("");
  const [uploadText, setUploadText] = useState("");
  const [uploadFileName, setUploadFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleOpen = (v: boolean) => {
    if (!v) {
      setForm({ name: "", description: "" });
      setShowEmails(false);
      setPasteText("");
      setUploadText("");
      setUploadFileName("");
    }
    onOpenChange(v);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setUploadText((ev.target?.result as string) ?? "");
    reader.readAsText(file);
  };

  const rawText = emailTab === "paste" ? pasteText : uploadText;
  const parsedEmails = rawText.trim() ? parseEmailInput(rawText) : [];

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="sm:max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle>Create new list</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>List name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Manual Outreach June 2026"
              className="rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What is this list for?"
              className="rounded-xl resize-none"
              rows={2}
            />
          </div>

          {/* Collapsible email import section */}
          <div className="border border-border/50 rounded-xl overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/30 transition-colors"
              onClick={() => setShowEmails((v) => !v)}
            >
              <span className="flex items-center gap-2 text-muted-foreground">
                <Mail className="w-4 h-4" />
                Add emails to this list
                <span className="text-xs font-normal">(optional)</span>
              </span>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showEmails ? "rotate-180" : ""}`} />
            </button>

            {showEmails && (
              <div className="px-4 pb-4 space-y-3 border-t border-border/40">
                {/* Tabs */}
                <div className="flex gap-1 pt-3">
                  {(["paste", "upload"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setEmailTab(tab)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                        emailTab === tab
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      }`}
                    >
                      {tab === "paste" ? <ClipboardList className="w-3.5 h-3.5" /> : <Upload className="w-3.5 h-3.5" />}
                      {tab === "paste" ? "Paste" : "Upload CSV"}
                    </button>
                  ))}
                </div>

                {emailTab === "paste" && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">
                      One email per line. Optionally add company name after a comma: <code className="bg-muted px-1 rounded">email@example.com, Acme Corp</code>
                    </p>
                    <Textarea
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      placeholder={"info@acme.com, Acme Corp\njohn@example.com\nsales@company.com, Company Inc"}
                      className="rounded-xl resize-none font-mono text-xs"
                      rows={6}
                    />
                  </div>
                )}

                {emailTab === "upload" && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Upload a CSV file. Needs at least an <code className="bg-muted px-1 rounded">email</code> column. Optionally a <code className="bg-muted px-1 rounded">company_name</code> column.
                    </p>
                    <div
                      className="border-2 border-dashed border-border/60 rounded-xl p-6 text-center cursor-pointer hover:border-primary/40 hover:bg-muted/20 transition-colors"
                      onClick={() => fileRef.current?.click()}
                    >
                      <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
                      {uploadFileName ? (
                        <p className="text-sm font-medium text-foreground">{uploadFileName}</p>
                      ) : (
                        <p className="text-sm text-muted-foreground">Click to choose a CSV file</p>
                      )}
                      {parsedEmails.length > 0 && (
                        <p className="text-xs text-emerald-600 mt-1">{parsedEmails.length} emails detected</p>
                      )}
                    </div>
                    <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileChange} />
                  </div>
                )}

                {parsedEmails.length > 0 && (
                  <p className="text-xs text-emerald-600 font-medium">
                    ✓ {parsedEmails.length} valid email{parsedEmails.length !== 1 ? "s" : ""} will be added
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpen(false)} className="rounded-xl">
            Cancel
          </Button>
          <Button
            disabled={!form.name.trim() || loading}
            onClick={() => onSubmit(form, parsedEmails)}
            className="rounded-xl"
          >
            {loading ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />Creating…</> : "Create list"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit List Dialog (name + description only, no email import) ──────────────

function EditListDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
  loading,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: FormState;
  onSubmit: (v: FormState) => void;
  loading: boolean;
}) {
  const [form, setForm] = useState<FormState>(initial ?? { name: "", description: "" });

  const handleOpen = (v: boolean) => {
    if (v && initial) setForm(initial);
    if (v && !initial) setForm({ name: "", description: "" });
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>Edit list</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>List name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. DACH SaaS Prospects"
              className="rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What is this list for?"
              className="rounded-xl resize-none"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl">
            Cancel
          </Button>
          <Button
            disabled={!form.name.trim() || loading}
            onClick={() => onSubmit(form)}
            className="rounded-xl"
          >
            {loading ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Lists() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [showArchived, setShowArchived] = useState(false);
  const [emailSearch, setEmailSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<LeadList | null>(null);
  const [exportingListId, setExportingListId] = useState<number | null>(null);

  // Outreach dialog state
  const [outreachTarget, setOutreachTarget] = useState<LeadList | null>(null);
  const [outreachTemplateId, setOutreachTemplateId] = useState("");
  const [outreachAccountId, setOutreachAccountId] = useState("");
  const [outreachResult, setOutreachResult] = useState<{ queued: number; skipped: number } | null>(null);

  const listParams = {
    includeArchived: showArchived ? true : undefined,
    emailSearch: emailSearch.trim() || undefined,
  };
  const { data: lists, isLoading } = useListLeadLists(
    listParams,
    { query: { staleTime: 10_000, queryKey: getListLeadListsQueryKey(listParams) } },
  );

  const createMut = useCreateLeadList();
  const updateMut = useUpdateLeadList();
  const deleteMut = useDeleteLeadList();
  const outreachMut = useOutreachFromList();
  const { data: templates } = useListEmailTemplates({ includeInactive: false }, { query: { queryKey: getListEmailTemplatesQueryKey({ includeInactive: false }), staleTime: 30_000 } });
  const { data: emailAccounts } = useListEmailAccounts({ query: { queryKey: getListEmailAccountsQueryKey(), staleTime: 30_000 } });
  const activeTemplates = Array.isArray(templates) ? templates.filter((t) => t.isActive) : [];
  const emailAccountRows = Array.isArray(emailAccounts) ? emailAccounts : [];

  const invalidate = () => qc.invalidateQueries({ queryKey: getListLeadListsQueryKey() });

  const handleExportList = async (list: LeadList, format: "csv" | "xlsx" = "csv") => {
    if (exportingListId !== null) return;
    setExportingListId(list.id);
    try {
      const resp = await fetch(`/api/lists/${list.id}/leads`);
      if (!resp.ok) throw new Error("Failed to fetch list leads");
      const leads = (await resp.json()) as { id: number }[];
      if (!leads.length) {
        toast({ title: "No leads in this list to export" });
        return;
      }
      const ids = leads.map((l) => l.id).join(",");
      const saved = await saveExportToServer(`/api/leads/export?format=${format}&leadIds=${ids}`);
      toast({ title: `Exported ${leads.length} lead${leads.length !== 1 ? "s" : ""} → ${saved.relativePath}` });
    } catch (err: unknown) {
      toast({
        title: err instanceof Error ? err.message : "Export failed",
        variant: "destructive",
      });
    } finally {
      setExportingListId(null);
    }
  };

  const handleCreate = (form: FormState, emails: ParsedEmail[]) => {
    createMut.mutate(
      {
        data: {
          name: form.name,
          description: form.description || undefined,
          // Pass emails directly so the API inserts them in one shot
          ...(emails.length > 0 ? { emails } : {}),
        } as Parameters<typeof createMut.mutate>[0]["data"],
      },
      {
        onSuccess: () => {
          const msg = emails.length > 0
            ? `List created with ${emails.length} email${emails.length !== 1 ? "s" : ""}`
            : "List created";
          toast({ title: msg });
          setNewOpen(false);
          invalidate();
        },
        onError: () => toast({ title: "Failed to create list", variant: "destructive" }),
      },
    );
  };

  const handleEdit = (form: FormState) => {
    if (!editTarget) return;
    updateMut.mutate(
      { id: editTarget.id, data: { name: form.name, description: form.description || null } },
      {
        onSuccess: () => {
          toast({ title: "List updated" });
          setEditTarget(null);
          invalidate();
        },
        onError: () => toast({ title: "Failed to update list", variant: "destructive" }),
      },
    );
  };

  const handleDelete = (list: LeadList) => {
    if (!confirm(`Delete "${list.name}"? This cannot be undone.`)) return;
    deleteMut.mutate(
      { id: list.id },
      {
        onSuccess: () => {
          toast({ title: "List deleted" });
          invalidate();
        },
      },
    );
  };

  const listRows: LeadList[] = Array.isArray(lists) ? (lists as LeadList[]) : [];

  const activeLists = listRows.filter((l) => l.listStatus === "active");
  const archivedLists = listRows.filter((l) => l.listStatus === "archived");
  const listStats = [
    { label: "Total Lists", value: listRows.length },
    { label: "Active", value: activeLists.length },
    { label: "Archived", value: archivedLists.length },
    { label: "Total Leads", value: listRows.reduce((sum, list) => sum + (list.leadCount ?? 0), 0) },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lists</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Organise leads into targeted groups for outreach
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </Button>
          <Button className="rounded-xl gap-2" onClick={() => setNewOpen(true)}>
            <Plus className="w-4 h-4" />
            New list
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {listStats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border/50 bg-card/50 p-4">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="text-2xl font-semibold mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border border-border/50 bg-card/30 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">Find lists by email</p>
          <p className="text-xs text-muted-foreground">
            Search all lists for a specific lead email address.
          </p>
        </div>
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={emailSearch}
            onChange={(e) => setEmailSearch(e.target.value)}
            placeholder="email@example.com"
            className="rounded-xl pl-9"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-border/50 overflow-hidden bg-card/30">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>List</TableHead>
                <TableHead>Total Leads</TableHead>
                <TableHead>With Emails</TableHead>
                <TableHead>Outreach</TableHead>
                <TableHead>Campaign Run</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
            </TableBody>
          </Table>
        </div>
      ) : listRows.length === 0 ? (
        emailSearch.trim() ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-border/50 bg-card/30 py-20 text-center">
            <Mail className="mb-3 h-8 w-8 text-muted-foreground/50" />
            <h3 className="font-semibold text-lg mb-1">No lists found</h3>
            <p className="text-sm text-muted-foreground">
              No list contains an email matching “{emailSearch.trim()}”.
            </p>
          </div>
        ) : (
          <EmptyState onNew={() => setNewOpen(true)} />
        )
      ) : (
        <div className="rounded-2xl border border-border/50 overflow-hidden bg-card/30">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[240px]">List</TableHead>
                <TableHead>Total Leads</TableHead>
                <TableHead>With Emails</TableHead>
                <TableHead>Outreach</TableHead>
                <TableHead>Campaign Run</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listRows.map((list) => (
                <TableRow
                  key={list.id}
                  className={`cursor-pointer hover:bg-muted/30 ${list.listStatus === "archived" ? "opacity-60" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setLocation(`/lists/${list.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setLocation(`/lists/${list.id}`);
                    }
                  }}
                >
                  <TableCell>
                    <span className="font-medium text-foreground">
                      {list.name}
                    </span>
                    {list.description && (
                      <p className="mt-1 max-w-[420px] text-xs text-muted-foreground line-clamp-2">
                        {list.description}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                      <Users className="w-3.5 h-3.5 text-muted-foreground" />
                      {list.leadCount}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-sm">
                      <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className={(list.leadsWithEmail ?? 0) > 0 ? "text-emerald-600 font-medium" : "text-muted-foreground"}>
                        {list.leadsWithEmail ?? 0}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    {list.hasOutreach ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                        <Send className="w-3 h-3" />
                        Created
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {list.campaignRunNames ? (
                      <span className="text-xs text-foreground">{list.campaignRunNames}</span>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(list.createdAt).toLocaleString(undefined, {
                      year: "numeric", month: "short", day: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {(list.leadsWithEmail ?? 0) > 0 && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 rounded-lg text-primary/70 hover:text-primary"
                          aria-label={`Create outreach for ${list.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOutreachTarget(list);
                            setOutreachTemplateId("");
                            setOutreachAccountId("");
                            setOutreachResult(null);
                          }}
                        >
                          <Send className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                        aria-label={`Export ${list.name}`}
                        disabled={exportingListId === list.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExportList(list, "csv");
                        }}
                      >
                        {exportingListId === list.id
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <Download className="w-4 h-4" />}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 rounded-lg"
                        aria-label={`Edit ${list.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditTarget(list);
                        }}
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 rounded-lg text-destructive/80 hover:text-destructive"
                        aria-label={`Delete ${list.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(list);
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create dialog — includes optional email import */}
      <CreateListDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onSubmit={handleCreate}
        loading={createMut.isPending}
      />

      {/* Edit dialog — name + description only */}
      <EditListDialog
        open={!!editTarget}
        onOpenChange={(v) => { if (!v) setEditTarget(null); }}
        initial={editTarget ? { name: editTarget.name, description: editTarget.description ?? "" } : undefined}
        onSubmit={handleEdit}
        loading={updateMut.isPending}
      />

      {/* Create Outreach dialog */}
      <Dialog open={!!outreachTarget} onOpenChange={(v) => { if (!v) { setOutreachTarget(null); setOutreachResult(null); } }}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="w-4 h-4 text-primary" /> Create Outreach
            </DialogTitle>
            {outreachTarget && (
              <DialogDescription>
                Queue outreach drafts for <strong>{outreachTarget.name}</strong>. Leads without an email will be skipped.
              </DialogDescription>
            )}
          </DialogHeader>
          {outreachResult ? (
            <div className="flex flex-col items-center py-6 gap-3 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500" />
              <p className="text-lg font-semibold">{outreachResult.queued} drafts created</p>
              {outreachResult.skipped > 0 && (
                <p className="text-sm text-muted-foreground">{outreachResult.skipped} leads skipped (no email or already queued).</p>
              )}
              <DialogFooter className="w-full pt-2">
                <Button onClick={() => { setOutreachTarget(null); setOutreachResult(null); }} className="w-full rounded-xl">Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Email Template *</Label>
                {activeTemplates.length === 0 ? (
                  <p className="text-sm text-muted-foreground rounded-xl border border-border/50 px-4 py-3">
                    No active templates. <a href="/settings/email-templates" className="text-primary hover:underline">Create one first.</a>
                  </p>
                ) : (
                  <Select value={outreachTemplateId} onValueChange={setOutreachTemplateId}>
                    <SelectTrigger className="rounded-xl">
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
                <Select value={outreachAccountId} onValueChange={setOutreachAccountId}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Assign later in Outreach" />
                  </SelectTrigger>
                  <SelectContent>
                    {emailAccountRows.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.name} ({a.email})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter className="pt-2">
                <Button variant="ghost" onClick={() => setOutreachTarget(null)}>Cancel</Button>
                <Button
                  disabled={!outreachTemplateId || outreachMut.isPending || !outreachTarget}
                  onClick={() => {
                    if (!outreachTarget) return;
                    outreachMut.mutate(
                      { data: { listId: outreachTarget.id, emailTemplateId: Number(outreachTemplateId), emailAccountId: outreachAccountId ? Number(outreachAccountId) : undefined } },
                      {
                        onSuccess: (r) => { setOutreachResult({ queued: r.queued, skipped: r.skipped }); qc.invalidateQueries({ queryKey: ["outreach"] }); },
                        onError: () => toast({ title: "Failed to create outreach", variant: "destructive" }),
                      },
                    );
                  }}
                  className="gap-2"
                >
                  {outreachMut.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : <><Send className="w-4 h-4" /> Create Outreach Drafts</>}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
