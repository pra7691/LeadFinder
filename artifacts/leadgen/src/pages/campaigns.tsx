import { useListCampaigns, useCreateCampaign } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Plus, Activity, Pause } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { getListCampaignsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

export function Campaigns() {
  const { data: campaigns, isLoading } = useListCampaigns();
  const createCampaign = useCreateCampaign();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");

  const handleCreate = () => {
    createCampaign.mutate({
      data: { name, objective, isActive: true }
    }, {
      onSuccess: () => {
        setOpen(false);
        setName("");
        setObjective("");
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">Campaigns</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="font-mono text-xs uppercase" size="sm">
              <Plus className="w-4 h-4 mr-2" /> New Campaign
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle className="font-mono uppercase">Create Campaign</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CTOs in SaaS" className="font-mono text-sm" />
              </div>
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase">Objective</Label>
                <Input value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="What are we selling?" className="font-mono text-sm" />
              </div>
              <Button onClick={handleCreate} disabled={!name || !objective || createCampaign.isPending} className="w-full font-mono text-xs uppercase">
                {createCampaign.isPending ? "Creating..." : "Create Campaign"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-sm font-mono text-muted-foreground">LOADING...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {campaigns?.map((campaign) => (
            <Link key={campaign.id} href={`/campaigns/${campaign.id}`}>
              <Card className="bg-card border-border hover:border-primary/50 transition-colors cursor-pointer group shadow-none h-full">
                <CardContent className="p-5 flex flex-col h-full">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="font-bold text-lg leading-tight group-hover:text-primary transition-colors">{campaign.name}</h3>
                    {campaign.isActive ? (
                      <span className="flex items-center text-[10px] font-mono font-bold text-primary bg-primary/10 px-2 py-1 rounded uppercase">
                        <Activity className="w-3 h-3 mr-1" /> Active
                      </span>
                    ) : (
                      <span className="flex items-center text-[10px] font-mono font-bold text-muted-foreground bg-muted px-2 py-1 rounded uppercase">
                        <Pause className="w-3 h-3 mr-1" /> Paused
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2 flex-1">{campaign.objective}</p>
                  
                  <div className="flex gap-2 flex-wrap mt-auto pt-4 border-t border-border/50">
                    {(campaign.keywords || []).slice(0, 3).map((kw, i) => (
                      <span key={i} className="text-[10px] font-mono bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                        {kw}
                      </span>
                    ))}
                    {(campaign.keywords?.length || 0) > 3 && (
                      <span className="text-[10px] font-mono text-muted-foreground">+{campaign.keywords!.length - 3}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
          {!campaigns?.length && <div className="text-sm text-muted-foreground font-mono col-span-full">No campaigns found.</div>}
        </div>
      )}
    </div>
  );
}
