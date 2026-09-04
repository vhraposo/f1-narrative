"use client";

import { Loader2, MessagesSquare, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CONVERSATION_TYPE_LABELS, type Conversation } from "@/lib/conversations";

type ConversationCardProps = {
  conversation: Conversation;
  onDelete: (conversation: Conversation) => void;
  isDeleting: boolean;
};

export function ConversationCard({
  conversation,
  onDelete,
  isDeleting,
}: ConversationCardProps) {
  const [confirming, setConfirming] = useState(false);

  const names = conversation.participants.map((p) => p.name).join(", ");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          {conversation.title || "Conversa sem título"}
        </CardTitle>
        <CardDescription>
          {CONVERSATION_TYPE_LABELS[conversation.type]} ·{" "}
          {conversation.participants.length} participante
          {conversation.participants.length === 1 ? "" : "s"} ·{" "}
          {conversation.messageCount} mensagem
          {conversation.messageCount === 1 ? "" : "ns"}
        </CardDescription>
      </CardHeader>
      {names && (
        <CardContent>
          <p className="line-clamp-3 text-sm text-muted-foreground">{names}</p>
        </CardContent>
      )}
      <CardFooter className="justify-between gap-2">
        <Link
          href={`/app/conversations/${conversation.id}`}
          className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-input bg-background px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <MessagesSquare className="mr-2 h-4 w-4" />
          Abrir
        </Link>
        {confirming ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Excluir?</span>
            <Button
              variant="destructive"
              size="sm"
              disabled={isDeleting}
              onClick={() => onDelete(conversation)}
            >
              {isDeleting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Confirmar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={isDeleting}
              onClick={() => setConfirming(false)}
            >
              Cancelar
            </Button>
          </div>
        ) : (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Excluir
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}