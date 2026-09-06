"use client";

import { Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EventCard } from "@/components/events/event-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectTrigger,
} from "@/components/ui/select";
import {
  useDeleteEvent,
  useEvents,
} from "@/hooks/use-events";
import {
  EVENT_IMPORTANCE_OPTIONS,
  EVENT_TYPE_OPTIONS,
  type Event,
  type EventFilters,
} from "@/lib/events";

const primaryLinkStyles =
  "inline-flex items-center justify-center whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export default function EventsPage() {
  const [type, setType] = useState<EventFilters["type"]>(undefined);
  const [importance, setImportance] = useState<EventFilters["importance"]>(
    undefined,
  );

  const { data, isLoading, isError, isRefetching, error, refetch } =
    useEvents({ type, importance });
  const deleteMutation = useDeleteEvent();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function handleDelete(event: Event) {
    setDeletingId(event.id);
    deleteMutation.mutate(event.id, {
      onSettled: () => setDeletingId(null),
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="UNIVERSO / EVENTOS"
        title="Eventos"
        description="Os eventos da sua narrativa e a notícia derivada de cada um."
        action={
          <Link href="/app/events/new" className={primaryLinkStyles}>
            <Plus className="mr-2 h-4 w-4" />
            Novo evento
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor="event-type-filter"
          className="text-sm text-muted-foreground"
        >
          Tipo
        </label>
        <Select
          value={type ?? ""}
          onValueChange={(value) =>
            setType(value === "" ? undefined : (value as EventFilters["type"]))
          }
          options={[{ value: "", label: "Todos" }, ...EVENT_TYPE_OPTIONS]}
        >
          <SelectTrigger id="event-type-filter" className="w-44" />
          <SelectContent />
        </Select>
        <label
          htmlFor="event-importance-filter"
          className="text-sm text-muted-foreground"
        >
          Importância
        </label>
        <Select
          value={importance ?? ""}
          onValueChange={(value) =>
            setImportance(
              value === ""
                ? undefined
                : (value as EventFilters["importance"]),
            )
          }
          options={[{ value: "", label: "Todas" }, ...EVENT_IMPORTANCE_OPTIONS]}
        >
          <SelectTrigger id="event-importance-filter" className="w-44" />
          <SelectContent />
        </Select>
      </div>

      {isLoading && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <ErrorState
          title="Dados indisponíveis"
          description="Não foi possível carregar os eventos."
          detail={error instanceof Error ? error.message : "Erro desconhecido"}
          action={
            <Button
              variant="outline"
              onClick={() => void refetch()}
              disabled={isRefetching}
            >
              {isRefetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Tentar novamente
            </Button>
          }
        />
      )}

      {!isLoading && !isError && data && data.length === 0 && (
        <EmptyState
          title={
            type || importance
              ? "Nenhum evento encontrado"
              : "Você ainda não tem eventos."
          }
          description={
            type || importance
              ? "Ajuste os filtros para ver mais resultados."
              : "Crie seu primeiro evento para começar a narrativa."
          }
          action={
            !type && !importance ? (
              <Link href="/app/events/new" className={primaryLinkStyles}>
                <Plus className="mr-2 h-4 w-4" />
                Criar evento
              </Link>
            ) : undefined
          }
        />
      )}

      {data && data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              onDelete={handleDelete}
              isDeleting={deletingId === event.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}