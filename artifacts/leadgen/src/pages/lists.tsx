import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListLeadLists,
  useCreateLeadList,
  useUpdateLeadList,
  useDeleteLeadList,
  getListLeadListsQueryKey,
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
  DialogFooter,
} from "@/components/ui/dialog";
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
  Send,
} from "lucide-react";

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

function ListFormDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
  title,
  loading,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: FormState;
  onSubmit: (v: FormState) => void;
  title: string;
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
          <DialogTitle>{title}</DialogTitle>
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
            <Label>Description (optional)</Label>
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
  const [newOpen, setNewOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<LeadList | null>(null);
  const [exportingListId, setExportingListId] = useState<number | null>(null);

  const listParams = { includeArchived: showArchived ? true : undefined };
  const { data: lists, isLoading } = useListLeadLists(
    listParams,
    { query: { staleTime: 10_000, queryKey: getListLeadListsQueryKey(listParams) } },
  );

  const createMut = useCreateLeadList();
  const updateMut = useUpdateLeadList();
  const deleteMut = useDeleteLeadList();

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

  const handleCreate = (form: FormState) => {
    createMut.mutate(
      { data: { name: form.name, description: form.description || undefined } },
      {
        onSuccess: () => {
          toast({ title: "List created" });
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
        <EmptyState onNew={() => setNewOpen(true)} />
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

      {/* Create dialog */}
      <ListFormDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onSubmit={handleCreate}
        title="Create new list"
        loading={createMut.isPending}
      />

      {/* Edit dialog */}
      <ListFormDialog
        open={!!editTarget}
        onOpenChange={(v) => { if (!v) setEditTarget(null); }}
        initial={editTarget ? { name: editTarget.name, description: editTarget.description ?? "" } : undefined}
        onSubmit={handleEdit}
        title="Edit list"
        loading={updateMut.isPending}
      />
    </div>
  );
}
