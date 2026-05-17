import { useGetCampaign, useUpdateCampaign, useRunDiscovery } from "@workspace/api-client-react";
import { useParams } from "wouter";
import { getGetCampaignQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, Play, AlertCircle, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";

export function CampaignDetail() {
  const { id } = useParams();
  const campaignId = Number(id);
  const { data: campaign, isLoading } = useGetCampaign(campaignId, { query: { enabled: !!campaignId, queryKey: getGetCampaignQueryKey(campaignId) } });
  const updateCampaign = useUpdateCampaign();
  const runDiscovery = useRunDiscovery();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [formData, setFormData] = useState<any>({});
  const initialized = useRef(false);

  const [discoveryResult, setDiscoveryResult] = useState<any>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  useEffect(() => {
    if (campaign && !initialized.current) {
      setFormData({
        name: campaign.name,
        objective: campaign.objective,
        isActive: campaign.isActive,
        minRelevanceScore: campaign.minRelevanceScore,
        maxSearchesPerDay: campaign.maxSearchesPerDay,
        maxLeadsPerDay: campaign.maxLeadsPerDay,
        maxEmailsPerDay: campaign.maxEmailsPerDay,
        emailTemplate: campaign.emailTemplate || "",
        keywords: campaign.keywords?.join(", ") || "",
        countries: campaign.countries?.join(", ") || "",
      });
      initialized.current = true;
    }
  }, [campaign]);

  const handleSave = () => {
    updateCampaign.mutate({
      id: campaignId,
      data: {
        ...formData,
        keywords: formData.keywords.split(",").map((k: string) => k.trim()).filter(Boolean),
        countries: formData.countries.split(",").map((c: string) => c.trim()).filter(Boolean),
      }
    }, {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetCampaignQueryKey(campaignId), updated);
        toast({ title: "Campaign saved." });
      }
    });
  };

  const handleRunDiscovery = () => {
    setDiscoveryResult(null);
    setDiscoveryError(null);
    
    runDiscovery.mutate({ id: campaignId }, {
      onSuccess: (result) => {
        setDiscoveryResult(result);
        toast({ title: "Discovery run complete." });
      },
      onError: (err: any) => {
        setDiscoveryError(err.message || "An error occurred during discovery.");
        toast({ title: "Discovery failed.", variant: "destructive" });
      }
    });
  };

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground animate-pulse">Loading campaign...</div>;
  if (!campaign) return <div className="p-8 text-sm text-destructive">Campaign not found.</div>;

  return (
    <div className="space-y-8 max-w-5xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <Link href="/campaigns" className="text-muted-foreground hover:text-foreground transition-colors p-2 rounded-full hover:bg-muted">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight flex-1">{campaign.name}</h1>
        <Button 
          onClick={handleRunDiscovery} 
          disabled={runDiscovery.isPending || !campaign.isActive}
          variant="secondary"
          className="rounded-xl shadow-sm gap-2 bg-primary/10 text-primary hover:bg-primary/20"
          data-testid="button-run-discovery"
        >
          {runDiscovery.isPending ? (
            <span className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /> Running...
            </span>
          ) : (
            <><Play className="w-4 h-4" /> Run Discovery</>
          )}
        </Button>
        <Button 
          onClick={handleSave} 
          disabled={updateCampaign.isPending} 
          className="rounded-xl shadow-sm"
          data-testid="button-save-campaign"
        >
          {updateCampaign.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      {discoveryError && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-2xl flex items-start gap-3 text-destructive animate-in fade-in">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-sm">Discovery Failed</h4>
            <p className="text-sm mt-1 opacity-90">{discoveryError}</p>
          </div>
        </div>
      )}

      {discoveryResult && (
        <Card className="glass-card border-primary/20 bg-primary/5 animate-in fade-in">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="p-2 bg-primary/20 text-primary rounded-full shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-primary">Discovery Run Complete</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Searches</span>
                    <span className="text-2xl font-semibold" data-testid="stat-searches">{discoveryResult.searchesPerformed}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">New Leads</span>
                    <span className="text-2xl font-semibold text-primary" data-testid="stat-new-leads">{discoveryResult.newLeadsCreated}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Blocked</span>
                    <span className="text-2xl font-semibold text-amber-500" data-testid="stat-blocked">{discoveryResult.blockedSkipped}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Duplicates</span>
                    <span className="text-2xl font-semibold text-muted-foreground" data-testid="stat-duplicates">{discoveryResult.duplicatesSkipped}</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="glass-card">
          <CardHeader className="border-b border-border/30 pb-4">
            <CardTitle className="text-sm font-medium text-foreground">General Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">Name</Label>
              <Input 
                value={formData.name || ""} 
                onChange={(e) => setFormData({...formData, name: e.target.value})} 
                className="rounded-xl bg-background/50" 
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">Objective</Label>
              <Textarea 
                value={formData.objective || ""} 
                onChange={(e) => setFormData({...formData, objective: e.target.value})} 
                className="rounded-xl bg-background/50 min-h-[100px] resize-y" 
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">Keywords (comma separated)</Label>
              <Input 
                value={formData.keywords || ""} 
                onChange={(e) => setFormData({...formData, keywords: e.target.value})} 
                className="rounded-xl bg-background/50 font-mono text-sm" 
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">Countries (comma separated codes)</Label>
              <Input 
                value={formData.countries || ""} 
                onChange={(e) => setFormData({...formData, countries: e.target.value})} 
                className="rounded-xl bg-background/50 font-mono text-sm" 
                placeholder="US, UK, CA"
              />
            </div>
            <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl border border-border/50">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium text-foreground">Active Status</Label>
                <p className="text-xs text-muted-foreground">Campaign will run discovery when active</p>
              </div>
              <Switch checked={formData.isActive || false} onCheckedChange={(c) => setFormData({...formData, isActive: c})} />
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="border-b border-border/30 pb-4">
            <CardTitle className="text-sm font-medium text-foreground">Limits & Templates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Min Relevance Score</Label>
                <Input type="number" value={formData.minRelevanceScore || 0} onChange={(e) => setFormData({...formData, minRelevanceScore: Number(e.target.value)})} className="rounded-xl bg-background/50" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Max Searches / Day</Label>
                <Input type="number" value={formData.maxSearchesPerDay || 0} onChange={(e) => setFormData({...formData, maxSearchesPerDay: Number(e.target.value)})} className="rounded-xl bg-background/50" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Max Leads / Day</Label>
                <Input type="number" value={formData.maxLeadsPerDay || 0} onChange={(e) => setFormData({...formData, maxLeadsPerDay: Number(e.target.value)})} className="rounded-xl bg-background/50" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Max Emails / Day</Label>
                <Input type="number" value={formData.maxEmailsPerDay || 0} onChange={(e) => setFormData({...formData, maxEmailsPerDay: Number(e.target.value)})} className="rounded-xl bg-background/50" />
              </div>
            </div>
            
            <div className="space-y-2 pt-2 border-t border-border/30">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium text-foreground">Email Template</Label>
              </div>
              <Textarea 
                value={formData.emailTemplate || ""} 
                onChange={(e) => setFormData({...formData, emailTemplate: e.target.value})} 
                className="rounded-xl bg-background/50 min-h-[250px] resize-y font-mono text-sm leading-relaxed border-primary/20 focus-visible:ring-primary/30" 
                placeholder="Hi {{firstName}},..."
              />
              <p className="text-[11px] text-muted-foreground">Use {'{{companyName}}'}, {'{{domain}}'}, etc. for variables.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
