"use client";

import { useEffect, useState } from "react";

import { SectionHeading } from "@/components/home/section-heading";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectTrigger } from "@/components/ui/select";
import {
  ExternalSectionEmpty,
  ExternalSectionError,
  ExternalSectionLoading,
} from "@/components/external/external-section-state";
import { ExternalSourceBadge } from "@/components/external/external-source-badge";
import type { DriverTeamInfo } from "@/components/external/external-standings";
import {
  positionSortKey,
  type ExternalRace,
  type ExternalResult,
} from "@/lib/external-world";

type ExternalResultsProps = {
  races: ExternalRace[];
  results: ExternalResult[];
  driverTeamByExternalId: Record<string, DriverTeamInfo>;
  isLoading: boolean;
  isError: boolean;
  refetching: boolean;
  onRetry: () => void;
};

export function ExternalResults({
  races,
  results,
  driverTeamByExternalId,
  isLoading,
  isError,
  refetching,
  onRetry,
}: ExternalResultsProps) {
  const [selectedRound, setSelectedRound] = useState<number | null>(null);

  const sortedRaces = [...races].sort((a, b) => a.round - b.round);

  useEffect(() => {
    if (sortedRaces.length === 0) return;
    setSelectedRound((current) =>
      current != null && sortedRaces.some((race) => race.round === current)
        ? current
        : sortedRaces[0].round,
    );
  }, [sortedRaces]);

  const roundResults = results
    .filter((result) => result.externalRace.round === selectedRound)
    .sort(
      (a, b) => positionSortKey(a.position) - positionSortKey(b.position),
    );
  const selectedRace =
    sortedRaces.find((race) => race.round === selectedRound) ?? null;

  return (
    <section aria-label="Resultados externos" className="space-y-4">
      <SectionHeading
        kicker="Dados Externos"
        title="Resultados"
        action={<ExternalSourceBadge />}
      />
      {isLoading && <ExternalSectionLoading />}
      {isError && (
        <ExternalSectionError
          description="Não foi possível carregar os resultados da fonte."
          refetching={refetching}
          onRetry={onRetry}
        />
      )}
      {!isLoading && !isError && sortedRaces.length === 0 && (
        <ExternalSectionEmpty
          title="Não há corridas da fonte para exibir resultados."
        />
      )}
      {!isLoading && !isError && sortedRaces.length > 0 && (
        <div className="space-y-4">
          <div className="w-full max-w-xs space-y-1.5">
            <Label htmlFor="external-results-race">Corrida</Label>
            <Select
              value={selectedRound != null ? String(selectedRound) : ""}
              onValueChange={(value) => setSelectedRound(Number(value))}
              options={sortedRaces.map((race) => ({
                value: String(race.round),
                label: `R${race.round} · ${
                  race.grandPrix ?? race.name ?? "Corrida"
                }`,
              }))}
              placeholder="Selecione a corrida"
            >
              <SelectTrigger
                id="external-results-race"
                aria-label="Corrida da fonte"
              />
              <SelectContent />
            </Select>
          </div>

          {roundResults.length === 0 && (
            <ExternalSectionEmpty
              title={
                selectedRace
                  ? "A fonte não informou resultados para esta corrida."
                  : "Nenhum resultado disponível."
              }
            />
          )}
          {roundResults.length > 0 && (
            <Card>
              <CardContent className="pt-6">
                <div className="overflow-x-auto rounded-md border border-border">
                  <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    <span className="w-10 shrink-0 text-center">Pos</span>
                    <span className="h-4 w-1 shrink-0" aria-hidden="true" />
                    <span className="flex-1">Piloto</span>
                    <span className="shrink-0 text-right">Pontos</span>
                  </div>
                  <ol className="divide-y divide-border">
                    {roundResults.map((result) => {
                      const team =
                        driverTeamByExternalId[
                          result.externalDriver.externalId
                        ] ?? null;
                      return (
                        <li
                          key={result.id}
                          className="flex items-center gap-3 px-4 py-3"
                        >
                          <span className="w-10 shrink-0 text-center text-sm font-black tabular-nums text-muted-foreground">
                            {result.position == null
                              ? "—"
                              : String(result.position).padStart(2, "0")}
                          </span>
                          <span
                            aria-hidden
                            className="h-4 w-1 shrink-0 rounded-full bg-foreground/10"
                            style={
                              team?.color
                                ? { backgroundColor: team.color }
                                : undefined
                            }
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-semibold text-foreground">
                                {result.externalDriver.name}
                              </span>
                              {result.fastestLap && (
                                <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                  VL
                                </span>
                              )}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {team?.teamName ?? "Equipe não informada"}
                              {result.status
                                ? ` · ${result.status}`
                                : ""}
                            </span>
                          </span>
                          <span className="shrink-0 text-right text-sm font-black tabular-nums text-foreground">
                            {result.points ?? "—"}{" "}
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              PTS
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </section>
  );
}