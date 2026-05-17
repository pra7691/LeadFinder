import { useListEmailAccounts, useCreateEmailAccount, useUpdateEmailAccount, useDeleteEmailAccount } from "@workspace/api-client-react";
import { getListEmailAccountsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useState } from "react";
import { Mail, Trash2, CheckCircle2, AlertCircle, Plus } from "lucide-react";

export function EmailAccounts() {
  const { data: accounts, isLoading } = useListEmailAccounts();
  const createAccount = useCreateEmailAccount();
  const updateAccount = useUpdateEmailAccount();
  const deleteAccount = useDeleteEmailAccount();
  const queryClient = useQueryClient();
  
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "", email: "", smtpHost: "", smtpPort: 587, smtpSecure: true, smtpUser: "", smtpPassword: "", dailySendLimit: 100
  });

  const handleCreate = () => {
    createAccount.mutate({
      data: { ...formData, isActive: true }
    }, {
      onSuccess: () => {
        setOpen(false);
        queryClient.invalidateQueries({ queryKey: getListEmailAccountsQueryKey() });
        setFormData({name: "", email: "", smtpHost: "", smtpPort: 587, smtpSecure: true, smtpUser: "", smtpPassword: "", dailySendLimit: 100});
      }
    });
  };

  const handleToggle = (id: number, isActive: boolean) => {
    updateAccount.mutate({ id, data: { isActive } }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListEmailAccountsQueryKey() })
    });
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this email account? This action cannot be undone.")) {
      deleteAccount.mutate({ id }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListEmailAccountsQueryKey() })
      });
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Email Accounts</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-xl shadow-sm" data-testid="button-add-account">
              <Plus className="w-4 h-4 mr-2" /> Add Account
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px] rounded-2xl border-border/50 bg-background/80 backdrop-blur-2xl">
            <DialogHeader>
              <DialogTitle className="text-xl">Add SMTP Account</DialogTitle>
              <DialogDescription>Configure a new sender account for outreach.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-5 py-4">
              <div className="space-y-2 col-span-2">
                <Label>Internal Name</Label>
                <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="rounded-xl" placeholder="e.g. John (Sales)" />
              </div>
              <div className="space-y-2">
                <Label>Email Address</Label>
                <Input value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="rounded-xl" placeholder="john@company.com" />
              </div>
              <div className="space-y-2">
                <Label>Daily Limit</Label>
                <Input type="number" value={formData.dailySendLimit} onChange={e => setFormData({...formData, dailySendLimit: Number(e.target.value)})} className="rounded-xl" />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>SMTP Host</Label>
                <Input value={formData.smtpHost} onChange={e => setFormData({...formData, smtpHost: e.target.value})} className="rounded-xl font-mono text-sm" placeholder="smtp.gmail.com" />
              </div>
              <div className="space-y-2">
                <Label>SMTP Port</Label>
                <Input type="number" value={formData.smtpPort} onChange={e => setFormData({...formData, smtpPort: Number(e.target.value)})} className="rounded-xl" />
              </div>
              <div className="space-y-2">
                <Label>SMTP User</Label>
                <Input value={formData.smtpUser} onChange={e => setFormData({...formData, smtpUser: e.target.value})} className="rounded-xl" placeholder="Usually your email" />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>SMTP Password</Label>
                <Input type="password" value={formData.smtpPassword} onChange={e => setFormData({...formData, smtpPassword: e.target.value})} className="rounded-xl" placeholder="App password or secure password" />
              </div>
              <div className="col-span-2 mt-4">
                <Button 
                  onClick={handleCreate} 
                  disabled={createAccount.isPending || !formData.email || !formData.smtpHost} 
                  className="w-full rounded-xl"
                  data-testid="button-save-account"
                >
                  {createAccount.isPending ? "Saving..." : "Save Account"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          <div className="text-sm text-muted-foreground animate-pulse">Loading accounts...</div>
        ) : accounts?.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center p-12 text-center bg-muted/20 border border-border/50 rounded-2xl border-dashed">
            <Mail className="w-10 h-10 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium text-foreground">No email accounts</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Add your first SMTP account to start sending outreach emails.
            </p>
            <Button variant="outline" className="mt-6 rounded-xl" onClick={() => setOpen(true)}>
              Add Account
            </Button>
          </div>
        ) : (
          accounts?.map(acc => (
            <Card key={acc.id} className="glass-card hover:shadow-md transition-all duration-300">
              <CardContent className="p-6 flex flex-col gap-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                      <Mail className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-base leading-tight">{acc.name}</h3>
                      <p className="text-sm text-muted-foreground">{acc.email}</p>
                    </div>
                  </div>
                  <Switch checked={acc.isActive} onCheckedChange={(c) => handleToggle(acc.id, c)} data-testid={`switch-account-${acc.id}`} />
                </div>
                
                <div className="flex items-center justify-between text-sm p-4 bg-muted/30 rounded-xl border border-border/50">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground text-xs font-medium">Daily Limit</span>
                    <span className="font-semibold">{acc.dailySendLimit} msgs</span>
                  </div>
                  <div className="flex flex-col gap-0.5 text-right">
                    <span className="text-muted-foreground text-xs font-medium">Status</span>
                    {acc.isActive ? (
                      <span className="text-primary font-medium flex items-center gap-1.5 justify-end">
                        <CheckCircle2 className="w-3.5 h-3.5"/> Active
                      </span>
                    ) : (
                      <span className="text-muted-foreground font-medium flex items-center gap-1.5 justify-end">
                        <AlertCircle className="w-3.5 h-3.5"/> Disabled
                      </span>
                    )}
                  </div>
                </div>
                
                <div className="flex justify-end pt-2 border-t border-border/30">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleDelete(acc.id)} 
                    className="h-9 rounded-xl text-destructive hover:text-destructive hover:bg-destructive/10 px-4"
                    data-testid={`button-delete-account-${acc.id}`}
                  >
                    <Trash2 className="w-4 h-4 mr-2" /> Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
