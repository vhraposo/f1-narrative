"use client";

import { Calendar, Loader2, Pencil, X } from "lucide-react";
import { useState } from "react";

import { MemoryForm } from "@/components/memory/memory-form";
import { MemoryParticipantPanel } from "@/components/memory/memory-participant-panel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useEvent } from "@/hooks/use-events";
import { useMemory, useUpdateMemory } from "@/hooks/use-memories";
import {
  MEMORY_IMPORTANCE_LABELS,
  MEMORY_SOURCE_LABELS,
} from "@/lib/memories";

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
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <CardTitle className="text-lg">
            {memory.summary || "Memória"}
          </CardTitle>
          <div className="flex shrink-0 items-center gap-2">
            {!editing && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(true)}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Editar
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onDone} aria-label="Fechar">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {editing ? (
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
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                  {MEMORY_IMPORTANCE_LABELS[memory.importance]}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                  {MEMORY_SOURCE_LABELS[memory.source]}
                </span>
                {memory.emotionalImpact != null && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                    Impacto: {memory.emotionalImpact}
                  </span>
                )}
              </div>

              {memory.eventId != null && (
                <p className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  Evento de origem:
                  {eventTitle ?? "Evento"}
                </p>
              )}

              <div className="whitespace-pre-line text-sm">{memory.content}</div>

              {memory.summary && (
                <p className="text-xs text-muted-foreground">
                  Resumo: {memory.summary}
                </p>
              )}

              {memory.context && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Contexto
                  </p>
                  <pre className="mt-1 whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                    {JSON.stringify(memory.context, null, 2)}
                  </pre>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <MemoryParticipantPanel memoryId={memoryId} />
    </div>
  );
}