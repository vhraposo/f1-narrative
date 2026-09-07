"use client";

import { CalendarDays, Loader2, Pencil, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { MemoryForm } from "@/components/memory/memory-form";
import { MemoryParticipantPanel } from "@/components/memory/memory-participant-panel";
import {
  IMPORTANCE_SIGNAL_CLASS,
  ImportanceDot,
} from "@/components/events/event-display";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useEvent } from "@/hooks/use-events";
import { useMemory, useUpdateMemory } from "@/hooks/use-memories";
import {
  formatMemoryDate,
  MEMORY_IMPORTANCE_LABELS,
  MEMORY_SOURCE_LABELS,
} from "@/lib/memories";
import { cn } from "@/lib/utils";

type MemoryDetailProps = {
  memoryId: string;
  onDone?: () => void;
};

export function MemoryDetail({ memoryId, onDone }: MemoryDetailProps) {
  const memoryQuery = useMemory(memoryId);
  const eventQuery = useEvent(memoryQuery.data?.eventId ?? undefined);
  const updateMutation = useUpdateMemory();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const memory = memoryQuery.data;
  const mode = editing ? "editing" : error ? "error" : "view";

  function handleUpdate(payload: Parameters<typeof updateMutation.mutate>[0]["input"]) {
    setError(null);
    updateMutation.mutate(
      { id: memoryId, input: payload },
      {
        onSuccess: () => setEditing(false),
        onError: (err) =>
          setError(err instanceof Error ? err.message : "Falha ao salvar"),
      },
    );
  }

  if (mode === "error") {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-destructive" role="alert">
            Não foi possível carregar a memória.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (memoryQuery.isLoading || !memory) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const eventTitle =
    memory.eventId != null && eventQuery.data ? eventQuery.data.title : null;

  return (
    <div className="space-y-4">
      <article className="relative overflow-hidden rounded-xl border border-border bg-card">
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-0 left-0 w-[3px]",
            IMPORTANCE_SIGNAL_CLASS[memory.importance],
          )}
        />

        {editing ? (
          <div className="p-5 pl-5">
            <MemoryForm
              memory={memory}
              isSubmitting={updateMutation.isPending}
              error={error}
              onSubmit={(payload) =>
                handleUpdate({
                  content: payload.content,
                  summary: payload.summary,
                  importance: payload.importance,
                  source: payload.source,
                  emotionalImpact: payload.emotionalImpact,
                  context: payload.context,
                  eventId: payload.eventId,
                })
              }
              submitLabel="Salvar alterações"
              cancelHref="#"
            />
          </div>
        ) : (
          <div className="flex flex-col p-5 pl-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Memória
                  </span>
                  <span aria-hidden="true" className="text-muted-foreground/50">
                    ·
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                    {formatMemoryDate(memory.createdAt)}
                  </span>
                  <span aria-hidden="true" className="text-muted-foreground/50">
                    ·
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-foreground">
                    <ImportanceDot importance={memory.importance} />
                    {MEMORY_IMPORTANCE_LABELS[memory.importance]}
                  </span>
                  <span
                    aria-hidden="true"
                    className="text-muted-foreground/50"
                  >
                    ·
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {MEMORY_SOURCE_LABELS[memory.source]}
                  </span>
                </div>
                <h2 className="mt-2 text-xl font-black tracking-tight text-foreground">
                  {memory.summary || "Memória"}
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Editar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDone}
                  aria-label="Fechar"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {memory.eventId != null && (
              <div className="mt-4 border-t border-border pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Origem
                </p>
                <Link
                  href={`/app/events/${memory.eventId}`}
                  className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                >
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  EVENT / {eventTitle ?? "Evento"}
                </Link>
              </div>
            )}

            {memory.participants.length > 0 && (
              <div className="mt-4 border-t border-border pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Participantes
                </p>
                <ul className="mt-2 space-y-1">
                  {memory.participants.map((participant) => (
                    <li key={participant.id}>
                      <Link
                        href={`/app/characters/${participant.id}`}
                        className="text-sm font-medium text-foreground transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                      >
                        {participant.name}
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {participant.nationality}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {memory.summary && (
              <div className="mt-4 border-t border-border pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Resumo
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {memory.summary}
                </p>
              </div>
            )}

            {memory.emotionalImpact != null && (
              <div className="mt-4 border-t border-border pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Impacto
                </p>
                <p className="mt-1 text-sm font-medium tabular-nums text-foreground">
                  {memory.emotionalImpact}
                </p>
              </div>
            )}

            <div className="mt-4 border-t border-border pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Memória
              </p>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground">
                {memory.content}
              </p>
            </div>
          </div>
        )}
      </article>

      <MemoryParticipantPanel memoryId={memoryId} />
    </div>
  );
}
