import { useListCampaigns, useCreateCampaign } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Plus, Activity, Pause, Search, Briefcase } from "lucide-react";
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
  const [search, setSearch] = useState("");

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

  const filteredCampaigns = campaigns?.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Campaigns</h1>
        
        <div className="flex items-center gap-4">
          <div className="relative w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input 
              placeholder="Search campaigns..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 rounded-xl bg-background/50 border-border/50"
            />
          </div>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-xl shadow-sm" data-testid="button-new-campaign">
                <Plus className="w-4 h-4 mr-2" /> New Campaign
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] rounded-2xl border-border/50 bg-background/80 backdrop-blur-2xl">
              <DialogHeader>
                <DialogTitle className="text-xl">Create Campaign</DialogTitle>
              </DialogHeader>
              <div className="space-y-5 py-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input 
                    value={name} 
                    onChange={(e) => setName(e.target.value)} 
                    placeholder="e.g. CTOs in SaaS" 
                    className="rounded-xl"
                    data-testid="input-campaign-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Objective</Label>
                  <Input 
                    value={objective} 
                    onChange={(e) => setObjective(e.target.value)} 
                    placeholder="What are we selling?" 
                    className="rounded-xl"
                    data-testid="input-campaign-objective"
                  />
                </div>
                <Button 
                  onClick={handleCreate} 
                  disabled={!name || !objective || createCampaign.isPending} 
                  className="w-full rounded-xl"
                  data-testid="button-create-campaign"
                >
                  {createCampaign.isPending ? "Creating..." : "Create Campaign"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground animate-pulse">Loading campaigns...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCampaigns?.map((campaign) => (
            <Link key={campaign.id} href={`/campaigns/${campaign.id}`} data-testid={`link-campaign-${campaign.id}`}>
              <Card className="glass-card hover:shadow-md hover:border-primary/30 transition-all duration-300 cursor-pointer group h-full flex flex-col">
                <CardContent className="p-6 flex flex-col h-full">
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="font-semibold text-lg leading-tight group-hover:text-primary transition-colors">{campaign.name}</h3>
                    {campaign.isActive ? (
                      <span className="flex items-center text-[11px] font-medium text-primary bg-primary/10 px-2.5 py-1 rounded-full">
                        <Activity className="w-3 h-3 mr-1" /> Active
                      </span>
                    ) : (
                      <span className="flex items-center text-[11px] font-medium text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
                        <Pause className="w-3 h-3 mr-1" /> Paused
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mb-6 line-clamp-2 flex-1">{campaign.objective}</p>
                  
                  <div className="flex gap-2 flex-wrap mt-auto pt-4 border-t border-border/30">
                    {(campaign.keywords || []).slice(0, 3).map((kw, i) => (
                      <span key={i} className="text-[11px] font-medium bg-muted/50 text-muted-foreground px-2 py-1 rounded-md">
                        {kw}
                      </span>
                    ))}
                    {(campaign.keywords?.length || 0) > 3 && (
                      <span className="text-[11px] font-medium text-muted-foreground px-1 py-1">+{campaign.keywords!.length - 3}</span>
                    )}
                    {(!campaign.keywords || campaign.keywords.length === 0) && (
                      <span className="text-[11px] font-medium text-muted-foreground/50 italic px-1 py-1">No keywords</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
          {!filteredCampaigns?.length && (
            <div className="col-span-full flex flex-col items-center justify-center p-12 text-center bg-muted/20 border border-border/50 rounded-2xl border-dashed">
              <Briefcase className="w-10 h-10 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-medium text-foreground">No campaigns found</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                {search ? "Try adjusting your search query." : "Get started by creating your first discovery campaign."}
              </p>
              {!search && (
                <Button variant="outline" className="mt-6 rounded-xl" onClick={() => setOpen(true)}>
                  Create Campaign
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
