"use client";

import { Bot, UserRoundCog } from "lucide-react";

import { CharacterAvatar } from "@/components/conversations/character-avatar";
import {
  formatChatTime,
  type ConversationParticipant,
  type Message,
} from "@/lib/conversations";

type MessageBubbleProps = {
  message: Message;
  author: ConversationParticipant | null;
};

// Espelho da MessageBubble: a identidade (alinhamento/avatar/nome) vem do
// senderType REAL, nunca inferida pela aparência ou por controlledBy.
export function MessageBubble({ message, author }: MessageBubbleProps) {
  const time = formatChatTime(message.createdAt);

  if (message.senderType === "SYSTEM") {
    return (
      <li className="flex justify-center px-4 py-1.5">
        <div className="flex max-w-[85%] items-center gap-2 rounded-full bg-muted px-3.5 py-1.5 text-xs text-muted-foreground">
          <UserRoundCog className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="whitespace-pre-wrap text-center">
            {message.content}
          </span>
        </div>
      </li>
    );
  }

  const isOwn = message.senderType === "USER_CHARACTER";
  const name = author?.name ?? "Personagem";

  if (isOwn) {
    return (
      <li className="flex justify-end px-4 py-1.5">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground shadow-sm">
          <span className="block whitespace-pre-wrap">{message.content}</span>
          {time && (
            <span className="mt-0.5 block text-right text-[10px] font-medium text-primary-foreground/70">
              {time}
            </span>
          )}
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-end gap-2 px-4 py-1.5">
      <CharacterAvatar
        name={name}
        imageUrl={author?.imageUrl ?? null}
        size="sm"
        className="mb-0.5"
      />
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-card px-3 py-2 text-sm shadow-sm">
        {message.senderType === "AI_CHARACTER" && (
          <span className="mb-0.5 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-brand">
            <Bot className="h-3 w-3" aria-hidden="true" />
            {name}
          </span>
        )}
        <span className="block whitespace-pre-wrap text-foreground">
          {message.content}
        </span>
        {time && (
          <span className="mt-0.5 block text-right text-[10px] font-medium text-muted-foreground">
            {time}
          </span>
        )}
      </div>
    </li>
  );
}