"use client";

import { Loader2, Send } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useConversationParticipants, useCreateMessage } from "@/hooks/use-conversations";

type MessageComposerProps = {
  conversationId: string;
  onError?: (message: string) => void;
};

// Composer manual: o usuário envia como um de seus Characters participantes
// (USER_CHARACTER). SYSTEM/AI_CHARACTER não são selecionáveis aqui — são
// estruturais/futuros; o backend continua sendo a autoridade.
export function MessageComposer({ conversationId, onError }: MessageComposerProps) {
  const participantsQuery = useConversationParticipants(conversationId);
  const createMutation = useCreateMessage(conversationId);

  const [content, setContent] = useState("");
  const [senderCharacterId, setSenderCharacterId] = useState("");

  const participants = participantsQuery.data ?? [];
  // Só Characters USER (do usuário) podem ser remetentes manuais.
  const ownCharacters = participants.filter((p) => p.controlledBy === "USER");

  const effectiveSender =
    senderCharacterId ||
    (ownCharacters.length === 1 ? ownCharacters[0].id : "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveSender || !content.trim()) return;
    createMutation.mutate(
      {
        senderType: "USER_CHARACTER",
        characterId: effectiveSender,
        content: content.trim(),
      },
      {
        onSuccess: () => setContent(""),
        onError: (err) =>
          onError?.(err instanceof Error ? err.message : "Falha ao enviar mensagem"),
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      {ownCharacters.length > 1 && (
        <select
          value={effectiveSender}
          onChange={(e) => setSenderCharacterId(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
        >
          <option value="">Selecione o remetente</option>
          {ownCharacters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <div className="flex items-start gap-2">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Escreva sua mensagem como personagem..."
          rows={2}
          disabled={!effectiveSender}
          className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        />
        <Button
          type="submit"
          disabled={!effectiveSender || !content.trim() || createMutation.isPending}
        >
          {createMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          Enviar
        </Button>
      </div>
      {ownCharacters.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nenhum dos seus personagens participa desta conversa.
        </p>
      )}
    </form>
  );
}