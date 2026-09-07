"use client";

import { Bot, Loader2, Send, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useConversationParticipants,
  useCreateMessage,
  useGenerateMessage,
} from "@/hooks/use-conversations";
import { ApiError } from "@/lib/api";
import type { GenerateResponse, Message } from "@/lib/conversations";

type MessageComposerProps = {
  conversationId: string;
  onError?: (message: string) => void;
};

// Dois conceitos distintos (Fase 14 STEP 41):
// - USER sender: quem envia manualmente via /messages (USER_CHARACTER).
// - AI speaker: qual personagem AI responde via /generate (targetCharacterId).
// A seleção de speaker é EXPLÍCITA do usuário; nunca automática quando existem
// mais de um AI participante (regra da Fase 14: sem heurística).
//
// Turno completo (Fase 14 STEP 43): a ação "Gerar resposta IA" vira um TURNO
// sequenciado — (1) POST /messages persiste a USER Message do usuário e, SOMENTE
// após sucesso, (2) POST /generate gera a resposta AI. Isso garante que a fala
// do usuário existe no histórico antes da geração (recentMessages + generationKey
// incorporam o turno). Sem optimistic update e sem store; o estado local
// turnUserMessageId evita reinserir a USER Message no retry após falha do provider
// (NÃO reinicia o insert ao repetir o turno com o mesmo texto).
export function MessageComposer({ conversationId, onError }: MessageComposerProps) {
  const participantsQuery = useConversationParticipants(conversationId);
  const createMutation = useCreateMessage(conversationId);
  const generateMutation = useGenerateMessage(conversationId);

  const [content, setContent] = useState("");
  const [senderCharacterId, setSenderCharacterId] = useState("");
  const [speakerCharacterId, setSpeakerCharacterId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // Id da USER Message persistida no turno corrente. Quando definido, uma nova
  // "Gerar resposta IA" só chama /generate (retry SEM reinserir a mensagem).
  const [turnUserMessageId, setTurnUserMessageId] = useState<string | null>(null);

  const participants = participantsQuery.data ?? [];
  // Só Characters USER (do usuário) podem ser remetentes manuais.
  const ownCharacters = participants.filter((p) => p.controlledBy === "USER");
  const aiParticipants = participants.filter((p) => p.controlledBy === "AI");

  const effectiveSender =
    senderCharacterId ||
    (ownCharacters.length === 1 ? ownCharacters[0].id : "");

  // Speaker: sem heurística. 0 AI → ninguém; 1 AI → o único candidato;
  // N AI → exige seleção explícita (nenhum valor implícito).
  useEffect(() => {
    if (aiParticipants.length === 0) {
      setSpeakerCharacterId("");
      return;
    }
    if (aiParticipants.length === 1) {
      setSpeakerCharacterId(aiParticipants[0].id);
      return;
    }
    const validIds = new Set(aiParticipants.map((p) => p.id));
    setSpeakerCharacterId((current) =>
      current && validIds.has(current) ? current : "",
    );
  }, [aiParticipants]);

  // Texto editado invalida o turno pendente: se o usuário mudar o conteúdo de
  // um turno que falhou na geração, o próximo "Gerar" volta a persistir o novo
  // texto como USER Message (evita divergência mensagem-persistida × prompt).
  useEffect(() => {
    setTurnUserMessageId(null);
  }, [content]);

  const isBusy = createMutation.isPending || generateMutation.isPending;

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

  function reportUserMessageError(err: unknown) {
    if (err instanceof ApiError && err.status === 401) {
      onError?.("Sessão expirada. Faça login novamente.");
      return;
    }
    onError?.(
      err instanceof Error
        ? `Falha ao enviar sua mensagem: ${err.message}`
        : "Não foi possível enviar sua mensagem antes de gerar a resposta.",
    );
  }

  function runGenerate(prompt: string, target: string) {
    generateMutation.mutate(
      { userPrompt: prompt, targetCharacterId: target },
      {
        onSuccess: (data: GenerateResponse) => {
          if ("message" in data) {
            // 201: o backend persistiu a Message AI; o refetch a exibe.
            setContent("");
            setTurnUserMessageId(null);
            return;
          }
          // 200 assembly-only: o backend NÃO persistiu. Nunca criar Message
          // falsa nem inserir nada no cache.
          setContent("");
          setTurnUserMessageId(null);
          setNotice("Nenhuma resposta foi gerada (modo de pré-visualização).");
        },
        onError: (err) => {
          if (err instanceof ApiError) {
            if (err.status === 401) {
              onError?.("Sessão expirada. Faça login novamente.");
              return;
            }
            if (err.status === 400) {
              onError?.("Confira o prompt e o alvo de geração.");
              return;
            }
            if (err.status === 403) {
              onError?.(
                "Este personagem de IA não pode responder nesta conversa.",
              );
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
          onError?.(
            err instanceof Error ? err.message : "Falha ao gerar resposta",
          );
        },
      },
    );
  }

  // Turno completo (STEP 43): a USER Message do usuário entra no histórico
  // ANTES da geração. Se o insert USER falhar, a geração é abortada.
  // Se a geração falhar após o insert, a USER permanece no histórico
  // (append-only) e o possível retry reutiliza turnUserMessageId.
  function handleGenerate() {
    if (!speakerCharacterId || !effectiveSender || !content.trim() || isBusy) {
      return;
    }
    setNotice(null);
    if (turnUserMessageId) {
      runGenerate(content.trim(), speakerCharacterId);
      return;
    }
    createMutation.mutate(
      {
        senderType: "USER_CHARACTER",
        characterId: effectiveSender,
        content: content.trim(),
      },
      {
        onSuccess: (message: Message) => {
          setTurnUserMessageId(message.id);
          runGenerate(content.trim(), speakerCharacterId);
        },
        onError: reportUserMessageError,
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

        {aiParticipants.length > 0 && (
          <label className="flex min-w-0 flex-1 basis-44 items-center gap-2">
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Resposta de
            </span>
            <Select
              value={speakerCharacterId}
              onValueChange={(value) => setSpeakerCharacterId(value)}
              options={
                aiParticipants.length > 1
                  ? [
                      {
                        value: "",
                        label: "Selecione quem deve responder",
                      },
                      ...aiParticipants.map((ai) => ({
                        value: ai.id,
                        label: ai.name,
                      })),
                    ]
                  : aiParticipants.map((ai) => ({
                      value: ai.id,
                      label: ai.name,
                    }))
              }
            >
              <SelectTrigger
                aria-label="Quem deve responder"
                className="h-8"
                disabled={aiParticipants.length === 1 || isBusy}
              >
                <Bot className="mr-2 h-3 w-3 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </label>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          disabled={
            !speakerCharacterId || !effectiveSender || !content.trim() || isBusy
          }
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
          disabled={!effectiveSender && !speakerCharacterId}
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
      {aiParticipants.length > 1 && !speakerCharacterId && (
        <p className="px-1 text-[11px] text-muted-foreground">
          Selecione quem deve responder para gerar uma resposta de IA.
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