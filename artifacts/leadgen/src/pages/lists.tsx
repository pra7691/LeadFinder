import { useState } from "react";
import { Link } from "wouter";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  List,
  Plus,
  MoreHorizontal,
  Archive,
  Trash2,
  Edit2,
  Users,
  ChevronRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

function SkeletonCard() {
  return (
    <div className="glass-card rounded-2xl p-5 animate-pulse">
      <div className="flex items-start justify-between">
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-muted rounded w-1/3" />
          <div className="h-3 bg-muted rounded w-1/2" />
        </div>
        <div className="h-8 w-8 bg-muted rounded-lg" />
      </div>
      <div className="mt-4 flex gap-3">
        <div className="h-3 bg-muted rounded w-16" />
        <div className="h-3 bg-muted rounded w-20" />
      </div>
    </div>
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
  const qc = useQueryClient();
  const { toast } = useToast();

  const [showArchived, setShowArchived] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<LeadList | null>(null);

  const listParams = { includeArchived: showArchived ? true : undefined };
  const { data: lists, isLoading } = useListLeadLists(
    listParams,
    { query: { staleTime: 10_000, queryKey: getListLeadListsQueryKey(listParams) } },
  );

  const createMut = useCreateLeadList();
  const updateMut = useUpdateLeadList();
  const deleteMut = useDeleteLeadList();

  const invalidate = () => qc.invalidateQueries({ queryKey: getListLeadListsQueryKey() });

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

  const handleArchive = (list: LeadList) => {
    const next = list.listStatus === "active" ? "archived" : "active";
    updateMut.mutate(
      { id: list.id, data: { listStatus: next as "active" | "archived" } },
      {
        onSuccess: () => {
          toast({ title: next === "archived" ? "List archived" : "List restored" });
          invalidate();
        },
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

  const activeLists = (lists ?? []).filter((l) => l.listStatus === "active");
  const archivedLists = (lists ?? []).filter((l) => l.listStatus === "archived");

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

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (lists ?? []).length === 0 ? (
        <EmptyState onNew={() => setNewOpen(true)} />
      ) : (
        <div className="space-y-6">
          {activeLists.length > 0 && (
            <div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeLists.map((list) => (
                  <ListCard
                    key={list.id}
                    list={list}
                    onEdit={() => setEditTarget(list)}
                    onArchive={() => handleArchive(list)}
                    onDelete={() => handleDelete(list)}
                  />
                ))}
              </div>
            </div>
          )}

          {showArchived && archivedLists.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-muted-foreground mb-3">Archived</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {archivedLists.map((list) => (
                  <ListCard
                    key={list.id}
                    list={list}
                    onEdit={() => setEditTarget(list)}
                    onArchive={() => handleArchive(list)}
                    onDelete={() => handleDelete(list)}
                  />
                ))}
              </div>
            </div>
          )}
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

function ListCard({
  list,
  onEdit,
  onArchive,
  onDelete,
}: {
  list: LeadList;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "glass-card rounded-2xl p-5 flex flex-col gap-3 group transition-all duration-200 hover:shadow-md",
        list.listStatus === "archived" && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={`/lists/${list.id}`} className="flex-1 min-w-0">
          <h3 className="font-semibold truncate hover:underline cursor-pointer">{list.name}</h3>
          {list.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{list.description}</p>
          )}
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground shrink-0"
            >
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="rounded-xl">
            <DropdownMenuItem onClick={onEdit} className="gap-2">
              <Edit2 className="w-3.5 h-3.5" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onArchive} className="gap-2">
              <Archive className="w-3.5 h-3.5" />
              {list.listStatus === "active" ? "Archive" : "Restore"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="gap-2 text-destructive">
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Users className="w-3 h-3" />
          {list.leadCount} lead{list.leadCount !== 1 ? "s" : ""}
        </span>
        {list.campaignName && (
          <Badge variant="secondary" className="text-[10px] py-0 px-1.5 rounded-md">
            {list.campaignName}
          </Badge>
        )}
        <span className="ml-auto">
          {formatDistanceToNow(new Date(list.updatedAt), { addSuffix: true })}
        </span>
      </div>

      <Link
        href={`/lists/${list.id}`}
        className="flex items-center gap-1 text-xs text-primary hover:underline mt-auto"
      >
        View leads
        <ChevronRight className="w-3 h-3" />
      </Link>
    </div>
  );
}
