import { useListLeads, useUpdateLead } from "@workspace/api-client-react";
import { getListLeadsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Check, X, Search, Globe, Mail as MailIcon } from "lucide-react";

export function Leads() {
  const { data: leads, isLoading } = useListLeads({ limit: 100 });
  const updateLead = useUpdateLead();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const handleReview = (id: number, status: string) => {
    updateLead.mutate({
      id,
      data: { reviewStatus: 'reviewed', leadStatus: status }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });
      }
    });
  };

  const filteredLeads = leads?.filter(l => 
    l.companyName?.toLowerCase().includes(search.toLowerCase()) || 
    l.rootDomain?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Leads Queue</h1>
        <div className="relative w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input 
            placeholder="Search company or domain..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 rounded-xl bg-background/50 border-border/50"
          />
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow className="border-border/30 hover:bg-transparent">
              <TableHead className="w-[250px]">Company</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead className="text-center">Score</TableHead>
              <TableHead className="w-[200px]">Status</TableHead>
              <TableHead className="text-right w-[120px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground animate-pulse">Loading leads...</TableCell>
              </TableRow>
            ) : filteredLeads?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <Search className="w-6 h-6 opacity-20" />
                    <p>No leads found.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredLeads?.map((lead) => (
                <TableRow key={lead.id} className="group border-border/30 transition-colors">
                  <TableCell className="font-medium text-foreground">{lead.companyName}</TableCell>
                  <TableCell>
                    <a href={`https://${lead.rootDomain}`} target="_blank" rel="noreferrer" className="flex items-center text-muted-foreground hover:text-primary transition-colors text-sm">
                      <Globe className="w-3.5 h-3.5 mr-1.5 opacity-70" />
                      {lead.rootDomain}
                    </a>
                  </TableCell>
                  <TableCell>
                    {lead.emails ? (
                      <div className="flex items-center text-sm text-muted-foreground">
                        <MailIcon className="w-3.5 h-3.5 mr-1.5 opacity-70" />
                        <span className="truncate max-w-[150px]">{lead.emails.split(',')[0]}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground/50 italic">No email</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      (lead.relevanceScore || 0) >= 80 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                    }`}>
                      {lead.relevanceScore || 0}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium capitalize ${lead.reviewStatus === 'pending' ? 'bg-amber-500/10 text-amber-500' : 'bg-muted text-muted-foreground'}`}>
                        {lead.reviewStatus}
                      </span>
                      <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium capitalize ${lead.leadStatus === 'approved' ? 'bg-primary/10 text-primary' : lead.leadStatus === 'rejected' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>
                        {lead.leadStatus}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {lead.reviewStatus === 'pending' && (
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-8 w-8 rounded-full text-primary hover:bg-primary/10 hover:text-primary" 
                          onClick={() => handleReview(lead.id, 'approved')} 
                          disabled={updateLead.isPending}
                          data-testid={`btn-approve-${lead.id}`}
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-8 w-8 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive" 
                          onClick={() => handleReview(lead.id, 'rejected')} 
                          disabled={updateLead.isPending}
                          data-testid={`btn-reject-${lead.id}`}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
