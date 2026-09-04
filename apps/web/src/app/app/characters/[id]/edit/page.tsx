"use client";

import { Loader2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { CharacterForm } from "@/components/characters/character-form";
import { Button } from "@/components/ui/button";
import {
  useCharacter,
  useUpdateCharacter,
} from "@/hooks/use-characters";
import type { CreateCharacterInput } from "@/lib/characters";

export default function EditCharacterPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: character, isLoading, isError, error } = useCharacter(id);
  const updateMutation = useUpdateCharacter();
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleSubmit(input: CreateCharacterInput) {
    setSubmitError(null);
    updateMutation.mutate(
      { id, input },
      {
        onSuccess: () => {
          router.push("/app/characters");
          router.refresh();
        },
        onError: (err) => {
          setSubmitError(
            err instanceof Error ? err.message : "Falha ao salvar",
          );
        },
      },
    );
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
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">
          Personagem não encontrado
        </h1>
        <p className="text-muted-foreground">
          {error instanceof Error ? error.message : "Não foi possível carregar o personagem."}
        </p>
        <Button variant="outline" onClick={() => router.push("/app/characters")}>
          Voltar para personagens
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Editar personagem
        </h1>
        <p className="text-muted-foreground">
          Atualize os dados de {character.name}.
        </p>
      </div>
      <CharacterForm
        character={character}
        isSubmitting={updateMutation.isPending}
        error={submitError}
        onSubmit={handleSubmit}
        submitLabel="Salvar alterações"
        cancelHref="/app/characters"
      />
    </div>
  );
}
