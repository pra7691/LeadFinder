import { useGetCampaign, useUpdateCampaign } from "@workspace/api-client-react";
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
import { ChevronLeft } from "lucide-react";
import { Link } from "wouter";

export function CampaignDetail() {
  const { id } = useParams();
  const campaignId = Number(id);
  const { data: campaign, isLoading } = useGetCampaign(campaignId, { query: { enabled: !!campaignId, queryKey: getGetCampaignQueryKey(campaignId) } });
  const updateCampaign = useUpdateCampaign();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [formData, setFormData] = useState<any>({});
  const initialized = useRef(false);

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

  if (isLoading) return <div className="text-sm font-mono text-muted-foreground p-6">LOADING CAMPAIGN...</div>;
  if (!campaign) return <div className="text-sm font-mono text-destructive p-6">Campaign not found.</div>;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <Link href="/campaigns" className="text-muted-foreground hover:text-foreground">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase flex-1">{campaign.name}</h1>
        <Button onClick={handleSave} disabled={updateCampaign.isPending} className="font-mono text-xs uppercase" size="sm">
          {updateCampaign.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-card border-border shadow-none">
          <CardHeader>
            <CardTitle className="text-xs font-mono uppercase text-muted-foreground">General Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="font-mono text-[10px] uppercase">Name</Label>
              <Input value={formData.name || ""} onChange={(e) => setFormData({...formData, name: e.target.value})} className="font-mono text-sm" />
            </div>
            <div className="space-y-2">
              <Label className="font-mono text-[10px] uppercase">Objective</Label>
              <Textarea value={formData.objective || ""} onChange={(e) => setFormData({...formData, objective: e.target.value})} className="font-mono text-sm min-h-[100px]" />
            </div>
            <div className="space-y-2">
              <Label className="font-mono text-[10px] uppercase">Keywords (comma separated)</Label>
              <Input value={formData.keywords || ""} onChange={(e) => setFormData({...formData, keywords: e.target.value})} className="font-mono text-sm" />
            </div>
            <div className="space-y-2">
              <Label className="font-mono text-[10px] uppercase">Countries (comma separated codes)</Label>
              <Input value={formData.countries || ""} onChange={(e) => setFormData({...formData, countries: e.target.value})} className="font-mono text-sm" />
            </div>
            <div className="flex items-center justify-between pt-4 border-t border-border">
              <Label className="font-mono text-[10px] uppercase">Active</Label>
              <Switch checked={formData.isActive || false} onCheckedChange={(c) => setFormData({...formData, isActive: c})} />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border shadow-none">
          <CardHeader>
            <CardTitle className="text-xs font-mono uppercase text-muted-foreground">Limits & Templates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase">Min Relevance Score</Label>
                <Input type="number" value={formData.minRelevanceScore || 0} onChange={(e) => setFormData({...formData, minRelevanceScore: Number(e.target.value)})} className="font-mono text-sm" />
              </div>
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase">Max Searches / Day</Label>
                <Input type="number" value={formData.maxSearchesPerDay || 0} onChange={(e) => setFormData({...formData, maxSearchesPerDay: Number(e.target.value)})} className="font-mono text-sm" />
              </div>
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase">Max Leads / Day</Label>
                <Input type="number" value={formData.maxLeadsPerDay || 0} onChange={(e) => setFormData({...formData, maxLeadsPerDay: Number(e.target.value)})} className="font-mono text-sm" />
              </div>
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase">Max Emails / Day</Label>
                <Input type="number" value={formData.maxEmailsPerDay || 0} onChange={(e) => setFormData({...formData, maxEmailsPerDay: Number(e.target.value)})} className="font-mono text-sm" />
              </div>
            </div>
            
            <div className="space-y-2 pt-4">
              <Label className="font-mono text-[10px] uppercase text-primary">Email Template</Label>
              <Textarea value={formData.emailTemplate || ""} onChange={(e) => setFormData({...formData, emailTemplate: e.target.value})} className="font-mono text-sm min-h-[200px] border-primary/30 focus-visible:ring-primary/50" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
