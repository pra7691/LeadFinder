import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ScoreBadge({
  score,
  reason,
}: {
  score: number;
  reason?: string | null;
}) {
  const colorClass =
    score >= 80
      ? "bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/30"
      : score >= 60
        ? "bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/30"
        : score >= 40
          ? "bg-amber-500/15 text-amber-500 ring-1 ring-amber-500/30"
          : "bg-red-500/15 text-red-400 ring-1 ring-red-500/30";

  const badge = (
    <span
      className={`inline-flex items-center justify-center w-[38px] h-[22px] rounded-full text-[11px] font-semibold cursor-default ${colorClass}`}
    >
      {score}
    </span>
  );

  if (!reason) return badge;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px] text-xs text-center">
          {reason}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
