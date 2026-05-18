import {
  useListSettings,
  useUpsertSetting,
  useTestAIConnection,
  getListSettingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, XCircle, BrainCircuit, Shield } from "lucide-react";

const OPENAI_MODELS = [
  { value: "gpt-4o-mini", label: "GPT-4o Mini (recommended)" },
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
  { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
];

export function Settings() {
  const { data: settings, isLoading } = useListSettings({ query: { queryKey: getListSettingsQueryKey(), staleTime: 10_000 } });
  const upsertSetting = useUpsertSetting();
  const testAIMut = useTestAIConnection();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Global filters
  const [blockedDomains, setBlockedDomains] = useState("");

  // AI settings
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiScoringEnabled, setAiScoringEnabled] = useState(false);
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("gpt-4o-mini");
  const [aiTestResult, setAiTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const initialized = useRef(false);

  useEffect(() => {
    if (settings && !initialized.current) {
      const find = (key: string) => settings.find((s) => s.key === key)?.value;
      const domains = find("blocked_domains");
      if (domains) setBlockedDomains(domains);
      setAiEnabled(find("ai_enabled") === "true");
      setAiScoringEnabled(find("ai_scoring_enabled") === "true");
      setOpenaiKey(find("openai_api_key") ?? "");
      setOpenaiModel(find("openai_model") ?? "gpt-4o-mini");
      initialized.current = true;
    }
  }, [settings]);

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

  const handleSaveAI = async () => {
    await save("ai_enabled", aiEnabled ? "true" : "false");
    await save("ai_scoring_enabled", aiScoringEnabled ? "true" : "false");
    await save("openai_api_key", openaiKey);
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

  return (
    <div className="space-y-8 max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">System Settings</h1>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground animate-pulse">Loading settings…</div>
      ) : (
        <>
          {/* Global Filters */}
          <Card className="glass-card">
            <CardHeader className="border-b border-border/30 pb-4">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-muted-foreground" />
                <CardTitle className="text-lg font-medium text-foreground">Global Filters</CardTitle>
              </div>
              <CardDescription>Configure system-wide rules for discovery and extraction.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="space-y-3">
                <Label className="text-sm font-medium">Blocked Domains</Label>
                <p className="text-xs text-muted-foreground">Leads matching these domains will be automatically rejected. Enter one domain per line.</p>
                <Textarea
                  value={blockedDomains}
                  onChange={(e) => setBlockedDomains(e.target.value)}
                  className="rounded-xl bg-background/50 min-h-[200px] font-mono text-sm leading-relaxed"
                  placeholder={"ibm.com\nmicrosoft.com\napple.com"}
                  data-testid="textarea-blocked-domains"
                />
              </div>
              <div className="flex justify-end pt-4 border-t border-border/30">
                <Button onClick={handleSaveFilters} disabled={upsertSetting.isPending} className="rounded-xl px-6" data-testid="button-save-settings">
                  {upsertSetting.isPending ? "Saving…" : "Save Settings"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* AI Settings */}
          <Card className="glass-card">
            <CardHeader className="border-b border-border/30 pb-4">
              <div className="flex items-center gap-2">
                <BrainCircuit className="w-4 h-4 text-violet-500" />
                <CardTitle className="text-lg font-medium text-foreground">AI Settings</CardTitle>
              </div>
              <CardDescription>Configure OpenAI for AI-powered email personalization. The API key is stored encrypted and never shown in full after saving.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              {/* Enable AI Personalization toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">Enable AI Personalization</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">When enabled, emails are personalized using OpenAI during outreach queuing.</p>
                </div>
                <Switch
                  checked={aiEnabled}
                  onCheckedChange={setAiEnabled}
                  data-testid="toggle-ai-enabled"
                />
              </div>

              {/* Enable AI Scoring toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">AI Scoring Enabled</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">When enabled, lead relevance scoring uses OpenAI. When disabled, scoring uses rule-based keyword fallback.</p>
                </div>
                <Switch
                  checked={aiScoringEnabled}
                  onCheckedChange={setAiScoringEnabled}
                  data-testid="toggle-ai-scoring-enabled"
                />
              </div>

              {/* API Key */}
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
                <p className="text-[11px] text-muted-foreground">
                  If you see •••• it means a key is already stored. Entering a new value will replace it.
                </p>
              </div>

              {/* Model */}
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

              {/* Test connection */}
              <div className="space-y-3">
                <Button
                  variant="outline"
                  className="rounded-xl gap-2"
                  onClick={handleTestAI}
                  disabled={testAIMut.isPending}
                  data-testid="button-test-ai"
                >
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
        </>
      )}
    </div>
  );
}
