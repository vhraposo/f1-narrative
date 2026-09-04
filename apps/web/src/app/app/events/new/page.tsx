"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { EventForm } from "@/components/events/event-form";
import { useCreateEvent } from "@/hooks/use-events";
import type { CreateEventInput } from "@/lib/events";

export default function NewEventPage() {
  const router = useRouter();
  const createMutation = useCreateEvent();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(input: CreateEventInput) {
    setError(null);
    createMutation.mutate(input, {
      onSuccess: () => {
        router.push("/app/events");
        router.refresh();
      },
      onError: (err) => {
        setError(err instanceof Error ? err.message : "Falha ao criar evento");
      },
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Novo evento</h1>
        <p className="text-muted-foreground">
          Registre um evento na sua narrativa.
        </p>
      </div>
      <EventForm
        isSubmitting={createMutation.isPending}
        error={error}
        onSubmit={handleSubmit}
        submitLabel="Criar evento"
        cancelHref="/app/events"
      />
    </div>
  );
}