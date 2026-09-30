"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDrivers } from "@/hooks/use-driver-profiles";
import {
  useApplyCorrection,
  usePreviewCorrection,
  useTimelineEvent,
} from "@/hooks/use-timeline";
import { ApiError } from "@/lib/api";
import {
  timelineKindLabel,
  type CorrectionCommand,
  type CorrectionPreview,
  type TimelineEditBlockedReason,
  type TimelineEditorKind,
  type TimelineEventDetail,
  type TimelineItem,
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

const BLOCKED_REASONS: Record<TimelineEditBlockedReason, string> = {
  NO_VISUAL_EDITOR:
    "Este tipo de evento não possui editor visual nesta versão.",
  EVOLUTION_STALE:
    "Esta temporada já possui evolução aplicada; corrija a evolução antes de editar resultados.",
  DERIVED_STANDING:
    "Esta temporada possui resultados; a classificação é derivada e deve ser corrigida pela origem esportiva.",
  RESULT_NOT_FOUND:
    "O resultado desta linha não existe mais neste universo.",
  DRIVER_NOT_IN_SEASON: "O piloto não participa desta temporada.",
  RACE_NOT_FOUND: "A corrida não existe mais neste universo.",
  SEASON_NOT_FOUND: "A temporada não existe mais neste universo.",
  WORLD_STATE_MISSING: "O universo ainda não possui estado do mundo.",
};

type FormField = {
  key: string;
  label: string;
  type: "number" | "text" | "date" | "checkbox";
  hint?: string;
};

const EDITOR_FORMS: Record<
  TimelineEditorKind,
  { title: string; fields: FormField[] }
> = {
  RACE_RESULT: {
    title: "Resultado de corrida",
    fields: [
      { key: "position", label: "Posição", type: "number" },
      { key: "grid", label: "Grid", type: "number" },
      { key: "status", label: "Status", type: "text" },
    ],
  },
  SPRINT: {
    title: "Sprint",
    fields: [
      { key: "position", label: "Posição", type: "number" },
      { key: "status", label: "Status", type: "text" },
      { key: "neutralizedStart", label: "Largada neutralizada", type: "checkbox" },
      { key: "distancePct", label: "Distância percorrida (%)", type: "number" },
    ],
  },
  NUMBER: {
    title: "Número do piloto",
    fields: [
      {
        key: "number",
        label: "Número",
        type: "number",
        hint: "Deixe vazio para liberar o número.",
      },
    ],
  },
  STANDING: {
    title: "Classificação",
    fields: [
      { key: "points", label: "Pontos", type: "number" },
      { key: "wins", label: "Vitórias", type: "number" },
      { key: "podiums", label: "Pódios", type: "number" },
      { key: "position", label: "Posição", type: "number" },
    ],
  },
  RACE: {
    title: "Corrida",
    fields: [
      { key: "name", label: "Nome", type: "text" },
      { key: "date", label: "Data", type: "date" },
      { key: "round", label: "Rodada", type: "number" },
      { key: "status", label: "Status", type: "text" },
    ],
  },
};

function formatWorldDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function initialFormValues(detail: TimelineEventDetail): Record<string, string | boolean> {
  const kind = detail.edit.editorKind;
  if (!kind) return {};
  const current = detail.edit.currentValues ?? {};
  const values: Record<string, string | boolean> = {};
  for (const field of EDITOR_FORMS[kind].fields) {
    const raw = current[field.key];
    if (field.type === "checkbox") {
      values[field.key] = raw === 1;
    } else if (field.key === "date" && typeof raw === "string") {
      values[field.key] = raw.slice(0, 10);
    } else {
      values[field.key] = raw === null || raw === undefined ? "" : String(raw);
    }
  }
  return values;
}

function optionalNumber(
  values: Record<string, string | boolean>,
  key: string,
): number | undefined {
  const raw = values[key];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildCorrectionCommand(
  detail: TimelineEventDetail,
  values: Record<string, string | boolean>,
): CorrectionCommand | null {
  const kind = detail.edit.editorKind;
  const worldDate = detail.edit.defaultWorldDate;
  if (!kind || !worldDate) return null;
  const supersedesId = detail.edit.suggestedSupersedesId ?? null;
  const raceId = detail.item.race?.id;
  const driverProfileId = detail.item.driver?.id;
  const seasonId = detail.item.season?.id;

  if (kind === "RACE_RESULT") {
    if (!raceId || !driverProfileId) return null;
    const status =
      typeof values.status === "string" && values.status.trim().length > 0
        ? values.status.trim()
        : undefined;
    return {
      kind: "RACE_RESULT_CORRECTED",
      worldDate,
      raceId,
      driverProfileId,
      ...(optionalNumber(values, "position") !== undefined
        ? { position: optionalNumber(values, "position") as number }
        : {}),
      ...(optionalNumber(values, "grid") !== undefined
        ? { grid: optionalNumber(values, "grid") as number }
        : {}),
      ...(status !== undefined ? { status } : {}),
      supersedesId,
    };
  }

  if (kind === "SPRINT") {
    if (!raceId || !driverProfileId) return null;
    const status =
      typeof values.status === "string" && values.status.trim().length > 0
        ? values.status.trim()
        : undefined;
    const current = detail.edit.currentValues ?? {};
    const distancePct =
      optionalNumber(values, "distancePct") ??
      (typeof current.distancePct === "number" ? current.distancePct : 100);
    return {
      kind: "RACE_SESSION_RESULT_CORRECTED",
      worldDate,
      raceId,
      driverProfileId,
      ...(optionalNumber(values, "position") !== undefined
        ? { position: optionalNumber(values, "position") as number }
        : {}),
      ...(status !== undefined ? { status } : {}),
      eligibility: {
        neutralizedStart: values.neutralizedStart === true,
        distancePct,
      },
      supersedesId,
    };
  }

  if (kind === "NUMBER") {
    if (!seasonId || !driverProfileId) return null;
    const raw = typeof values.number === "string" ? values.number.trim() : "";
    const number = raw.length === 0 ? null : Number(raw);
    if (number !== null && !Number.isFinite(number)) return null;
    return {
      kind: "NUMBER_CORRECTED",
      worldDate,
      seasonId,
      driverProfileId,
      number,
      supersedesId,
    };
  }

  if (kind === "STANDING") {
    if (!seasonId || !driverProfileId) return null;
    return {
      kind: "STANDING_CORRECTED",
      worldDate,
      seasonId,
      driverProfileId,
      ...(optionalNumber(values, "points") !== undefined
        ? { points: optionalNumber(values, "points") as number }
        : {}),
      ...(optionalNumber(values, "wins") !== undefined
        ? { wins: optionalNumber(values, "wins") as number }
        : {}),
      ...(optionalNumber(values, "podiums") !== undefined
        ? { podiums: optionalNumber(values, "podiums") as number }
        : {}),
      ...(optionalNumber(values, "position") !== undefined
        ? { position: optionalNumber(values, "position") as number }
        : {}),
      supersedesId,
    };
  }

  if (!raceId) return null;
  const name =
    typeof values.name === "string" && values.name.trim().length > 0
      ? values.name.trim()
      : undefined;
  const date =
    typeof values.date === "string" && values.date.trim().length > 0
      ? new Date(`${values.date.trim()}T00:00:00.000Z`).toISOString()
      : undefined;
  const status =
    typeof values.status === "string" && values.status.trim().length > 0
      ? values.status.trim()
      : undefined;
  return {
    kind: "RACE_UPDATED",
    worldDate,
    raceId,
    ...(name !== undefined ? { name } : {}),
    ...(date !== undefined ? { date } : {}),
    ...(optionalNumber(values, "round") !== undefined
      ? { round: optionalNumber(values, "round") as number }
      : {}),
    ...(status !== undefined ? { status } : {}),
    supersedesId,
  };
}

function PreviewPanel({
  preview,
  driverNames,
}: {
  preview: CorrectionPreview;
  driverNames: Map<string, string>;
}) {
  const nameOf = (id: string | null) =>
    id ? (driverNames.get(id) ?? "Piloto alterado") : "—";
  const championChanged =
    preview.championBefore !== preview.championAfter &&
    (preview.championBefore !== null || preview.championAfter !== null);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Pré-visualização da correção
      </p>

      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Antes / Depois
        </p>
        {preview.changes.map((change, index) => (
          <p key={`${change.area}-${change.field}-${index}`} className="text-foreground">
            {change.label} · {change.field}:{" "}
            <span className="text-muted-foreground">{String(change.before ?? "—")}</span>
            {" → "}
            <span className="font-semibold">{String(change.after ?? "—")}</span>
          </p>
        ))}
      </div>

      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Impactos
        </p>
        <p className="text-foreground">
          Campeão:{" "}
          {championChanged
            ? `${nameOf(preview.championBefore)} → ${nameOf(preview.championAfter)}`
            : "sem alteração"}
        </p>
        <p className="text-foreground">
          #1:{" "}
          {preview.numberImpact?.requiresAction
            ? `reatribuição manual necessária após esta correção (${preview.numberImpact.year}).`
            : "sem alteração"}
        </p>
        <p className="text-foreground">
          Narrativa:{" "}
          {preview.narrativeStaleEventIds.length > 0
            ? `pode ficar desatualizada (${preview.narrativeStaleEventIds.length} registro(s)).`
            : "sem alteração."}
        </p>
      </div>

      <p className="text-xs text-muted-foreground">
        A fonte externa não será modificada; a alteração fica registrada no
        histórico deste Universe.
      </p>
    </div>
  );
}

function CorrectionEditor({
  detail,
  onClose,
  onApplied,
}: {
  detail: TimelineEventDetail;
  onClose: () => void;
  onApplied: () => void;
}) {
  const kind = detail.edit.editorKind as TimelineEditorKind;
  const form = EDITOR_FORMS[kind];
  const driversQuery = useDrivers();
  const previewMutation = usePreviewCorrection();
  const applyMutation = useApplyCorrection();
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    initialFormValues(detail),
  );
  const [preview, setPreview] = useState<CorrectionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const driverNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const driver of driversQuery.data ?? []) {
      map.set(driver.id, driver.character.name);
    }
    return map;
  }, [driversQuery.data]);

  function runPreview() {
    const command = buildCorrectionCommand(detail, values);
    if (!command) {
      setError("Preencha os campos para gerar a pré-visualização.");
      return;
    }
    setError(null);
    setStale(false);
    previewMutation.mutate(command, {
      onSuccess: (result) => setPreview(result),
      onError: (err) => {
        if (err instanceof ApiError && err.code === "PREVIEW_STALE") {
          setStale(true);
        }
        setError(err instanceof Error ? err.message : "Falha ao pré-visualizar");
        setPreview(null);
      },
    });
  }

  function runApply() {
    const command = buildCorrectionCommand(detail, values);
    if (!command || !preview) return;
    setError(null);
    applyMutation.mutate(
      { command, previewToken: preview.previewToken },
      {
        onSuccess: () => onApplied(),
        onError: (err) => {
          if (err instanceof ApiError && err.code === "PREVIEW_STALE") {
            setStale(true);
            setPreview(null);
            setConfirming(false);
            setError(
              "O estado do Universo mudou desde a pré-visualização. Gere uma nova pré-visualização antes de aplicar esta correção.",
            );
            return;
          }
          setError(err instanceof Error ? err.message : "Falha ao aplicar");
        },
      },
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-brand/40 bg-brand/5 p-4">
      <p className="text-sm font-semibold text-foreground">
        Editar: {form.title}
      </p>
      <p className="text-xs text-muted-foreground">
        A edição não modifica o evento anterior: uma nova correção histórica
        será registrada e o histórico será preservado.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {form.fields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            {field.type === "checkbox" ? (
              <label className="flex items-center gap-2 pt-5 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={values[field.key] === true}
                  onChange={(event) => {
                    setValues((current) => ({
                      ...current,
                      [field.key]: event.target.checked,
                    }));
                    setPreview(null);
                  }}
                />
                {field.label}
              </label>
            ) : (
              <>
                <Label htmlFor={`editor-${field.key}`}>{field.label}</Label>
                <Input
                  id={`editor-${field.key}`}
                  type={field.type}
                  value={typeof values[field.key] === "string" ? String(values[field.key]) : ""}
                  onChange={(event) => {
                    setValues((current) => ({
                      ...current,
                      [field.key]: event.target.value,
                    }));
                    setPreview(null);
                  }}
                />
                {field.hint && (
                  <p className="text-xs text-muted-foreground">{field.hint}</p>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          {stale && (
            <Button variant="outline" size="sm" onClick={runPreview}>
              Gerar nova pré-visualização
            </Button>
          )}
        </div>
      )}

      {preview && (
        <>
          <PreviewPanel preview={preview} driverNames={driverNames} />
          {confirming ? (
            <div className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
              <p className="font-semibold text-foreground">
                Aplicar correção histórica?
              </p>
              <p className="text-muted-foreground">
                Esta operação será registrada na Linha do Tempo, preservará o
                histórico anterior e será aplicada atomicamente. A fonte externa
                não será modificada.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={applyMutation.isPending}
                  onClick={runApply}
                >
                  {applyMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Aplicar correção
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={applyMutation.isPending}
                  onClick={() => setConfirming(false)}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}

      <div className="flex items-center gap-2">
        {!preview && (
          <Button
            size="sm"
            disabled={previewMutation.isPending}
            onClick={runPreview}
          >
            {previewMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Pré-visualizar correção
          </Button>
        )}
        {preview && !confirming && (
          <Button size="sm" onClick={() => setConfirming(true)}>
            Aplicar correção
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClose}>
          Fechar editor
        </Button>
      </div>
    </div>
  );
}

function ChainList({
  items,
  currentId,
  emptyLabel,
}: {
  items: TimelineItem[];
  currentId: string | null;
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ol className="space-y-1 text-sm">
      {items.map((item) => (
        <li key={item.id} className="flex flex-wrap items-center gap-2">
          {item.id === currentId ? (
            <Badge tone="success">Atual</Badge>
          ) : (
            <Badge tone="muted">#{item.sequence}</Badge>
          )}
          <span className="text-foreground">{item.summary}</span>
          {item.values && (
            <span className="text-xs text-muted-foreground">
              {Object.entries(item.values)
                .filter(([, value]) => value !== null)
                .map(([key, value]) => `${key}: ${String(value)}`)
                .join(" · ")}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

export function TimelineEventPanel({
  eventId,
  onClose,
}: {
  eventId: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError, error, refetch } = useTimelineEvent(eventId);
  const [tab, setTab] = useState<"details" | "impact" | "history">("details");
  const [editing, setEditing] = useState(false);
  const [appliedNotice, setAppliedNotice] = useState(false);

  useEffect(() => {
    setTab("details");
    setEditing(false);
    setAppliedNotice(false);
  }, [eventId]);

  if (isLoading) {
    return (
      <div
        role="status"
        aria-label="Carregando evento"
        className="flex justify-center py-6"
      >
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">
          {error instanceof Error
            ? error.message
            : "Não foi possível carregar o evento."}
        </p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  const { item, edit } = data;
  const chain = [...data.supersedesChain].reverse().concat(item);
  const fullHistory = [...chain, ...data.supersededByChain];
  const effectiveId =
    data.supersededByChain.length > 0
      ? data.supersededByChain[data.supersededByChain.length - 1]!.id
      : item.id;
  const currentValues = edit.currentValues
    ? Object.entries(edit.currentValues).filter(([, value]) => value !== null)
    : [];

  return (
    <div className="space-y-3">
      <div
        role="tablist"
        aria-label="Detalhes do evento"
        className="flex gap-2 border-b border-border pb-2"
      >
        {(
          [
            ["details", "Detalhes"],
            ["impact", "Impacto"],
            ["history", "Histórico"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            role="tab"
            aria-selected={tab === value}
            variant={tab === value ? "default" : "ghost"}
            size="sm"
            onClick={() => setTab(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      {appliedNotice && (
        <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400">
          Correção aplicada. O evento anterior foi preservado no histórico.
        </p>
      )}

      {tab === "details" && (
        <div className="space-y-3">
          <dl className="space-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="w-32 shrink-0 text-muted-foreground">Evento</dt>
              <dd className="font-medium text-foreground">{item.summary}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-32 shrink-0 text-muted-foreground">Tipo</dt>
              <dd className="flex items-center gap-2">
                {timelineKindLabel(item.kind)}
                {item.isSuperseded ? (
                  <Badge tone="muted">Substituído</Badge>
                ) : (
                  item.isCorrection && <Badge tone="success">Efetivo</Badge>
                )}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-32 shrink-0 text-muted-foreground">Data do mundo</dt>
              <dd>{formatWorldDate(item.worldDate)}</dd>
            </div>
            {item.season && (
              <div className="flex gap-2">
                <dt className="w-32 shrink-0 text-muted-foreground">Temporada</dt>
                <dd>{item.season.year}</dd>
              </div>
            )}
            {item.race && (
              <div className="flex gap-2">
                <dt className="w-32 shrink-0 text-muted-foreground">Corrida</dt>
                <dd>{item.race.name}</dd>
              </div>
            )}
            {item.driver && (
              <div className="flex gap-2">
                <dt className="w-32 shrink-0 text-muted-foreground">Piloto</dt>
                <dd>{item.driver.name}</dd>
              </div>
            )}
            {item.team && (
              <div className="flex gap-2">
                <dt className="w-32 shrink-0 text-muted-foreground">Equipe</dt>
                <dd>{item.team.name}</dd>
              </div>
            )}
            {currentValues.length > 0 && (
              <div className="flex gap-2">
                <dt className="w-32 shrink-0 text-muted-foreground">Estado atual</dt>
                <dd className="space-x-3">
                  {currentValues.map(([key, value]) => (
                    <span key={key} className="text-foreground">
                      {key}: <span className="font-semibold">{String(value)}</span>
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>

          {!editing && (
            <div className="space-y-2">
              <Button
                size="sm"
                disabled={!edit.canEdit}
                title={
                  edit.canEdit
                    ? "Criar uma nova correção histórica"
                    : edit.blockedReason
                      ? BLOCKED_REASONS[edit.blockedReason]
                      : "Edição indisponível"
                }
                onClick={() => setEditing(true)}
              >
                Editar
              </Button>
              {!edit.canEdit && (
                <p className="text-xs text-muted-foreground">
                  {edit.blockedReason
                    ? BLOCKED_REASONS[edit.blockedReason]
                    : "Este evento não pode ser editado."}
                </p>
              )}
            </div>
          )}

          {editing && edit.canEdit && edit.editorKind && (
            <CorrectionEditor
              detail={data}
              onClose={() => setEditing(false)}
              onApplied={() => {
                setEditing(false);
                setAppliedNotice(true);
              }}
            />
          )}
        </div>
      )}

      {tab === "impact" && (
        <div className="space-y-2 text-sm">
          {currentValues.length > 0 ? (
            <p className="text-foreground">
              Estado atual:{" "}
              {currentValues
                .map(([key, value]) => `${key}: ${String(value)}`)
                .join(" · ")}
            </p>
          ) : (
            <p className="text-muted-foreground">
              Nenhum estado derivado disponível para este evento.
            </p>
          )}
          {edit.narrativeStaleEventIds.length > 0 ? (
            <p className="text-amber-600 dark:text-amber-400">
              Narrativa: pode ficar desatualizada (
              {edit.narrativeStaleEventIds.length} registro(s) ligado(s) a este
              acontecimento).
            </p>
          ) : (
            <p className="text-muted-foreground">Narrativa: sem impacto conhecido.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Use Editar → Pré-visualizar correção para ver o impacto completo
            (classificação, campeão e #1) antes de aplicar.
          </p>
        </div>
      )}

      {tab === "history" && (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Cadeia de correções
          </p>
          <ChainList
            items={fullHistory}
            currentId={effectiveId}
            emptyLabel="Nenhuma correção registrada para este acontecimento."
          />
        </div>
      )}

      <Button variant="ghost" size="sm" onClick={onClose}>
        Fechar detalhe
      </Button>
    </div>
  );
}
