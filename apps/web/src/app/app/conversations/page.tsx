"use client";

import { Loader2, MessagesSquare, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConversationCard } from "@/components/conversations/conversation-card";
import { ConversationForm } from "@/components/conversations/conversation-form";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  useConversations,
  useCreateConversation,
  useDeleteConversation,
} from "@/hooks/use-conversations";
import type { Conversation } from "@/lib/conversations";

export default function ConversationsPage() {
  const router = useRouter();
  const {
    data,
    isLoading,
    isError,
    isRefetching,
    error,
    refetch,
  } = useConversations();
  const createMutation = useCreateConversation();
  const deleteMutation = useDeleteConversation();

  const [showCreate, setShowCreate] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function handleCreate(payload: Parameters<typeof createMutation.mutate>[0]) {
    setFormError(null);
    createMutation.mutate(payload, {
      onSuccess: (conversation) => {
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
    deleteMutation.mutate(conversation.id, {
      onSettled: () => setDeletingId(null),
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="UNIVERSO / CONVERSAS"
        title="Conversas"
        description="Comunicação persistente entre personagens do universo."
        action={
          <Button onClick={() => setShowCreate((v) => !v)}>
            <Plus className="mr-2 h-4 w-4" />
            Nova conversa
          </Button>
        }
      />

      {showCreate && (
        <ConversationForm
          isSubmitting={createMutation.isPending}
          error={formError}
          onSubmit={handleCreate}
          submitLabel="Criar conversa"
          cancelHref="/app/conversations"
        />
      )}

      {isLoading && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <ErrorState
          title="Dados indisponíveis"
          description="Não foi possível carregar as conversas."
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
          icon={<MessagesSquare className="h-6 w-6" />}
          title="Você ainda não tem conversas."
          description="Crie uma conversa para começar a comunicação entre personagens."
        />
      )}

      {data && data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((conversation) => (
            <ConversationCard
              key={conversation.id}
              conversation={conversation}
              onDelete={handleDelete}
              isDeleting={deletingId === conversation.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}