import { useListEmailAccounts, useCreateEmailAccount, useUpdateEmailAccount, useDeleteEmailAccount } from "@workspace/api-client-react";
import { getListEmailAccountsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useState } from "react";
import { Mail, Trash2, CheckCircle2, AlertCircle } from "lucide-react";

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
    if (confirm("Delete this email account?")) {
      deleteAccount.mutate({ id }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListEmailAccountsQueryKey() })
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">Email Accounts</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="font-mono text-xs uppercase" size="sm">Add Account</Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle className="font-mono uppercase">Add SMTP Account</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="space-y-2 col-span-2">
                <Label className="font-mono text-xs uppercase">Internal Name</Label>
                <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="font-mono text-sm" />
              </div>
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase">Email Address</Label>
                <Input value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="font-mono text-sm" />
              </div>
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase">Daily Limit</Label>
                <Input type="number" value={formData.dailySendLimit} onChange={e => setFormData({...formData, dailySendLimit: Number(e.target.value)})} className="font-mono text-sm" />
              </div>
              <div className="space-y-2 col-span-2">
                <Label className="font-mono text-xs uppercase">SMTP Host</Label>
                <Input value={formData.smtpHost} onChange={e => setFormData({...formData, smtpHost: e.target.value})} className="font-mono text-sm" />
              </div>
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase">SMTP Port</Label>
                <Input type="number" value={formData.smtpPort} onChange={e => setFormData({...formData, smtpPort: Number(e.target.value)})} className="font-mono text-sm" />
              </div>
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase">SMTP User</Label>
                <Input value={formData.smtpUser} onChange={e => setFormData({...formData, smtpUser: e.target.value})} className="font-mono text-sm" />
              </div>
              <div className="space-y-2 col-span-2">
                <Label className="font-mono text-xs uppercase">SMTP Password</Label>
                <Input type="password" value={formData.smtpPassword} onChange={e => setFormData({...formData, smtpPassword: e.target.value})} className="font-mono text-sm" />
              </div>
              <div className="col-span-2 mt-4">
                <Button onClick={handleCreate} disabled={createAccount.isPending || !formData.email || !formData.smtpHost} className="w-full font-mono text-xs uppercase">
                  Save Account
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="text-sm font-mono text-muted-foreground">LOADING...</div>
        ) : (
          accounts?.map(acc => (
            <Card key={acc.id} className="bg-card border-border shadow-none">
              <CardContent className="p-5 flex flex-col gap-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded bg-muted flex items-center justify-center border border-border">
                      <Mail className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="font-bold font-mono text-sm leading-tight">{acc.name}</h3>
                      <p className="text-xs text-muted-foreground font-mono">{acc.email}</p>
                    </div>
                  </div>
                  <Switch checked={acc.isActive} onCheckedChange={(c) => handleToggle(acc.id, c)} />
                </div>
                
                <div className="flex items-center justify-between text-xs font-mono p-3 bg-background rounded border border-border/50">
                  <div className="flex flex-col">
                    <span className="text-muted-foreground uppercase text-[10px]">Daily Limit</span>
                    <span>{acc.dailySendLimit} msgs</span>
                  </div>
                  <div className="flex flex-col text-right">
                    <span className="text-muted-foreground uppercase text-[10px]">Status</span>
                    {acc.isActive ? (
                      <span className="text-primary flex items-center gap-1 justify-end"><CheckCircle2 className="w-3 h-3"/> Active</span>
                    ) : (
                      <span className="text-muted-foreground flex items-center gap-1 justify-end"><AlertCircle className="w-3 h-3"/> Disabled</span>
                    )}
                  </div>
                </div>
                
                <div className="flex justify-end pt-2">
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(acc.id)} className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10 font-mono text-xs uppercase">
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
