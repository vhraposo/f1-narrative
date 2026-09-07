"use client";

import { CalendarDays, MapPin } from "lucide-react";

import type { Race, Season } from "@/lib/championship";
import { RACE_SESSION_LABELS, type RaceSession } from "@/lib/world";

type CurrentRace = Pick<Race, "name" | "round" | "circuit" | "country" | "date">;

type ChampionshipContextProps = {
  season: Season;
  race?: CurrentRace | null;
  session?: RaceSession | null;
  isCurrentSeason?: boolean;
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function ChampionshipContext({
  season,
  race,
  session,
  isCurrentSeason = false,
}: ChampionshipContextProps) {
  return (
    <section
      aria-label="Contexto do campeonato"
      className="relative overflow-hidden rounded-xl border border-border bg-card"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[3px] bg-brand"
      />
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          {race?.round != null ? (
            <span className="rounded-sm border border-brand/30 bg-brand/10 px-2 py-0.5 text-xs font-bold tabular-nums tracking-wider text-brand">
              R{race.round}
            </span>
          ) : null}
          <span className="rounded-sm border border-border bg-muted/40 px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
            {season.year}
          </span>
          {race ? (
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {isCurrentSeason ? "Rodada atual" : "Rodada"}
            </span>
          ) : null}
        </div>

        {race ? (
          <>
            <h2 className="text-3xl font-black leading-tight tracking-tight text-foreground sm:text-4xl">
              {race.name}
            </h2>
            {race.circuit || race.country ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4" aria-hidden="true" />
                {[race.circuit, race.country].filter(Boolean).join(" — ")}
              </p>
            ) : null}
            {race.date ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarDays className="h-4 w-4" aria-hidden="true" />
                {formatDate(race.date)}
              </p>
            ) : null}
          </>
        ) : (
          <h2 className="text-3xl font-black leading-tight tracking-tight text-foreground sm:text-4xl">
            {season.name ?? `Temporada ${season.year}`}
          </h2>
        )}

        {session ? (
          <span className="inline-flex w-fit items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Sessão atual
            </span>
            <span className="text-sm font-black tracking-tight text-brand">
              {RACE_SESSION_LABELS[session]}
            </span>
          </span>
        ) : null}
      </div>
    </section>
  );
}
