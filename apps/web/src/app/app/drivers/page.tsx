"use client";

import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

import { DriverCard } from "@/components/drivers/driver-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { useCharacters } from "@/hooks/use-characters";
import { useSeasons, useStandings } from "@/hooks/use-championship";
import { useDeleteDriver, useDrivers } from "@/hooks/use-driver-profiles";
import { useWorld } from "@/hooks/use-world";
import { compareDrivers, type Driver } from "@/lib/driver-profiles";

export default function DriversPage() {
  const { data, isLoading, isError, isRefetching, error, refetch } =
    useDrivers();
  const { data: characters } = useCharacters();
  const { data: world } = useWorld();
  const { data: seasons } = useSeasons();
  const deleteMutation = useDeleteDriver();
  const [removingId, setRemovingId] = useState<string | null>(null);

  const ownedCharacterIds = useMemo(
    () => new Set((characters ?? []).map((character) => character.id)),
    [characters],
  );

  const sortedDrivers = useMemo(
    () => [...(data ?? [])].sort(compareDrivers),
    [data],
  );

  const currentSeasonId = world?.currentSeasonId ?? null;
  const standingsQuery = useStandings(currentSeasonId ?? "");

  const seasonLabel = seasons?.find((s) => s.id === currentSeasonId) ?? null;

  const standingByDriver = new Map(
    (standingsQuery.data ?? []).map((standing) => [
      standing.driverProfileId,
      standing,
    ]),
  );

  function handleRemove(driver: Driver) {
    setRemovingId(driver.characterId);
    deleteMutation.mutate(driver.characterId, {
      onSettled: () => setRemovingId(null),
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={
          seasonLabel
            ? `UNIVERSO / GRID ${seasonLabel.year}`
            : "UNIVERSO / GRID"
        }
        title="Drivers"
        description="A grade esportiva do seu universo: número, piloto e equipe, na ordem do grid."
        meta={
          data && data.length > 0
            ? `${data.length} piloto${data.length === 1 ? "" : "s"} na grid`
            : undefined
        }
      />

      {isLoading && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <ErrorState
          title="Dados indisponíveis"
          description="Não foi possível carregar os pilotos."
          detail={error instanceof Error ? error.message : "Erro desconhecido"}
          action={
            <Button
              variant="outline"
              onClick={() => void refetch()}
              disabled={isRefetching}
            >
              {isRefetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Tentar novamente
            </Button>
          }
        />
      )}

      {!isLoading && !isError && data && data.length === 0 && (
        <EmptyState
          title="Nenhum piloto na grid."
          description="A temporada atual ainda não tem pilotos na grade."
        />
      )}

      {data && data.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {sortedDrivers.map((driver) => (
            <DriverCard
              key={driver.characterId}
              driver={driver}
              standing={standingByDriver.get(driver.id) ?? null}
              isOwned={ownedCharacterIds.has(driver.characterId)}
              onRemove={handleRemove}
              isRemoving={removingId === driver.characterId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
