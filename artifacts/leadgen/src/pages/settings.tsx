import { useListSettings, useUpsertSetting } from "@workspace/api-client-react";
import { getListSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
        toast({ title: "Settings saved successfully." });
      }
    });
  };

  return (
    <div className="space-y-8 max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">System Settings</h1>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground animate-pulse">Loading settings...</div>
      ) : (
        <Card className="glass-card">
          <CardHeader className="border-b border-border/30 pb-4">
            <CardTitle className="text-lg font-medium text-foreground">Global Filters</CardTitle>
            <CardDescription>Configure system-wide rules for discovery and extraction.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            <div className="space-y-3">
              <Label className="text-sm font-medium">Blocked Domains</Label>
              <p className="text-xs text-muted-foreground mb-2">Leads matching these domains will be automatically rejected. Enter one domain per line.</p>
              <Textarea 
                value={blockedDomains} 
                onChange={(e) => setBlockedDomains(e.target.value)} 
                className="rounded-xl bg-background/50 min-h-[250px] font-mono text-sm leading-relaxed" 
                placeholder="ibm.com&#10;microsoft.com&#10;apple.com"
                data-testid="textarea-blocked-domains"
              />
            </div>
            <div className="flex justify-end pt-4 border-t border-border/30">
              <Button 
                onClick={handleSave} 
                disabled={upsertSetting.isPending} 
                className="rounded-xl px-6"
                data-testid="button-save-settings"
              >
                {upsertSetting.isPending ? "Saving..." : "Save Settings"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
