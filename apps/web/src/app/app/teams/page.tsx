"use client";

import { Loader2, Plus } from "lucide-react";
import { useState } from "react";

import { TeamCard } from "@/components/teams/team-card";
import { TeamForm } from "@/components/teams/team-form";
import { Button } from "@/components/ui/button";
import {
  useCreateTeam,
  useDeleteTeam,
  useTeams,
  useUpdateTeam,
} from "@/hooks/use-teams";
import type { Team } from "@/lib/teams";

type FormState =
  | { mode: "hidden" }
  | { mode: "create" }
  | { mode: "edit"; team: Team };

export default function TeamsPage() {
  const { data, isLoading, isError, error, refetch } = useTeams();
  const createMutation = useCreateTeam();
  const updateMutation = useUpdateTeam();
  const deleteMutation = useDeleteTeam();

  const [form, setForm] = useState<FormState>({ mode: "hidden" });
  const [formError, setFormError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  function handleSubmit(input: {
    name: string;
    shortName: string | null;
    color: string | null;
  }) {
    setFormError(null);

    if (form.mode === "create") {
      createMutation.mutate(input, {
        onSuccess: () => {
          setForm({ mode: "hidden" });
        },
        onError: (err) => {
          setFormError(
            err instanceof Error ? err.message : "Falha ao criar a equipe",
          );
        },
      });
      return;
    }

    if (form.mode === "edit") {
      updateMutation.mutate(
        { id: form.team.id, input },
        {
          onSuccess: () => {
            setForm({ mode: "hidden" });
          },
          onError: (err) => {
            setFormError(
              err instanceof Error ? err.message : "Falha ao salvar a equipe",
            );
          },
        },
      );
    }
  }

  function handleRemove(team: Team) {
    setRemovingId(team.id);
    setDeleteErrors((prev) => {
      const next = { ...prev };
      delete next[team.id];
      return next;
    });
    deleteMutation.mutate(team.id, {
      onSettled: () => setRemovingId(null),
      onError: (err) => {
        const message =
          err instanceof Error ? err.message : "Falha ao excluir a equipe";
        setDeleteErrors((prev) => ({ ...prev, [team.id]: message }));
      },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Equipes</h1>
          <p className="text-muted-foreground">
            As equipes do seu universo narrativo.
          </p>
        </div>
        {form.mode === "hidden" && !isLoading && !isError && (
          <Button onClick={() => setForm({ mode: "create" })}>
            <Plus className="mr-2 h-4 w-4" />
            Nova equipe
          </Button>
        )}
      </div>

      {form.mode !== "hidden" && (
        <TeamForm
          initial={
            form.mode === "edit"
              ? {
                  name: form.team.name,
                  shortName: form.team.shortName,
                  color: form.team.color,
                }
              : undefined
          }
          isSubmitting={isSubmitting}
          error={formError}
          onSubmit={handleSubmit}
          onCancel={() => {
            setForm({ mode: "hidden" });
            setFormError(null);
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
            Não foi possível carregar as equipes.
          </p>
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "Erro desconhecido"}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => void refetch()}
          >
            Tentar novamente
          </Button>
        </div>
      )}

      {!isLoading && !isError && data && data.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-muted-foreground">
            Você ainda não tem equipes.
          </p>
          <p className="text-sm text-muted-foreground">
            Crie uma equipe para começar e depois vincule seus pilotos a ela.
          </p>
          {form.mode === "hidden" && (
            <Button
              className="mt-4"
              onClick={() => setForm({ mode: "create" })}
            >
              Criar equipe
            </Button>
          )}
        </div>
      )}

      {data && data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              onEdit={(t) => {
                setForm({ mode: "edit", team: t });
                setFormError(null);
              }}
              onRemove={handleRemove}
              isRemoving={removingId === team.id}
              removeError={deleteErrors[team.id] ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
