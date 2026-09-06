"use client";

import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { AvailabilityCard } from "@/components/availability/availability-card";
import { DriverProfileForm } from "@/components/drivers/driver-profile-form";
import { MemorySection } from "@/components/memory/memory-section";
import { ScheduleCard } from "@/components/schedule/schedule-card";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { useCharacter } from "@/hooks/use-characters";
import {
  useDeleteDriver,
  useDrivers,
  useUpsertDriver,
} from "@/hooks/use-driver-profiles";
import { useRelationships } from "@/hooks/use-relationships";
import { useTeams } from "@/hooks/use-teams";

export default function CharacterDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const {
    data: character,
    isLoading,
    isError,
    error,
  } = useCharacter(id);

  const driversQuery = useDrivers();
  const teamsQuery = useTeams();
  const relationshipsQuery = useRelationships();
  const upsertMutation = useUpsertDriver();
  const deleteMutation = useDeleteDriver();

  const [showForm, setShowForm] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const driver = driversQuery.data?.find((d) => d.characterId === id);

  function handleSave(input: { number: number | null; teamId: string | null }) {
    setSubmitError(null);
    upsertMutation.mutate(
      { characterId: id, input },
      {
        onSuccess: () => {
          setShowForm(false);
        },
        onError: (err) => {
          setSubmitError(
            err instanceof Error ? err.message : "Falha ao salvar",
          );
        },
      },
    );
  }

  function handleRemove() {
    setSubmitError(null);
    deleteMutation.mutate(id, {
      onSuccess: () => {
        setConfirmingRemove(false);
      },
      onError: (err) => {
        setConfirmingRemove(false);
        setSubmitError(err instanceof Error ? err.message : "Falha ao remover");
      },
    });
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !character) {
    return (
      <ErrorState
        heading="h1"
        title="Personagem não encontrado"
        description={
          error instanceof Error
            ? error.message
            : "Não foi possível carregar o personagem."
        }
        action={
          <Button
            variant="outline"
            onClick={() => router.push("/app/characters")}
          >
            Voltar para personagens
          </Button>
        }
      />
    );
  }

  const birthDate = new Date(character.birthDate);
  const birthLabel = Number.isNaN(birthDate.getTime())
    ? character.birthDate
    : birthDate.toLocaleDateString("pt-BR");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        kicker="UNIVERSO / PERSONAGENS"
        title={character.name}
        description={`${character.nationality}${
          character.gender ? ` · ${character.gender}` : ""
        }${character.birthDate ? ` · Nascido(a): ${birthLabel}` : ""}`}
        action={
          <Link
            href={`/app/characters/${character.id}/edit`}
            className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-input bg-background px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Pencil className="mr-2 h-4 w-4" />
            Editar personagem
          </Link>
        }
      />

      {character.biography && (
        <p className="text-muted-foreground">{character.biography}</p>
      )}

      <section className="rounded-lg border p-6">
        <h2 className="text-xl font-semibold tracking-tight">
          Perfil de piloto
        </h2>

        {submitError && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {submitError}
          </p>
        )}

        {driversQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : showForm ? (
          <div className="mt-4">
            <DriverProfileForm
              characterName={character.name}
              initialNumber={driver?.number ?? null}
              initialTeamId={driver?.teamId ?? null}
              teams={teamsQuery.data ?? []}
              teamsLoading={teamsQuery.isLoading}
              teamsError={
                teamsQuery.isError
                  ? teamsQuery.error instanceof Error
                    ? teamsQuery.error.message
                    : "Falha ao carregar equipes"
                  : null
              }
              isSubmitting={upsertMutation.isPending}
              error={submitError}
              onSubmit={handleSave}
              onCancel={() => {
                setShowForm(false);
                setSubmitError(null);
              }}
            />
          </div>
        ) : driver ? (
          <div className="mt-4 space-y-4">
            <div className="text-sm">
              <p className="text-muted-foreground">Número do piloto:</p>
              <p className="text-2xl font-bold">
                {driver.number != null ? driver.number : "—"}
              </p>
            </div>
            <div className="text-sm">
              <p className="text-muted-foreground">Equipe:</p>
              <p className="text-xl font-semibold">
                {driver.team ? (
                  <span
                    className="inline-flex items-center gap-2"
                    style={
                      driver.team.color
                        ? { color: driver.team.color }
                        : undefined
                    }
                  >
                    {driver.team.color ? (
                      <span
                        aria-hidden
                        className="inline-block h-3 w-3 rounded-full"
                        style={{ backgroundColor: driver.team.color }}
                      />
                    ) : null}
                    {driver.team.name}
                  </span>
                ) : (
                  "—"
                )}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Remover o perfil de piloto não exclui o personagem.
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setShowForm(true);
                  setSubmitError(null);
                }}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Editar perfil
              </Button>
              {confirmingRemove ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Remover?</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={deleteMutation.isPending}
                    onClick={handleRemove}
                  >
                    {deleteMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Confirmar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={deleteMutation.isPending}
                    onClick={() => setConfirmingRemove(false)}
                  >
                    Cancelar
                  </Button>
                </div>
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setConfirmingRemove(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remover
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Este personagem ainda não possui um perfil de piloto.
            </p>
            <Button size="sm" onClick={() => setShowForm(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Tornar piloto
            </Button>
          </div>
        )}
      </section>

      <section className="rounded-lg border p-6">
        <h2 className="text-xl font-semibold tracking-tight">
          Relacionamentos
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Personagens ligados a {character.name}.
        </p>

        {relationshipsQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : relationshipsQuery.isError ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            Não foi possível carregar os relacionamentos.
          </p>
        ) : null}

        {relationshipsQuery.data
          ? (() => {
              const related = relationshipsQuery.data.filter(
                (r) =>
                  r.characterAId === id || r.characterBId === id,
              );
              if (related.length === 0) {
                return (
                  <p className="mt-4 text-sm text-muted-foreground">
                    Nenhum relacionamento registrado.
                  </p>
                );
              }
              return (
                <ul className="mt-4 space-y-2">
                  {related.map((r) => {
                    const isA = r.characterAId === id;
                    const other = isA ? r.characterB : r.characterA;
                    const dimensions = Object.entries(r.dimensions ?? {});
                    return (
                      <li
                        key={r.id}
                        className="flex items-center justify-between gap-3 rounded-md border p-3"
                      >
                        <div>
                          <p className="font-medium">{other.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {other.nationality}
                          </p>
                          {dimensions.length > 0 && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {dimensions
                                .map(([k, v]) => `${k}: ${String(v)}`)
                                .join(" · ")}
                            </p>
                          )}
                        </div>
                        <Link
                          href="/app/relationships"
                          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                        >
                          Ver tudo
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              );
            })()
          : null}
      </section>

      <section>
        <AvailabilityCard characterId={character.id} />
      </section>

      <section>
        <ScheduleCard characterId={character.id} />
      </section>

      <MemorySection characterId={character.id} characterName={character.name} />
    </div>
  );
}
