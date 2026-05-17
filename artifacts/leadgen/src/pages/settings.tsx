import { useListSettings, useUpsertSetting } from "@workspace/api-client-react";
import { getListSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";

export function Settings() {
  const { data: settings, isLoading } = useListSettings();
  const upsertSetting = useUpsertSetting();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [blockedDomains, setBlockedDomains] = useState("");
  const initialized = useRef(false);

  useEffect(() => {
    if (settings && !initialized.current) {
      const domainsSetting = settings.find(s => s.key === "blocked_domains");
      if (domainsSetting) {
        setBlockedDomains(domainsSetting.value);
      }
      initialized.current = true;
    }
  }, [settings]);

  const handleSave = () => {
    upsertSetting.mutate({
      key: "blocked_domains",
      data: { value: blockedDomains }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSettingsQueryKey() });
        toast({ title: "Settings saved" });
      }
    });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">System Settings</h1>
      </div>

      {isLoading ? (
        <div className="text-sm font-mono text-muted-foreground">LOADING...</div>
      ) : (
        <Card className="bg-card border-border shadow-none">
          <CardHeader>
            <CardTitle className="text-sm font-mono uppercase text-muted-foreground">Global Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase">Blocked Domains (One per line)</Label>
              <Textarea 
                value={blockedDomains} 
                onChange={(e) => setBlockedDomains(e.target.value)} 
                className="font-mono text-sm min-h-[200px]" 
                placeholder="ibm.com&#10;microsoft.com"
              />
              <p className="text-[10px] font-mono text-muted-foreground uppercase">Leads from these domains will be automatically rejected.</p>
            </div>
            <Button onClick={handleSave} disabled={upsertSetting.isPending} className="font-mono text-xs uppercase">
              {upsertSetting.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
