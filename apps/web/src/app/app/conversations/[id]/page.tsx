"use client";

import { Loader2, Pencil } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { ConversationForm } from "@/components/conversations/conversation-form";
import { ConversationParticipantPanel } from "@/components/conversations/conversation-participant-panel";
import { ConversationThread } from "@/components/conversations/conversation-thread";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import {
  useConversation,
  useUpdateConversation,
} from "@/hooks/use-conversations";
import type { ConversationType } from "@/lib/conversations";

export default function ConversationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: conversation, isLoading, isError, error } = useConversation(id);
  const updateMutation = useUpdateConversation();

  const [showEdit, setShowEdit] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function handleUpdate(payload: {
    title?: string | null;
    type?: ConversationType;
  }) {
    setFormError(null);
    updateMutation.mutate(
      {
        id: conversation?.id ?? "",
        input: { title: payload.title, type: payload.type },
      },
      {
        onSuccess: () => setShowEdit(false),
        onError: (err) =>
          setFormError(
            err instanceof Error ? err.message : "Falha ao atualizar conversa",
          ),
      },
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !conversation) {
    return (
      <ErrorState
        heading="h1"
        title="Conversa não encontrada"
        description={
          error instanceof Error
            ? error.message
            : "Não foi possível carregar a conversa."
        }
        action={
          <Button
            variant="outline"
            onClick={() => router.push("/app/conversations")}
          >
            Voltar para conversas
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <ConversationThread
          conversationId={conversation.id}
          backHref="/app/conversations"
          rootClassName="h-[60dvh] min-h-[400px]"
          rightAction={
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowEdit((v) => !v)}
            >
              <Pencil className="mr-1.5 h-4 w-4" />
              Editar
            </Button>
          }
        />
      </div>

      {showEdit && (
        <ConversationForm
          mode="edit"
          conversation={{
            title: conversation.title,
            type: conversation.type,
            participants: [],
          }}
          isSubmitting={updateMutation.isPending}
          error={formError}
          onSubmit={handleUpdate}
          submitLabel="Salvar"
          cancelHref={`/app/conversations/${conversation.id}`}
        />
      )}

      <ConversationParticipantPanel conversationId={conversation.id} />
    </div>
  );
}