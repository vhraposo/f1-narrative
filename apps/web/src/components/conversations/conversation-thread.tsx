"use client";

import { ChevronLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import {
  CharacterAvatar,
  GroupAvatar,
} from "@/components/conversations/character-avatar";
import { MessageComposer } from "@/components/conversations/message-composer";
import { MessageList } from "@/components/conversations/message-list";
import { EmptyState } from "@/components/ui/empty-state";
import {
  useConversation,
  useConversationParticipants,
} from "@/hooks/use-conversations";
import { CONVERSATION_TYPE_LABELS } from "@/lib/conversations";
import { cn } from "@/lib/utils";

type ConversationThreadProps = {
  conversationId: string | null;
  backHref?: string;
  onBack?: () => void;
  backClassName?: string;
  rightAction?: ReactNode;
  rootClassName?: string;
};

function threadTitle(
  title: string | null,
  participants: { name: string }[],
): string {
  if (title) return title;
  const names = participants.map((p) => p.name).filter(Boolean);
  if (names.length === 0) return "Conversa sem título";
  if (names.length <= 2) return names.join(" e ");
  return `${names.slice(0, 2).join(" e ")} e mais ${names.length - 2}`;
}

export function ConversationThread({
  conversationId,
  backHref,
  onBack,
  backClassName,
  rightAction,
  rootClassName,
}: ConversationThreadProps) {
  const conversationQuery = useConversation(conversationId ?? undefined);
  const participantsQuery = useConversationParticipants(
    conversationId ?? undefined,
  );
  const [composerError, setComposerError] = useState<string | null>(null);

  if (conversationId == null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-background">
        <EmptyState
          kicker="Conversas"
          title="Selecione uma conversa"
          description="Escolha uma conversa na lista para começar."
        />
      </div>
    );
  }

  if (conversationQuery.isLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (conversationQuery.isError || !conversationQuery.data) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-background">
        <EmptyState
          kicker="Conversas"
          title="Conversa não encontrada"
          description="Não foi possível carregar esta conversa."
          action={
            backHref ? (
              <Link
                href={backHref}
                className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Voltar para conversas
              </Link>
            ) : undefined
          }
        />
      </div>
    );
  }

  const conversation = conversationQuery.data;
  const participants = participantsQuery.data ?? [];

  const isGroup = conversation.type === "GROUP";
  const subtitle = isGroup
    ? `${CONVERSATION_TYPE_LABELS.GROUP} · ${participants.length} participante${participants.length === 1 ? "" : "s"}`
    : participants.map((p) => p.name).filter(Boolean).join(", ") ||
      CONVERSATION_TYPE_LABELS.DM;
  const partner =
    !isGroup && (participants.find((p) => p.controlledBy === "AI") ?? participants[0]);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col bg-background", rootClassName)}>
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border px-2 py-2.5 sm:px-3">
        {backHref &&
          (onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="Voltar para conversas"
              className={cn(
                "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                backClassName,
              )}
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : (
            <Link
              href={backHref}
              aria-label="Voltar para conversas"
              className={cn(
                "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                backClassName,
              )}
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </Link>
          ))}
        {isGroup ? (
          <GroupAvatar size="md" />
        ) : partner ? (
          <CharacterAvatar
            name={partner.name}
            imageUrl={partner.imageUrl}
            size="md"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-bold leading-tight text-foreground">
            {threadTitle(conversation.title, participants)}
          </h2>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {rightAction}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <MessageList conversationId={conversation.id} />
      </div>

      <div className="shrink-0 border-t border-border bg-background px-2 py-2 sm:px-3">
        {composerError && (
          <p className="mb-1.5 px-1 text-xs text-destructive" role="alert">
            {composerError}
          </p>
        )}
        <MessageComposer conversationId={conversation.id} onError={setComposerError} />
      </div>
    </div>
  );
}