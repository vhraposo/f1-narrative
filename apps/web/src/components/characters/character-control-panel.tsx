"use client";

import { Bot, Loader2, User } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAiCharacters, useCharacters, useSwitchCharacterControl } from "@/hooks/use-characters";
import { ApiError } from "@/lib/api";

export function CharacterControlPanel() {
  const charactersQuery = useCharacters();
  const aiCharactersQuery = useAiCharacters();
  const switchMutation = useSwitchCharacterControl();
  const [notice, setNotice] = useState<string | null>(null);

  const controlled = (charactersQuery.data ?? []).find(
    (c) => c.controlledBy === "USER",
  );
  const controlledIds = new Set(
    (charactersQuery.data ?? []).map((c) => c.id),
  );
  const adoptable = (aiCharactersQuery.data ?? []).filter(
    (c) => !controlledIds.has(c.id),
  );

  function handleSwitch(id: string, name: string) {
    setNotice(null);
    switchMutation.mutate(id, {
      onSuccess: (res) => {
        setNotice(
          res.releasedCount > 0
            ? `Agora você controla ${name} (${res.releasedCount} anteriormente liberado(s)).`
            : `Agora você controla ${name}.`,
        );
      },
      onError: (err) => {
        if (err instanceof ApiError && err.status === 409) {
          setNotice(err.message);
          return;
        }
        setNotice(
          err instanceof Error ? err.message : "Não foi possível trocar o controle.",
        );
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Controle de personagem</CardTitle>
        <CardDescription>
          Você controla um personagem por vez. Assumir um personagem de IA libera
          o anterior sem alterar o histórico das conversas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {controlled ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm">
            <User className="h-4 w-4 text-brand" aria-hidden="true" />
            <span className="font-semibold text-foreground">Você controla</span>
            <span className="text-foreground">{controlled.name}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm">
            <Bot className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-muted-foreground">
              Nenhum personagem sob seu controle no momento.
            </span>
          </div>
        )}

        <div className="space-y-2">
          {adoptable.map((character) => (
            <div
              key={character.id}
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">
                  {character.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {character.nationality}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={switchMutation.isPending}
                onClick={() => handleSwitch(character.id, character.name)}
              >
                {switchMutation.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <User className="mr-1.5 h-3.5 w-3.5" />
                )}
                Assumir controle
              </Button>
            </div>
          ))}
          {adoptable.length === 0 && (
            <p className="px-1 text-xs text-muted-foreground">
              Não há personagens de IA disponíveis para assumir.
            </p>
          )}
        </div>

        {notice && (
          <p className="px-1 text-[11px] text-muted-foreground" role="status">
            {notice}
          </p>
        )}
      </CardContent>
    </Card>
  );
}