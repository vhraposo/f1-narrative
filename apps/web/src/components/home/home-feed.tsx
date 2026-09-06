"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { SectionHeading } from "@/components/home/section-heading";
import { useEvents } from "@/hooks/use-events";
import {
  EVENT_IMPORTANCE_LABELS,
  EVENT_TYPE_LABELS,
  type EventImportance,
} from "@/lib/events";
import { cn } from "@/lib/utils";

const IMPORTANCE_DOT: Record<EventImportance, string> = {
  CRITICAL: "bg-brand",
  HIGH: "bg-warning",
  MEDIUM: "bg-info",
  LOW: "bg-muted-foreground/50",
};

function formatShort(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function HomeFeed() {
  const { data, isLoading } = useEvents();
  const events = [...(data ?? [])]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  return (
    <section aria-label="Eventos recentes">
      <SectionHeading
        kicker="Narrativa em movimento"
        title="Eventos recentes"
        action={
          <Link
            href="/app/events"
            className="group inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors motion-safe:transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Ver todos
            <ArrowRight
              className="h-4 w-4 transition-transform motion-safe:transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
        }
      />
      <div className="mt-5 rounded-md border border-border bg-card px-5">
        {isLoading ? (
          <p className="py-5 text-sm text-muted-foreground">
            Carregando os eventos…
          </p>
        ) : events.length === 0 ? (
          <div className="py-6">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Nenhum evento registrado ainda.{" "}
              <Link
                href="/app/events"
                className="font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                Crie o primeiro
              </Link>{" "}
              para movimentar a história.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((event) => (
              <li key={event.id} className="flex items-start gap-3 py-4">
                <span
                  className={cn(
                    "mt-2 h-2 w-2 shrink-0 rounded-full",
                    IMPORTANCE_DOT[event.importance],
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {EVENT_TYPE_LABELS[event.type]}
                  </p>
                  <p className="mt-1 truncate text-sm font-semibold text-foreground">
                    {event.title}
                  </p>
                  <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                    {EVENT_IMPORTANCE_LABELS[event.importance]} ·{" "}
                    {formatShort(event.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}