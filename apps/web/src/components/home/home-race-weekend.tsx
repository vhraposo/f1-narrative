"use client";

import { ArrowRight, CalendarDays, MapPin } from "lucide-react";
import Link from "next/link";

import { SectionHeading } from "@/components/home/section-heading";
import { useRaces, useSeasons } from "@/hooks/use-championship";
import { useWorld } from "@/hooks/use-world";
import { RACE_SESSION_LABELS, type RaceSession } from "@/lib/world";
import { cn } from "@/lib/utils";

const SESSION_ORDER: RaceSession[] = ["PRACTICE", "QUALIFYING", "RACE"];
const SESSION_SHORT: Record<RaceSession, string> = {
  PRACTICE: "Treino",
  QUALIFYING: "Classificação",
  RACE: "Corrida",
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

export function HomeRaceWeekend() {
  const { data: world, isLoading } = useWorld();
  const { data: seasons } = useSeasons();
  const season = seasons?.find((s) => s.id === world?.currentSeasonId);
  const { data: races } = useRaces(season?.id ?? "");
  const race = races?.find((r) => r.id === world?.currentRaceId);

  return (
    <section aria-label="Próximo fim de semana">
      <SectionHeading
        kicker="Próximo fim de semana"
        title="O ritmo segue no mundo"
        action={
          <Link
            href="/app/championship"
            className="group inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors motion-safe:transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Campeonato
            <ArrowRight
              className="h-4 w-4 transition-transform motion-safe:transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
        }
      />
      <div className="mt-5 overflow-hidden rounded-md border border-border bg-card">
        {isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">
            Carregando o calendário…
          </p>
        ) : !world || !race ? (
          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Sem corrida definida
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Configure a temporada e o estado do mundo para acompanhar o fim
                de semana aqui.
              </p>
            </div>
            <Link
              href="/app/championship"
              className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Definir corrida
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        ) : (
          <>
            <div className="grid gap-6 p-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  {race.round != null ? (
                    <span className="rounded-sm border border-brand/30 bg-brand/10 px-2 py-0.5 text-xs font-bold tabular-nums tracking-wider text-brand">
                      R{race.round}
                    </span>
                  ) : null}
                  {season ? (
                    <span className="rounded-sm border border-border bg-muted/40 px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                      {season.year}
                    </span>
                  ) : null}
                </div>
                <h3 className="mt-3 text-3xl font-black tracking-tight text-foreground sm:text-4xl">
                  {race.name}
                </h3>
                {race.circuit || race.country ? (
                  <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4" aria-hidden="true" />
                    {[race.circuit, race.country].filter(Boolean).join(" — ")}
                  </p>
                ) : null}
                <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  {formatDate(world.currentDate)}
                </p>
              </div>
              {world.currentSession ? (
                <div className="rounded-sm border border-border bg-muted/30 px-3 py-2 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Sessão atual
                  </p>
                  <p className="mt-0.5 text-lg font-black tracking-tight text-brand">
                    {RACE_SESSION_LABELS[world.currentSession]}
                  </p>
                </div>
              ) : null}
            </div>
            <div className="grid grid-cols-3 border-t border-border">
              {SESSION_ORDER.map((session) => {
                const active = world.currentSession === session;
                return (
                  <div
                    key={session}
                    className={cn(
                      "px-4 py-3 text-center transition-colors motion-safe:transition-colors",
                      "border-r border-border last:border-r-0",
                      active
                        ? "bg-brand text-brand-foreground"
                        : "bg-muted/20 text-muted-foreground",
                    )}
                  >
                    <p
                      className={cn(
                        "text-[10px] font-semibold uppercase tracking-[0.2em]",
                        active ? "opacity-80" : "opacity-60",
                      )}
                    >
                      {SESSION_SHORT[session]}
                    </p>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </section>
  );
}