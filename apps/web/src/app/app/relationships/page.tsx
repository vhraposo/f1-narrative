"use client";

import { Loader2, Plus } from "lucide-react";
import { useState } from "react";

import { RelationshipCard } from "@/components/relationships/relationship-card";
import { RelationshipForm } from "@/components/relationships/relationship-form";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { useCharacters } from "@/hooks/use-characters";
import {
  useCreateRelationship,
  useDeleteRelationship,
  useRelationships,
  useUpdateRelationship,
} from "@/hooks/use-relationships";
import type { Relationship } from "@/lib/relationships";
import { ApiError } from "@/lib/api";

type FormState =
  | { mode: "hidden" }
  | { mode: "create" }
  | { mode: "edit"; relationship: Relationship };

export default function RelationshipsPage() {
  const {
    data: relationships,
    isLoading,
    isError,
    isRefetching,
    error,
    refetch,
  } = useRelationships();
  const charactersQuery = useCharacters();
  const createMutation = useCreateRelationship();
  const updateMutation = useUpdateRelationship();
  const deleteMutation = useDeleteRelationship();

  const [form, setForm] = useState<FormState>({ mode: "hidden" });
  const [formError, setFormError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  const characters = charactersQuery.data ?? [];
  const charactersLoading = charactersQuery.isLoading;
  const charactersError = charactersQuery.isError
    ? charactersQuery.error instanceof Error
      ? charactersQuery.error.message
      : "Falha ao carregar personagens"
    : null;

  function handleSubmit(input: {
    characterAId: string;
    characterBId: string;
    dimensions: Record<string, unknown> | undefined;
  }) {
    setFormError(null);

    if (form.mode === "edit" && form.relationship) {
      updateMutation.mutate(
        {
          id: form.relationship.id,
          input: { dimensions: input.dimensions ?? {} },
        },
        {
          onSuccess: () => setForm({ mode: "hidden" }),
          onError: (err) =>
            setFormError(
              err instanceof Error ? err.message : "Falha ao salvar a relação",
            ),
        },
      );
      return;
    }

    createMutation.mutate(
      {
        characterAId: input.characterAId,
        characterBId: input.characterBId,
        dimensions: input.dimensions,
      },
      {
        onSuccess: () => setForm({ mode: "hidden" }),
        onError: (err) => {
          const message =
            err instanceof Error ? err.message : "Falha ao criar a relação";
          setFormError(
            err instanceof ApiError && err.status === 409
              ? "Já existe um relacionamento entre esses personagens."
              : message,
          );
        },
      },
    );
  }

  function handleRemove(relationship: Relationship) {
    setRemovingId(relationship.id);
    setDeleteErrors((prev) => {
      const next = { ...prev };
      delete next[relationship.id];
      return next;
    });
    deleteMutation.mutate(relationship.id, {
      onSettled: () => setRemovingId(null),
      onError: (err) => {
        const message =
          err instanceof Error ? err.message : "Falha ao excluir a relação";
        setDeleteErrors((prev) => ({ ...prev, [relationship.id]: message }));
      },
    });
  }

  const needsCharacters = relationships && relationships.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="UNIVERSO / RELACIONAMENTOS"
        title="Relacionamentos"
        description="As relações entre personagens do seu universo."
        action={
          form.mode === "hidden" && !isLoading && !isError && needsCharacters ? (
            <Button onClick={() => setForm({ mode: "create" })}>
              <Plus className="mr-2 h-4 w-4" />
              Nova relação
            </Button>
          ) : undefined
        }
      />

      {form.mode !== "hidden" && (
        <RelationshipForm
          characters={characters}
          charactersLoading={charactersLoading}
          charactersError={charactersError}
          initial={form.mode === "edit" ? form.relationship : undefined}
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
        <ErrorState
          title="Dados indisponíveis"
          description="Não foi possível carregar os relacionamentos."
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

      {!isLoading && !isError && relationships && relationships.length === 0 && (
        <EmptyState
          title="Você ainda não tem relacionamentos."
          description="Crie pelo menos dois personagens e vincule-os entre si."
          action={
            characters.length >= 2 && form.mode === "hidden" ? (
              <Button onClick={() => setForm({ mode: "create" })}>
                Criar relação
              </Button>
            ) : undefined
          }
        />
      )}

      {relationships && relationships.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {relationships.map((relationship) => (
            <RelationshipCard
              key={relationship.id}
              relationship={relationship}
              onEdit={(r) => {
                setForm({ mode: "edit", relationship: r });
                setFormError(null);
              }}
              onRemove={handleRemove}
              isRemoving={removingId === relationship.id}
              removeError={deleteErrors[relationship.id] ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
