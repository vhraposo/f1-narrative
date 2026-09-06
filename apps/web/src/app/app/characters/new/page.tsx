"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CharacterForm } from "@/components/characters/character-form";
import { PageHeader } from "@/components/ui/page-header";
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
      <PageHeader
        kicker="UNIVERSO / PERSONAGENS"
        title="Novo personagem"
        description="Defina a identidade básica do seu personagem."
      />
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
