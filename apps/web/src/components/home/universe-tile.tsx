import { ArrowUpRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export function UniverseTile({
  href,
  kicker,
  title,
  description,
  Icon,
  meta,
}: {
  href: string;
  kicker: string;
  title: string;
  description: string;
  Icon: LucideIcon;
  meta?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group relative flex h-full flex-col gap-6 rounded-md border border-border bg-card p-5 outline-none transition-colors motion-safe:transition-colors hover:border-brand hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <div className="flex items-start justify-between gap-4">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-sm border border-brand/30 bg-brand/10 text-brand">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <ArrowUpRight
          className="h-5 w-5 text-muted-foreground transition-transform motion-safe:transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand"
          aria-hidden="true"
        />
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {kicker}
        </p>
        <h3 className="mt-1.5 text-2xl font-black tracking-tight text-foreground">
          {title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
        {meta ? (
          <p className="mt-4 text-xs font-semibold tabular-nums uppercase tracking-[0.18em] text-brand">
            {meta}
          </p>
        ) : null}
      </div>
    </Link>
  );
}