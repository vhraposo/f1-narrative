"use client";

import { Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CharacterCard } from "@/components/characters/character-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { useCharacters, useDeleteCharacter } from "@/hooks/use-characters";
import type { Character } from "@/lib/characters";

const primaryLinkStyles =
  "inline-flex items-center justify-center whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export default function CharactersPage() {
  const { data, isLoading, isError, isRefetching, error, refetch } =
    useCharacters();
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
      <PageHeader
        kicker="UNIVERSO / PERSONAGENS"
        title="Personagens"
        description="Seus personagens do universo narrativo."
        action={
          <Link href="/app/characters/new" className={primaryLinkStyles}>
            <Plus className="mr-2 h-4 w-4" />
            Novo personagem
          </Link>
        }
      />

      {isLoading && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <ErrorState
          title="Dados indisponíveis"
          description="Não foi possível carregar os personagens."
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

      {!isLoading && !isError && data && data.length === 0 && (
        <EmptyState
          title="Você ainda não tem personagens."
          description="Crie seu primeiro personagem para começar a narrativa."
          action={
            <Link href="/app/characters/new" className={primaryLinkStyles}>
              <Plus className="mr-2 h-4 w-4" />
              Criar personagem
            </Link>
          }
        />
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
