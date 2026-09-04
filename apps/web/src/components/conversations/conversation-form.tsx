"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCharacters } from "@/hooks/use-characters";
import {
  CONVERSATION_TYPE_OPTIONS,
  type Conversation,
  type ConversationType,
} from "@/lib/conversations";

const conversationFormSchema = z.object({
  title: z.string().trim().max(200, "Título muito longo (máx. 200 caracteres)"),
  type: z.enum(["GROUP", "DM"]),
  participantIds: z.array(z.string()),
});

type ConversationFormValues = z.infer<typeof conversationFormSchema>;

type ConversationSubmitPayload = {
  title?: string | null;
  type?: ConversationType;
  participantIds: string[];
};

type ConversationFormProps = {
  conversation?: Pick<
    Conversation,
    "title" | "type" | "participants"
  >;
  mode?: "create" | "edit";
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (payload: ConversationSubmitPayload) => void;
  submitLabel: string;
  cancelHref: string;
};

export function ConversationForm({
  conversation,
  mode = "create",
  isSubmitting,
  error,
  onSubmit,
  submitLabel,
  cancelHref,
}: ConversationFormProps) {
  const isEdit = mode === "edit";
  const router = useRouter();
  const charactersQuery = useCharacters();

  const defaultValues: ConversationFormValues = conversation
    ? {
        title: conversation.title ?? "",
        type: conversation.type,
        participantIds: conversation.participants.map((p) => p.id),
      }
    : { title: "", type: "GROUP", participantIds: [] };

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    getValues,
    watch,
    setError,
    formState: { errors },
  } = useForm<ConversationFormValues>({
    resolver: zodResolver(conversationFormSchema),
    defaultValues,
    mode: "onSubmit",
  });

  useEffect(() => {
    if (!conversation) return;
    reset({
      title: conversation.title ?? "",
      type: conversation.type,
      participantIds: conversation.participants.map((p) => p.id),
    });
  }, [conversation, reset]);

  const characters = charactersQuery.data ?? [];
  const participantIds = watch("participantIds");
  const type = watch("type");

  function toggleCharacter(id: string) {
    const current = getValues("participantIds");
    setValue(
      "participantIds",
      current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id],
      { shouldValidate: true },
    );
  }

  function handleFormSubmit(values: ConversationFormValues) {
    if (!isEdit && values.participantIds.length < 1) {
      setError("participantIds", {
        type: "manual",
        message: "Selecione ao menos um personagem participante",
      });
      return;
    }
    onSubmit(values);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {conversation ? "Editar conversa" : "Nova conversa"}
        </CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit(handleFormSubmit)} noValidate>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="conversation-title">Título (opcional)</Label>
            <Input
              id="conversation-title"
              placeholder="Ex.: Garagem Paddock"
              {...register("title")}
            />
            {errors.title && (
              <p className="text-sm text-destructive">{errors.title.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Tipo</Label>
            <div className="flex gap-4">
              {CONVERSATION_TYPE_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    value={option.value}
                    checked={type === option.value}
                    {...register("type")}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          {!isEdit && (
            <>
              {type === "DM" && (
                <p className="text-xs text-muted-foreground">
                  Conversa direta (DM) exige exatamente 2 participantes.
                </p>
              )}

              <div className="space-y-2">
                <Label>Participantes</Label>
                {charactersQuery.isLoading ? (
                  <p className="text-sm text-muted-foreground">
                    Carregando personagens...
                  </p>
                ) : charactersQuery.isError ? (
                  <p className="text-sm text-destructive">
                    Não foi possível carregar seus personagens.
                  </p>
                ) : (characters ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Você ainda não tem personagens para participar de uma conversa.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2 rounded-md border p-3">
                    {(characters ?? []).map((character) => {
                      const selected = participantIds.includes(character.id);
                      return (
                        <button
                          type="button"
                          key={character.id}
                          onClick={() => toggleCharacter(character.id)}
                          className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors ${
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "hover:bg-accent"
                          }`}
                        >
                          {character.name}
                          <span className="text-xs opacity-70">
                            {character.nationality}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {errors.participantIds && (
                  <p className="text-sm text-destructive">
                    {errors.participantIds.message}
                  </p>
                )}
              </div>
            </>
          )}

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </CardContent>

        <CardFooter className="justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(cancelHref)}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {submitLabel}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}