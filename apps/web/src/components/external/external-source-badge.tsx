import { cn } from "@/lib/utils";

export function ExternalSourceBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground",
        className,
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand" />
      FONTE: JOLPICA-F1 · EXTERNAL
    </span>
  );
}