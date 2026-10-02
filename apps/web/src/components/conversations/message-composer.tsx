"use client";

import { Loader2, Send } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectTrigger } from "@/components/ui/select";
import {
  useAutonomousTurn,
  useConversationParticipants,
  useCreateMessage,
} from "@/hooks/use-conversations";
import { ApiError } from "@/lib/api";

type MessageComposerProps = {
  conversationId: string;
  onError?: (message: string) => void;
  onTypingChange?: (typing: boolean) => void;
};

export function MessageComposer({
  conversationId,
  onError,
  onTypingChange,
}: MessageComposerProps) {
  const participantsQuery = useConversationParticipants(conversationId);
  const createMutation = useCreateMessage(conversationId);
  const autonomousMutation = useAutonomousTurn(conversationId);

  const [content, setContent] = useState("");
  const [senderCharacterId, setSenderCharacterId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const participants = participantsQuery.data ?? [];
  const ownCharacters = participants.filter((p) => p.controlledBy === "USER");

  const effectiveSender =
    senderCharacterId || (ownCharacters.length === 1 ? ownCharacters[0].id : "");

  const isBusy = createMutation.isPending || autonomousMutation.isPending;

  function reportTurnError(err: unknown) {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        onError?.("Sessão expirada. Faça login novamente.");
        return;
      }
      if (err.status === 404) {
        onError?.("Conversa não encontrada.");
        return;
      }
    }
    onError?.("Não foi possível gerar uma resposta agora.");
  }

  async function triggerAutonomousResponse() {
    onTypingChange?.(true);
    try {
      const result = await autonomousMutation.mutateAsync({});
      if (!result.turn.executed) {
        setNotice(null);
      }
    } catch (err) {
      reportTurnError(err);
    } finally {
      onTypingChange?.(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveSender || !content.trim() || isBusy) return;
    setNotice(null);
    const text = content.trim();
    createMutation.mutate(
      { senderType: "USER_CHARACTER", characterId: effectiveSender, content: text },
      {
        onSuccess: () => {
          setContent("");
          void triggerAutonomousResponse();
        },
        onError: (err) =>
          onError?.(err instanceof Error ? err.message : "Falha ao enviar mensagem"),
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-1.5">
      {ownCharacters.length > 1 && (
        <label className="flex items-center gap-2">
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Remetente
          </span>
          <Select
            value={effectiveSender}
            onValueChange={(value) => setSenderCharacterId(value)}
            options={[
              { value: "", label: "Selecione o remetente" },
              ...ownCharacters.map((c) => ({ value: c.id, label: c.name })),
            ]}
          >
            <SelectTrigger aria-label="Quem envia a mensagem" className="h-8" />
            <SelectContent />
          </Select>
        </label>
      )}

      <div className="flex items-end gap-2 rounded-2xl border border-border bg-card px-3 py-2 shadow-sm">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Escreva sua mensagem..."
          rows={2}
          disabled={!effectiveSender}
          className="min-h-[40px] max-h-[160px] w-full resize-none rounded-md bg-transparent py-1.5 px-1 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
        <Button
          type="submit"
          size="icon"
          className="h-10 w-10 shrink-0 rounded-full"
          aria-label="Enviar mensagem"
          disabled={!effectiveSender || !content.trim() || isBusy}
        >
          {isBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>

      {ownCharacters.length === 0 && (
        <p className="px-1 text-[11px] text-muted-foreground">
          Nenhum dos seus personagens participa desta conversa.
        </p>
      )}
      {notice && (
        <p className="px-1 text-[11px] text-muted-foreground" role="status">
          {notice}
        </p>
      )}
    </form>
  );
}
