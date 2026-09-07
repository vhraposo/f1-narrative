"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { ConversationForm } from "@/components/conversations/conversation-form";
import { ConversationList } from "@/components/conversations/conversation-list";
import { ConversationThread } from "@/components/conversations/conversation-thread";
import {
  useConversations,
  useCreateConversation,
  useDeleteConversation,
} from "@/hooks/use-conversations";
import { useSeasons } from "@/hooks/use-championship";
import { useWorld } from "@/hooks/use-world";
import { findDefaultGroup, type Conversation } from "@/lib/conversations";
import { cn } from "@/lib/utils";

export default function ConversationsPage() {
  const router = useRouter();
  const conversationsQuery = useConversations();
  const worldQuery = useWorld();
  const seasonsQuery = useSeasons();
  const createMutation = useCreateConversation();
  const deleteMutation = useDeleteConversation();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [interacted, setInteracted] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const conversations = conversationsQuery.data ?? [];

  // Temporada atual DERIVADA de dados reais: world.currentSeasonId → seasons.
  // Nenhum ano é inventado; sem world/seasons, o grupo é resolvido sem ano.
  const currentSeasonYear = useMemo(() => {
    const currentSeasonId = worldQuery.data?.currentSeasonId;
    if (!currentSeasonId || !seasonsQuery.data) return undefined;
    const season = seasonsQuery.data.find((s) => s.id === currentSeasonId);
    return season?.year;
  }, [worldQuery.data, seasonsQuery.data]);

  const defaultGroup = useMemo(
    () => findDefaultGroup(conversationsQuery.data ?? [], currentSeasonYear),
    [conversationsQuery.data, currentSeasonYear],
  );

  // Direciona para o grupo por padrão quando ele existe nos dados.
  useEffect(() => {
    if (interacted || !defaultGroup) return;
    setSelectedId(defaultGroup.id);
  }, [defaultGroup, interacted]);

  function handleSelect(id: string) {
    setInteracted(true);
    setShowCreate(false);
    setDeleteError(null);
    setSelectedId(id);
  }

  function handleBack() {
    setInteracted(true);
    setShowCreate(false);
    setDeleteError(null);
    setSelectedId(null);
  }

  function handleCreate(payload: Parameters<typeof createMutation.mutate>[0]) {
    setFormError(null);
    createMutation.mutate(payload, {
      onSuccess: (conversation) => {
        setInteracted(true);
        setShowCreate(false);
        router.push(`/app/conversations/${conversation.id}`);
      },
      onError: (err) =>
        setFormError(
          err instanceof Error ? err.message : "Falha ao criar conversa",
        ),
    });
  }

  function handleDelete(conversation: Conversation) {
    setDeletingId(conversation.id);
    setDeleteError(null);
    deleteMutation.mutate(conversation.id, {
      onSettled: () => setDeletingId(null),
      onError: (err) =>
        setDeleteError(
          err instanceof Error ? err.message : "Falha ao excluir conversa",
        ),
    });
  }

  return (
    <section
      className={cn(
        "flex h-[calc(100dvh-8rem)] min-h-[480px] flex-col overflow-hidden rounded-xl border border-border bg-card",
        "lg:h-[calc(100dvh-6rem)]",
      )}
    >
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside
          className={cn(
            "min-h-0 flex-col border-border lg:flex lg:border-r",
            selectedId && !showCreate ? "hidden lg:flex" : "flex",
          )}
        >
          <ConversationList
            conversations={conversations}
            selectedId={selectedId}
            defaultGroupId={defaultGroup?.id ?? null}
            isLoading={conversationsQuery.isLoading}
            isError={conversationsQuery.isError}
            onNew={() => {
              setInteracted(true);
              setSelectedId(null);
              setShowCreate((v) => !v);
            }}
            onSelect={handleSelect}
            onDelete={handleDelete}
            isDeletingId={deletingId}
            onRetry={() => void conversationsQuery.refetch()}
          />
        </aside>

        <section
          className={cn(
            "min-h-0 flex-col",
            selectedId || showCreate ? "flex" : "hidden lg:flex",
          )}
        >
          {deleteError && (
            <p
              className="shrink-0 border-b border-border px-4 py-2 text-xs text-destructive"
              role="alert"
            >
              {deleteError}
            </p>
          )}
          {showCreate ? (
            <div className="min-h-0 flex-1 overflow-y-auto bg-background p-4 sm:p-6">
              <ConversationForm
                isSubmitting={createMutation.isPending}
                error={formError}
                onSubmit={handleCreate}
                submitLabel="Criar conversa"
                cancelHref="/app/conversations"
              />
            </div>
          ) : (
            <ConversationThread
              conversationId={selectedId}
              backHref="/app/conversations"
              onBack={handleBack}
              backClassName="lg:hidden"
            />
          )}
        </section>
      </div>
    </section>
  );
}