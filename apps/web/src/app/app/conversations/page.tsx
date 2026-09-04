"use client";

import { Loader2, MessagesSquare, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConversationCard } from "@/components/conversations/conversation-card";
import { ConversationForm } from "@/components/conversations/conversation-form";
import { Button } from "@/components/ui/button";
import {
  useConversations,
  useCreateConversation,
  useDeleteConversation,
} from "@/hooks/use-conversations";
import type { Conversation } from "@/lib/conversations";

export default function ConversationsPage() {
  const router = useRouter();
  const { data, isLoading, isError, error, refetch } = useConversations();
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Conversas</h1>
          <p className="text-muted-foreground">
            Comunicação persistente entre personagens do universo.
          </p>
        </div>
        <Button onClick={() => setShowCreate((v) => !v)}>
          <Plus className="mr-2 h-4 w-4" />
          Nova conversa
        </Button>
      </div>

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
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-destructive">
            Não foi possível carregar as conversas.
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
          <MessagesSquare className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-muted-foreground">
            Você ainda não tem conversas.
          </p>
          <p className="text-sm text-muted-foreground">
            Crie uma conversa para começar a comunicação entre personagens.
          </p>
        </div>
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