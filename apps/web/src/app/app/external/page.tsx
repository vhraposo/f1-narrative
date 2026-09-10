"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ExternalCalendar } from "@/components/external/external-calendar";
import { ExternalDrivers } from "@/components/external/external-drivers";
import { ExternalGrid } from "@/components/external/external-grid";
import { ExternalOverview } from "@/components/external/external-overview";
import { ExternalResults } from "@/components/external/external-results";
import { ExternalStandings } from "@/components/external/external-standings";
import { ExternalSourceBadge } from "@/components/external/external-source-badge";
import { ExternalTeams } from "@/components/external/external-teams";
import { Button } from "@/components/ui/button";
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
  formatExternalDateTime,
  positionSortKey,
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

  const selectedSeason = useMemo(
    () => seasons.find((season) => season.year === year) ?? null,
    [seasons, year],
  );

  const lastSyncedAt = useMemo(() => {
    const values = [
      ...(teamsQuery.data ?? []).map((team) => team.lastSyncedAt),
      ...(driversQuery.data ?? []).map((driver) => driver.lastSyncedAt),
    ].filter((value): value is string => value != null);
    return values.length > 0 ? values.reduce((a, b) => (a > b ? a : b)) : null;
  }, [teamsQuery.data, driversQuery.data]);

  const teamsCount = useMemo(
    () =>
      new Set(
        (driverSeasonsQuery.data ?? [])
          .map((ds) => ds.teamExternalId)
          .filter((value): value is string => value != null),
      ).size,
    [driverSeasonsQuery.data],
  );

  const driversCount = useMemo(
    () =>
      new Set(
        (driverSeasonsQuery.data ?? []).map(
          (ds) => ds.externalDriver.externalId,
        ),
      ).size,
    [driverSeasonsQuery.data],
  );

  const racesCount = racesQuery.data?.length ?? 0;
  const resultsCount = resultsQuery.data?.length ?? 0;

  const leader = useMemo(() => {
    const sorted = [...(standingsQuery.data ?? [])].sort(
      (a, b) => positionSortKey(a.position) - positionSortKey(b.position),
    );
    const top = sorted[0];
    if (!top) return null;
    return {
      name: top.externalDriver.name,
      points: top.points,
      teamName:
        driverTeamByExternalId[top.externalDriver.externalId]?.teamName ?? null,
    };
  }, [standingsQuery.data, driverTeamByExternalId]);

  const seasonOptions = seasons.map((season) => ({
    value: String(season.year),
    label: `${season.year} — ${seasonStatusLabel(season.status)}`,
  }));

  const overviewLoading =
    driverSeasonsQuery.isLoading ||
    racesQuery.isLoading ||
    resultsQuery.isLoading ||
    standingsQuery.isLoading;
  const overviewError =
    driverSeasonsQuery.isError ||
    racesQuery.isError ||
    resultsQuery.isError ||
    standingsQuery.isError;

  return (
    <div className="space-y-8">
      <PageHeader
        kicker="EXTERNAL WORLD DATA"
        title="F1 World Data"
        description={`Dados externos da Fórmula 1 · Mirror de ${EXTERNAL_SOURCE_NAME} (${EXTERNAL_SOURCE_REF}), somente leitura. Exibidos como contavam na fonte, sem alterar o universo narrativo.`}
        meta={
          <>
            <span>
              {seasons.length} temporada{seasons.length === 1 ? "" : "s"} na
              fonte
            </span>
            {selectedSeason && (
              <span>
                Temporada {selectedSeason.year} —{" "}
                {seasonStatusLabel(selectedSeason.status)}
              </span>
            )}
            <span>Sincronizado em {formatExternalDateTime(lastSyncedAt)}</span>
          </>
        }
        action={
          <div className="flex flex-col items-stretch gap-3 sm:items-end">
            <div>
              <Select
                value={year != null ? String(year) : ""}
                onValueChange={(value) => setYear(Number(value))}
                options={seasonOptions}
                placeholder="Selecione a temporada"
              >
                <Label
                  className="sr-only"
                  htmlFor="external-season"
                >
                  Temporada da fonte
                </Label>
                <SelectTrigger
                  id="external-season"
                  aria-label="Temporada da fonte"
                  className="min-w-44"
                />
                <SelectContent />
              </Select>
            </div>
            <ExternalSourceBadge className="self-end" />
          </div>
        }
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
          detail="Verifique se a API está acessível e se o Mirror Externo já foi sincronizado."
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
            <ExternalOverview
              year={year}
              teamsCount={teamsCount}
              driversCount={driversCount}
              racesCount={racesCount}
              resultsCount={resultsCount}
              leader={leader}
              isLoading={overviewLoading}
              isError={overviewError}
              refetching={
                driverSeasonsQuery.isRefetching ||
                racesQuery.isRefetching ||
                resultsQuery.isRefetching ||
                standingsQuery.isRefetching
              }
              onRetry={() => {
                void driverSeasonsQuery.refetch();
                void racesQuery.refetch();
                void resultsQuery.refetch();
                void standingsQuery.refetch();
              }}
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

            <ExternalDrivers
              driverSeasons={driverSeasonsQuery.data ?? []}
              driversByExternalId={driversByExternalId}
              isLoading={driverSeasonsQuery.isLoading}
              isError={driverSeasonsQuery.isError}
              refetching={driverSeasonsQuery.isRefetching}
              onRetry={() => void driverSeasonsQuery.refetch()}
            />

            <ExternalTeams
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