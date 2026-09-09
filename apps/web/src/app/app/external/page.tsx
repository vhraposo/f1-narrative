"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ExternalCalendar } from "@/components/external/external-calendar";
import { ExternalDrivers } from "@/components/external/external-drivers";
import { ExternalGrid } from "@/components/external/external-grid";
import { ExternalResults } from "@/components/external/external-results";
import { ExternalStandings } from "@/components/external/external-standings";
import { ExternalSourceBadge } from "@/components/external/external-source-badge";
import { ExternalTeams } from "@/components/external/external-teams";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectTrigger } from "@/components/ui/select";
import {
  useExternalDriverSeasons,
  useExternalDrivers,
  useExternalRaces,
  useExternalResults,
  useExternalSeasons,
  useExternalStandings,
  useExternalTeams,
} from "@/hooks/use-external-world";
import {
  EXTERNAL_SOURCE_NAME,
  EXTERNAL_SOURCE_REF,
  seasonStatusLabel,
  type ExternalDriver,
  type ExternalTeam,
} from "@/lib/external-world";

export default function F1WorldDataPage() {
  const seasonsQuery = useExternalSeasons();
  const teamsQuery = useExternalTeams();
  const driversQuery = useExternalDrivers();

  const [year, setYear] = useState<number | null>(null);
  const seasons = useMemo(() => seasonsQuery.data ?? [], [seasonsQuery.data]);

  useEffect(() => {
    if (year == null) {
      const latest = seasons[0]?.year;
      if (latest != null) setYear(latest);
    }
  }, [year, seasons]);

  const driverSeasonsQuery = useExternalDriverSeasons(year);
  const racesQuery = useExternalRaces(year);
  const resultsQuery = useExternalResults(year);
  const standingsQuery = useExternalStandings(year);

  const teamsByExternalId = useMemo(() => {
    const map: Record<string, ExternalTeam> = {};
    for (const team of teamsQuery.data ?? []) {
      map[team.externalId] = team;
    }
    return map;
  }, [teamsQuery.data]);

  const driversByExternalId = useMemo(() => {
    const map: Record<string, ExternalDriver> = {};
    for (const driver of driversQuery.data ?? []) {
      map[driver.externalId] = driver;
    }
    return map;
  }, [driversQuery.data]);

  const driverTeamByExternalId = useMemo(() => {
    const map: Record<string, { teamName: string | null; color: string | null }> =
      {};
    for (const ds of driverSeasonsQuery.data ?? []) {
      map[ds.externalDriver.externalId] = {
        teamName:
          ds.teamNameSnapshot ??
          (ds.teamExternalId
            ? teamsByExternalId[ds.teamExternalId]?.name ?? null
            : null),
        color: ds.teamExternalId
          ? teamsByExternalId[ds.teamExternalId]?.color ?? null
          : null,
      };
    }
    return map;
  }, [driverSeasonsQuery.data, teamsByExternalId]);

  const seasonOptions = seasons.map((season) => ({
    value: String(season.year),
    label: `${season.year} — ${seasonStatusLabel(season.status)}`,
  }));

  return (
    <div className="space-y-8">
      <PageHeader
        kicker="EXTERNAL WORLD DATA"
        title="F1 World Data"
        description={`Dados do Mirror Externo (${EXTERNAL_SOURCE_NAME} · ${EXTERNAL_SOURCE_REF}), somente leitura. Exibidos como contavam na fonte, sem alterar o universo narrativo.`}
        meta={
          seasons.length > 0
            ? `${seasons.length} temporada${seasons.length === 1 ? "" : "s"} na fonte`
            : undefined
        }
        action={<ExternalSourceBadge />}
      />

      {seasonsQuery.isLoading && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {seasonsQuery.isError && (
        <ErrorState
          title="Dados indisponíveis"
          description="Não foi possível carregar as temporadas da fonte."
          action={
            <Button
              variant="outline"
              onClick={() => void seasonsQuery.refetch()}
              disabled={seasonsQuery.isRefetching}
            >
              {seasonsQuery.isRefetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Tentar novamente
            </Button>
          }
        />
      )}

      {!seasonsQuery.isLoading &&
        !seasonsQuery.isError &&
        seasons.length === 0 && (
          <EmptyState
            title="Nenhum dado externo importado ainda."
            description="Não há temporadas do Mirror Externo disponíveis. A sincronização é feita pelo administrador no backend."
          />
        )}

      {!seasonsQuery.isLoading &&
        !seasonsQuery.isError &&
        seasons.length > 0 &&
        year != null && (
          <>
            <Card>
              <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    Temporada exibida
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Seleção baseada nas temporadas da fonte, não no estado do
                    universo.
                  </p>
                </div>
                <div className="w-full max-w-xs space-y-1.5">
                  <Label htmlFor="external-season">Temporada</Label>
                  <Select
                    value={String(year)}
                    onValueChange={(value) => setYear(Number(value))}
                    options={seasonOptions}
                    placeholder="Selecione a temporada"
                  >
                    <SelectTrigger
                      id="external-season"
                      aria-label="Temporada da fonte"
                    />
                    <SelectContent />
                  </Select>
                </div>
              </CardContent>
            </Card>

            <ExternalTeams
              year={year}
              driverSeasons={driverSeasonsQuery.data ?? []}
              teamsByExternalId={teamsByExternalId}
              isLoading={driverSeasonsQuery.isLoading}
              isError={driverSeasonsQuery.isError}
              refetching={driverSeasonsQuery.isRefetching}
              onRetry={() => void driverSeasonsQuery.refetch()}
            />

            <ExternalDrivers
              driverSeasons={driverSeasonsQuery.data ?? []}
              driversByExternalId={driversByExternalId}
              isLoading={driverSeasonsQuery.isLoading}
              isError={driverSeasonsQuery.isError}
              refetching={driverSeasonsQuery.isRefetching}
              onRetry={() => void driverSeasonsQuery.refetch()}
            />

            <ExternalGrid
              year={year}
              driverSeasons={driverSeasonsQuery.data ?? []}
              teamsByExternalId={teamsByExternalId}
              isLoading={driverSeasonsQuery.isLoading}
              isError={driverSeasonsQuery.isError}
              refetching={driverSeasonsQuery.isRefetching}
              onRetry={() => void driverSeasonsQuery.refetch()}
            />

            <ExternalCalendar
              races={racesQuery.data ?? []}
              isLoading={racesQuery.isLoading}
              isError={racesQuery.isError}
              refetching={racesQuery.isRefetching}
              onRetry={() => void racesQuery.refetch()}
            />

            <ExternalResults
              races={racesQuery.data ?? []}
              results={resultsQuery.data ?? []}
              driverTeamByExternalId={driverTeamByExternalId}
              isLoading={resultsQuery.isLoading || racesQuery.isLoading}
              isError={resultsQuery.isError || racesQuery.isError}
              refetching={
                resultsQuery.isRefetching || racesQuery.isRefetching
              }
              onRetry={() => {
                void resultsQuery.refetch();
                void racesQuery.refetch();
              }}
            />

            <ExternalStandings
              standings={standingsQuery.data ?? []}
              driverTeamByExternalId={driverTeamByExternalId}
              isLoading={standingsQuery.isLoading}
              isError={standingsQuery.isError}
              refetching={standingsQuery.isRefetching}
              onRetry={() => void standingsQuery.refetch()}
            />
          </>
        )}
    </div>
  );
}