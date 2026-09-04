"use client";

import { Bot, Loader2, MessagesSquare, User, UserRoundCog } from "lucide-react";

import {
  useConversationMessages,
  useConversationParticipants,
} from "@/hooks/use-conversations";
import {
  SENDER_LABELS,
  type ConversationParticipant,
  type Message,
} from "@/lib/conversations";

type MessageListProps = {
  conversationId: string;
};

function senderDisplay(
  message: Message,
  participants: ConversationParticipant[],
): { name: string; icon: React.ReactNode } {
  if (message.senderType === "SYSTEM") {
    return {
      name: SENDER_LABELS.SYSTEM,
      icon: <UserRoundCog className="h-3.5 w-3.5" />,
    };
  }
  const character = participants.find((p) => p.id === message.characterId);
  const name = character?.name ?? "Personagem";
  const label = message.senderType === "AI_CHARACTER" ? "IA" : "Usuário";
  const icon =
    message.senderType === "AI_CHARACTER" ? (
      <Bot className="h-3.5 w-3.5" />
    ) : (
      <User className="h-3.5 w-3.5" />
    );
  return { name: `${name} (${label})`, icon };
}

export function MessageList({ conversationId }: MessageListProps) {
  const messagesQuery = useConversationMessages(conversationId);
  const participantsQuery = useConversationParticipants(conversationId);

  const messages = messagesQuery.data ?? [];
  const participants = participantsQuery.data ?? [];

  return (
    <div className="space-y-2">
      {messagesQuery.isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : messagesQuery.isError ? (
        <p className="text-sm text-destructive" role="alert">
          Não foi possível carregar as mensagens.
        </p>
      ) : messages.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <MessagesSquare className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            Ainda não há mensagens nesta conversa.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {messages.map((message) => {
            const display = senderDisplay(message, participants);
            return (
              <li
                key={message.id}
                className="flex items-start gap-3 rounded-md border p-3"
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="text-muted-foreground flex items-center gap-1">
                    {display.icon}
                  </span>
                  {display.name}
                </div>
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}