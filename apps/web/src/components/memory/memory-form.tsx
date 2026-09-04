"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
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
import { useEvents } from "@/hooks/use-events";
import { useCharacters } from "@/hooks/use-characters";
import {
  MEMORY_IMPORTANCE_OPTIONS,
  MEMORY_SOURCE_OPTIONS,
  type Memory,
} from "@/lib/memories";

// O contexto é digitado como texto JSON; validado apenas quando preenchido.
const contextFieldSchema = z
  .string()
  .optional()
  .refine(
    (value) =>
      value === undefined || value === "" || isValidJson(value),
    {
      message: "Contexto deve ser um JSON válido.",
    },
  );

function isValidJson(value: string): boolean {
  try {
    const parsed = JSON.parse(value);
    return (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    );
  } catch {
    return false;
  }
}

const memoryFormSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Informe o conteúdo da memória")
    .max(5000, "Conteúdo muito longo (máx. 5000 caracteres)"),
  summary: z
    .string()
    .max(1000, "Resumo muito longo (máx. 1000 caracteres)")
    .optional(),
  importance: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  source: z.enum([
    "CANON",
    "USER_DEFINED",
    "GENERATED_EVENT",
    "EXTERNAL_INFORMATION",
  ]),
  emotionalImpact: z.string().optional(),
  context: contextFieldSchema,
  eventId: z.string().optional(),
  participantIds: z
    .array(z.string())
    .min(1, "Selecione ao menos um personagem participante"),
});

type MemoryFormValues = z.infer<typeof memoryFormSchema>;

type MemorySubmitPayload = {
  content: string;
  summary?: string | null;
  importance?: Memory["importance"];
  source?: Memory["source"];
  emotionalImpact?: number | null;
  context?: Record<string, unknown> | null;
  eventId?: string | null;
  characterIds: string[];
};

type MemoryFormProps = {
  memory?: Pick<
    Memory,
    | "content"
    | "summary"
    | "importance"
    | "source"
    | "emotionalImpact"
    | "context"
    | "eventId"
    | "participants"
  >;
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (payload: MemorySubmitPayload) => void;
  submitLabel: string;
  cancelHref: string;
};

function emptyValues(): MemoryFormValues {
  return {
    content: "",
    summary: "",
    importance: "LOW",
    source: "USER_DEFINED",
    emotionalImpact: "",
    context: "",
    eventId: "",
    participantIds: [],
  };
}

export function MemoryForm({
  memory,
  isSubmitting,
  error,
  onSubmit,
  submitLabel,
  cancelHref,
}: MemoryFormProps) {
  const router = useRouter();
  const charactersQuery = useCharacters();
  const eventsQuery = useEvents();

  const defaultValues = useMemo<MemoryFormValues>(() => {
    if (!memory) return emptyValues();
    return {
      content: memory.content,
      summary: memory.summary ?? "",
      importance: memory.importance,
      source: memory.source,
      emotionalImpact:
        memory.emotionalImpact != null ? String(memory.emotionalImpact) : "",
      context: memory.context ? JSON.stringify(memory.context, null, 2) : "",
      eventId: memory.eventId ?? "",
      participantIds: memory.participants.map((p) => p.id),
    };
  }, [memory]);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    getValues,
    watch,
    formState: { errors },
  } = useForm<MemoryFormValues>({
    resolver: zodResolver(memoryFormSchema),
    defaultValues,
    mode: "onSubmit",
  });

  useEffect(() => {
    if (!memory) return;
    reset(defaultValues);
  }, [memory, reset, defaultValues]);

  const characters = charactersQuery.data ?? [];
  const events = eventsQuery.data ?? [];
  const participantIds = watch("participantIds");

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{memory ? "Editar memória" : "Nova memória"}</CardTitle>
      </CardHeader>
      <form
        onSubmit={handleSubmit((values) => {
          const context =
            values.context === undefined || values.context === ""
              ? null
              : (JSON.parse(values.context) as Record<string, unknown>);

          const emotional =
            values.emotionalImpact === undefined || values.emotionalImpact === ""
              ? null
              : Number(values.emotionalImpact);

          onSubmit({
            content: values.content,
            summary: values.summary === "" ? null : values.summary,
            importance: values.importance,
            source: values.source,
            emotionalImpact: emotional,
            context,
            eventId: values.eventId === "" ? null : values.eventId,
            characterIds: values.participantIds,
          });
        })}
        noValidate
      >
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="memory-content">Conteúdo</Label>
            <textarea
              id="memory-content"
              rows={4}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="O que essa memória registra?"
              {...register("content")}
            />
            {errors.content && (
              <p className="text-sm text-destructive">
                {errors.content.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="memory-summary">Resumo (opcional)</Label>
            <Input
              id="memory-summary"
              placeholder="Um título curto para a memória"
              {...register("summary")}
            />
            {errors.summary && (
              <p className="text-sm text-destructive">
                {errors.summary.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Participantes (ao menos um)</Label>
            {charactersQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">
                Carregando personagens...
              </p>
            ) : charactersQuery.isError ? (
              <p className="text-sm text-destructive">
                Não foi possível carregar seus personagens.
              </p>
            ) : characters.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Você ainda não tem personagens para associar à memória.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {characters.map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={participantIds.includes(c.id)}
                      onChange={() => toggleCharacter(c.id)}
                    />
                    <span>
                      {c.name}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {c.nationality}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Ao menos um participante precisa ser seu personagem (ownership).
              Personagens de IA podem ser associados depois, via painel de
              participantes.
            </p>
            {errors.participantIds && (
              <p className="text-sm text-destructive">
                {errors.participantIds.message}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="memory-importance">Importância</Label>
              <select
                id="memory-importance"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                {...register("importance")}
              >
                {MEMORY_IMPORTANCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="memory-source">Origem</Label>
              <select
                id="memory-source"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                {...register("source")}
              >
                {MEMORY_SOURCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="memory-event">Evento de origem (opcional)</Label>
              <select
                id="memory-event"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                {...register("eventId")}
              >
                <option value="">Nenhum evento</option>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="memory-emotionalImpact">
                Impacto emocional (-10 a 10, opcional)
              </Label>
              <Input
                id="memory-emotionalImpact"
                type="number"
                min={-10}
                max={10}
                placeholder="0"
                {...register("emotionalImpact")}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="memory-context">Contexto (JSON, opcional)</Label>
            <textarea
              id="memory-context"
              rows={4}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder='Ex.: { "local": "Interlagos", "disputa": "última volta" }'
              {...register("context")}
            />
            {errors.context && (
              <p className="text-sm text-destructive">
                {errors.context.message}
              </p>
            )}
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </CardContent>
        <CardFooter className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(cancelHref)}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Salvando..." : submitLabel}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}