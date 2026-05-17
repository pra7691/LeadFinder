import {
  useListEmailAccounts,
  useCreateEmailAccount,
  useUpdateEmailAccount,
  useDeleteEmailAccount,
  useTestEmailAccount,
  useListCampaigns,
  useListCampaignEmailAccounts,
  useAssignCampaignEmailAccount,
  useUnassignCampaignEmailAccount,
  getListEmailAccountsQueryKey,
  getListCampaignEmailAccountsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useState } from "react";
import {
  Mail,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Plus,
  Wifi,
  WifiOff,
  Loader2,
  Pencil,
  SendHorizonal,
  Clock,
  X,
  ChevronDown,
  ChevronUp,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";

type EmailAccount = {
  id: number;
  name: string;
  senderName: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure?: boolean;
  smtpUser: string;
  dailySendLimit: number;
  isActive: boolean;
  totalSent: number;
  sentToday: number;
  lastSentAt?: string | null;
  lastTestedAt?: string | null;
  lastTestResult?: string | null;
  createdAt: string;
  updatedAt: string;
};

const EMPTY_FORM = {
  name: "",
  senderName: "",
  email: "",
  smtpHost: "smtp.gmail.com",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "",
  smtpPassword: "",
  dailySendLimit: 100,
  isActive: true,
};

function formatDate(iso?: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TestResultBadge({ result }: { result?: string | null }) {
  if (!result) return null;
  const ok = result === "success";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full",
        ok
          ? "bg-green-500/10 text-green-600"
          : "bg-destructive/10 text-destructive",
      )}
    >
      {ok ? (
        <CheckCircle2 className="w-3 h-3" />
      ) : (
        <AlertCircle className="w-3 h-3" />
      )}
      {ok ? "Verified" : "Failed"}
    </span>
  );
}

function CampaignAssignment({ account }: { account: EmailAccount }) {
  const qc = useQueryClient();
  const { data: campaigns } = useListCampaigns();
  const { data: assigned } = useListCampaignEmailAccounts(account.id, {
    query: {
      queryKey: getListCampaignEmailAccountsQueryKey(account.id),
    },
  });
  const assign = useAssignCampaignEmailAccount();
  const unassign = useUnassignCampaignEmailAccount();
  const [adding, setAdding] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState("");

  const assignedIds = new Set((assigned ?? []).map((a) => a.id));
  const available = (campaigns ?? []).filter((c) => !assignedIds.has(c.id));

  const invalidate = () =>
    qc.invalidateQueries({
      queryKey: getListCampaignEmailAccountsQueryKey(account.id),
    });

  const handleAssign = () => {
    if (!selectedCampaign) return;
    assign.mutate(
      { id: Number(selectedCampaign), data: { emailAccountId: account.id } },
      {
        onSuccess: () => {
          setAdding(false);
          setSelectedCampaign("");
          invalidate();
        },
      },
    );
  };

  const handleUnassign = (campaignId: number) => {
    unassign.mutate(
      { id: campaignId, accountId: account.id },
      { onSuccess: invalidate },
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Campaigns
        </span>
        {available.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setAdding(!adding)}
          >
            {adding ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3 mr-1" />}
            {adding ? "Cancel" : "Assign"}
          </Button>
        )}
      </div>

      {adding && (
        <div className="flex gap-2">
          <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
            <SelectTrigger className="h-8 text-xs rounded-lg flex-1">
              <SelectValue placeholder="Select campaign…" />
            </SelectTrigger>
            <SelectContent>
              {available.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="h-8 px-3 text-xs rounded-lg"
            disabled={!selectedCampaign || assign.isPending}
            onClick={handleAssign}
          >
            {assign.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Add"}
          </Button>
        </div>
      )}

      {(assigned ?? []).length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          Not assigned to any campaign
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {(assigned ?? []).map((a) => {
            const camp = (campaigns ?? []).find((c) => c.id === a.id);
            return (
              <Badge key={a.id} variant="secondary" className="text-xs gap-1 pr-1 pl-2">
                {camp?.name ?? `Campaign #${a.id}`}
                <button
                  onClick={() => handleUnassign(a.id)}
                  className="ml-0.5 rounded-full hover:text-destructive transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AccountCard({
  account,
  onEdit,
}: {
  account: EmailAccount;
  onEdit: (a: EmailAccount) => void;
}) {
  const qc = useQueryClient();
  const updateAccount = useUpdateEmailAccount();
  const deleteAccount = useDeleteEmailAccount();
  const testAccount = useTestEmailAccount();
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showCampaigns, setShowCampaigns] = useState(false);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListEmailAccountsQueryKey() });

  const handleToggle = (isActive: boolean) => {
    updateAccount.mutate({ id: account.id, data: { isActive } }, { onSuccess: invalidate });
  };

  const handleDelete = () => {
    if (confirm("Delete this email account? It will be unassigned from all campaigns.")) {
      deleteAccount.mutate({ id: account.id }, { onSuccess: invalidate });
    }
  };

  const handleTest = () => {
    setTestResult(null);
    testAccount.mutate(
      { id: account.id },
      {
        onSuccess: (data) => {
          setTestResult({ success: data.success, message: data.message });
          invalidate();
        },
        onError: () => {
          setTestResult({ success: false, message: "Request failed — check server connection." });
        },
      },
    );
  };

  const lastResultOk = account.lastTestResult === "success";

  return (
    <Card className="glass-card hover:shadow-md transition-all duration-300 flex flex-col">
      <CardContent className="p-6 flex flex-col gap-4 flex-1">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 shrink-0 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
              <Mail className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-base leading-tight truncate">{account.name}</h3>
              <p className="text-sm text-muted-foreground truncate">
                {account.senderName
                  ? `${account.senderName} <${account.email}>`
                  : account.email}
              </p>
            </div>
          </div>
          <Switch
            checked={account.isActive}
            onCheckedChange={handleToggle}
            data-testid={`switch-account-${account.id}`}
          />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 p-3 bg-muted/30 rounded-xl border border-border/50 text-center">
          <div>
            <p className="text-xs text-muted-foreground font-medium">Today</p>
            <p className="text-sm font-semibold">
              {account.sentToday}/{account.dailySendLimit}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium">Total</p>
            <p className="text-sm font-semibold">{account.totalSent.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium">Status</p>
            <p className={cn("text-sm font-semibold", account.isActive ? "text-primary" : "text-muted-foreground")}>
              {account.isActive ? "Active" : "Off"}
            </p>
          </div>
        </div>

        {/* SMTP config row */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono bg-muted/20 px-3 py-2 rounded-lg border border-border/40">
          <Shield className="w-3 h-3 shrink-0 text-muted-foreground/50" />
          <span className="truncate">
            {account.smtpHost}:{account.smtpPort}
            {account.smtpSecure ? " (SSL)" : " (STARTTLS)"}
          </span>
          <span className="ml-auto text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-sans font-medium">
            Encrypted
          </span>
        </div>

        {/* Last test */}
        {account.lastTestedAt && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              <span>Tested {formatDate(account.lastTestedAt)}</span>
            </div>
            <TestResultBadge result={account.lastTestResult} />
          </div>
        )}

        {/* Live test result */}
        {testResult && (
          <div
            className={cn(
              "text-xs px-3 py-2 rounded-lg border leading-relaxed",
              testResult.success
                ? "bg-green-500/5 border-green-500/20 text-green-700 dark:text-green-400"
                : "bg-destructive/5 border-destructive/20 text-destructive",
            )}
          >
            {testResult.message}
          </div>
        )}

        {/* Campaign assignments (collapsible) */}
        <div>
          <button
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left"
            onClick={() => setShowCampaigns(!showCampaigns)}
          >
            {showCampaigns ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Campaign assignments
          </button>
          {showCampaigns && (
            <div className="mt-2">
              <CampaignAssignment account={account} />
            </div>
          )}
        </div>

        <Separator />

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={testAccount.isPending}
            className="h-8 rounded-xl text-xs flex-1"
          >
            {testAccount.isPending ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Testing…</>
            ) : (
              <>
                {lastResultOk && account.lastTestedAt ? (
                  <Wifi className="w-3.5 h-3.5 mr-1.5 text-green-500" />
                ) : (
                  <WifiOff className="w-3.5 h-3.5 mr-1.5" />
                )}
                Test SMTP
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(account)}
            className="h-8 w-8 rounded-xl p-0 shrink-0"
            title="Edit"
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            className="h-8 w-8 rounded-xl p-0 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
            data-testid={`button-delete-account-${account.id}`}
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AccountForm({
  initial,
  onSave,
  onCancel,
  isPending,
  isEdit,
}: {
  initial: typeof EMPTY_FORM;
  onSave: (data: typeof EMPTY_FORM) => void;
  onCancel: () => void;
  isPending: boolean;
  isEdit: boolean;
}) {
  const [form, setForm] = useState(initial);
  const set = (k: keyof typeof EMPTY_FORM, v: unknown) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const canSave =
    !isPending &&
    !!form.name &&
    !!form.email &&
    !!form.smtpHost &&
    !!form.smtpUser &&
    (isEdit || !!form.smtpPassword);

  return (
    <div className="grid grid-cols-2 gap-4 py-1">
      <div className="space-y-1.5 col-span-2">
        <Label className="text-xs font-medium">Account Name</Label>
        <Input
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          className="rounded-xl"
          placeholder="e.g. John — Sales Outreach"
        />
      </div>
      <div className="space-y-1.5 col-span-2">
        <Label className="text-xs font-medium">Sender Name</Label>
        <Input
          value={form.senderName}
          onChange={(e) => set("senderName", e.target.value)}
          className="rounded-xl"
          placeholder='Display name in "From:" field'
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Sender Email</Label>
        <Input
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
          className="rounded-xl"
          placeholder="john@company.com"
          type="email"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Daily Limit</Label>
        <Input
          type="number"
          value={form.dailySendLimit}
          onChange={(e) => set("dailySendLimit", Number(e.target.value))}
          className="rounded-xl"
          min={1}
          max={2000}
        />
      </div>
      <div className="space-y-1.5 col-span-2">
        <Label className="text-xs font-medium">SMTP Host</Label>
        <Input
          value={form.smtpHost}
          onChange={(e) => set("smtpHost", e.target.value)}
          className="rounded-xl font-mono text-sm"
          placeholder="smtp.gmail.com"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">SMTP Port</Label>
        <Input
          type="number"
          value={form.smtpPort}
          onChange={(e) => set("smtpPort", Number(e.target.value))}
          className="rounded-xl"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">SMTP Username</Label>
        <Input
          value={form.smtpUser}
          onChange={(e) => set("smtpUser", e.target.value)}
          className="rounded-xl"
          placeholder="Usually your email"
        />
      </div>
      <div className="space-y-1.5 col-span-2">
        <Label className="text-xs font-medium">
          SMTP Password{" "}
          {isEdit && (
            <span className="text-muted-foreground font-normal">
              (leave blank to keep current)
            </span>
          )}
        </Label>
        <Input
          type="password"
          value={form.smtpPassword}
          onChange={(e) => set("smtpPassword", e.target.value)}
          className="rounded-xl"
          placeholder={isEdit ? "Enter new password to change" : "App password"}
        />
      </div>
      <div className="col-span-2 flex items-center justify-between py-1">
        <div className="flex items-center gap-2.5">
          <Switch
            checked={form.smtpSecure}
            onCheckedChange={(v) => set("smtpSecure", v)}
            id="smtp-secure"
          />
          <Label htmlFor="smtp-secure" className="text-sm cursor-pointer">
            SSL/TLS (port 465)
          </Label>
        </div>
        <div className="flex items-center gap-2.5">
          <Switch
            checked={form.isActive}
            onCheckedChange={(v) => set("isActive", v)}
            id="is-active"
          />
          <Label htmlFor="is-active" className="text-sm cursor-pointer">
            Active
          </Label>
        </div>
      </div>
      <div className="col-span-2 flex gap-3 pt-2">
        <Button variant="outline" onClick={onCancel} className="flex-1 rounded-xl">
          Cancel
        </Button>
        <Button
          onClick={() => onSave(form)}
          disabled={!canSave}
          className="flex-1 rounded-xl"
          data-testid="button-save-account"
        >
          {isPending ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
          ) : isEdit ? (
            "Save Changes"
          ) : (
            "Create Account"
          )}
        </Button>
      </div>
    </div>
  );
}

export function EmailAccounts() {
  const { data: accounts, isLoading } = useListEmailAccounts();
  const createAccount = useCreateEmailAccount();
  const updateAccount = useUpdateEmailAccount();
  const qc = useQueryClient();

  const [dialogMode, setDialogMode] = useState<"none" | "create" | "edit">("none");
  const [editingAccount, setEditingAccount] = useState<EmailAccount | null>(null);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListEmailAccountsQueryKey() });

  const openCreate = () => {
    setEditingAccount(null);
    setDialogMode("create");
  };

  const openEdit = (acc: EmailAccount) => {
    setEditingAccount(acc);
    setDialogMode("edit");
  };

  const closeDialog = () => {
    setDialogMode("none");
    setEditingAccount(null);
  };

  const handleCreate = (form: typeof EMPTY_FORM) => {
    createAccount.mutate(
      { data: form },
      { onSuccess: () => { invalidate(); closeDialog(); } },
    );
  };

  const handleEdit = (form: typeof EMPTY_FORM) => {
    if (!editingAccount) return;
    type PatchData = Parameters<typeof updateAccount.mutate>[0]["data"];
    const patch: PatchData = {
      name: form.name,
      senderName: form.senderName,
      email: form.email,
      smtpHost: form.smtpHost,
      smtpPort: form.smtpPort,
      smtpSecure: form.smtpSecure,
      smtpUser: form.smtpUser,
      dailySendLimit: form.dailySendLimit,
      isActive: form.isActive,
    };
    if (form.smtpPassword) patch.smtpPassword = form.smtpPassword;
    updateAccount.mutate(
      { id: editingAccount.id, data: patch },
      { onSuccess: () => { invalidate(); closeDialog(); } },
    );
  };

  const editInitial: typeof EMPTY_FORM = editingAccount
    ? {
        name: editingAccount.name,
        senderName: editingAccount.senderName,
        email: editingAccount.email,
        smtpHost: editingAccount.smtpHost,
        smtpPort: editingAccount.smtpPort,
        smtpSecure: editingAccount.smtpSecure ?? false,
        smtpUser: editingAccount.smtpUser,
        smtpPassword: "",
        dailySendLimit: editingAccount.dailySendLimit,
        isActive: editingAccount.isActive,
      }
    : EMPTY_FORM;

  const allAccounts = accounts as EmailAccount[] | undefined;
  const activeCount = (allAccounts ?? []).filter((a) => a.isActive).length;
  const totalSentToday = (allAccounts ?? []).reduce((s, a) => s + a.sentToday, 0);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Email Accounts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            SMTP senders · AES-256-GCM encrypted credentials · Google Workspace, Outlook, or any SMTP
          </p>
        </div>
        <Button className="rounded-xl shadow-sm" onClick={openCreate} data-testid="button-add-account">
          <Plus className="w-4 h-4 mr-2" /> Add Account
        </Button>
      </div>

      {/* Summary stats bar */}
      {allAccounts && allAccounts.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { icon: <Mail className="w-4 h-4" />, label: "Total Accounts", value: allAccounts.length },
            { icon: <CheckCircle2 className="w-4 h-4" />, label: "Active", value: activeCount },
            { icon: <SendHorizonal className="w-4 h-4" />, label: "Sent Today", value: totalSentToday.toLocaleString() },
          ].map((stat) => (
            <div
              key={stat.label}
              className="flex items-center gap-3 p-4 rounded-2xl bg-muted/30 border border-border/50"
            >
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                {stat.icon}
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">{stat.label}</p>
                <p className="text-xl font-semibold leading-tight">{stat.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {isLoading ? (
          <div className="text-sm text-muted-foreground animate-pulse col-span-full">
            Loading accounts…
          </div>
        ) : allAccounts?.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center p-14 text-center bg-muted/20 border border-border/50 rounded-2xl border-dashed">
            <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
              <Mail className="w-7 h-7 text-muted-foreground/30" />
            </div>
            <h3 className="text-lg font-medium">No email accounts yet</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Add a Google Workspace or any SMTP account to build your outreach pipeline.
            </p>
            <Button variant="outline" className="mt-6 rounded-xl" onClick={openCreate}>
              <Plus className="w-4 h-4 mr-2" /> Add Account
            </Button>
          </div>
        ) : (
          allAccounts?.map((acc) => (
            <AccountCard key={acc.id} account={acc} onEdit={openEdit} />
          ))
        )}
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogMode !== "none"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-[520px] rounded-2xl border-border/50 bg-background/80 backdrop-blur-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">
              {dialogMode === "edit" ? "Edit Account" : "Add SMTP Account"}
            </DialogTitle>
            <DialogDescription>
              {dialogMode === "edit"
                ? "Update credentials or settings. Leave password blank to keep current."
                : "Credentials are stored encrypted with AES-256-GCM using your session secret."}
            </DialogDescription>
          </DialogHeader>
          <AccountForm
            key={editingAccount?.id ?? "new"}
            initial={dialogMode === "edit" ? editInitial : EMPTY_FORM}
            onSave={dialogMode === "edit" ? handleEdit : handleCreate}
            onCancel={closeDialog}
            isPending={
              dialogMode === "edit" ? updateAccount.isPending : createAccount.isPending
            }
            isEdit={dialogMode === "edit"}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
