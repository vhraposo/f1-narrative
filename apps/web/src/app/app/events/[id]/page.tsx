"use client";

import { CalendarDays, Loader2, Newspaper, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import {
  IMPORTANCE_SIGNAL_CLASS,
  ImportanceDot,
} from "@/components/events/event-display";
import { ParticipantPanel } from "@/components/events/participant-panel";
import { SectionHeading } from "@/components/home/section-heading";
import { NewsCard } from "@/components/news/news-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { formatWorldDate, formatWorldDateLong } from "@/lib/event-format";
import {
  EVENT_IMPORTANCE_LABELS,
  EVENT_SOURCE_LABELS,
  EVENT_TYPE_LABELS,
} from "@/lib/events";
import { cn } from "@/lib/utils";
import {
  useDeleteEvent,
  useEvent,
  useEventNews,
} from "@/hooks/use-events";

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

  const worldDate = formatWorldDate(event.worldDate);
  const worldDateLong = formatWorldDateLong(event.worldDate);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        kicker="UNIVERSO / EVENTOS"
        title={event.title}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-2 font-medium text-foreground">
              <ImportanceDot importance={event.importance} className="h-2.5 w-2.5" />
              {EVENT_IMPORTANCE_LABELS[event.importance]}
            </span>
            <span aria-hidden="true" className="text-muted-foreground/50">
              ·
            </span>
            <span>{EVENT_TYPE_LABELS[event.type]}</span>
            <span aria-hidden="true" className="text-muted-foreground/50">
              ·
            </span>
            <span>{EVENT_SOURCE_LABELS[event.source]}</span>
            {worldDate && (
              <>
                <span aria-hidden="true" className="text-muted-foreground/50">
                  ·
                </span>
                <span className="inline-flex items-center gap-1.5 tabular-nums font-medium text-foreground">
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                  {worldDate}
                </span>
              </>
            )}
          </span>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
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

      <section aria-label="Registro do evento">
        <div className="relative overflow-hidden rounded-lg border border-border bg-card p-6">
          <span
            aria-hidden="true"
            className={cn(
              "absolute inset-y-0 left-0 w-[3px]",
              IMPORTANCE_SIGNAL_CLASS[event.importance],
            )}
          />
          <div className="flex flex-wrap items-center gap-2">
            <ImportanceDot importance={event.importance} />
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {EVENT_TYPE_LABELS[event.type]}
            </p>
            <span aria-hidden="true" className="text-muted-foreground/50">
              ·
            </span>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {EVENT_IMPORTANCE_LABELS[event.importance]}
            </p>
          </div>
          {worldDateLong && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              {worldDateLong}
            </p>
          )}
          {event.description && (
            <p className="mt-4 whitespace-pre-line break-words text-muted-foreground">
              {event.description}
            </p>
          )}
        </div>
      </section>

      <section aria-label="Participantes" className="space-y-4">
        <ParticipantPanel eventId={event.id} />
      </section>

      <section aria-label="Notícia derivada" className="space-y-4">
        {newsQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : newsQuery.isError || newsQuery.data == null ? (
          <EmptyState
            icon={<Newspaper className="h-6 w-6" />}
            kicker="Cobertura"
            title="Sem notícia derivada."
            description="A notícia surge automaticamente quando o evento e seus participantes tiverem informações suficientes."
          />
        ) : (
          <>
            <SectionHeading kicker="Cobertura" title="Notícia" />
            <NewsCard news={newsQuery.data} />
          </>
        )}
      </section>
    </div>
  );
}