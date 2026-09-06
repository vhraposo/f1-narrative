"use client";

import { Calendar, Loader2, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { ParticipantPanel } from "@/components/events/participant-panel";
import { NewsCard } from "@/components/news/news-card";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  useDeleteEvent,
  useEvent,
  useEventNews,
} from "@/hooks/use-events";
import {
  EVENT_IMPORTANCE_LABELS,
  EVENT_SOURCE_LABELS,
  EVENT_TYPE_LABELS,
} from "@/lib/events";

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: event, isLoading, isError, error } = useEvent(id);
  const newsQuery = useEventNews(id);
  const deleteMutation = useDeleteEvent();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleDelete() {
    setDeleteError(null);
    deleteMutation.mutate(id, {
      onSuccess: () => router.push("/app/events"),
      onError: (err) => {
        setConfirmingDelete(false);
        setDeleteError(
          err instanceof Error ? err.message : "Falha ao excluir o evento",
        );
      },
    });
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
          <Button variant="outline" onClick={() => router.push("/app/events")}>
            Voltar para eventos
          </Button>
        }
      />
    );
  }

  const worldDate = formatDate(event.worldDate);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        kicker="UNIVERSO / EVENTOS"
        title={event.title}
        meta={
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                {EVENT_TYPE_LABELS[event.type]}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                {EVENT_IMPORTANCE_LABELS[event.importance]}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                {EVENT_SOURCE_LABELS[event.source]}
              </span>
            </div>
            {worldDate && (
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {worldDate}
              </span>
            )}
          </>
        }
        action={
          <div className="flex items-center gap-2">
            <Link
              href={`/app/events/${event.id}/edit`}
              className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-input bg-background px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Pencil className="mr-2 h-4 w-4" />
              Editar
            </Link>
            {confirmingDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Excluir?</span>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleteMutation.isPending}
                  onClick={handleDelete}
                >
                  {deleteMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Confirmar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={deleteMutation.isPending}
                  onClick={() => setConfirmingDelete(false)}
                >
                  Cancelar
                </Button>
              </div>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Excluir
              </Button>
            )}
          </div>
        }
      />

      {deleteError && (
        <p className="text-sm text-destructive" role="alert">
          {deleteError}
        </p>
      )}

      {event.description && (
        <p className="whitespace-pre-line text-muted-foreground">
          {event.description}
        </p>
      )}

      <section className="space-y-6">
        <ParticipantPanel eventId={event.id} />

        <div className="space-y-2">
          <h2 className="text-xl font-semibold tracking-tight">Notícia</h2>
          <p className="text-sm text-muted-foreground">
            Notícia derivada automaticamente a partir do evento e de seus
            participantes (somente leitura).
          </p>
          {newsQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : newsQuery.isError ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <p className="text-sm text-muted-foreground">
                Este evento ainda não possui uma notícia derivada.
              </p>
            </div>
          ) : newsQuery.data ? (
            <NewsCard news={newsQuery.data} />
          ) : null}
        </div>
      </section>
    </div>
  );
}