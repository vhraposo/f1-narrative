"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectTrigger,
} from "@/components/ui/select";
import {
  useApplyPilotEvolution,
  useCreatePilotMemory,
  usePatchPilotMemory,
  usePilotMemories,
  usePreviewPilotEvolution,
  useReconcilePilotContext,
} from "@/hooks/use-pilot-experience";
import {
  PILOT_IMPORTANCE_LABELS,
  PILOT_MEMORY_STATUS_LABELS,
  PILOT_MEMORY_TYPE_LABELS,
  type EvolutionPreview,
  type PilotImportance,
  type PilotMemoryStatus,
  type PilotMemoryType,
  type PilotMemoryView,
} from "@/lib/pilot-experience";

const STATUS_FILTER_OPTIONS = [
  { value: "ACTIVE", label: "Ativas" },
  { value: "ARCHIVED", label: "Arquivadas" },
  { value: "SUPERSEDED", label: "Substituídas" },
  { value: "INVALIDATED", label: "Invalidadas" },
];

const IMPORTANCE_OPTIONS = [
  { value: "LOW", label: "Baixa" },
  { value: "MEDIUM", label: "Média" },
  { value: "HIGH", label: "Alta" },
  { value: "CRITICAL", label: "Crítica" },
];

const TYPE_OPTIONS = Object.entries(PILOT_MEMORY_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function MemoryCard({
  characterId,
  memory,
}: {
  characterId: string;
  memory: PilotMemoryView;
}) {
  const patchMutation = usePatchPilotMemory(characterId);
  const isManual = memory.derivation === "MANUAL";
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {memory.memoryType ? PILOT_MEMORY_TYPE_LABELS[memory.memoryType] : "Memória"}
        </span>
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {PILOT_IMPORTANCE_LABELS[memory.importance]}
        </span>
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {PILOT_MEMORY_STATUS_LABELS[memory.status]}
        </span>
        <span className="rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
          {isManual ? "Manual" : "Derivada"}
        </span>
      </div>
      <p className="mt-2 text-sm text-foreground">{memory.content}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Origem: {memory.source.source === "MANUAL" ? "criada neste Universe" : memory.source.source}
        {memory.source.seasonYear ? ` · ${memory.source.seasonYear}` : ""}
        {memory.source.occurredAt ? ` · ${formatDate(memory.source.occurredAt)}` : ""}
        {` · revisão ${memory.revision}`}
      </p>
      {isManual && memory.status === "ACTIVE" && (
        <Button
          className="mt-2"
          size="sm"
          variant="ghost"
          disabled={patchMutation.isPending}
          onClick={() => patchMutation.mutate({ memoryId: memory.id, input: { status: "ARCHIVED" } })}
        >
          Arquivar
        </Button>
      )}
      {!isManual && (
        <p className="mt-1 text-xs text-muted-foreground">
          Memória derivada de fatos do Universe; corrigir a fonte invalida ou substitui esta memória.
        </p>
      )}
    </li>
  );
}

export function PilotMemoriesPanel({ characterId }: { characterId: string }) {
  const [status, setStatus] = useState<PilotMemoryStatus>("ACTIVE");
  const [type, setType] = useState<string>("ALL");
  const [importance, setImportance] = useState<string>("ALL");
  const [showForm, setShowForm] = useState(false);
  const [content, setContent] = useState("");
  const [formImportance, setFormImportance] = useState<PilotImportance>("MEDIUM");
  const [formType, setFormType] = useState<string>("ALL");
  const [occurredAt, setOccurredAt] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const filters = {
    status,
    ...(type !== "ALL" ? { type: type as PilotMemoryType } : {}),
    ...(importance !== "ALL" ? { importance: importance as PilotImportance } : {}),
  };
  const { data, isLoading, isError, error } = usePilotMemories(characterId, filters);
  const createMutation = useCreatePilotMemory(characterId);
  const reconcileMutation = useReconcilePilotContext(characterId);

  function submit() {
    if (content.trim().length === 0) {
      setFormError("Descreva a memória.");
      return;
    }
    setFormError(null);
    createMutation.mutate(
      {
        content: content.trim(),
        importance: formImportance,
        memoryType: formType === "ALL" ? null : (formType as PilotMemoryType),
        occurredAt: occurredAt.length > 0 ? new Date(`${occurredAt}T00:00:00.000Z`).toISOString() : null,
      },
      {
        onSuccess: () => {
          setShowForm(false);
          setContent("");
          setOccurredAt("");
          setNotice("Memória criada somente neste Universe.");
        },
        onError: (err) => setFormError(err instanceof Error ? err.message : "Falha ao salvar"),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Memórias</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {notice && (
          <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400">
            {notice}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="memory-status">Situação</Label>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as PilotMemoryStatus)}
              options={STATUS_FILTER_OPTIONS}
              className="block"
            >
              <SelectTrigger id="memory-status" aria-label="Situação" />
              <SelectContent />
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="memory-type">Tipo</Label>
            <Select
              value={type}
              onValueChange={setType}
              options={[{ value: "ALL", label: "Todos" }, ...TYPE_OPTIONS]}
              className="block"
            >
              <SelectTrigger id="memory-type" aria-label="Tipo" />
              <SelectContent />
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="memory-importance">Importância</Label>
            <Select
              value={importance}
              onValueChange={setImportance}
              options={[{ value: "ALL", label: "Todas" }, ...IMPORTANCE_OPTIONS]}
              className="block"
            >
              <SelectTrigger id="memory-importance" aria-label="Importância" />
              <SelectContent />
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div role="status" aria-label="Carregando memórias" className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <p role="alert" className="text-sm text-destructive">
            {error instanceof Error ? error.message : "Não foi possível carregar as memórias."}
          </p>
        ) : (data?.memories ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma memória registrada para este filtro.
          </p>
        ) : (
          <ul className="space-y-3">
            {(data?.memories ?? []).map((memory) => (
              <MemoryCard key={memory.id} characterId={characterId} memory={memory} />
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          {showForm ? (
            <div className="w-full space-y-3 rounded-lg border border-brand/40 bg-brand/5 p-3">
              <p className="text-sm font-semibold text-foreground">Adicionar memória</p>
              <div className="space-y-1">
                <Label htmlFor="memory-content">Memória</Label>
                <Input
                  id="memory-content"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  maxLength={600}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="memory-form-type">Tipo</Label>
                  <Select
                    value={formType}
                    onValueChange={setFormType}
                    options={[{ value: "ALL", label: "Sem tipo" }, ...TYPE_OPTIONS]}
                    className="block"
                  >
                    <SelectTrigger id="memory-form-type" aria-label="Tipo" />
                    <SelectContent />
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="memory-form-importance">Importância</Label>
                  <Select
                    value={formImportance}
                    onValueChange={(value) => setFormImportance(value as PilotImportance)}
                    options={IMPORTANCE_OPTIONS}
                    className="block"
                  >
                    <SelectTrigger id="memory-form-importance" aria-label="Importância" />
                    <SelectContent />
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="memory-form-date">Data (opcional)</Label>
                  <Input
                    id="memory-form-date"
                    type="date"
                    value={occurredAt}
                    onChange={(event) => setOccurredAt(event.target.value)}
                  />
                </div>
              </div>
              {formError && (
                <p role="alert" className="text-sm text-destructive">
                  {formError}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Esta memória pertence somente ao seu Universe.
              </p>
              <div className="flex gap-2">
                <Button size="sm" disabled={createMutation.isPending} onClick={submit}>
                  {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Salvar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
              Adicionar memória
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={reconcileMutation.isPending}
            onClick={() =>
              reconcileMutation.mutate(undefined, {
                onSuccess: (result) =>
                  setNotice(
                    `Reconciliação concluída: ${result.reconcile.memories.created} nova(s), ${result.reconcile.memories.invalidated} invalidada(s).`,
                  ),
              })
            }
          >
            {reconcileMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Reconciliar com os fatos do Universe
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function PilotEvolutionCard({ characterId }: { characterId: string }) {
  const previewMutation = usePreviewPilotEvolution(characterId);
  const applyMutation = useApplyPilotEvolution(characterId);
  const [preview, setPreview] = useState<EvolutionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function runPreview() {
    setError(null);
    setNotice(null);
    previewMutation.mutate(undefined, {
      onSuccess: (result) => setPreview(result.preview),
      onError: (err) => setError(err instanceof Error ? err.message : "Falha ao pré-visualizar"),
    });
  }

  function apply() {
    if (!preview) return;
    setError(null);
    applyMutation.mutate(
      {
        expectedRevision: preview.evolutionRevision,
        expectedPendingFingerprint: preview.pendingFingerprint,
      },
      {
        onSuccess: (result) => {
          setNotice(
            result.evolution.applied
              ? `Evolução aplicada (revisão ${result.evolution.evolutionRevision}).`
              : "Sem mudanças pendentes.",
          );
          setPreview(null);
        },
        onError: (err) => {
          setError(
            err instanceof Error
              ? err.message
              : "Falha ao aplicar evolução",
          );
          setPreview(null);
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Evolução da persona</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Mudanças derivadas de experiências do Universe, determinísticas e auditáveis. Afeta
          somente este Universe; personalizações manuais têm precedência.
        </p>
        {notice && (
          <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {preview && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
            {preview.pendingCount === 0 && (preview.revertedEffects?.length ?? 0) === 0 ? (
              <p className="text-muted-foreground">Sem mudanças pendentes.</p>
            ) : (
              <ul className="space-y-2">
                {preview.traits.map((trait) => (
                  <li key={trait.key}>
                    <p className="font-semibold text-foreground">
                      {trait.label}: {percent(trait.beforeConfidence)} → {percent(trait.afterConfidence)}
                      {trait.skippedManual ? " (manual preservado)" : ""}
                    </p>
                    {trait.reasons.map((reason) => (
                      <p key={`${trait.key}-${reason.ruleCode}-${reason.experienceId}`} className="text-xs text-muted-foreground">
                        {reason.reason} · {reason.experienceTitle} ({reason.delta > 0 ? "+" : ""}
                        {reason.delta})
                      </p>
                    ))}
                    {trait.origin === "RULE_DERIVED" && (
                      <p className="text-xs text-muted-foreground">Valor derivado: {trait.value}</p>
                    )}
                  </li>
                ))}
                {(preview.revertedEffects ?? []).map((effect) => (
                  <li key={effect.id} className="text-xs text-muted-foreground">
                    Revoga ajuste: {effect.reason} ({effect.ruleCode})
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                disabled={
                  applyMutation.isPending ||
                  (preview.pendingCount === 0 && (preview.revertedEffects?.length ?? 0) === 0)
                }
                onClick={apply}
              >
                {applyMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Aplicar evolução
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
        <Button size="sm" variant="outline" disabled={previewMutation.isPending} onClick={runPreview}>
          {previewMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Pré-visualizar evolução
        </Button>
      </CardContent>
    </Card>
  );
}
