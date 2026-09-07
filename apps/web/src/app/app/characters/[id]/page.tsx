"use client";

import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { AvailabilityCard } from "@/components/availability/availability-card";
import { CharacterIdentity } from "@/components/characters/character-identity";
import { CharacterAvatar } from "@/components/conversations/character-avatar";
import { DriverProfileForm } from "@/components/drivers/driver-profile-form";
import { MemorySection } from "@/components/memory/memory-section";
import { SectionHeading } from "@/components/home/section-heading";
import { ScheduleCard } from "@/components/schedule/schedule-card";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { useCharacter } from "@/hooks/use-characters";
import {
  useDeleteDriver,
  useDrivers,
  useUpsertDriver,
} from "@/hooks/use-driver-profiles";
import { useRelationships } from "@/hooks/use-relationships";
import { useTeams } from "@/hooks/use-teams";
import { CONTROLLED_BY_LABELS } from "@/lib/characters";
import type { Relationship } from "@/lib/relationships";

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

  const related =
    relationshipsQuery.data?.filter(
      (r) => r.characterAId === id || r.characterBId === id,
    ) ?? [];
  const fight = (r: Relationship) =>
    r.characterAId === id ? r.characterB : r.characterA;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <CharacterIdentity character={character} driver={driver} />

      <section aria-label="Sobre o personagem" className="space-y-3">
        <SectionHeading kicker="Identidade" title="Sobre" />
        {character.biography ? (
          <p className="whitespace-pre-line text-[15px] leading-relaxed text-foreground/80">
            {character.biography}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhuma biografia registrada para este personagem.
          </p>
        )}
        <dl className="grid gap-x-6 gap-y-2 border-t border-border pt-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Nacionalidade
            </dt>
            <dd className="mt-0.5 font-medium text-foreground">
              {character.nationality}
            </dd>
          </div>
          {character.gender && (
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Gênero
              </dt>
              <dd className="mt-0.5 font-medium text-foreground">
                {character.gender}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Controle
            </dt>
            <dd className="mt-0.5 font-medium text-foreground">
              {CONTROLLED_BY_LABELS[character.controlledBy]}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-label="Perfil de piloto" className="space-y-3">
        <SectionHeading kicker="Papel" title="Perfil de piloto" />
        {submitError && (
          <p className="text-sm text-destructive" role="alert">
            {submitError}
          </p>
        )}
        {driversQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : showForm ? (
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
        ) : driver ? (
          <div className="space-y-3">
            <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center">
              <div className="flex items-center gap-4">
                <span className="text-4xl font-black tabular-nums leading-none text-brand">
                  {driver.number != null ? `#${driver.number}` : "—"}
                </span>
                <div className="min-w-0">
                  {driver.team ? (
                    <span className="flex items-center gap-2 text-lg font-bold text-foreground">
                      {driver.team.color ? (
                        <span
                          aria-hidden="true"
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: driver.team.color }}
                        />
                      ) : null}
                      {driver.team.name}
                    </span>
                  ) : (
                    <p className="text-muted-foreground">Sem equipe definida</p>
                  )}
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {character.nationality}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:ml-auto">
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
                    <span className="text-sm text-muted-foreground">
                      Remover?
                    </span>
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
            <p className="text-xs text-muted-foreground">
              Remover o perfil de piloto não exclui o personagem.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-xl border border-dashed bg-background p-5 sm:flex-row sm:items-center sm:justify-between">
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

      <section aria-label="Relacionamentos" className="space-y-3">
        <SectionHeading
          kicker="Vínculos"
          title="Relacionamentos"
          action={
            <Link
              href="/app/relationships"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Ver tudo
            </Link>
          }
        />
        {relationshipsQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : relationshipsQuery.isError ? (
          <p className="text-sm text-destructive" role="alert">
            Não foi possível carregar os relacionamentos.
          </p>
        ) : related.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum relacionamento registrado com {character.name}.
          </p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {related.map((r) => {
              const other = fight(r);
              const dimensions = Object.entries(r.dimensions ?? {});
              return (
                <li key={r.id} className="flex items-center gap-3 py-3">
                  <CharacterAvatar
                    name={other.name}
                    imageUrl={other.imageUrl}
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/app/characters/${other.id}`}
                      className="font-semibold text-foreground transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                    >
                      {other.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {other.nationality}
                    </p>
                    {dimensions.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {dimensions.map(([key, value]) => (
                          <span
                            key={key}
                            className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs"
                          >
                            <span className="font-medium text-foreground">
                              {key}
                            </span>
                            <span className="text-muted-foreground">
                              {String(value)}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <MemorySection characterId={character.id} characterName={character.name} />

      <AvailabilityCard characterId={character.id} />

      <ScheduleCard characterId={character.id} />
    </div>
  );
}