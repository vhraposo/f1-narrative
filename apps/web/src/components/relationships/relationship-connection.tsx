"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

type ConnectionPerson = {
  id: string;
  name: string;
  nationality: string;
  imageUrl: string | null;
};

type RelationshipConnectionProps = {
  a: ConnectionPerson;
  b: ConnectionPerson;
  dimensions?: Record<string, unknown>;
  className?: string;
};

function ConnectionSide({
  person,
  align,
}: {
  person: ConnectionPerson;
  align: "start" | "end";
}) {
  const initial = person.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col",
        align === "start" ? "items-start text-left" : "items-end text-right",
      )}
    >
      <span className="shrink-0">
        {person.imageUrl ? (
          <img
            src={person.imageUrl}
            alt=""
            className="h-10 w-10 rounded-full bg-muted object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-bold uppercase text-muted-foreground"
          >
            {initial}
          </span>
        )}
      </span>
      <Link
        href={`/app/characters/${person.id}`}
        aria-label={person.name}
        className="mt-1.5 max-w-[8rem] truncate text-sm font-semibold text-foreground transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm sm:max-w-[10rem]"
      >
        {person.name}
      </Link>
      <span className="mt-0.5 max-w-[8rem] truncate text-xs text-muted-foreground sm:max-w-[10rem]">
        {person.nationality}
      </span>
    </div>
  );
}

export function RelationshipConnection({
  a,
  b,
  dimensions,
  className,
}: RelationshipConnectionProps) {
  const entries = Object.entries(dimensions ?? {});

  return (
    <div className={className}>
      <div className="flex items-center justify-center gap-4 sm:gap-6">
        <ConnectionSide person={a} align="end" />

        <div
          aria-hidden="true"
          className="flex shrink-0 flex-col items-center text-muted-foreground"
        >
          <span className="h-8 w-px bg-border" />
          <span className="my-1 h-1.5 w-1.5 rounded-full bg-brand/50" />
          <span className="h-8 w-px bg-border" />
        </div>

        <ConnectionSide person={b} align="start" />
      </div>

      <div className="mt-4 border-t border-border pt-3">
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Sem dimensões definidas.
          </p>
        ) : (
          <dl className="space-y-1.5">
            {entries.map(([key, value]) => (
              <div
                key={key}
                className="flex items-baseline justify-between gap-4 text-sm"
              >
                <dt className="font-semibold uppercase tracking-wider text-muted-foreground">
                  {key}
                </dt>
                <dd className="text-right font-medium text-foreground">
                  {String(value)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
