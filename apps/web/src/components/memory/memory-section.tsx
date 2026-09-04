"use client";

import { Brain, Loader2, Plus } from "lucide-react";
import { useState } from "react";

import { MemoryCard } from "@/components/memory/memory-card";
import { MemoryDetail } from "@/components/memory/memory-detail";
import { MemoryForm } from "@/components/memory/memory-form";
import { Button } from "@/components/ui/button";
import {
  useCharacterMemories,
  useCreateMemory,
  useDeleteMemory,
} from "@/hooks/use-memories";
import type { Memory } from "@/lib/memories";

type MemorySectionProps = {
  characterId: string;
  characterName: string;
};

export function MemorySection({
  characterId,
  characterName,
}: MemorySectionProps) {
  const memoriesQuery = useCharacterMemories(characterId);
  const createMutation = useCreateMemory(characterId);
  const deleteMutation = useDeleteMemory(characterId);

  const [showCreate, setShowCreate] = useState(false);
  const [openMemoryId, setOpenMemoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleCreate(payload: {
    content: string;
    summary?: string | null;
    importance?: Memory["importance"];
    source?: Memory["source"];
    emotionalImpact?: number | null;
    context?: Record<string, unknown> | null;
    eventId?: string | null;
    characterIds: string[];
  }) {
    setError(null);
    createMutation.mutate(payload, {
      onSuccess: () => {
        setShowCreate(false);
      },
      onError: (err) =>
        setError(err instanceof Error ? err.message : "Falha ao criar memória"),
    });
  }

  function handleDelete(memory: Memory) {
    deleteMutation.mutate(memory.id, {
      onError: (err) =>
        setError(
          err instanceof Error ? err.message : "Falha ao excluir memória",
        ),
    });
  }

  return (
    <section className="rounded-lg border p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Memórias</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Lembranças relevantes para {characterName}.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
          <Plus className="mr-2 h-4 w-4" />
          Nova memória
        </Button>
      </div>

      {error && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {showCreate && (
        <div className="mt-4">
          <MemoryForm
            isSubmitting={createMutation.isPending}
            error={error}
            onSubmit={handleCreate}
            submitLabel="Criar memória"
            cancelHref="#"
          />
        </div>
      )}

      <div className="mt-4 space-y-3">
        {memoriesQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : memoriesQuery.isError ? (
          <p className="text-sm text-destructive" role="alert">
            Não foi possível carregar as memórias.
          </p>
        ) : memoriesQuery.data && memoriesQuery.data.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <Brain className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              {showCreate
                ? "Preencha o formulário acima para registrar a primeira memória."
                : "Este personagem ainda não possui memórias. Crie a primeira para começar."}
            </p>
          </div>
        ) : openMemoryId ? (
          <MemoryDetail
            memoryId={openMemoryId}
            onDone={() => setOpenMemoryId(null)}
          />
        ) : (
          (memoriesQuery.data ?? []).map((memory) => (
            <MemoryCard
              key={memory.id}
              memory={memory}
              isDeleting={deleteMutation.isPending}
              onDelete={handleDelete}
              onOpen={() => setOpenMemoryId(memory.id)}
            />
          ))
        )}
      </div>
    </section>
  );
}