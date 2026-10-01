"use client";

import { ArrowRight, CalendarDays, Loader2, MapPin, Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { SectionHeading } from "@/components/home/section-heading";
import { Button } from "@/components/ui/button";
import { useNextRace } from "@/hooks/use-next-race";
import { useRaceWeekend, useRunWeekendSession } from "@/hooks/use-race-weekend";
import { API_BASE } from "@/lib/api";
import { RACE_SESSION_LABELS, type RaceSession } from "@/lib/world";
import type { WeekendSessionView } from "@/lib/weekend";
import { cn } from "@/lib/utils";

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function resultSummary(session: WeekendSessionView): string | null {
  const classified = session.results
    .filter((row) => row.position !== null)
    .sort((a, b) => (a.position as number) - (b.position as number))
    .slice(0, 3);
  if (classified.length === 0) return null;
  return classified
    .map((row) => {
      const points = row.points > 0 ? ` (${row.points} pts)` : "";
      return `P${row.position} ${row.driverName}${points}`;
    })
    .join(" · ");
}

export function HomeRaceWeekend() {
  const { data, isLoading, isError } = useNextRace();
  const race = data?.next ?? data?.current ?? null;
  const season = data?.season ?? null;
  const totalRounds = data?.totalRounds ?? 0;

  const weekendQuery = useRaceWeekend(race?.raceId);
  const runMutation = useRunWeekendSession(race?.raceId ?? "");
  const [actionError, setActionError] = useState<string | null>(null);

  const weekend = weekendQuery.data ?? null;
  const sessions = weekend?.sessions ?? [];
  const availableSession = sessions.find((item) => item.state === "AVAILABLE");
  const completedWithResults = [...sessions]
    .reverse()
    .find((item) => item.state === "COMPLETED" && item.results.length > 0);
  const currentSession =
    weekend?.currentSession ??
    ((weekend?.status ?? null) as RaceSession | null);
  const isBusy = runMutation.isPending;

  function handleRun(session: WeekendSessionView["session"]) {
    setActionError(null);
    runMutation.mutate(
      { session },
      {
        onError: (error) =>
          setActionError(
            error instanceof Error
              ? error.message
              : "Falha ao executar a sessão",
          ),
      },
    );
  }

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
        ) : isError || !race ? (
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
                      {totalRounds > 0 ? `/${totalRounds}` : ""}
                    </span>
                  ) : null}
                  {weekend?.effectiveSprint ? (
                    <span className="rounded-sm border border-border bg-muted/40 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-foreground">
                      Sprint
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
                {race.circuit ? (
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4" aria-hidden="true" />
                    {[
                      race.circuit.name,
                      [race.circuit.locality, race.circuit.country]
                        .filter(Boolean)
                        .join(", "),
                      race.circuit.lengthMeters !== null
                        ? `${(race.circuit.lengthMeters / 1000).toLocaleString("pt-BR", {
                            minimumFractionDigits: 3,
                            maximumFractionDigits: 3,
                          })} km`
                        : null,
                      race.circuit.turns !== null ? `${race.circuit.turns} curvas` : null,
                    ]
                      .filter(Boolean)
                      .join(" — ")}
                  </p>
                ) : null}
                {race.circuit?.layoutUrl ? (
                  <figure className="mt-3 space-y-1">
                    <img
                      src={`${API_BASE}${race.circuit.layoutUrl}`}
                      alt={`Layout do circuito ${race.circuit.name}`}
                      className="h-24 w-full max-w-xs rounded-sm border border-border bg-white object-contain p-1"
                    />
                    {race.circuit.layoutAttribution ? (
                      <figcaption className="text-[10px] text-muted-foreground">
                        {race.circuit.layoutAttribution}
                      </figcaption>
                    ) : null}
                  </figure>
                ) : null}
                {race.date ? (
                  <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                    <CalendarDays className="h-4 w-4" aria-hidden="true" />
                    {formatDate(race.date)}
                  </p>
                ) : null}
                <Link
                  href="/app/championship"
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  Ver evento
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
              {currentSession ? (
                <div className="rounded-sm border border-border bg-muted/30 px-3 py-2 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Sessão atual
                  </p>
                  <p className="mt-0.5 text-lg font-black tracking-tight text-brand">
                    {RACE_SESSION_LABELS[currentSession]}
                  </p>
                </div>
              ) : null}
            </div>

            {weekendQuery.isLoading ? (
              <p className="border-t border-border p-4 text-sm text-muted-foreground">
                Carregando o fim de semana…
              </p>
            ) : null}

            {weekendQuery.isError ? (
              <p
                className="border-t border-border p-4 text-sm text-destructive"
                role="alert"
              >
                Não foi possível carregar as sessões do fim de semana.
              </p>
            ) : null}

            {sessions.length > 0 ? (
              <>
                <div
                  className="grid border-t border-border"
                  style={{
                    gridTemplateColumns: `repeat(${sessions.length}, minmax(0, 1fr))`,
                  }}
                >
                  {sessions.map((item) => (
                    <div
                      key={item.session}
                      className={cn(
                        "border-r border-border px-2 py-3 text-center last:border-r-0",
                        item.state === "COMPLETED"
                          ? "bg-brand text-brand-foreground"
                          : item.state === "AVAILABLE"
                            ? "bg-brand/5 text-brand"
                            : "bg-muted/20 text-muted-foreground",
                      )}
                    >
                      <p
                        className={cn(
                          "truncate text-[10px] font-semibold uppercase tracking-[0.16em]",
                          item.state === "COMPLETED"
                            ? "opacity-80"
                            : "opacity-70",
                        )}
                      >
                        {RACE_SESSION_LABELS[item.session]}
                      </p>
                      <p className="mt-0.5 text-[10px] font-semibold">
                        {item.state === "COMPLETED"
                          ? "Concluída"
                          : item.state === "AVAILABLE"
                            ? "Disponível"
                            : "Bloqueada"}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
                  {availableSession ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => handleRun(availableSession.session)}
                    >
                      {isBusy ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="mr-2 h-4 w-4" />
                      )}
                      Executar {RACE_SESSION_LABELS[availableSession.session]}
                    </Button>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {weekend?.status === "FINISHED"
                        ? "Fim de semana concluído."
                        : "Nenhuma sessão disponível."}
                    </p>
                  )}
                  {completedWithResults ? (
                    <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {RACE_SESSION_LABELS[completedWithResults.session]}:{" "}
                      {resultSummary(completedWithResults) ??
                        "sem classificação"}
                    </p>
                  ) : null}
                </div>

                {actionError ? (
                  <p
                    className="px-4 pb-4 text-sm text-destructive"
                    role="alert"
                  >
                    {actionError}
                  </p>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
