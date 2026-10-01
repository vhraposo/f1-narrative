"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  useExternalSyncStatus,
  useRefreshExternalData,
} from "@/hooks/use-external-sync";
import { formatExternalDateTime } from "@/lib/external-world";
import type { ExternalSyncCounts, ExternalSyncRunView } from "@/lib/external-sync";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/providers/session-provider";

const STATUS_LABELS: Record<string, string> = {
  RUNNING: "em execução",
  SUCCESS: "sucesso",
  FAILED: "falha",
};

function countsSummary(counts: ExternalSyncCounts | null): string | null {
  if (!counts) return null;
  return `criados ${counts.created} · atualizados ${counts.updated} · inalterados ${counts.unchanged} · ignorados ${counts.skipped}`;
}

function runSummary(label: string, run: ExternalSyncRunView | null): string {
  if (!run) return `${label}: nenhuma execução registrada`;
  const when = formatExternalDateTime(run.lastSyncedAt ?? run.startedAt);
  return `${label}: ${run.scope} · ${STATUS_LABELS[run.status] ?? run.status} · ${when}`;
}

export function ExternalSyncPanel({ year }: { year: number | null }) {
  const { data: session } = useSession();
  const isAdmin = session.user?.role === "ADMIN";
  const statusQuery = useExternalSyncStatus();
  const refreshMutation = useRefreshExternalData();
  const toast = useToast();
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const status = statusQuery.data;
  const lastRun = status?.lastRun ?? null;
  const lastSuccess = status?.lastSuccess ?? null;
  const running =
    refreshMutation.isPending || (status?.active?.length ?? 0) > 0;

  function handleRefresh() {
    if (year == null || running) return;
    setNotice(null);
    setActionError(null);
    const toastId = toast.show({
      message: "Sincronização em andamento…",
      tone: "info",
      persistent: true,
    });
    refreshMutation.mutate(year, {
      onSuccess: (result) => {
        setNotice(
          `Dados externos atualizados em ${result.durationMs} ms (${result.scopes.length} escopos).`,
        );
        toast.update(toastId, {
          message: "Sincronização realizada com sucesso.",
          tone: "success",
        });
      },
      onError: (error) => {
        setActionError(
          error instanceof Error
            ? error.message
            : "Falha ao atualizar os dados externos",
        );
        toast.update(toastId, {
          message: "Não foi possível realizar a sincronização.",
          tone: "error",
        });
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sincronização externa</CardTitle>
        <CardDescription>
          Atualiza o espelho global da fonte externa. Não altera o seu
          Universe.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {statusQuery.isLoading ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando status da sincronização…
          </span>
        ) : null}

        {statusQuery.isError ? (
          <p className="text-sm text-muted-foreground">
            Status da sincronização indisponível.
          </p>
        ) : null}

        {status ? (
          <div className="space-y-1 text-sm">
            <p className="text-foreground">
              {runSummary("Última sincronização bem-sucedida", lastSuccess)}
            </p>
            <p className="text-foreground">
              {runSummary("Última execução", lastRun)}
            </p>
            {lastRun?.statistics ? (
              <p className="text-xs text-muted-foreground">
                {countsSummary(lastRun.statistics)}
                {lastRun.durationMs != null
                  ? ` · ${lastRun.durationMs} ms`
                  : ""}
              </p>
            ) : null}
            {lastRun?.status === "FAILED" && lastRun.error ? (
              <p className="text-xs text-destructive">
                Falha registrada: {lastRun.error}
              </p>
            ) : null}
          </div>
        ) : null}

        {running ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Sincronização em andamento…
          </p>
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

        {isAdmin ? (
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={running || year == null}
              onClick={handleRefresh}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${refreshMutation.isPending ? "animate-spin" : ""}`}
              />
              Atualizar dados externos
            </Button>
            <span className="text-xs text-muted-foreground">
              {year != null
                ? `Temporada ${year} · escopos SEASON, TEAMS, DRIVERS, DRIVER_SEASONS, RACES, RESULTS, STANDINGS`
                : "Selecione uma temporada para atualizar"}
            </span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Somente administradores podem atualizar os dados externos.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
