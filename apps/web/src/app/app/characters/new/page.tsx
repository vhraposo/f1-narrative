"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CharacterForm } from "@/components/characters/character-form";
import { useCreateCharacter } from "@/hooks/use-characters";
import type { CreateCharacterInput } from "@/lib/characters";

export default function NewCharacterPage() {
  const router = useRouter();
  const createMutation = useCreateCharacter();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(input: CreateCharacterInput) {
    setError(null);
    createMutation.mutate(input, {
      onSuccess: () => {
        router.push("/app/characters");
        router.refresh();
      },
      onError: (err) => {
        setError(err instanceof Error ? err.message : "Falha ao criar");
      },
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Novo personagem
        </h1>
        <p className="text-muted-foreground">
          Defina a identidade básica do seu personagem.
        </p>
      </div>
      <CharacterForm
        isSubmitting={createMutation.isPending}
        error={error}
        onSubmit={handleSubmit}
        submitLabel="Criar personagem"
        cancelHref="/app/characters"
      />
    </div>
  );
}
