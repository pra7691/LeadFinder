import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import { ThemeProvider } from "@/components/theme-provider";
import { ErrorBoundary } from "@/components/ErrorBoundary";

import { Dashboard } from "@/pages/dashboard";
import { Campaigns } from "@/pages/campaigns";
import { CampaignDetail } from "@/pages/campaign-detail";
import { Leads } from "@/pages/leads";
import { Lists } from "@/pages/lists";
import { ListDetail } from "@/pages/list-detail";
import { EmailAccounts } from "@/pages/email-accounts";
import { EmailTemplates } from "@/pages/email-templates";
import { Outreach } from "@/pages/outreach";
import { Logs } from "@/pages/logs";
import { Settings } from "@/pages/settings";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Layout>
      <ErrorBoundary>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/campaigns" component={Campaigns} />
          <Route path="/campaigns/:id" component={CampaignDetail} />
          <Route path="/leads" component={Leads} />
          <Route path="/lists/:id" component={ListDetail} />
          <Route path="/lists" component={Lists} />
          <Route path="/email-accounts" component={EmailAccounts} />
          <Route path="/email-templates" component={EmailTemplates} />
          <Route path="/outreach" component={Outreach} />
          <Route path="/logs" component={Logs} />
          <Route path="/settings" component={Settings} />
          <Route component={NotFound} />
        </Switch>
      </ErrorBoundary>
    </Layout>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="leadgen-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
