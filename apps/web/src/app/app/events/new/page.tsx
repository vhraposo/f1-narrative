"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { EventForm } from "@/components/events/event-form";
import { PageHeader } from "@/components/ui/page-header";
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
      <PageHeader
        kicker="UNIVERSO / EVENTOS"
        title="Novo evento"
        description="Registre um evento na sua narrativa."
      />
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