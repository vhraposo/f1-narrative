"use client";

import { Loader2, CircleCheck, TriangleAlert } from "lucide-react";
import * as React from "react";

import { UniverseTeamCard } from "@/components/universe/universe-team-card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectTrigger } from "@/components/ui/select";
import { ApiError } from "@/lib/api";
import type { PlayerEntrySeason } from "@/lib/player-entry";
import type { UniverseTeam } from "@/lib/universe";
import {
  useKeepUniverseConfig,
  useRestoreSourceConfig,
  useRosterComparison,
} from "@/hooks/use-universe";

type UniverseEditorContentProps = {
  seasons: PlayerEntrySeason[];
  seasonId: string;
  onSeasonChange: (seasonId: string) => void;
};

type DialogState = {
  team: UniverseTeam;
  mode: "keep" | "restore";
} | null;

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export function UniverseEditorContent({
  seasons,
  seasonId,
  onSeasonChange,
}: UniverseEditorContentProps) {
  const comparison = useRosterComparison(seasonId);
  const keep = useKeepUniverseConfig(seasonId);
  const restore = useRestoreSourceConfig(seasonId);

  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setActionError(null);
    setDialog(null);
  }, [seasonId]);

  const runKeep = React.useCallback(
    async (teamId: string) => {
      try {
        await keep.mutateAsync(teamId);
        setActionError(null);
      } catch (err) {
        setActionError(errorMessage(err, "Não foi possível ativar a configuração do universo."));
      }
    },
    [keep],
  );

  const runRestore = React.useCallback(
    async (teamId: string) => {
      setDialog(null);
      try {
        const result = await restore.mutateAsync(teamId);
        setActionError(null);
        setDialog(null);
        return result.restored;
      } catch (err) {
        setDialog(null);
        setActionError(
          errorMessage(err, "Não foi possível restaurar a configuração da fonte."),
        );
        return 0;
      }
    },
    [restore],
  );

  const seasonOptions = seasons.map((season) => ({
    value: season.id,
    label: `Temporada ${season.year}`,
  }));

  const data = comparison.data;
  const hasDivergence =
    data != null &&
    data.comparable &&
    data.teams.some((team) => team.status === "DIVERGENT");
  const seatCount = data?.teams.reduce((sum, t) => sum + t.seats.length, 0) ?? 0;
  const matchedSeats =
    data?.teams.reduce(
      (sum, t) => sum + t.seats.filter((s) => s.status === "MATCH").length,
      0,
    ) ?? 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="universe-editor-season">Temporada do universo</Label>
          <Select
            value={seasonId}
            onValueChange={onSeasonChange}
            options={seasonOptions}
            placeholder="Selecione a temporada"
          >
            <SelectTrigger id="universe-editor-season" className="min-w-44" />
            <SelectContent />
          </Select>
        </div>
        {data != null && data.comparable && data.teams.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            {`${matchedSeats} de ${seatCount} assentos alinhados`}
          </p>
        ) : null}
      </div>

      {comparison.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : null}

      {comparison.isError && !comparison.isLoading ? (
        <ErrorState
          heading="h2"
          title="Não foi possível comparar o universo com a fonte."
          description="Ocorreu um erro ao carregar a comparação."
          action={
            <Button
              variant="outline"
              onClick={() => void comparison.refetch()}
              disabled={comparison.isRefetching}
            >
              {comparison.isRefetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Tentar novamente
            </Button>
          }
        />
      ) : null}

      {data != null && !data.comparable ? (
        <EmptyState
          icon={<CircleCheck className="h-6 w-6" aria-hidden />}
          kicker="UNIVERSE EDITOR"
          title="Temporada sem fonte externa vinculada."
          description="Vincule a fonte para comparar a configuração do seu universo com o Mirror Externo."
        />
      ) : null}

      {data != null && data.comparable && data.teams.length === 0 ? (
        <EmptyState
          icon={<TriangleAlert className="h-6 w-6" aria-hidden />}
          kicker="UNIVERSE EDITOR"
          title="Nenhuma equipe espelhada ainda."
          description="Crie sua equipe e vincule a fonte externa para usar o editor de universo."
        />
      ) : null}

      {data != null && data.comparable && data.teams.length > 0 ? (
        <section
          className="space-y-4"
          aria-label="Comparação entre a fonte e o universo"
        >
          {!hasDivergence ? (
            <EmptyState
              kicker="UNIVERSE EDITOR"
              title="Tudo alinhado com a fonte."
              description="Cada assento do seu universo corresponde à configuração da fonte externa."
            />
          ) : null}
          {data.teams.map((team) => (
            <UniverseTeamCard
              key={team.id}
              team={team}
              isKeeping={keep.isPending}
              isRestoring={restore.isPending}
              pendingAction={
                keep.isPending ? "keep" : restore.isPending ? "restore" : null
              }
              error={actionError}
              onKeep={() => void runKeep(team.id)}
              onRequestRestore={() =>
                setDialog({ team, mode: "restore" })
              }
            />
          ))}
        </section>
      ) : null}

      <ConfirmDialog
        open={dialog?.mode === "restore"}
        onClose={() => setDialog(null)}
        title="Restaurar configuração da fonte?"
        description={`A equipe ${dialog?.team.name ?? ""} será ajustada para refletir a configuração da fonte externa, substituindo os pilotos atuais do seu universo quando a fonte vincular um piloto.`}
        onConfirm={() => {
          if (dialog) void runRestore(dialog.team.id);
        }}
        confirmLabel="Restaurar da fonte"
        cancelLabel="Cancelar"
        isPending={restore.isPending}
        error={actionError}
      />
    </div>
  );
}