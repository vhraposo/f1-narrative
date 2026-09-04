"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Trash2, UserPlus } from "lucide-react";
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
import { useCharacters } from "@/hooks/use-characters";
import {
  useAddParticipant,
  useEventParticipants,
  useRemoveParticipant,
} from "@/hooks/use-events";
import { ApiError } from "@/lib/api";

const addParticipantSchema = z.object({
  characterId: z.string().min(1, "Selecione um personagem"),
});

type AddParticipantValues = z.infer<typeof addParticipantSchema>;

type ParticipantPanelProps = {
  eventId: string;
};

export function ParticipantPanel({ eventId }: ParticipantPanelProps) {
  const {
    data: participants,
    isLoading,
    isError,
  } = useEventParticipants(eventId);
  const charactersQuery = useCharacters();
  const addMutation = useAddParticipant();
  const removeMutation = useRemoveParticipant();

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

  const characters = charactersQuery.data ?? [];
  const participatingIds = new Set(
    (participants ?? []).map((p) => p.id),
  );
  const availableCharacters = characters.filter(
    (c) => !participatingIds.has(c.id),
  );

  // Personagens ainda não participantes, excluindo os já vinculados.
  const characterOptions = availableCharacters.map((c) => ({
    id: c.id,
    label: `${c.name}${c.nationality ? ` (${c.nationality})` : ""}`,
  }));

  function handleAdd(values: AddParticipantValues) {
    setFormError(null);
    addMutation.mutate(
      { eventId, characterId: values.characterId },
      {
        onSuccess: () => {
          setFormError(null);
          reset({ characterId: "" });
        },
        onError: (err) => {
          const message =
            err instanceof Error ? err.message : "Falha ao adicionar participante";
          setFormError(
            err instanceof ApiError && err.status === 409
              ? "Este personagem já participa do evento."
              : message,
          );
        },
      },
    );
  }

  function handleRemove(characterId: string) {
    setRemovingId(characterId);
    removeMutation.mutate(
      { eventId, characterId },
      {
        onSettled: () => setRemovingId(null),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Participantes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {isError && (
          <p className="text-sm text-destructive" role="alert">
            Não foi possível carregar os participantes.
          </p>
        )}

        {!isLoading && !isError && participants && participants.length > 0 && (
          <ul className="divide-y rounded-md border">
            {participants.map((participant) => (
              <li
                key={participant.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium">{participant.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {participant.nationality}
                  </p>
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

        {!isLoading && !isError && participants && participants.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum participante ainda.
          </p>
        )}

        {charactersQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">
            Carregando personagens...
          </p>
        ) : charactersQuery.isError ? (
          <p className="text-sm text-destructive">
            Não foi possível carregar seus personagens.
          </p>
        ) : characterOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {characters.length === 0
              ? "Você ainda não tem personagens para adicionar."
              : "Todos os seus personagens já participam deste evento."}
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