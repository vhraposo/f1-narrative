"use client";

import { Loader2, Pencil, RotateCcw } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { SectionHeading } from "@/components/home/section-heading";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDrivers } from "@/hooks/use-driver-profiles";
import {
  useApplyChampionChange,
  useApplyHistoricalChampionOverride,
  useChampionDetail,
  useChampions,
  usePreviewChampionChange,
  usePreviewHistoricalChampionOverride,
} from "@/hooks/use-timeline";
import {
  CHAMPION_BLOCKED_REASONS,
  CHAMPION_STATE_LABELS,
  type ChampionBlockedReason,
  type ChampionChangePreview,
  type ChampionEntry,
  type ChampionState,
  type HistoricalChampionChangePreview,
} from "@/lib/timeline";

type BadgeTone = "muted" | "brand" | "warning" | "danger" | "success";

function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: BadgeTone }) {
  const tones: Record<BadgeTone, string> = {
    muted: "border-border bg-muted text-muted-foreground",
    brand: "border-brand/40 bg-brand/10 text-brand",
    warning:
      "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    danger: "border-destructive/40 bg-destructive/10 text-destructive",
    success:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function stateTone(state: ChampionState): BadgeTone {
  if (state === "MATCH") return "success";
  if (state === "DIVERGENT") return "warning";
  if (state === "EXTERNAL_ONLY") return "brand";
  return "muted";
}

function championName(
  value: { name: string } | null | undefined,
): string {
  return value?.name ?? "-";
}

function ExternalChampionCell({ entry }: { entry: ChampionEntry }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span>{championName(entry.externalChampion)}</span>
      {entry.externalChampion?.sourceType === "CANONICAL" && (
        <span
          className="text-[10px] uppercase tracking-wide text-muted-foreground"
          title="Fallback factual da cronologia oficial (2000-2025)"
        >
          cronologia oficial
        </span>
      )}
      {entry.sourceConflict && (
        <Badge tone="warning">
          <span title={`Standing externo diverge da cronologia oficial (${entry.canonicalChampion?.name ?? "—"})`}>
            Fonte em conflito
          </span>
        </Badge>
      )}
    </span>
  );
}

function PreviewDiff({ preview }: { preview: ChampionChangePreview }) {
  return (
    <div className="space-y-1 rounded-lg border border-border bg-muted/40 p-3 text-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Pré-visualização
      </p>
      {preview.changes.map((change) => (
        <p key={change.field} className="text-foreground">
          <span className="text-muted-foreground">{championName(preview.before)}</span>
          {" → "}
          <span className="font-semibold">{change.after}</span>
        </p>
      ))}
      <p className="text-xs text-muted-foreground">
        A fonte externa não será modificada; a alteração fica registrada no
        histórico deste Universe.
      </p>
    </div>
  );
}

function EditChampionDialog({
  entry,
  onClose,
}: {
  entry: ChampionEntry & { seasonId: string };
  onClose: () => void;
}) {
  const driversQuery = useDrivers();
  const previewMutation = usePreviewChampionChange();
  const applyMutation = useApplyChampionChange();
  const [driverProfileId, setDriverProfileId] = useState("");
  const [preview, setPreview] = useState<ChampionChangePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const driverOptions = (driversQuery.data ?? []).map((driver) => ({
    value: driver.id,
    label: driver.character.name,
  }));

  function resetPreview() {
    setPreview(null);
    setError(null);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar campeão mundial</DialogTitle>
          <DialogDescription>
            Temporada {entry.year} · afeta somente este Universe
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Campeão da fonte</span>
            <span className="font-medium">{championName(entry.externalChampion)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Campeão atual do Universe</span>
            <span className="font-medium">{championName(entry.universeChampion)}</span>
          </div>
          <div className="space-y-1.5">
            <Label id="champion-edit-driver-label">Novo campeão</Label>
            <Select
              value={driverProfileId}
              onValueChange={(value) => {
                setDriverProfileId(value);
                resetPreview();
              }}
              options={driverOptions}
              placeholder="Selecione o piloto"
            >
              <SelectTrigger aria-labelledby="champion-edit-driver-label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            A fonte externa não será modificada. A alteração afeta apenas este
            Universe e ficará registrada no histórico da Linha do Tempo.
          </p>
          {preview && <PreviewDiff preview={preview} />}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={applyMutation.isPending}>
            Cancelar
          </Button>
          {preview ? (
            <Button
              disabled={applyMutation.isPending}
              onClick={() => {
                setError(null);
                applyMutation.mutate(
                  {
                    seasonId: entry.seasonId,
                    request: {
                      mode: "EDIT",
                      driverProfileId,
                      previewToken: preview.previewToken,
                    },
                  },
                  {
                    onSuccess: () => onClose(),
                    onError: (err) =>
                      setError(
                        err instanceof Error ? err.message : "Falha ao aplicar",
                      ),
                  },
                );
              }}
            >
              {applyMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Confirmar alteração
            </Button>
          ) : (
            <Button
              disabled={
                previewMutation.isPending ||
                driverProfileId.length === 0 ||
                driverProfileId === entry.universeChampion?.driverProfileId
              }
              onClick={() => {
                setError(null);
                previewMutation.mutate(
                  {
                    seasonId: entry.seasonId,
                    request: { mode: "EDIT", driverProfileId },
                  },
                  {
                    onSuccess: (result) => setPreview(result),
                    onError: (err) =>
                      setError(
                        err instanceof Error
                          ? err.message
                          : "Falha ao pré-visualizar",
                      ),
                  },
                );
              }}
            >
              {previewMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Pré-visualizar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RestoreChampionDialog({
  entry,
  onClose,
}: {
  entry: ChampionEntry & { seasonId: string };
  onClose: () => void;
}) {
  const previewMutation = usePreviewChampionChange();
  const applyMutation = useApplyChampionChange();
  const [preview, setPreview] = useState<ChampionChangePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restaurar campeão da fonte</DialogTitle>
          <DialogDescription>
            Temporada {entry.year} · afeta somente este Universe
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Campeão atual do Universe</span>
            <span className="font-medium">{championName(entry.universeChampion)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Campeão da fonte</span>
            <span className="font-medium">{championName(entry.externalChampion)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Esta operação fará o Universe voltar a coincidir com o campeão
            informado pela fonte externa. A fonte externa não será modificada e a
            alteração será registrada no histórico da Linha do Tempo.
          </p>
          {preview && <PreviewDiff preview={preview} />}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={applyMutation.isPending}>
            Cancelar
          </Button>
          {preview ? (
            <Button
              disabled={applyMutation.isPending}
              onClick={() => {
                setError(null);
                applyMutation.mutate(
                  {
                    seasonId: entry.seasonId,
                    request: {
                      mode: "RESTORE",
                      previewToken: preview.previewToken,
                    },
                  },
                  {
                    onSuccess: () => onClose(),
                    onError: (err) =>
                      setError(
                        err instanceof Error ? err.message : "Falha ao restaurar",
                      ),
                  },
                );
              }}
            >
              {applyMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Restaurar da fonte
            </Button>
          ) : (
            <Button
              disabled={previewMutation.isPending}
              onClick={() => {
                setError(null);
                previewMutation.mutate(
                  {
                    seasonId: entry.seasonId,
                    request: { mode: "RESTORE" },
                  },
                  {
                    onSuccess: (result) => setPreview(result),
                    onError: (err) =>
                      setError(
                        err instanceof Error
                          ? err.message
                          : "Falha ao pré-visualizar",
                      ),
                  },
                );
              }}
            >
              {previewMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Pré-visualizar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoricalChampionDialog({
  entry,
  initialMode,
  onClose,
}: {
  entry: ChampionEntry;
  initialMode: "EDIT" | "RESTORE";
  onClose: () => void;
}) {
  const driversQuery = useDrivers();
  const previewMutation = usePreviewHistoricalChampionOverride();
  const applyMutation = useApplyHistoricalChampionOverride();
  const [mode, setMode] = useState<"EDIT" | "RESTORE">(initialMode);
  const [driverProfileId, setDriverProfileId] = useState("");
  const [preview, setPreview] = useState<HistoricalChampionChangePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const driverOptions = (driversQuery.data ?? []).map((driver) => ({
    value: driver.id,
    label: driver.character.name,
  }));

  function resetPreview(nextMode?: "EDIT" | "RESTORE") {
    setPreview(null);
    setError(null);
    if (nextMode) setMode(nextMode);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Campeão histórico do Universe</DialogTitle>
          <DialogDescription>
            Temporada {entry.year} · sem Season materializada · afeta somente este
            Universe
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Campeão da fonte</span>
            <span className="font-medium">{championName(entry.externalChampion)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Campeão atual do Universe</span>
            <span className="font-medium">
              {entry.universeChampion
                ? championName(entry.universeChampion)
                : "— (baseline da fonte)"}
            </span>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant={mode === "EDIT" ? "default" : "outline"}
              onClick={() => resetPreview("EDIT")}
            >
              Sobrescrever
            </Button>
            <Button
              size="sm"
              variant={mode === "RESTORE" ? "default" : "outline"}
              disabled={!entry.canRestoreOverride}
              onClick={() => resetPreview("RESTORE")}
            >
              Restaurar da fonte
            </Button>
          </div>

          {mode === "EDIT" ? (
            <div className="space-y-1.5">
              <Label id="historical-champion-driver-label">Novo campeão</Label>
              <Select
                value={driverProfileId}
                onValueChange={(value) => {
                  setDriverProfileId(value);
                  resetPreview();
                }}
                options={driverOptions}
                placeholder="Selecione o piloto"
              >
                <SelectTrigger aria-labelledby="historical-champion-driver-label">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent />
              </Select>
              <p className="text-xs text-muted-foreground">
                Nenhuma temporada, corrida ou resultado é criado: o override é
                registrado na Linha do Tempo e não altera o espelho externo.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              A operação remove o override deste Universe e volta ao campeão da
              fonte. O espelho externo não é modificado.
            </p>
          )}

          {preview && (
            <div className="space-y-1 rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Pré-visualização
              </p>
              <p className="text-foreground">
                <span className="text-muted-foreground">
                  {championName(preview.before)}
                </span>
                {" → "}
                <span className="font-semibold">{championName(preview.after)}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Impacto: divergência histórica External × Universe; a fonte externa
                permanece intacta.
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={applyMutation.isPending}>
            Cancelar
          </Button>
          {preview ? (
            <Button
              disabled={applyMutation.isPending}
              onClick={() => {
                setError(null);
                applyMutation.mutate(
                  {
                    year: entry.year,
                    request:
                      mode === "EDIT"
                        ? {
                            mode: "EDIT",
                            driverProfileId,
                            previewToken: preview.previewToken,
                          }
                        : { mode: "RESTORE", previewToken: preview.previewToken },
                  },
                  {
                    onSuccess: () => onClose(),
                    onError: (err) =>
                      setError(
                        err instanceof Error ? err.message : "Falha ao aplicar",
                      ),
                  },
                );
              }}
            >
              {applyMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Confirmar alteração
            </Button>
          ) : (
            <Button
              disabled={
                previewMutation.isPending ||
                (mode === "EDIT" && driverProfileId.length === 0)
              }
              onClick={() => {
                setError(null);
                previewMutation.mutate(
                  {
                    year: entry.year,
                    request:
                      mode === "EDIT"
                        ? { mode: "EDIT", driverProfileId }
                        : { mode: "RESTORE" },
                  },
                  {
                    onSuccess: (result) => setPreview(result),
                    onError: (err) =>
                      setError(
                        err instanceof Error
                          ? err.message
                          : "Falha ao pré-visualizar",
                      ),
                  },
                );
              }}
            >
              {previewMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Pré-visualizar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BlockedChampionDialog({
  entry,
  onClose,
  onOpenTimeline,
}: {
  entry: ChampionEntry;
  onClose: () => void;
  onOpenTimeline?: (seasonId: string) => void;
}) {
  const reason: ChampionBlockedReason =
    entry.blockedReason ?? "SEASON_NOT_IN_UNIVERSE";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Campeão não editável</DialogTitle>
          <DialogDescription>
            Temporada {entry.year} · somente leitura neste Universe
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Campeão da fonte</span>
            <span className="font-medium">{championName(entry.externalChampion)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Campeão do Universe</span>
            <span className="font-medium">{championName(entry.universeChampion)}</span>
          </div>
          <p className="text-sm text-foreground">{CHAMPION_BLOCKED_REASONS[reason]}</p>
          {reason === "DERIVED_CHAMPION" && (
            <p className="text-xs text-muted-foreground">
              Corrija a origem esportiva (resultados/classificação) pela Linha do
              Tempo; um override independente deixaria standings e campeão
              inconsistentes.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          {reason === "DERIVED_CHAMPION" && entry.seasonId && onOpenTimeline && (
            <Button
              onClick={() => {
                onOpenTimeline(entry.seasonId as string);
                onClose();
              }}
            >
              Editar resultados na Linha do Tempo
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChampionDetailSection({
  seasonId,
  onClose,
}: {
  seasonId: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError, error, refetch } = useChampionDetail(seasonId);

  return (
    <section
      aria-label="Detalhe do campeonato"
      className="space-y-3 rounded-xl border border-border bg-card p-5"
    >
      <SectionHeading kicker="Campeonato" title="Detalhe" />
      {isLoading ? (
        <div role="status" aria-label="Carregando campeonato" className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError || !data ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            {error instanceof Error ? error.message : "Não foi possível carregar."}
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">Fonte externa: </span>
              <span className="font-medium">
                {championName(data.champion.externalChampion)}
              </span>
            </p>
            <p>
              <span className="text-muted-foreground">Universe: </span>
              <span className="font-medium">
                {championName(data.champion.universeChampion)}
              </span>
            </p>
            <p className="flex items-center gap-2">
              <span className="text-muted-foreground">Estado: </span>
              <Badge tone={stateTone(data.champion.state)}>
                {CHAMPION_STATE_LABELS[data.champion.state]}
              </Badge>
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Histórico
            </p>
            {data.history.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Nenhuma alteração histórica registrada.
              </p>
            ) : (
              <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                {data.history.map((item) => (
                  <li key={item.id}>#{item.sequence} · {item.summary}</li>
                ))}
              </ul>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Fechar detalhe
          </Button>
        </>
      )}
    </section>
  );
}

export function ChampionsPanel({
  onOpenTimeline,
}: {
  onOpenTimeline?: (seasonId: string) => void;
}) {
  const championsQuery = useChampions();
  const [yearFilter, setYearFilter] = useState("");
  const [onlyDivergent, setOnlyDivergent] = useState(false);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [editEntry, setEditEntry] = useState<ChampionEntry | null>(null);
  const [restoreEntry, setRestoreEntry] = useState<ChampionEntry | null>(null);
  const [blockedEntry, setBlockedEntry] = useState<ChampionEntry | null>(null);
  const [historicalEntry, setHistoricalEntry] = useState<{
    entry: ChampionEntry;
    mode: "EDIT" | "RESTORE";
  } | null>(null);

  const entries = championsQuery.data ?? [];
  const yearOptions = useMemo(
    () => [
      { value: "all", label: "Todas" },
      ...[...new Set(entries.map((entry) => entry.year))]
        .sort((a, b) => b - a)
        .map((year) => ({ value: String(year), label: String(year) })),
    ],
    [entries],
  );

  const filtered = entries.filter((entry) => {
    if (yearFilter && String(entry.year) !== yearFilter) return false;
    if (onlyDivergent && entry.state !== "DIVERGENT") return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <section aria-label="Filtros de campeões" className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Compare o campeão informado pela fonte externa com o campeão do seu
          universo. Alterações afetam somente este Universe e ficam registradas
          no histórico.
        </p>
        <div className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-card p-5">
          <div className="w-full space-y-1.5 sm:w-44">
            <Label id="champions-year-label">Temporada</Label>
            <Select
              value={yearFilter === "" ? "all" : yearFilter}
              onValueChange={(value) => setYearFilter(value === "all" ? "" : value)}
              options={yearOptions}
              placeholder="Todas"
            >
              <SelectTrigger aria-labelledby="champions-year-label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={onlyDivergent}
              onChange={(event) => setOnlyDivergent(event.target.checked)}
            />
            Somente divergentes
          </label>
        </div>
      </section>

      <section aria-label="Histórico de campeões" className="space-y-3">
        {championsQuery.isLoading ? (
          <div
            role="status"
            aria-label="Carregando campeões"
            className="flex justify-center py-10"
          >
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : championsQuery.isError ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">
              {championsQuery.error instanceof Error
                ? championsQuery.error.message
                : "Não foi possível carregar os campeões."}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void championsQuery.refetch()}
            >
              Tentar novamente
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            kicker="Campeões"
            title="Nenhum campeão encontrado"
            description="Ajuste os filtros ou materialize temporadas para ver o histórico de campeões."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">
                Histórico de campeões por temporada, com fonte externa e Universe
              </caption>
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-semibold">Ano</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Campeão externo</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Campeão do Universe</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Estado</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((entry) => (
                  <tr
                    key={entry.seasonId ?? `year-${entry.year}`}
                    className={
                      entry.seasonId ? "cursor-pointer hover:bg-accent/30" : ""
                    }
                    onClick={() =>
                      entry.seasonId && setSelectedSeasonId(entry.seasonId)
                    }
                  >
                    <td className="px-4 py-3 font-semibold tabular-nums text-foreground">
                      {entry.year}
                    </td>
                    <td className="px-4 py-3 text-foreground/90">
                      <ExternalChampionCell entry={entry} />
                    </td>
                    <td className="px-4 py-3 text-foreground/90">
                      {entry.universeChampion ? (
                        championName(entry.universeChampion)
                      ) : entry.baseline ? (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <span>{championName(entry.externalChampion)}</span>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            baseline histórico
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {entry.blockedReason
                            ? CHAMPION_BLOCKED_REASONS[entry.blockedReason]
                            : "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={stateTone(entry.state)}>
                        {CHAMPION_STATE_LABELS[entry.state]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Editar campeão de ${entry.year}`}
                          title={
                            entry.canEdit
                              ? `Editar campeão de ${entry.year}`
                              : entry.canEditOverride
                                ? `Definir campeão do Universe para ${entry.year}`
                                : entry.blockedReason
                                  ? CHAMPION_BLOCKED_REASONS[entry.blockedReason]
                                  : "Edição não disponível para esta temporada."
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            if (entry.canEdit) setEditEntry(entry);
                            else if (entry.canEditOverride)
                              setHistoricalEntry({ entry, mode: "EDIT" });
                            else setBlockedEntry(entry);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {entry.canRestore && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Restaurar campeão de ${entry.year} da fonte`}
                            title={`Restaurar campeão de ${entry.year} da fonte`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setRestoreEntry(entry);
                            }}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {entry.canRestoreOverride && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Restaurar campeão histórico de ${entry.year} da fonte`}
                            title={`Restaurar campeão histórico de ${entry.year} da fonte`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setHistoricalEntry({ entry, mode: "RESTORE" });
                            }}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedSeasonId && (
        <ChampionDetailSection
          seasonId={selectedSeasonId}
          onClose={() => setSelectedSeasonId(null)}
        />
      )}

      {editEntry && editEntry.seasonId && (
        <EditChampionDialog
          entry={{ ...editEntry, seasonId: editEntry.seasonId }}
          onClose={() => setEditEntry(null)}
        />
      )}
      {restoreEntry && restoreEntry.seasonId && (
        <RestoreChampionDialog
          entry={{ ...restoreEntry, seasonId: restoreEntry.seasonId }}
          onClose={() => setRestoreEntry(null)}
        />
      )}
      {historicalEntry && (
        <HistoricalChampionDialog
          entry={historicalEntry.entry}
          initialMode={historicalEntry.mode}
          onClose={() => setHistoricalEntry(null)}
        />
      )}
      {blockedEntry && (
        <BlockedChampionDialog
          entry={blockedEntry}
          onClose={() => setBlockedEntry(null)}
          onOpenTimeline={onOpenTimeline}
        />
      )}
    </div>
  );
}
