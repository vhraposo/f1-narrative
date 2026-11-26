"use client";

import { Bot, Check, Loader2, Trash2, User, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useAiCharacters, useCharacters } from "@/hooks/use-characters";
import {
  useAddConversationParticipant,
  useConversationParticipants,
  useRemoveConversationParticipant,
} from "@/hooks/use-conversations";

type ConversationParticipantsDialogProps = {
  conversationId: string;
  open: boolean;
  onClose: () => void;
};

function typeLabel(character: { controlledBy: string }): string {
  return character.controlledBy === "AI" ? "IA" : "Você";
}

export function ConversationParticipantsDialog({
  conversationId,
  open,
  onClose,
}: ConversationParticipantsDialogProps) {
  const participantsQuery = useConversationParticipants(conversationId);
  const charactersQuery = useCharacters();
  const aiCharactersQuery = useAiCharacters();
  const addMutation = useAddConversationParticipant(conversationId);
  const removeMutation = useRemoveConversationParticipant(conversationId);

  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSelected([]);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const participants = participantsQuery.data ?? [];
  const participatingIds = new Set(participants.map((p) => p.id));
  const allCharacters = [
    ...(charactersQuery.data ?? []),
    ...(aiCharactersQuery.data ?? []),
  ];
  const available = allCharacters.filter((character) => !participatingIds.has(character.id));

  function toggle(characterId: string) {
    setSelected((current) =>
      current.includes(characterId)
        ? current.filter((id) => id !== characterId)
        : [...current, characterId],
    );
  }

  async function addSelected() {
    if (selected.length === 0) return;
    setError(null);
    try {
      for (const characterId of selected) {
        await addMutation.mutateAsync(characterId);
      }
      setSelected([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível adicionar participantes.");
    }
  }

  function removeParticipant(characterId: string) {
    setError(null);
    removeMutation.mutate(characterId, {
      onError: (err) =>
        setError(err instanceof Error ? err.message : "Não foi possível remover participante."),
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Participantes da conversa"
        className="flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl sm:rounded-2xl"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-bold text-foreground">Participantes</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar participantes"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          <section className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              No grupo ({participants.length})
            </p>
            <ul className="space-y-1">
              {participants.map((participant) => (
                <li
                  key={participant.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                    {participant.controlledBy === "AI" ? (
                      <Bot className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden="true" />
                    ) : (
                      <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                    <span className="truncate">{participant.name}</span>
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {typeLabel(participant)}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remover ${participant.name}`}
                    disabled={removeMutation.isPending}
                    onClick={() => removeParticipant(participant.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Adicionar personagens
            </p>
            {charactersQuery.isLoading || aiCharactersQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando personagens…</p>
            ) : available.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Todos os seus personagens já participam deste grupo.
              </p>
            ) : (
              <ul className="space-y-1">
                {available.map((character) => {
                  const isSelected = selected.includes(character.id);
                  return (
                    <li key={character.id}>
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => toggle(character.id)}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          isSelected
                            ? "border-brand bg-brand/10 text-foreground"
                            : "border-border hover:bg-accent"
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {character.controlledBy === "AI" ? (
                            <Bot className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden="true" />
                          ) : (
                            <User
                              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                          )}
                          <span className="truncate">{character.name}</span>
                          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {typeLabel(character)}
                          </span>
                        </span>
                        {isSelected && <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          <span className="text-xs text-muted-foreground">
            {selected.length > 0
              ? `${selected.length} selecionado${selected.length === 1 ? "" : "s"}`
              : "Selecione quem adicionar"}
          </span>
          <Button
            type="button"
            size="sm"
            disabled={selected.length === 0 || addMutation.isPending}
            onClick={() => void addSelected()}
          >
            {addMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Adicionar
          </Button>
        </footer>
      </div>
    </div>
  );
}
