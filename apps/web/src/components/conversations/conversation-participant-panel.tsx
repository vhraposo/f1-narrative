"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Bot, Loader2, Trash2, User, UserPlus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAiCharacters, useCharacters } from "@/hooks/use-characters";
import {
  useAddConversationParticipant,
  useConversationParticipants,
  useRemoveConversationParticipant,
} from "@/hooks/use-conversations";
import { ApiError } from "@/lib/api";

const addParticipantSchema = z.object({
  characterId: z.string().min(1, "Selecione um personagem"),
});

type AddParticipantValues = z.infer<typeof addParticipantSchema>;

type ConversationParticipantPanelProps = {
  conversationId: string;
};

export function ConversationParticipantPanel({
  conversationId,
}: ConversationParticipantPanelProps) {
  const participantsQuery = useConversationParticipants(conversationId);
  const charactersQuery = useCharacters();
  const aiCharactersQuery = useAiCharacters();
  const addMutation = useAddConversationParticipant(conversationId);
  const removeMutation = useRemoveConversationParticipant(conversationId);

  const [formError, setFormError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AddParticipantValues>({
    resolver: zodResolver(addParticipantSchema),
    defaultValues: { characterId: "" },
  });

  const participants = participantsQuery.data ?? [];
  const characters = charactersQuery.data ?? [];
  const aiCharacters = aiCharactersQuery.data ?? [];
  const participatingIds = new Set(participants.map((p) => p.id));
  const availableCharacters = [...characters, ...aiCharacters].filter(
    (c) => !participatingIds.has(c.id),
  );

  const characterOptions = availableCharacters.map((c) => ({
    id: c.id,
    label: `${c.name}${c.nationality ? ` (${c.nationality})` : ""}${
      c.controlledBy === "AI" ? " — IA" : ""
    }`,
  }));

  function handleAdd(values: AddParticipantValues) {
    setFormError(null);
    addMutation.mutate(values.characterId, {
      onSuccess: () => {
        setFormError(null);
        reset({ characterId: "" });
      },
      onError: (err) => {
        const message =
          err instanceof Error ? err.message : "Falha ao adicionar participante";
        setFormError(
          err instanceof ApiError && err.status === 409
            ? "Este personagem já participa da conversa."
            : message,
        );
      },
    });
  }

  function handleRemove(characterId: string) {
    setRemovingId(characterId);
    removeMutation.mutate(characterId, {
      onSettled: () => setRemovingId(null),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Participantes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {participantsQuery.isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : participantsQuery.isError ? (
          <p className="text-sm text-destructive" role="alert">
            Não foi possível carregar os participantes.
          </p>
        ) : null}

        {participants.length > 0 && (
          <ul className="divide-y rounded-md border">
            {participants.map((participant) => (
              <li
                key={participant.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <div>
                    <p className="text-sm font-medium">{participant.name}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      {participant.controlledBy === "AI" ? (
                        <>
                          <Bot className="h-3 w-3" /> IA
                        </>
                      ) : (
                        <>
                          <User className="h-3 w-3" /> Usuário
                        </>
                      )}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={removingId === participant.id}
                  onClick={() => handleRemove(participant.id)}
                >
                  {removingId === participant.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {!participantsQuery.isLoading &&
          !participantsQuery.isError &&
          participants.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum participante ainda.
            </p>
          )}

        {charactersQuery.isLoading || aiCharactersQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">
            Carregando personagens...
          </p>
        ) : charactersQuery.isError ? (
          <p className="text-sm text-destructive">
            Não foi possível carregar seus personagens.
          </p>
        ) : aiCharactersQuery.isError ? (
          <p className="text-sm text-destructive">
            Não foi possível carregar os personagens de IA.
          </p>
        ) : characterOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {characters.length === 0 && aiCharacters.length === 0
              ? "Você ainda não tem personagens para adicionar."
              : "Todos os personagens disponíveis já participam desta conversa."}
          </p>
        ) : (
          <form
            onSubmit={handleSubmit(handleAdd)}
            noValidate
            className="space-y-3 rounded-md border p-3"
          >
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  {...register("characterId")}
                >
                  <option value="">Selecione um personagem</option>
                  {characterOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <Button
                  type="submit"
                  size="sm"
                  disabled={addMutation.isPending}
                >
                  <UserPlus className="mr-1 h-4 w-4" />
                  Adicionar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Personagens de IA oficiais também podem participar da conversa.
              </p>
              {errors.characterId && (
                <p className="text-sm text-destructive">
                  {errors.characterId.message}
                </p>
              )}
              {formError && (
                <p className="text-sm text-destructive" role="alert">
                  {formError}
                </p>
              )}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}