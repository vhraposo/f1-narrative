"use client";

import { ChevronLeft, Loader2, Pencil } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { ConversationForm } from "@/components/conversations/conversation-form";
import { ConversationParticipantPanel } from "@/components/conversations/conversation-participant-panel";
import { MessageComposer } from "@/components/conversations/message-composer";
import { MessageList } from "@/components/conversations/message-list";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  useConversation,
  useConversationParticipants,
  useUpdateConversation,
} from "@/hooks/use-conversations";
import { CONVERSATION_TYPE_LABELS, type ConversationType } from "@/lib/conversations";

export default function ConversationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: conversation, isLoading, isError, error } = useConversation(id);
  const participantsQuery = useConversationParticipants(id);
  const updateMutation = useUpdateConversation();

  const [showEdit, setShowEdit] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);

  function handleUpdate(payload: { title?: string | null; type?: ConversationType }) {
    setFormError(null);
    updateMutation.mutate(
      { id: conversation?.id ?? "", input: { title: payload.title, type: payload.type } },
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

  const participants = participantsQuery.data ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/app/conversations"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Conversas
      </Link>

      <PageHeader
        kicker="UNIVERSO / CONVERSAS"
        title={conversation.title || "Conversa sem título"}
        description={`${CONVERSATION_TYPE_LABELS[conversation.type]} · ${
          participants.length
        } participante${participants.length === 1 ? "" : "s"}`}
        action={
          <Button
            variant="outline"
            onClick={() => setShowEdit((v) => !v)}
          >
            <Pencil className="mr-2 h-4 w-4" />
            Editar
          </Button>
        }
      />

      {showEdit && (
        <ConversationForm
          mode="edit"
          conversation={{
            title: conversation.title,
            type: conversation.type,
            participants,
          }}
          isSubmitting={updateMutation.isPending}
          error={formError}
          onSubmit={handleUpdate}
          submitLabel="Salvar"
          cancelHref={`/app/conversations/${conversation.id}`}
        />
      )}

      <section>
        <MessageList conversationId={conversation.id} />
      </section>

      <section className="rounded-lg border p-4">
        {composerError && (
          <p className="mb-2 text-sm text-destructive" role="alert">
            {composerError}
          </p>
        )}
        <MessageComposer
          conversationId={conversation.id}
          onError={setComposerError}
        />
      </section>

      <section>
        <ConversationParticipantPanel conversationId={conversation.id} />
      </section>
    </div>
  );
}