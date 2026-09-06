"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
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
import {
  Select,
  SelectContent,
  SelectTrigger,
} from "@/components/ui/select";
import {
  EVENT_IMPORTANCE_OPTIONS,
  EVENT_SOURCE_OPTIONS,
  EVENT_TYPE_OPTIONS,
  type CreateEventInput,
  type Event,
} from "@/lib/events";

const eventFormSchema = z.object({
  type: z.enum([
    "RACE",
    "RACE_INCIDENT",
    "RELATIONSHIP",
    "SOCIAL",
    "PERSONAL",
    "NEWS",
    "WORLD",
  ]),
  title: z
    .string()
    .trim()
    .min(1, "Informe o título")
    .max(140, "Título muito longo (máx. 140 caracteres)"),
  description: z
    .string()
    .max(2000, "Descrição muito longa (máx. 2000 caracteres)")
    .optional(),
  importance: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  source: z.enum([
    "CANON",
    "USER_DEFINED",
    "GENERATED_EVENT",
    "EXTERNAL_INFORMATION",
  ]),
  worldDate: z.string().optional(),
});

type EventFormValues = z.infer<typeof eventFormSchema>;

function emptyValues(): EventFormValues {
  return {
    type: "RACE",
    title: "",
    description: "",
    importance: "MEDIUM",
    source: "USER_DEFINED",
    worldDate: "",
  };
}

function toInput(values: EventFormValues): CreateEventInput {
  return {
    type: values.type,
    title: values.title,
    description: values.description === "" ? null : values.description,
    importance: values.importance,
    source: values.source,
    worldDate: values.worldDate
      ? new Date(values.worldDate).toISOString()
      : null,
  };
}

type EventFormProps = {
  event?: Pick<
    Event,
    "type" | "title" | "description" | "importance" | "source" | "worldDate"
  >;
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (input: CreateEventInput) => void;
  submitLabel: string;
  cancelHref: string;
};

export function EventForm({
  event,
  isSubmitting,
  error,
  onSubmit,
  submitLabel,
  cancelHref,
}: EventFormProps) {
  const router = useRouter();

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: event
      ? {
          type: event.type,
          title: event.title,
          description: event.description ?? "",
          importance: event.importance,
          source: event.source,
          worldDate: event.worldDate?.slice(0, 16) ?? "",
        }
      : emptyValues(),
  });

  useEffect(() => {
    if (!event) return;
    reset({
      type: event.type,
      title: event.title,
      description: event.description ?? "",
      importance: event.importance,
      source: event.source,
      worldDate: event.worldDate?.slice(0, 16) ?? "",
    });
  }, [event, reset]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {event ? "Editar evento" : "Novo evento"}
        </CardTitle>
      </CardHeader>
      <form
        onSubmit={handleSubmit((values) => onSubmit(toInput(values)))}
        noValidate
      >
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="event-type">Tipo</Label>
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  options={EVENT_TYPE_OPTIONS}
                >
                  <SelectTrigger id="event-type" onBlur={field.onBlur} />
                  <SelectContent />
                </Select>
              )}
            />
            {errors.type && (
              <p className="text-sm text-destructive">{errors.type.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="event-title">Título</Label>
            <Input
              id="event-title"
              placeholder="Título do evento"
              {...register("title")}
            />
            {errors.title && (
              <p className="text-sm text-destructive">{errors.title.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="event-description">Descrição</Label>
            <textarea
              id="event-description"
              rows={4}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Detalhes do evento (opcional)"
              {...register("description")}
            />
            {errors.description && (
              <p className="text-sm text-destructive">
                {errors.description.message}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="event-importance">Importância</Label>
              <Controller
                control={control}
                name="importance"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    options={EVENT_IMPORTANCE_OPTIONS}
                  >
                    <SelectTrigger
                      id="event-importance"
                      onBlur={field.onBlur}
                    />
                    <SelectContent />
                  </Select>
                )}
              />
              {errors.importance && (
                <p className="text-sm text-destructive">
                  {errors.importance.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="event-source">Origem</Label>
              <Controller
                control={control}
                name="source"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    options={EVENT_SOURCE_OPTIONS}
                  >
                    <SelectTrigger id="event-source" onBlur={field.onBlur} />
                    <SelectContent />
                  </Select>
                )}
              />
              {errors.source && (
                <p className="text-sm text-destructive">
                  {errors.source.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="event-worldDate">Data do mundo (opcional)</Label>
            <Input
              id="event-worldDate"
              type="datetime-local"
              {...register("worldDate")}
            />
            {errors.worldDate && (
              <p className="text-sm text-destructive">
                {errors.worldDate.message}
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
          <Button type="button" variant="outline" onClick={() => router.push(cancelHref)}>
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