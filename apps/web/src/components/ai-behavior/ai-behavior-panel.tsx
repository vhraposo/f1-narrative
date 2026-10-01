"use client";

import { Loader2, Play, Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useAiDecisions,
  useEvaluateAiBehavior,
  useExecuteAiDecision,
} from "@/hooks/use-ai-behavior";
import type { AiDecision } from "@/lib/ai-behavior";

const STATUS_LABELS: Record<AiDecision["status"], string> = {
  NO_ACTION: "Sem ação",
  DECIDED: "Aguardando execução",
  EXECUTING: "Executando",
  EXECUTED: "Executado",
  REJECTED: "Rejeitado pela policy",
  FAILED: "Falha na execução",
};

const ACTION_LABELS: Record<AiDecision["actionType"], string> = {
  NO_ACTION: "Nenhuma ação",
  SEND_MESSAGE: "Enviar mensagem",
  CREATE_EVENT: "Criar acontecimento",
};

export function AiBehaviorPanel({
  characterId,
  characterName,
}: {
  characterId: string;
  characterName: string;
}) {
  const decisionsQuery = useAiDecisions(characterId);
  const evaluateMutation = useEvaluateAiBehavior(characterId);
  const executeMutation = useExecuteAiDecision(characterId);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const latest =
    executeMutation.data ??
    evaluateMutation.data ??
    decisionsQuery.data?.[0] ??
    null;
  const busy = evaluateMutation.isPending || executeMutation.isPending;

  function handleEvaluate() {
    setNotice(null);
    setActionError(null);
    evaluateMutation.mutate(undefined, {
      onSuccess: (decision) =>
        setNotice(
          decision.actionType === "NO_ACTION"
            ? "Nenhuma ação indicada para o contexto atual."
            : `Decisão: ${ACTION_LABELS[decision.actionType]}.`,
        ),
      onError: (error) =>
        setActionError(
          error instanceof Error ? error.message : "Falha ao avaliar",
        ),
    });
  }

  function handleExecute(decision: AiDecision) {
    setNotice(null);
    setActionError(null);
    executeMutation.mutate(decision.id, {
      onSuccess: (result) =>
        setNotice(
          result.status === "EXECUTED"
            ? "Decisão executada."
            : result.status === "REJECTED"
              ? `Decisão rejeitada (${result.policyCode ?? "policy"}).`
              : `Execução terminou como ${STATUS_LABELS[result.status]}.`,
        ),
      onError: (error) =>
        setActionError(
          error instanceof Error ? error.message : "Falha ao executar",
        ),
    });
  }

  return (
    <section aria-label="Comportamento AI">
      <Card>
        <CardHeader>
          <CardTitle>Comportamento autônomo</CardTitle>
          <CardDescription>
            Avaliação manual do personagem AI {characterName}. Decisões são
            auditadas e passam por policy antes de executar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={handleEvaluate}
            >
              {evaluateMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              Avaliar comportamento
            </Button>
            {latest?.status === "DECIDED" ? (
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => handleExecute(latest)}
              >
                {executeMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                Executar decisão
              </Button>
            ) : null}
          </div>

          {decisionsQuery.isLoading ? (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando decisões…
            </span>
          ) : null}

          {!decisionsQuery.isLoading && latest === null ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma decisão registrada ainda.
            </p>
          ) : null}

          {latest ? (
            <div className="space-y-1 text-sm">
              <p className="text-foreground">
                {ACTION_LABELS[latest.actionType]} ·{" "}
                {STATUS_LABELS[latest.status]}
              </p>
              {latest.reason ? (
                <p className="text-xs text-muted-foreground">{latest.reason}</p>
              ) : null}
              {latest.policyCode ? (
                <p className="text-xs text-destructive">
                  Motivo técnico: {latest.policyCode}
                </p>
              ) : null}
              {latest.executedMessageId ? (
                <p className="text-xs text-muted-foreground">
                  Mensagem gerada na conversa.
                </p>
              ) : null}
              {latest.executedEventId ? (
                <p className="text-xs text-muted-foreground">
                  Acontecimento criado e vinculado à cobertura existente.
                </p>
              ) : null}
            </div>
          ) : null}

          {notice ? (
            <p role="status" className="text-sm text-foreground">
              {notice}
            </p>
          ) : null}
          {actionError ? (
            <p role="alert" className="text-sm text-destructive">
              {actionError}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
