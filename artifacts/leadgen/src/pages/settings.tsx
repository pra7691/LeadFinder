import {
  useListSettings,
  useUpsertSetting,
  useTestAIConnection,
  useTestSerperConnection,
  getListSettingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, XCircle, BrainCircuit, Shield, Activity, RefreshCw, AlertTriangle, Search, Mail, FileText, HelpCircle, Download, MousePointerClick, Gauge } from "lucide-react";
import { EmailAccounts } from "@/pages/email-accounts";
import { EmailTemplates } from "@/pages/email-templates";
import { saveTextExportToServer } from "@/lib/export-files";

// ---------------------------------------------------------------------------
// System Health types + fetcher
// ---------------------------------------------------------------------------

interface DeepHealthResponse {
  status: "ok" | "warning" | "error";
  database: {
    connected: boolean;
    missingTables: string[];
    missingColumns: string[];
    warnings: string[];
  };
  message: string;
}

function makeErrorDb() {
  return { connected: false, missingTables: [] as string[], missingColumns: [] as string[], warnings: [] as string[] };
}

async function fetchDeepHealth(): Promise<DeepHealthResponse> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}api/healthz/deep`);
    const json = await res.json().catch(() => null);
    if (json && typeof json === "object" && "status" in json) {
      return json as DeepHealthResponse;
    }
    return {
      status: "error",
      database: makeErrorDb(),
      message: res.ok ? "Unexpected response from health endpoint" : `Health endpoint returned ${res.status}`,
    };
  } catch {
    return {
      status: "error",
      database: makeErrorDb(),
      message: "Could not reach the API server",
    };
  }
}

function SystemHealthCard() {
  const { data, isLoading, isFetching, refetch } = useQuery<DeepHealthResponse>({
    queryKey: ["healthz-deep"],
    queryFn: fetchDeepHealth,
    staleTime: 30_000,
    retry: false,
  });

  const statusColor = {
    ok: "text-emerald-600 dark:text-emerald-400",
    warning: "text-amber-600 dark:text-amber-400",
    error: "text-red-600 dark:text-red-400",
  };
  const statusBg = {
    ok: "bg-emerald-500/10",
    warning: "bg-amber-500/10",
    error: "bg-red-500/10",
  };
  const StatusIcon = {
    ok: CheckCircle2,
    warning: AlertTriangle,
    error: XCircle,
  };

  const status = data?.status ?? (isLoading ? null : "error");

  return (
    <Card className="glass-card">
      <CardHeader className="border-b border-border/30 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-lg font-medium text-foreground">System Health</CardTitle>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-lg"
            onClick={() => refetch()}
            disabled={isFetching}
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <CardDescription>Database connectivity and schema status.</CardDescription>
      </CardHeader>
      <CardContent className="pt-6 space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking…
          </div>
        ) : status ? (
          <>
            {/* Overall status banner */}
            <div className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm ${statusBg[status]}`}>
              {(() => { const Icon = StatusIcon[status]; return <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${statusColor[status]}`} />; })()}
              <div className="space-y-0.5">
                <p className={`font-medium ${statusColor[status]}`}>
                  {status === "ok" && "All systems operational"}
                  {status === "warning" && "Operational — configuration incomplete"}
                  {status === "error" && "Action required"}
                </p>
                <p className="text-xs text-muted-foreground">{data?.message}</p>
              </div>
            </div>

            {/* Individual checks */}
            <div className="space-y-2">
              <HealthRow label="API alive" ok={true} />
              <HealthRow label="Database connected" ok={data?.database.connected ?? false} />
              <HealthRow
                label="Schema applied"
                ok={(data?.database.missingTables.length ?? 0) === 0 && (data?.database.missingColumns.length ?? 0) === 0}
              />
            </div>

            {/* Missing tables */}
            {(data?.database.missingTables.length ?? 0) > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-red-600 dark:text-red-400">Missing tables</p>
                <div className="rounded-lg bg-background/60 border border-border/40 px-3 py-2 space-y-0.5">
                  {data!.database.missingTables.map((t) => (
                    <p key={t} className="font-mono text-xs text-muted-foreground">{t}</p>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground pt-1">
                  Run: <code className="font-mono bg-muted px-1 rounded">pnpm --filter @workspace/db run push</code>
                </p>
              </div>
            )}

            {/* Missing columns */}
            {(data?.database.missingColumns.length ?? 0) > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-red-600 dark:text-red-400">Missing columns</p>
                <div className="rounded-lg bg-background/60 border border-border/40 px-3 py-2 space-y-0.5">
                  {data!.database.missingColumns.map((c) => (
                    <p key={c} className="font-mono text-xs text-muted-foreground">{c}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Warnings */}
            {(data?.database.warnings.length ?? 0) > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-amber-600 dark:text-amber-400">Warnings</p>
                <div className="space-y-0.5">
                  {data!.database.warnings.map((w) => (
                    <p key={w} className="text-xs text-muted-foreground">{w}</p>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Health check unavailable.</p>
        )}
      </CardContent>
    </Card>
  );
}

function HealthRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      {ok ? (
        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
          <CheckCircle2 className="w-3.5 h-3.5" /> OK
        </span>
      ) : (
        <span className="flex items-center gap-1 text-red-600 dark:text-red-400 text-xs font-medium">
          <XCircle className="w-3.5 h-3.5" /> Failed
        </span>
      )}
    </div>
  );
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function exportBlockedDomainsCsv(value: string) {
  const domains = value
    .split(/\r?\n/)
    .map((domain) => domain.trim())
    .filter(Boolean);
  const csv = ["Domain", ...domains].map(csvEscape).join("\r\n") + "\r\n";
  return saveTextExportToServer(`blocked-domains-${new Date().toISOString().slice(0, 10)}.csv`, csv);
}

const OPENAI_MODELS = [
  { value: "gpt-4o-mini", label: "GPT-4o Mini (recommended)" },
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
  { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
];

const SETTINGS_TABS = [
  { value: "domains", path: "/settings/domains", label: "Domains", icon: Shield },
  { value: "limits", path: "/settings/limits", label: "Limits", icon: Gauge },
  { value: "ai", path: "/settings/ai", label: "AI", icon: BrainCircuit },
  { value: "serp", path: "/settings/serp", label: "SERP", icon: Search },
  { value: "email-templates", path: "/settings/email-templates", label: "Email Templates", icon: FileText },
  { value: "email-accounts", path: "/settings/email-accounts", label: "Email Accounts", icon: Mail },
  { value: "email-tracking", path: "/settings/email-tracking", label: "Email Tracking", icon: MousePointerClick },
  { value: "help", path: "/settings/help", label: "Help", icon: HelpCircle },
] as const;

type SettingsTab = typeof SETTINGS_TABS[number]["value"];

function normalizeSettingsTab(section: string | undefined): SettingsTab {
  return SETTINGS_TABS.some((tab) => tab.value === section) ? (section as SettingsTab) : "domains";
}

export function Settings() {
  const params = useParams<{ section?: string }>();
  const activeTab = normalizeSettingsTab(params.section);
  const [, navigate] = useLocation();
  const { data: settings, isLoading } = useListSettings({ query: { queryKey: getListSettingsQueryKey(), staleTime: 10_000 } });
  const upsertSetting = useUpsertSetting();
  const testSerperMut = useTestSerperConnection();
  const testAIMut = useTestAIConnection();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Global filters
  const [blockedDomains, setBlockedDomains] = useState("");

  // Search API settings
  const [serperKey, setSerperKey] = useState("");
  const [serperTestResult, setSerperTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // AI settings
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiScoringEnabled, setAiScoringEnabled] = useState(false);
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("gpt-4o-mini");
  const [aiTestResult, setAiTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Email tracking
  const [emailTrackerUrl, setEmailTrackerUrl] = useState("");
  const [emailTrackerSecret, setEmailTrackerSecret] = useState("");

  // Global limits
  const [globalMaxSearches, setGlobalMaxSearches] = useState("10");
  const [globalMaxEmails, setGlobalMaxEmails] = useState("20");

  const initialized = useRef(false);
  const settingRows = Array.isArray(settings) ? settings : [];

  useEffect(() => {
    if (settingRows.length > 0 && !initialized.current) {
      const find = (key: string) => settingRows.find((s) => s.key === key)?.value;
      const domains = find("blocked_domains");
      if (domains) setBlockedDomains(domains);
      setSerperKey(find("serper_api_key") ?? "");
      setAiEnabled(find("ai_enabled") === "true");
      setAiScoringEnabled(find("ai_scoring_enabled") === "true");
      setOpenaiKey(find("openai_api_key") ?? "");
      setOpenaiModel(find("openai_model") ?? "gpt-4o-mini");
      setEmailTrackerUrl(find("email_tracker_url") ?? "");
      setEmailTrackerSecret(find("email_tracker_admin_secret") ?? "");
      setGlobalMaxSearches(find("global_max_searches_per_day") ?? "10");
      setGlobalMaxEmails(find("global_max_emails_per_day") ?? "20");
      initialized.current = true;
    }
  }, [settingRows]);

  const save = (key: string, value: string) =>
    new Promise<void>((resolve, reject) =>
      upsertSetting.mutate(
        { key, data: { value } },
        {
          onSuccess: () => resolve(),
          onError: reject,
        },
      ),
    );

  const handleSaveFilters = async () => {
    await save("blocked_domains", blockedDomains);
    queryClient.invalidateQueries({ queryKey: getListSettingsQueryKey() });
    toast({ title: "Settings saved." });
  };

  const handleSaveLimits = async () => {
    await save("global_max_searches_per_day", globalMaxSearches);
    await save("global_max_emails_per_day", globalMaxEmails);
    queryClient.invalidateQueries({ queryKey: getListSettingsQueryKey() });
    toast({ title: "Limits saved." });
  };

  const handleSaveSerper = async () => {
    // Don't overwrite a real key with the masked placeholder
    if (!serperKey.startsWith("••••••••")) {
      await save("serper_api_key", serperKey);
      queryClient.invalidateQueries({ queryKey: getListSettingsQueryKey() });
    }
    toast({ title: "Search API settings saved." });
  };

  const handleTestSerper = () => {
    setSerperTestResult(null);
    testSerperMut.mutate(undefined, {
      onSuccess: (r) => setSerperTestResult({ success: r.success, message: r.message }),
      onError: () => setSerperTestResult({ success: false, message: "Request failed. Check server logs." }),
    });
  };

  const handleSaveAI = async () => {
    await save("ai_enabled", aiEnabled ? "true" : "false");
    await save("ai_scoring_enabled", aiScoringEnabled ? "true" : "false");
    if (!openaiKey.startsWith("••••••••")) {
      await save("openai_api_key", openaiKey);
    }
    await save("openai_model", openaiModel);
    queryClient.invalidateQueries({ queryKey: getListSettingsQueryKey() });
    toast({ title: "AI settings saved." });
  };

  const handleTestAI = () => {
    setAiTestResult(null);
    testAIMut.mutate(undefined, {
      onSuccess: (r) => setAiTestResult({ success: r.success, message: r.message }),
      onError: () => setAiTestResult({ success: false, message: "Request failed. Check server logs." }),
    });
  };

  const handleSaveEmailTracking = async () => {
    await save("email_tracker_url", emailTrackerUrl.trim());
    if (!emailTrackerSecret.startsWith("••••••••")) {
      await save("email_tracker_admin_secret", emailTrackerSecret.trim());
    }
    queryClient.invalidateQueries({ queryKey: getListSettingsQueryKey() });
    toast({ title: "Email tracking settings saved." });
  };

  return (
    <div className="space-y-6 max-w-6xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">System Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Configuration, sending setup, templates, and health checks.</p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const tab = SETTINGS_TABS.find((item) => item.value === value);
          if (tab) navigate(tab.path);
        }}
        className="space-y-6"
      >
        <div className="overflow-x-auto pb-1">
          <TabsList className="h-auto flex w-max min-w-full justify-start rounded-xl bg-muted/50 p-1">
            {SETTINGS_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="gap-2 rounded-lg px-3 py-2">
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* ── Limits ───────────────────────────────────────────────────────── */}
        <TabsContent value="limits" className="mt-0 max-w-3xl">
          <Card className="glass-card">
            <CardHeader className="border-b border-border/30 pb-4">
              <CardTitle className="text-base font-semibold">Global Daily Limits</CardTitle>
              <CardDescription>
                These limits apply across all campaigns. The header bar shows today&apos;s usage vs. these limits in real time.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Max Searches / Day</Label>
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    value={globalMaxSearches}
                    onChange={(e) => setGlobalMaxSearches(e.target.value)}
                    className="rounded-xl bg-background/50"
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum number of Serper SERP searches performed across all campaigns in a single day.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Max Emails / Day</Label>
                  <Input
                    type="number"
                    min={1}
                    max={1000}
                    value={globalMaxEmails}
                    onChange={(e) => setGlobalMaxEmails(e.target.value)}
                    className="rounded-xl bg-background/50"
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum number of outreach emails sent in total across all campaigns in a single day.
                  </p>
                </div>
              </div>
              <Button onClick={handleSaveLimits} disabled={upsertSetting.isPending} className="rounded-xl">
                {upsertSetting.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Save Limits
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="domains" className="mt-0 max-w-3xl">
          {isLoading ? (
            <div className="text-sm text-muted-foreground animate-pulse">Loading settings…</div>
          ) : (
            <Card className="glass-card">
              <CardContent className="space-y-6 pt-6">
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Blocked Domains</Label>
                  <p className="text-xs text-muted-foreground">Leads matching these domains will be automatically rejected. Enter one domain per line.</p>
                  <Textarea
                    value={blockedDomains}
                    onChange={(e) => setBlockedDomains(e.target.value)}
                    className="rounded-xl bg-background/50 min-h-[260px] font-mono text-sm leading-relaxed"
                    placeholder={"ibm.com\nmicrosoft.com\napple.com"}
                    data-testid="textarea-blocked-domains"
                  />
                </div>
                <div className="flex flex-col-reverse gap-3 pt-4 border-t border-border/30 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      try {
                        const saved = await exportBlockedDomainsCsv(blockedDomains);
                        toast({ title: `Export saved to ${saved.relativePath}` });
                      } catch (err) {
                        const message = err instanceof Error ? err.message : "Export failed";
                        toast({ title: message, variant: "destructive" });
                      }
                    }}
                    disabled={!blockedDomains.trim()}
                    className="rounded-xl gap-2 px-6"
                    data-testid="button-export-blocked-domains"
                  >
                    <Download className="w-4 h-4" />
                    Export CSV
                  </Button>
                  <Button onClick={handleSaveFilters} disabled={upsertSetting.isPending} className="rounded-xl px-6" data-testid="button-save-settings">
                    {upsertSetting.isPending ? "Saving…" : "Save Domains"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="ai" className="mt-0 max-w-3xl">
          {isLoading ? (
            <div className="text-sm text-muted-foreground animate-pulse">Loading settings…</div>
          ) : (
            <Card className="glass-card">
              <CardHeader className="border-b border-border/30 pb-4">
                <div className="flex items-center gap-2">
                  <BrainCircuit className="w-4 h-4 text-violet-500" />
                  <CardTitle className="text-lg font-medium text-foreground">AI Settings</CardTitle>
                </div>
                <CardDescription>Configure OpenAI for scoring and email personalization. The API key is stored encrypted and never shown in full after saving.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label className="text-sm font-medium">Enable AI Personalization</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">When enabled, emails are personalized using OpenAI during outreach queuing.</p>
                  </div>
                  <Switch checked={aiEnabled} onCheckedChange={setAiEnabled} data-testid="toggle-ai-enabled" />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label className="text-sm font-medium">AI Scoring Enabled</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">When enabled, lead relevance scoring uses OpenAI. When disabled, scoring uses rule-based keyword fallback.</p>
                  </div>
                  <Switch checked={aiScoringEnabled} onCheckedChange={setAiScoringEnabled} data-testid="toggle-ai-scoring-enabled" />
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">OpenAI API Key</Label>
                  <Input
                    type="password"
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    placeholder="sk-…"
                    className="rounded-xl bg-background/50 font-mono"
                    data-testid="input-openai-key"
                  />
                  <p className="text-[11px] text-muted-foreground">If you see •••• it means a key is already stored. Entering a new value will replace it.</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">OpenAI Model</Label>
                  <Select value={openaiModel} onValueChange={setOpenaiModel}>
                    <SelectTrigger className="rounded-xl bg-background/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPENAI_MODELS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3">
                  <Button variant="outline" className="rounded-xl gap-2" onClick={handleTestAI} disabled={testAIMut.isPending} data-testid="button-test-ai">
                    {testAIMut.isPending ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Testing…</>
                    ) : (
                      <><BrainCircuit className="w-4 h-4" /> Test OpenAI Connection</>
                    )}
                  </Button>
                  {aiTestResult && (
                    <div className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${aiTestResult.success ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400"}`}>
                      {aiTestResult.success
                        ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                        : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                      <span>{aiTestResult.message}</span>
                    </div>
                  )}
                </div>

                <div className="flex justify-end pt-4 border-t border-border/30">
                  <Button onClick={handleSaveAI} disabled={upsertSetting.isPending} className="rounded-xl px-6" data-testid="button-save-ai">
                    {upsertSetting.isPending ? "Saving…" : "Save AI Settings"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="serp" className="mt-0 max-w-3xl">
          {isLoading ? (
            <div className="text-sm text-muted-foreground animate-pulse">Loading settings…</div>
          ) : (
            <Card className="glass-card">
              <CardHeader className="border-b border-border/30 pb-4">
                <div className="flex items-center gap-2">
                  <Search className="w-4 h-4 text-muted-foreground" />
                  <CardTitle className="text-lg font-medium text-foreground">SERP Settings</CardTitle>
                </div>
                <CardDescription>Serper API key for lead discovery searches. Stored in the database, no environment variable required.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Serper API Key</Label>
                  <Input
                    type="password"
                    value={serperKey}
                    onChange={(e) => setSerperKey(e.target.value)}
                    placeholder="Your Serper.dev API key"
                    className="rounded-xl bg-background/50 font-mono"
                    data-testid="input-serper-key"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    If you see •••• a key is already stored. Entering a new value will replace it.
                    Get a key at{" "}
                    <a href="https://serper.dev" target="_blank" rel="noopener noreferrer" className="underline">serper.dev</a>.
                  </p>
                </div>

                <div className="space-y-3">
                  <Button variant="outline" className="rounded-xl gap-2" onClick={handleTestSerper} disabled={testSerperMut.isPending} data-testid="button-test-serper">
                    {testSerperMut.isPending ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Testing…</>
                    ) : (
                      <><Search className="w-4 h-4" /> Test Serper Connection</>
                    )}
                  </Button>
                  {serperTestResult && (
                    <div className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${serperTestResult.success ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400"}`}>
                      {serperTestResult.success
                        ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                        : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                      <span>{serperTestResult.message}</span>
                    </div>
                  )}
                </div>

                <div className="flex justify-end pt-4 border-t border-border/30">
                  <Button onClick={handleSaveSerper} disabled={upsertSetting.isPending} className="rounded-xl px-6" data-testid="button-save-serper">
                    {upsertSetting.isPending ? "Saving…" : "Save SERP Settings"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="email-templates" className="mt-0">
          <EmailTemplates basePath="/settings/email-templates" />
        </TabsContent>

        <TabsContent value="email-accounts" className="mt-0">
          <EmailAccounts />
        </TabsContent>

        <TabsContent value="email-tracking" className="mt-0 max-w-3xl">
          {isLoading ? (
            <div className="text-sm text-muted-foreground animate-pulse">Loading settings…</div>
          ) : (
            <Card className="glass-card">
              <CardHeader className="border-b border-border/30 pb-4">
                <div className="flex items-center gap-2">
                  <MousePointerClick className="w-4 h-4 text-muted-foreground" />
                  <CardTitle className="text-lg font-medium text-foreground">Email Tracking</CardTitle>
                </div>
                <CardDescription>Track opens and clicks for emails sent from the outreach queue using your hosted tracker file.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Tracker URL</Label>
                  <Input
                    value={emailTrackerUrl}
                    onChange={(e) => setEmailTrackerUrl(e.target.value)}
                    placeholder="https://yourdomain.com/config/email-tracker-single-file.php"
                    className="rounded-xl bg-background/50 font-mono"
                    data-testid="input-email-tracker-url"
                  />
                  <p className="text-[11px] text-muted-foreground">This is the URL of the PHP tracker file you hosted. New outgoing emails will use this automatically.</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Admin Secret</Label>
                  <Input
                    type="password"
                    value={emailTrackerSecret}
                    onChange={(e) => setEmailTrackerSecret(e.target.value)}
                    placeholder="The secret you set inside the PHP file"
                    className="rounded-xl bg-background/50 font-mono"
                    data-testid="input-email-tracker-secret"
                  />
                  <p className="text-[11px] text-muted-foreground">Used only by LeadFinder to sync open and click totals from your tracker. It is masked after saving.</p>
                </div>

                <div className="flex justify-end pt-4 border-t border-border/30">
                  <Button onClick={handleSaveEmailTracking} disabled={upsertSetting.isPending} className="rounded-xl px-6" data-testid="button-save-email-tracking">
                    {upsertSetting.isPending ? "Saving…" : "Save Email Tracking"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="help" className="mt-0 max-w-3xl">
          <SystemHealthCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
