"use client";

import { Bot, Loader2, Send, Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectTrigger } from "@/components/ui/select";
import {
  useConversationParticipants,
  useCreateMessage,
  useTurnMessage,
} from "@/hooks/use-conversations";
import { ApiError } from "@/lib/api";
import type { TurnResponse } from "@/lib/conversations";

type MessageComposerProps = {
  conversationId: string;
  onError?: (message: string) => void;
};

export function MessageComposer({ conversationId, onError }: MessageComposerProps) {
  const participantsQuery = useConversationParticipants(conversationId);
  const createMutation = useCreateMessage(conversationId);
  const turnMutation = useTurnMessage(conversationId);

  const [content, setContent] = useState("");
  const [senderCharacterId, setSenderCharacterId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const participants = participantsQuery.data ?? [];
  const ownCharacters = participants.filter((p) => p.controlledBy === "USER");
  const aiParticipants = participants.filter((p) => p.controlledBy === "AI");

  const effectiveSender =
    senderCharacterId ||
    (ownCharacters.length === 1 ? ownCharacters[0].id : "");

  const isBusy = createMutation.isPending || turnMutation.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveSender || !content.trim() || isBusy) return;
    setNotice(null);
    createMutation.mutate(
      {
        senderType: "USER_CHARACTER",
        characterId: effectiveSender,
        content: content.trim(),
      },
      {
        onSuccess: () => setContent(""),
        onError: (err) =>
          onError?.(
            err instanceof Error ? err.message : "Falha ao enviar mensagem",
          ),
      },
    );
  }

  function reportTurnError(err: unknown) {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        onError?.("Sessão expirada. Faça login novamente.");
        return;
      }
      if (err.status === 400) {
        onError?.("Confira o prompt do turno.");
        return;
      }
      if (err.status === 403) {
        onError?.("Nenhum personagem seu pode responder nesta conversa.");
        return;
      }
      if (err.status === 404) {
        onError?.("Conversa ou personagem não encontrados.");
        return;
      }
      if (err.code === "PROVIDER_ERROR" || err.status === 500) {
        onError?.("Não foi possível gerar a resposta. Tente novamente.");
        return;
      }
    }
    onError?.(err instanceof Error ? err.message : "Falha ao gerar resposta");
  }

  function handleGenerate() {
    if (!effectiveSender || !content.trim() || isBusy) return;
    setNotice(null);
    turnMutation.mutate(
      { userPrompt: content.trim() },
      {
        onSuccess: (data: TurnResponse) => {
          setContent("");
          if (data.messages.length === 0 && data.failedSpeakers.length === 0) {
            setNotice(
              "Nenhum personagem tinha motivo para responder neste turno.",
            );
          } else if (data.failedSpeakers.length > 0) {
            setNotice(
              data.messages.length > 0
                ? `${data.messages.length} resposta(s) gerada(s); ${data.failedSpeakers.length} não respondeu(ram).`
                : "Nenhuma resposta de IA foi gerada neste turno.",
            );
          }
        },
        onError: reportTurnError,
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {ownCharacters.length > 1 && (
          <label className="flex min-w-0 flex-1 basis-44 items-center gap-2">
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

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          disabled={!effectiveSender || !content.trim() || isBusy}
          onClick={handleGenerate}
        >
          {isBusy ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          )}
          Gerar resposta IA
        </Button>
      </div>

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
          aria-label="Enviar"
          disabled={!effectiveSender || !content.trim() || isBusy}
        >
          {createMutation.isPending ? (
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
      {aiParticipants.length === 0 && (
        <p className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
          <Bot className="h-3 w-3" />
          Nenhum personagem de IA participa desta conversa.
        </p>
      )}
      {aiParticipants.length > 0 && !effectiveSender && (
        <p className="px-1 text-[11px] text-muted-foreground">
          Escolha um remetente do seu personagem para gerar uma resposta de IA
          (o turno inclui a sua mensagem no histórico).
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