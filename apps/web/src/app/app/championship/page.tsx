"use client";

import { Loader2, Plus, Trophy } from "lucide-react";
import { useState } from "react";

import { RaceCard } from "@/components/championship/race-card";
import { RaceForm } from "@/components/championship/race-form";
import { ResultPanel } from "@/components/championship/result-panel";
import { SeasonCard } from "@/components/championship/season-card";
import { SeasonForm } from "@/components/championship/season-form";
import { StandingsPanel } from "@/components/championship/standings-panel";
import { Button } from "@/components/ui/button";
import {
  useCreateRace,
  useCreateSeason,
  useDeleteRace,
  useDeleteSeason,
  useRaces,
  useSeasons,
  useUpdateRace,
  useUpdateSeason,
} from "@/hooks/use-championship";
import { useDrivers } from "@/hooks/use-driver-profiles";
import type { Race, Season } from "@/lib/championship";

type SeasonFormState =
  | { mode: "hidden" }
  | { mode: "create" }
  | { mode: "edit"; season: Season };

type RaceFormState =
  | { mode: "hidden" }
  | { mode: "create" }
  | { mode: "edit"; race: Race };

export default function ChampionshipPage() {
  const { data: seasons, isLoading, isError } = useSeasons();
  const createSeasonMutation = useCreateSeason();
  const updateSeasonMutation = useUpdateSeason();
  const deleteSeasonMutation = useDeleteSeason();

  const { data: drivers } = useDrivers();

  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [seasonForm, setSeasonForm] = useState<SeasonFormState>({
    mode: "hidden",
  });
  const [seasonFormError, setSeasonFormError] = useState<string | null>(null);
  const [removingSeasonId, setRemovingSeasonId] = useState<string | null>(null);
  const [seasonDeleteErrors, setSeasonDeleteErrors] = useState<
    Record<string, string>
  >({});

  const selectedSeason =
    seasons?.find((s) => s.id === selectedSeasonId) ?? null;

  // Races do season selecionado
  const {
    data: races,
    isLoading: racesLoading,
    isError: racesError,
  } = useRaces(selectedSeasonId ?? "");

  const createRaceMutation = useCreateRace(selectedSeasonId ?? "");
  const updateRaceMutation = useUpdateRace(selectedSeasonId ?? "");
  const deleteRaceMutation = useDeleteRace(selectedSeasonId ?? "");

  const [raceForm, setRaceForm] = useState<RaceFormState>({ mode: "hidden" });
  const [raceFormError, setRaceFormError] = useState<string | null>(null);
  const [removingRaceId, setRemovingRaceId] = useState<string | null>(null);
  const [raceDeleteErrors, setRaceDeleteErrors] = useState<
    Record<string, string>
  >({});
  const [openRaceResults, setOpenRaceResults] = useState<string | null>(null);

  const seasonSubmitting =
    createSeasonMutation.isPending || updateSeasonMutation.isPending;
  const raceSubmitting =
    createRaceMutation.isPending || updateRaceMutation.isPending;

  function handleSeasonSubmit(input: {
    year: number;
    name: string | null;
    status: string;
  }) {
    setSeasonFormError(null);
    if (seasonForm.mode === "create") {
      createSeasonMutation.mutate(input, {
        onSuccess: () => setSeasonForm({ mode: "hidden" }),
        onError: (err) =>
          setSeasonFormError(
            err instanceof Error ? err.message : "Falha ao criar a temporada",
          ),
      });
      return;
    }
    if (seasonForm.mode === "edit") {
      updateSeasonMutation.mutate(
        { id: seasonForm.season.id, input },
        {
          onSuccess: () => setSeasonForm({ mode: "hidden" }),
          onError: (err) =>
            setSeasonFormError(
              err instanceof Error ? err.message : "Falha ao salvar a temporada",
            ),
        },
      );
    }
  }

  function handleRemoveSeason(season: Season) {
    setRemovingSeasonId(season.id);
    setSeasonDeleteErrors((prev) => {
      const next = { ...prev };
      delete next[season.id];
      return next;
    });
    deleteSeasonMutation.mutate(season.id, {
      onSettled: () => setRemovingSeasonId(null),
      onError: (err) => {
        const message =
          err instanceof Error ? err.message : "Falha ao excluir a temporada";
        setSeasonDeleteErrors((prev) => ({ ...prev, [season.id]: message }));
      },
    });
  }

  function handleSeasonSelect(season: Season) {
    setSelectedSeasonId(season.id);
    setRaceForm({ mode: "hidden" });
    setOpenRaceResults(null);
    setSeasonForm({ mode: "hidden" });
  }

  function handleRaceSubmit(input: {
    name: string;
    circuit: string | null;
    country: string | null;
    date: string | null;
    round: number | null;
    status: string;
  }) {
    setRaceFormError(null);
    if (raceForm.mode === "create") {
      createRaceMutation.mutate(input, {
        onSuccess: () => setRaceForm({ mode: "hidden" }),
        onError: (err) =>
          setRaceFormError(
            err instanceof Error ? err.message : "Falha ao criar a corrida",
          ),
      });
      return;
    }
    if (raceForm.mode === "edit") {
      updateRaceMutation.mutate(
        { id: raceForm.race.id, input },
        {
          onSuccess: () => setRaceForm({ mode: "hidden" }),
          onError: (err) =>
            setRaceFormError(
              err instanceof Error ? err.message : "Falha ao salvar a corrida",
            ),
        },
      );
    }
  }

  function handleRemoveRace(race: Race) {
    setRemovingRaceId(race.id);
    setRaceDeleteErrors((prev) => {
      const next = { ...prev };
      delete next[race.id];
      return next;
    });
    deleteRaceMutation.mutate(race.id, {
      onSettled: () => setRemovingRaceId(null),
      onError: (err) => {
        const message =
          err instanceof Error ? err.message : "Falha ao excluir a corrida";
        setRaceDeleteErrors((prev) => ({ ...prev, [race.id]: message }));
      },
    });
  }

  function handleViewResults(race: Race) {
    setOpenRaceResults((current) => (current === race.id ? null : race.id));
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Campeonato</h1>
          <p className="text-muted-foreground">
            Temporadas, corridas, resultados e classificação do seu universo.
          </p>
        </div>
        {seasonForm.mode === "hidden" && !isLoading && !isError && (
          <Button onClick={() => setSeasonForm({ mode: "create" })}>
            <Plus className="mr-2 h-4 w-4" />
            Nova temporada
          </Button>
        )}
      </div>

      {seasonForm.mode !== "hidden" && (
        <SeasonForm
          initial={
            seasonForm.mode === "edit"
              ? {
                  year: seasonForm.season.year,
                  name: seasonForm.season.name,
                  status: seasonForm.season.status,
                }
              : undefined
          }
          isSubmitting={seasonSubmitting}
          error={seasonFormError}
          onSubmit={handleSeasonSubmit}
          onCancel={() => {
            setSeasonForm({ mode: "hidden" });
            setSeasonFormError(null);
          }}
        />
      )}

      {isLoading && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-destructive">
            Não foi possível carregar as temporadas.
          </p>
          <p className="text-sm text-muted-foreground">Tente novamente.</p>
        </div>
      )}

      {!isLoading && !isError && seasons && seasons.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {seasons.map((season) => (
            <SeasonCard
              key={season.id}
              season={season}
              active={selectedSeasonId === season.id}
              onSelect={handleSeasonSelect}
              onEdit={(s) => {
                setSeasonForm({ mode: "edit", season: s });
                setSeasonFormError(null);
              }}
              onRemove={handleRemoveSeason}
              isRemoving={removingSeasonId === season.id}
              removeError={seasonDeleteErrors[season.id] ?? null}
            />
          ))}
        </div>
      )}

      {!isLoading && !isError && seasons && seasons.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-muted-foreground">
            Você ainda não tem temporadas.
          </p>
          <p className="text-sm text-muted-foreground">
            Crie uma temporada para começar o campeonato.
          </p>
          {seasonForm.mode === "hidden" && (
            <Button
              className="mt-4"
              onClick={() => setSeasonForm({ mode: "create" })}
            >
              Criar temporada
            </Button>
          )}
        </div>
      )}

      {selectedSeason && (
        <section className="space-y-4">
          <div className="flex items-center justify-between border-t pt-6">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                <Trophy className="mr-2 inline h-5 w-5" />
                {selectedSeason.name ?? `Temporada ${selectedSeason.year}`}
              </h2>
              <p className="text-sm text-muted-foreground">
                Corridas e classificação desta temporada.
              </p>
            </div>
            {raceForm.mode === "hidden" && (
              <Button onClick={() => setRaceForm({ mode: "create" })}>
                <Plus className="mr-2 h-4 w-4" />
                Nova corrida
              </Button>
            )}
          </div>

          {raceForm.mode !== "hidden" && (
            <RaceForm
              initial={
                raceForm.mode === "edit"
                  ? {
                      name: raceForm.race.name,
                      circuit: raceForm.race.circuit,
                      country: raceForm.race.country,
                      date: raceForm.race.date,
                      round: raceForm.race.round,
                      status: raceForm.race.status,
                    }
                  : undefined
              }
              isSubmitting={raceSubmitting}
              error={raceFormError}
              onSubmit={handleRaceSubmit}
              onCancel={() => {
                setRaceForm({ mode: "hidden" });
                setRaceFormError(null);
              }}
            />
          )}

          {racesLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {racesError && (
            <p className="text-sm text-destructive">
              Não foi possível carregar as corridas.
            </p>
          )}

          {!racesLoading && !racesError && races && races.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {races.map((race) => (
                <RaceCard
                  key={race.id}
                  race={race}
                  onEdit={(r) => {
                    setRaceForm({ mode: "edit", race: r });
                    setRaceFormError(null);
                  }}
                  onRemove={handleRemoveRace}
                  onViewResults={handleViewResults}
                  isRemoving={removingRaceId === race.id}
                  removeError={raceDeleteErrors[race.id] ?? null}
                />
              ))}
            </div>
          )}

          {!racesLoading && !racesError && races && races.length === 0 && (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-muted-foreground">
                Nenhuma corrida nesta temporada ainda.
              </p>
            </div>
          )}

          {openRaceResults && (
            (() => {
              const openRace = races?.find((r) => r.id === openRaceResults);
              if (!openRace) return null;
              return (
                <ResultPanel
                  race={openRace}
                  drivers={drivers ?? []}
                  onClose={() => setOpenRaceResults(null)}
                />
              );
            })()
          )}

          <StandingsPanel season={selectedSeason} drivers={drivers ?? []} />
        </section>
      )}
    </div>
  );
}
