import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertCircle } from "lucide-react";

export function ScoreBadge({
  score,
  reason,
  scoringMethod,
}: {
  score?: number | null;
  reason?: string | null;
  scoringMethod?: string | null;
}) {
  const failed = !!scoringMethod?.startsWith("failed");
  const hasScore = typeof score === "number";

  const colorClass =
    failed
      ? "bg-red-500/15 text-red-400 ring-1 ring-red-500/30"
      : !hasScore
        ? "bg-muted/40 text-muted-foreground ring-1 ring-border/40"
        : score >= 80
      ? "bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/30"
      : score >= 60
        ? "bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/30"
        : score >= 40
          ? "bg-amber-500/15 text-amber-500 ring-1 ring-amber-500/30"
          : "bg-red-500/15 text-red-400 ring-1 ring-red-500/30";

  const methodLabel =
    failed
      ? null
      : scoringMethod === "ai"
      ? "AI"
      : scoringMethod === "keyword_fallback"
        ? "KW"
        : null;

  const methodTitle =
    failed
      ? scoringMethod === "failed_ai_not_configured"
        ? "Scoring failed — AI is not configured"
        : scoringMethod === "failed_ai_error"
          ? "Scoring failed — OpenAI request failed"
          : "Scoring failed"
      : scoringMethod === "ai"
        ? "Scored by AI"
        : scoringMethod === "keyword_fallback"
          ? "Scored by keyword matching (AI unavailable)"
          : "Not yet scored";

  const tooltipText = [reason, methodTitle].filter(Boolean).join(" · ");

  const badge = failed ? (
    <span className="inline-flex items-center gap-1 cursor-default">
      <span className="inline-flex items-center justify-center w-[38px] h-[22px] rounded-full text-[11px] font-semibold bg-red-500/15 text-red-500 ring-1 ring-red-500/30">
        <AlertCircle className="w-3.5 h-3.5" />
      </span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 cursor-default">
      <span
        className={`inline-flex items-center justify-center w-[38px] h-[22px] rounded-full text-[11px] font-semibold ${colorClass}`}
      >
        {hasScore ? score : "—"}
      </span>
      {methodLabel && (
        <span
          className={`inline-flex items-center justify-center h-[16px] px-[5px] rounded-full text-[9px] font-bold tracking-wide ${
            scoringMethod === "ai"
              ? "bg-violet-500/15 text-violet-400 ring-1 ring-violet-500/30"
              : "bg-zinc-500/15 text-zinc-400 ring-1 ring-zinc-500/30"
          }`}
        >
          {methodLabel}
        </span>
      )}
    </span>
  );

  if (!tooltipText) return badge;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px] text-xs text-center">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
