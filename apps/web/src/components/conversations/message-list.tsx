"use client";

import { Loader2, MessagesSquare } from "lucide-react";

import { MessageBubble } from "@/components/conversations/message-bubble";
import {
  useConversationMessages,
  useConversationParticipants,
} from "@/hooks/use-conversations";
import type { ConversationParticipant, Message } from "@/lib/conversations";

type MessageListProps = {
  conversationId: string;
};

function findAuthor(
  participants: ConversationParticipant[],
  message: Message,
): ConversationParticipant | null {
  if (!message.characterId) return null;
  return participants.find((p) => p.id === message.characterId) ?? null;
}

export function MessageList({ conversationId }: MessageListProps) {
  const messagesQuery = useConversationMessages(conversationId);
  const participantsQuery = useConversationParticipants(conversationId);

  const messages = messagesQuery.data ?? [];
  const participants = participantsQuery.data ?? [];

  if (messagesQuery.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (messagesQuery.isError) {
    return (
      <p className="px-4 py-8 text-sm text-destructive" role="alert">
        Não foi possível carregar as mensagens.
      </p>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <MessagesSquare className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Ainda não há mensagens nesta conversa.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col py-3">
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          author={findAuthor(participants, message)}
        />
      ))}
    </ul>
  );
}