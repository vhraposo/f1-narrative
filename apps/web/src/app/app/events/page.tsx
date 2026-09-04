"use client";

import { Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EventCard } from "@/components/events/event-card";
import { Button } from "@/components/ui/button";
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

  const { data, isLoading, isError, error, refetch } = useEvents({
    type,
    importance,
  });
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
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Eventos</h1>
          <p className="text-muted-foreground">
            Os eventos da sua narrativa e a notícia derivada de cada um.
          </p>
        </div>
        <Link href="/app/events/new" className={primaryLinkStyles}>
          <Plus className="mr-2 h-4 w-4" />
          Novo evento
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted-foreground">Tipo</label>
        <select
          className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          value={type ?? ""}
          onChange={(e) =>
            setType(e.target.value === "" ? undefined : (e.target.value as EventFilters["type"]))
          }
        >
          <option value="">Todos</option>
          {EVENT_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <label className="text-sm text-muted-foreground">Importância</label>
        <select
          className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          value={importance ?? ""}
          onChange={(e) =>
            setImportance(
              e.target.value === ""
                ? undefined
                : (e.target.value as EventFilters["importance"]),
            )
          }
        >
          <option value="">Todas</option>
          {EVENT_IMPORTANCE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-destructive">
            Não foi possível carregar os eventos.
          </p>
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "Erro desconhecido"}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => void refetch()}
          >
            Tentar novamente
          </Button>
        </div>
      )}

      {!isLoading && !isError && data && data.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-muted-foreground">
            {type || importance
              ? "Nenhum evento corresponde aos filtros."
              : "Você ainda não tem eventos."}
          </p>
          <p className="text-sm text-muted-foreground">
            {type || importance
              ? "Ajuste os filtros para ver mais resultados."
              : "Crie seu primeiro evento para começar a narrativa."}
          </p>
          {!type && !importance && (
            <Link href="/app/events/new" className={primaryLinkStyles}>
              <Plus className="mr-2 h-4 w-4" />
              Criar evento
            </Link>
          )}
        </div>
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