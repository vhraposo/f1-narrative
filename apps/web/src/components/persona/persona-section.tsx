"use client";

import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { SectionHeading } from "@/components/home/section-heading";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCreatePersonaEvidence,
  useDeletePersonaTrait,
  usePersona,
  useReviewPersonaEvidence,
  useUpdatePersona,
} from "@/hooks/use-persona";
import {
  PERSONA_EVIDENCE_ROLE_LABELS,
  PERSONA_EVIDENCE_STATUS_LABELS,
  PERSONA_EVIDENCE_TYPE_LABELS,
  PERSONA_TRAIT_KEYS,
  PERSONA_TRAIT_LABELS,
  personaEvidenceTypeLabel,
  personaTraitLabel,
  qualitativeConfidence,
  type CreatePersonaEvidenceInput,
  type PersonaEvidence,
  type PersonaEvidenceType,
  type PersonaTrait,
  type PersonaTraitKey,
} from "@/lib/persona";
import { useSession } from "@/providers/session-provider";

const PERSONA_NOTICE =
  "Persona representa tendências narrativas e comportamentais do personagem — não fatos objetivos, memórias ou resultados esportivos.";

const TEXTAREA_CLASSES =
  "flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const traitOptions = PERSONA_TRAIT_KEYS.map((key) => ({
  value: key,
  label: PERSONA_TRAIT_LABELS[key],
}));

const sourceTypeOptions = (
  Object.keys(PERSONA_EVIDENCE_TYPE_LABELS) as PersonaEvidenceType[]
).map((value) => ({ value, label: PERSONA_EVIDENCE_TYPE_LABELS[value] }));

type BadgeTone = "muted" | "brand" | "warning" | "danger" | "success";

function PersonaBadge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  const tones: Record<BadgeTone, string> = {
    muted: "border-border bg-muted text-muted-foreground",
    brand: "border-brand/40 bg-brand/10 text-brand",
    warning: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    danger:
      "border-destructive/40 bg-destructive/10 text-destructive",
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

function ErrorAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="text-sm text-destructive" role="alert">
      {message}
    </p>
  );
}

function TraitItem({
  trait,
  isBusy,
  onSave,
  onRemove,
}: {
  trait: PersonaTrait;
  isBusy: boolean;
  onSave: (value: string) => void;
  onRemove: () => void;
}) {
  const label = personaTraitLabel(trait.key);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(trait.value);
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </span>
          <PersonaBadge tone={trait.sourceKind === "MANUAL" ? "brand" : "muted"}>
            {trait.sourceKind === "MANUAL" ? "Manual" : "Baseada em evidência"}
          </PersonaBadge>
        </div>
        {editing ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              aria-label={`Valor de ${label}`}
              value={draft}
              maxLength={200}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={isBusy || draft.trim().length === 0}
                aria-label={`Salvar ${label}`}
                onClick={() => {
                  onSave(draft.trim());
                  setEditing(false);
                }}
              >
                Salvar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Cancelar edição de ${label}`}
                onClick={() => {
                  setDraft(trait.value);
                  setEditing(false);
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-line text-sm text-foreground/90">
            {trait.value}
          </p>
        )}
      </div>
      {!editing && (
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-label={`Editar ${label}`}
            onClick={() => {
              setDraft(trait.value);
              setEditing(true);
            }}
          >
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Editar
          </Button>
          {confirming ? (
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                size="sm"
                disabled={isBusy}
                aria-label={`Confirmar remoção de ${label}`}
                onClick={onRemove}
              >
                Confirmar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={isBusy}
                aria-label={`Cancelar remoção de ${label}`}
                onClick={() => setConfirming(false)}
              >
                Cancelar
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Remover ${label}`}
              onClick={() => setConfirming(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function EvidenceItem({
  evidence,
  manualPrecedence,
  isAdmin,
  isBusy,
  onReview,
}: {
  evidence: PersonaEvidence;
  manualPrecedence: boolean;
  isAdmin: boolean;
  isBusy: boolean;
  onReview: (status: "APPROVED" | "REJECTED") => void;
}) {
  const statusTone: BadgeTone =
    evidence.status === "APPROVED"
      ? "success"
      : evidence.status === "REJECTED"
        ? "danger"
        : "warning";

  return (
    <li className="space-y-2 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-foreground">
          {evidence.title}
        </span>
        <PersonaBadge tone={statusTone}>
          {PERSONA_EVIDENCE_STATUS_LABELS[evidence.status]}
        </PersonaBadge>
        {evidence.role && (
          <PersonaBadge tone={evidence.role === "CONFLICTING" ? "danger" : "muted"}>
            {PERSONA_EVIDENCE_ROLE_LABELS[evidence.role]}
          </PersonaBadge>
        )}
        {manualPrecedence && (
          <PersonaBadge tone="brand">Manual prevalece</PersonaBadge>
        )}
      </div>
      <p className="text-sm text-foreground/90">{evidence.proposedValue}</p>
      <p className="text-xs text-muted-foreground">
        {personaTraitLabel(evidence.traitKey)} ·{" "}
        {personaEvidenceTypeLabel(evidence.sourceType)} · Confiança:{" "}
        {qualitativeConfidence(evidence.confidence)}
      </p>
      <p className="text-xs text-muted-foreground">{evidence.excerpt}</p>
      {evidence.url && (
        <a
          href={evidence.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-brand underline-offset-4 hover:underline"
        >
          Fonte
        </a>
      )}
      {isAdmin && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy || evidence.status === "APPROVED"}
            aria-label={`Aprovar evidência ${evidence.title}`}
            onClick={() => onReview("APPROVED")}
          >
            Aprovar
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy || evidence.status === "REJECTED"}
            aria-label={`Rejeitar evidência ${evidence.title}`}
            onClick={() => onReview("REJECTED")}
          >
            Rejeitar
          </Button>
        </div>
      )}
    </li>
  );
}

function EvidenceForm({
  isSubmitting,
  error,
  onSubmit,
  onCancel,
}: {
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (input: CreatePersonaEvidenceInput) => void;
  onCancel: () => void;
}) {
  const [traitKey, setTraitKey] = useState<PersonaTraitKey>("humor");
  const [proposedValue, setProposedValue] = useState("");
  const [sourceType, setSourceType] = useState<PersonaEvidenceType>("INTERVIEW");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [publishedAt, setPublishedAt] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [confidence, setConfidence] = useState("0.7");

  const parsedConfidence = Number.parseFloat(confidence);
  const canSubmit =
    proposedValue.trim().length > 0 &&
    title.trim().length > 0 &&
    excerpt.trim().length > 0 &&
    Number.isFinite(parsedConfidence) &&
    parsedConfidence >= 0 &&
    parsedConfidence <= 1;

  return (
    <form
      className="space-y-4 rounded-xl border border-border bg-card p-5"
      aria-label="Adicionar evidência"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        onSubmit({
          traitKey,
          proposedValue: proposedValue.trim(),
          sourceType,
          title: title.trim(),
          url: url.trim().length > 0 ? url.trim() : null,
          publishedAt: publishedAt.trim().length > 0 ? publishedAt : null,
          excerpt: excerpt.trim(),
          confidence: parsedConfidence,
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label id="evidence-trait-label">Trait</Label>
          <Select
            value={traitKey}
            onValueChange={(value) => setTraitKey(value as PersonaTraitKey)}
            options={traitOptions}
          >
            <SelectTrigger aria-labelledby="evidence-trait-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label id="evidence-source-label">Tipo da fonte</Label>
          <Select
            value={sourceType}
            onValueChange={(value) => setSourceType(value as PersonaEvidenceType)}
            options={sourceTypeOptions}
          >
            <SelectTrigger aria-labelledby="evidence-source-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="evidence-proposed-value">Valor proposto</Label>
        <Input
          id="evidence-proposed-value"
          value={proposedValue}
          maxLength={200}
          onChange={(event) => setProposedValue(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="evidence-title">Título</Label>
        <Input
          id="evidence-title"
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="evidence-url">URL</Label>
          <Input
            id="evidence-url"
            type="url"
            value={url}
            maxLength={2048}
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="evidence-published-at">Data de publicação</Label>
          <Input
            id="evidence-published-at"
            type="date"
            value={publishedAt}
            onChange={(event) => setPublishedAt(event.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="evidence-excerpt">Trecho</Label>
        <textarea
          id="evidence-excerpt"
          className={TEXTAREA_CLASSES}
          value={excerpt}
          maxLength={500}
          onChange={(event) => setExcerpt(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="evidence-confidence">Confiança (0 a 1)</Label>
        <Input
          id="evidence-confidence"
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={confidence}
          onChange={(event) => setConfidence(event.target.value)}
        />
      </div>
      <ErrorAlert message={error} />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={isSubmitting || !canSubmit}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Adicionar evidência
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isSubmitting}
          onClick={onCancel}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}

export function PersonaSection({
  characterId,
  characterName,
  showEvidence = false,
}: {
  characterId: string;
  characterName: string;
  showEvidence?: boolean;
}) {
  const { data: session } = useSession();
  const isAdmin = session.user?.role === "ADMIN";

  const { data: persona, isLoading, isError, error, refetch } =
    usePersona(characterId);
  const updateMutation = useUpdatePersona(characterId);
  const deleteMutation = useDeletePersonaTrait(characterId);
  const evidenceMutation = useCreatePersonaEvidence(characterId);
  const reviewMutation = useReviewPersonaEvidence(characterId);

  const [actionError, setActionError] = useState<string | null>(null);
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [newTraitKey, setNewTraitKey] = useState<PersonaTraitKey>("humor");
  const [newTraitValue, setNewTraitValue] = useState("");
  const [showEvidenceForm, setShowEvidenceForm] = useState(false);

  function showActionError(err: unknown) {
    setActionError(
      err instanceof Error ? err.message : "Não foi possível concluir a ação.",
    );
  }

  const section = (children: ReactNode) => (
    <section aria-label={`Persona de ${characterName}`} className="space-y-3">
      <SectionHeading kicker="Narrativa" title="Persona" />
      {children}
    </section>
  );

  if (isLoading) {
    return section(
      <div
        role="status"
        aria-label="Carregando persona"
        className="flex justify-center py-8"
      >
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>,
    );
  }

  if (isError || !persona) {
    return section(
      <div className="space-y-3">
        <ErrorAlert
          message={
            error instanceof Error
              ? error.message
              : "Não foi possível carregar a persona."
          }
        />
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Tentar novamente
        </Button>
      </div>,
    );
  }

  function saveSummary() {
    const value = summaryDraft.trim();
    if (value.length === 0) return;
    setActionError(null);
    updateMutation.mutate(
      { summary: value },
      {
        onSuccess: () => setEditingSummary(false),
        onError: showActionError,
      },
    );
  }

  function clearSummary() {
    setActionError(null);
    updateMutation.mutate(
      { summary: null },
      { onError: showActionError },
    );
  }

  function addTrait() {
    const value = newTraitValue.trim();
    if (value.length === 0) return;
    setActionError(null);
    updateMutation.mutate(
      { traits: [{ key: newTraitKey, value }] },
      {
        onSuccess: () => setNewTraitValue(""),
        onError: showActionError,
      },
    );
  }

  function saveTraitValue(key: string, value: string) {
    setActionError(null);
    updateMutation.mutate(
      { traits: [{ key: key as PersonaTraitKey, value }] },
      { onError: showActionError },
    );
  }

  function removeTrait(key: string) {
    setActionError(null);
    deleteMutation.mutate(key, { onError: showActionError });
  }

  const summaryEditor = (
    <div className="space-y-2 rounded-xl border border-border bg-card p-5">
      <Label htmlFor="persona-summary">Resumo da persona</Label>
      <textarea
        id="persona-summary"
        className={TEXTAREA_CLASSES}
        value={summaryDraft}
        maxLength={2000}
        onChange={(event) => setSummaryDraft(event.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={updateMutation.isPending || summaryDraft.trim().length === 0}
          onClick={saveSummary}
        >
          {updateMutation.isPending && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Salvar resumo
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={updateMutation.isPending}
          onClick={() => {
            setEditingSummary(false);
            setActionError(null);
          }}
        >
          Cancelar
        </Button>
      </div>
    </div>
  );

  if (!persona.exists) {
    return section(
      <>
        <p className="text-xs text-muted-foreground">{PERSONA_NOTICE}</p>
        <ErrorAlert message={actionError} />
        {editingSummary ? (
          summaryEditor
        ) : (
          <EmptyState
            kicker="Persona"
            title="Nenhuma persona registrada"
            description="Registre como este personagem tende a falar, reagir e se comportar nas conversas."
            action={
              <Button
                size="sm"
                onClick={() => {
                  setSummaryDraft("");
                  setEditingSummary(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Criar persona
              </Button>
            }
          />
        )}
      </>,
    );
  }

  const manualTraitKeys = new Set(
    persona.traits
      .filter((trait) => trait.sourceKind === "MANUAL")
      .map((trait) => trait.key),
  );

  return section(
    <>
      <p className="text-xs text-muted-foreground">{PERSONA_NOTICE}</p>
      <ErrorAlert message={actionError} />

      <div className="space-y-3 rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Resumo
            </p>
            {persona.summary ? (
              <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
                {persona.summary}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhum resumo registrado.
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSummaryDraft(persona.summary ?? "");
                setEditingSummary(true);
              }}
            >
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Editar resumo
            </Button>
            {persona.summary && (
              <Button
                variant="ghost"
                size="sm"
                disabled={updateMutation.isPending}
                onClick={clearSummary}
              >
                Limpar resumo
              </Button>
            )}
          </div>
        </div>
        {editingSummary && summaryEditor}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Traits
        </p>
        {persona.traits.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Nenhum trait registrado. Traits descrevem tendências de comportamento.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {persona.traits.map((trait) => (
              <TraitItem
                key={trait.key}
                trait={trait}
                isBusy={updateMutation.isPending || deleteMutation.isPending}
                onSave={(value) => saveTraitValue(trait.key, value)}
                onRemove={() => removeTrait(trait.key)}
              />
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-end">
          <div className="w-full space-y-1.5 sm:max-w-56">
            <Label id="new-trait-label">Trait</Label>
            <Select
              value={newTraitKey}
              onValueChange={(value) => setNewTraitKey(value as PersonaTraitKey)}
              options={traitOptions}
            >
              <SelectTrigger aria-labelledby="new-trait-label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>
          <div className="w-full space-y-1.5">
            <Label htmlFor="new-trait-value">Valor do trait</Label>
            <Input
              id="new-trait-value"
              value={newTraitValue}
              maxLength={200}
              onChange={(event) => setNewTraitValue(event.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={updateMutation.isPending || newTraitValue.trim().length === 0}
            onClick={addTrait}
          >
            <Plus className="mr-2 h-4 w-4" />
            Adicionar trait
          </Button>
        </div>
      </div>

      {showEvidence && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Evidências
              </p>
              <p className="text-xs text-muted-foreground">
                Fontes registradas sustentam traits baseados em evidência. A
                revisão é feita por administradores.
              </p>
            </div>
            {!showEvidenceForm && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowEvidenceForm(true)}
              >
                <Plus className="mr-2 h-4 w-4" />
                Adicionar evidência
              </Button>
            )}
          </div>

          {showEvidenceForm && (
            <EvidenceForm
              isSubmitting={evidenceMutation.isPending}
              error={actionError}
              onCancel={() => {
                setShowEvidenceForm(false);
                setActionError(null);
              }}
              onSubmit={(input) => {
                setActionError(null);
                evidenceMutation.mutate(input, {
                  onSuccess: () => setShowEvidenceForm(false),
                  onError: showActionError,
                });
              }}
            />
          )}

          {persona.evidences.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma evidência registrada.
            </p>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {persona.evidences.map((evidence) => (
                <EvidenceItem
                  key={evidence.id}
                  evidence={evidence}
                  manualPrecedence={
                    evidence.status === "APPROVED" &&
                    manualTraitKeys.has(evidence.traitKey)
                  }
                  isAdmin={isAdmin}
                  isBusy={reviewMutation.isPending}
                  onReview={(status) => {
                    setActionError(null);
                    reviewMutation.mutate(
                      { evidenceId: evidence.id, input: { status } },
                      { onError: showActionError },
                    );
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </>,
  );
}
