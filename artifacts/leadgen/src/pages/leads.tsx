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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">Leads Queue</h1>
        <div className="relative w-64">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
          <Input 
            placeholder="Search leads..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 font-mono text-sm bg-card border-border"
          />
        </div>
      </div>

      <div className="border border-border rounded-md bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-[200px]">Company</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead className="text-center">Score</TableHead>
              <TableHead className="w-[200px]">Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground font-mono text-xs">LOADING...</TableCell>
              </TableRow>
            ) : filteredLeads?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground font-mono text-xs">NO LEADS FOUND</TableCell>
              </TableRow>
            ) : (
              filteredLeads?.map((lead) => (
                <TableRow key={lead.id} className="group border-border">
                  <TableCell className="font-medium font-mono text-xs">{lead.companyName}</TableCell>
                  <TableCell>
                    <a href={`https://${lead.rootDomain}`} target="_blank" rel="noreferrer" className="flex items-center text-muted-foreground hover:text-primary transition-colors text-xs font-mono">
                      <Globe className="w-3 h-3 mr-1" />
                      {lead.rootDomain}
                    </a>
                  </TableCell>
                  <TableCell>
                    {lead.emails ? (
                      <div className="flex items-center text-xs font-mono text-muted-foreground">
                        <MailIcon className="w-3 h-3 mr-1" />
                        {lead.emails.split(',')[0]}
                      </div>
                    ) : (
                      <span className="text-[10px] text-muted-foreground font-mono">NO EMAIL</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                      (lead.relevanceScore || 0) >= 80 ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                    }`}>
                      {lead.relevanceScore || 0}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${lead.reviewStatus === 'pending' ? 'bg-amber-500/20 text-amber-500' : 'bg-muted text-muted-foreground'}`}>
                        {lead.reviewStatus}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${lead.leadStatus === 'approved' ? 'bg-primary/20 text-primary' : lead.leadStatus === 'rejected' ? 'bg-destructive/20 text-destructive' : 'bg-muted text-muted-foreground'}`}>
                        {lead.leadStatus}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {lead.reviewStatus === 'pending' && (
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-primary hover:bg-primary/20 hover:text-primary" onClick={() => handleReview(lead.id, 'approved')} disabled={updateLead.isPending}>
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/20 hover:text-destructive" onClick={() => handleReview(lead.id, 'rejected')} disabled={updateLead.isPending}>
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
