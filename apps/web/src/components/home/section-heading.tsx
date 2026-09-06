import type { ReactNode } from "react";

export function SectionHeading({
  kicker,
  title,
  action,
}: {
  kicker: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand">
          {kicker}
        </p>
        <h2 className="mt-1 text-2xl font-black tracking-tight text-foreground sm:text-3xl">
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}