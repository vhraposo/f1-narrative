"use client";

import { Loader2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { EventForm } from "@/components/events/event-form";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { useEvent, useUpdateEvent } from "@/hooks/use-events";
import type { CreateEventInput } from "@/lib/events";

export default function EditEventPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: event, isLoading, isError, error } = useEvent(id);
  const updateMutation = useUpdateEvent();
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleSubmit(input: CreateEventInput) {
    setSubmitError(null);
    updateMutation.mutate(
      { id, input },
      {
        onSuccess: () => {
          router.push(`/app/events/${id}`);
          router.refresh();
        },
        onError: (err) => {
          setSubmitError(
            err instanceof Error ? err.message : "Falha ao salvar evento",
          );
        },
      },
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !event) {
    return (
      <ErrorState
        heading="h1"
        title="Evento não encontrado"
        description={
          error instanceof Error
            ? error.message
            : "Não foi possível carregar o evento."
        }
        action={
          <Button
            variant="outline"
            onClick={() => router.push("/app/events")}
          >
            Voltar para eventos
          </Button>
        }
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        kicker="UNIVERSO / EVENTOS"
        title="Editar evento"
        description={`Atualize os dados de ${event.title}.`}
      />
      <EventForm
        event={event}
        isSubmitting={updateMutation.isPending}
        error={submitError}
        onSubmit={handleSubmit}
        submitLabel="Salvar alterações"
        cancelHref={`/app/events/${event.id}`}
      />
    </div>
  );
}