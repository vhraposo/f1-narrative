"use client";

import { Loader2, Plus } from "lucide-react";
import { useState } from "react";

import { RelationshipCard } from "@/components/relationships/relationship-card";
import { RelationshipForm } from "@/components/relationships/relationship-form";
import { Button } from "@/components/ui/button";
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
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Relacionamentos</h1>
          <p className="text-muted-foreground">
            As relações entre personagens do seu universo.
          </p>
        </div>
        {form.mode === "hidden" && !isLoading && !isError && needsCharacters && (
          <Button onClick={() => setForm({ mode: "create" })}>
            <Plus className="mr-2 h-4 w-4" />
            Nova relação
          </Button>
        )}
      </div>

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
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-destructive">
            Não foi possível carregar os relacionamentos.
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

      {!isLoading && !isError && relationships && relationships.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-muted-foreground">
            Você ainda não tem relacionamentos.
          </p>
          <p className="text-sm text-muted-foreground">
            Crie pelo menos dois personagens e vincule-os entre si.
          </p>
          {characters.length >= 2 && form.mode === "hidden" && (
            <Button
              className="mt-4"
              onClick={() => setForm({ mode: "create" })}
            >
              Criar relação
            </Button>
          )}
        </div>
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
