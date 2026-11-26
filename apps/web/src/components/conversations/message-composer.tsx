"use client";

import { Loader2, Send } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectTrigger } from "@/components/ui/select";
import {
  useConversationParticipants,
  useCreateMessage,
  useSimulateTurn,
} from "@/hooks/use-conversations";
import { ApiError } from "@/lib/api";
import { planSimulationTurn } from "@/lib/conversations";

type MessageComposerProps = {
  conversationId: string;
  onError?: (message: string) => void;
  onTypingChange?: (names: string[]) => void;
  onMessageSent?: () => void;
};

export function MessageComposer({
  conversationId,
  onError,
  onTypingChange,
  onMessageSent,
}: MessageComposerProps) {
  const participantsQuery = useConversationParticipants(conversationId);
  const createMutation = useCreateMessage(conversationId);
  const simulationMutation = useSimulateTurn(conversationId);

  const [content, setContent] = useState("");
  const [senderCharacterId, setSenderCharacterId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const participants = participantsQuery.data ?? [];
  const ownCharacters = participants.filter((p) => p.controlledBy === "USER");

  const effectiveSender =
    senderCharacterId || (ownCharacters.length === 1 ? ownCharacters[0].id : "");

  const isBusy = createMutation.isPending || simulationMutation.isPending;

  function reportTurnError(err: unknown) {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        onError?.("Sessão expirada. Faça login novamente.");
        return;
      }
      if (err.status === 403) {
        onError?.("Você não tem permissão para enviar nesta conversa.");
        return;
      }
      if (err.status === 404) {
        onError?.("Conversa não encontrada.");
        return;
      }
      if (err.status === 429) {
        onError?.("Muitas mensagens em pouco tempo. Aguarde um instante.");
        return;
      }
    }
    onError?.("Não foi possível gerar uma resposta agora.");
  }

  async function triggerAutonomousResponse() {
    try {
      const plan = await planSimulationTurn(conversationId, {});
      onTypingChange?.(plan.plan.planned.map((candidate) => candidate.name));
    } catch {
      onTypingChange?.([]);
    }
    try {
      const result = await simulationMutation.mutateAsync({});
      if (!result.simulation.executed) {
        setNotice(null);
      }
    } catch (err) {
      reportTurnError(err);
    } finally {
      onTypingChange?.([]);
    }
  }

  function reportSendError(err: unknown) {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        onError?.("Sessão expirada. Faça login novamente.");
        return;
      }
      if (err.status === 403) {
        onError?.("Você não tem permissão para enviar nesta conversa.");
        return;
      }
      if (err.status === 404) {
        onError?.("Conversa não encontrada.");
        return;
      }
      if (err.status === 400) {
        onError?.("Mensagem inválida.");
        return;
      }
      if (err.status === 429) {
        onError?.("Muitas mensagens em pouco tempo. Aguarde um instante.");
        return;
      }
    }
    onError?.(err instanceof Error ? err.message : "Falha ao enviar mensagem");
  }

  function submitMessage() {
    if (!effectiveSender || !content.trim() || isBusy) return;
    setNotice(null);
    const text = content.trim();
    createMutation.mutate(
      { senderType: "USER_CHARACTER", characterId: effectiveSender, content: text },
      {
        onSuccess: () => {
          setContent("");
          onMessageSent?.();
          void triggerAutonomousResponse();
        },
        onError: reportSendError,
      },
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submitMessage();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    submitMessage();
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
          onKeyDown={handleKeyDown}
          placeholder="Escreva sua mensagem..."
          aria-label="Mensagem"
          rows={2}
          maxLength={5000}
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
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
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
