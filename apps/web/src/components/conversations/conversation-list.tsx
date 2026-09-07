"use client";

import { Loader2, MessagesSquare, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  CharacterAvatar,
  GroupAvatar,
} from "@/components/conversations/character-avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  CONVERSATION_TYPE_LABELS,
  formatListTime,
  type Conversation,
} from "@/lib/conversations";
import { cn } from "@/lib/utils";

type ConversationListProps = {
  conversations: Conversation[];
  selectedId?: string | null;
  defaultGroupId?: string | null;
  isLoading: boolean;
  isError: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (conversation: Conversation) => void;
  isDeletingId: string | null;
  onRetry?: () => void;
};

function conversationName(conversation: Conversation): string {
  if (conversation.title) return conversation.title;
  const names = conversation.participants.map((p) => p.name).filter(Boolean);
  if (names.length === 0) return "Conversa sem título";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return `${names.slice(0, 2).join(" e ")} e mais ${names.length - 2}`;
}

function conversationSubtitle(conversation: Conversation): string {
  if (conversation.type === "GROUP") {
    const count = conversation.participants.length;
    return `${CONVERSATION_TYPE_LABELS.GROUP} · ${count} participante${count === 1 ? "" : "s"}`;
  }
  const names = conversation.participants.map((p) => p.name).filter(Boolean);
  return names.length > 0
    ? names.join(", ")
    : CONVERSATION_TYPE_LABELS.DM;
}

function directPartner(conversation: Conversation) {
  const ai = conversation.participants.find((p) => p.controlledBy === "AI");
  return ai ?? conversation.participants[0];
}

function ConversationRow({
  conversation,
  selected,
  isDefault,
  onSelect,
  onDelete,
  isDeleting,
}: {
  conversation: Conversation;
  selected: boolean;
  isDefault: boolean;
  onSelect: (id: string) => void;
  onDelete: (conversation: Conversation) => void;
  isDeleting: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const name = conversationName(conversation);
  const time = formatListTime(conversation.updatedAt);
  const avatar =
    conversation.type === "GROUP" ? (
      <GroupAvatar size="sm" />
    ) : (
      (() => {
        const partner = directPartner(conversation);
        return partner ? (
          <CharacterAvatar
            name={partner.name}
            imageUrl={partner.imageUrl}
            size="sm"
          />
        ) : null;
      })()
    );

  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onSelect(conversation.id)}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md px-2.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selected ? "bg-accent" : "hover:bg-accent/60",
        )}
      >
        {avatar}
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "truncate text-sm",
                isDefault ? "font-bold text-foreground" : "font-medium",
              )}
            >
              {name}
            </span>
            {time && (
              <time
                className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
                dateTime={conversation.updatedAt}
              >
                {time}
              </time>
            )}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {conversationSubtitle(conversation)}
          </span>
        </span>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
        aria-label={`Excluir ${name}`}
        onClick={() => setConfirming(true)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Excluir conversa"
        description={`Deseja excluir "${name}"? Esta ação não pode ser desfeita.`}
        onConfirm={() => onDelete(conversation)}
        isPending={isDeleting}
      />
    </li>
  );
}

export function ConversationList({
  conversations,
  selectedId,
  defaultGroupId,
  isLoading,
  isError,
  onNew,
  onSelect,
  onDelete,
  isDeletingId,
  onRetry,
}: ConversationListProps) {
  const defaultGroup =
    conversations.find((c) => c.id === defaultGroupId) ?? null;
  const direct = conversations.filter(
    (c) => c.type === "DM" && c.id !== defaultGroupId,
  );
  const otherGroups = conversations.filter(
    (c) => c.type === "GROUP" && c.id !== defaultGroupId,
  );
  const secondary = [...direct, ...otherGroups].sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Conversas
        </h2>
        <Button variant="outline" size="sm" onClick={onNew}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Nova conversa
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-destructive" role="alert">
              Não foi possível carregar as conversas.
            </p>
            {onRetry && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={onRetry}
              >
                Tentar novamente
              </Button>
            )}
          </div>
        ) : conversations.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <MessagesSquare className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium text-foreground">
              Você ainda não tem conversas.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Crie uma conversa para começar a comunicação entre personagens.
            </p>
          </div>
        ) : (
          <div className="px-2 py-2">
            {defaultGroup && (
              <div>
                <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand">
                  Grupo da temporada
                </p>
                <ul className="space-y-0.5">
                  <ConversationRow
                    conversation={defaultGroup}
                    selected={selectedId === defaultGroup.id}
                    isDefault
                    onSelect={onSelect}
                    onDelete={onDelete}
                    isDeleting={isDeletingId === defaultGroup.id}
                  />
                </ul>
              </div>
            )}
            {direct.length > 0 && (
              <div>
                <p className="px-2.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Conversas diretas
                </p>
                <ul className="space-y-0.5">
                  {secondary
                    .filter((c) => c.type === "DM")
                    .map((conversation) => (
                      <ConversationRow
                        key={conversation.id}
                        conversation={conversation}
                        selected={selectedId === conversation.id}
                        isDefault={false}
                        onSelect={onSelect}
                        onDelete={onDelete}
                        isDeleting={isDeletingId === conversation.id}
                      />
                    ))}
                </ul>
              </div>
            )}
            {otherGroups.length > 0 && (
              <div>
                <p className="px-2.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Outros grupos
                </p>
                <ul className="space-y-0.5">
                  {otherGroups.map((conversation) => (
                    <ConversationRow
                      key={conversation.id}
                      conversation={conversation}
                      selected={selectedId === conversation.id}
                      isDefault={false}
                      onSelect={onSelect}
                      onDelete={onDelete}
                      isDeleting={isDeletingId === conversation.id}
                    />
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}