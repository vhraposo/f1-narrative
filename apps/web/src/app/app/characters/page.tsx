"use client";

import { Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CharacterCard } from "@/components/characters/character-card";
import { Button } from "@/components/ui/button";
import { useCharacters, useDeleteCharacter } from "@/hooks/use-characters";
import type { Character } from "@/lib/characters";

const primaryLinkStyles =
  "inline-flex items-center justify-center whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export default function CharactersPage() {
  const { data, isLoading, isError, error, refetch } = useCharacters();
  const deleteMutation = useDeleteCharacter();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function handleDelete(character: Character) {
    setDeletingId(character.id);
    deleteMutation.mutate(character.id, {
      onSettled: () => setDeletingId(null),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Personagens</h1>
          <p className="text-muted-foreground">
            Seus personagens do universo narrativo.
          </p>
        </div>
        <Link href="/app/characters/new" className={primaryLinkStyles}>
          <Plus className="mr-2 h-4 w-4" />
          Novo personagem
        </Link>
      </div>

      {isLoading && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-destructive">
            Não foi possível carregar os personagens.
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
            Você ainda não tem personagens.
          </p>
          <p className="text-sm text-muted-foreground">
            Crie seu primeiro personagem para começar a narrativa.
          </p>
          <Link href="/app/characters/new" className={primaryLinkStyles}>
            <Plus className="mr-2 h-4 w-4" />
            Criar personagem
          </Link>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((character) => (
            <CharacterCard
              key={character.id}
              character={character}
              onDelete={handleDelete}
              isDeleting={deletingId === character.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
