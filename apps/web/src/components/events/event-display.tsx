import type { EventImportance } from "@/lib/events";
import { cn } from "@/lib/utils";

export const IMPORTANCE_SIGNAL_CLASS: Record<EventImportance, string> = {
  CRITICAL: "bg-brand",
  HIGH: "bg-warning",
  MEDIUM: "bg-info",
  LOW: "bg-muted-foreground/50",
};

export function ImportanceDot({
  importance,
  className,
}: {
  importance: EventImportance;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        IMPORTANCE_SIGNAL_CLASS[importance],
        className,
      )}
    />
  );
}