"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreateUniverseRelationship,
  useDeleteUniverseRelationship,
  usePilotKnowledge,
  useRestorePilotBiography,
  useUpdatePilotBiography,
} from "@/hooks/use-pilot-knowledge";
import { localizeNationalityPtBr } from "@/lib/nationality-pt-br";
import {
  PILOT_CLASSIFICATION_LABELS,
  PILOT_ORIGIN_LABELS,
  PILOT_RELATIONSHIP_STATE_LABELS,
  type PilotKnowledgeView,
  type PilotRelationshipEntryView,
} from "@/lib/pilot-knowledge";

export type PilotKnowledgeSectionKind =
  | "overview"
  | "persona"
  | "history"
  | "relationships";

const UNAVAILABLE_TEXT: Record<string, string> = {
  CHARACTER_NOT_FOUND: "Personagem não encontrado.",
  NO_DRIVER_PROFILE: "Este personagem não é um piloto.",
  NO_EXTERNAL_BINDING:
    "Este piloto ainda não possui vínculo externo — nenhuma informação pública disponível.",
  NO_EXTERNAL_PROFILE:
    "Nenhuma informação pública sincronizada para este piloto ainda.",
};

const NO_DATA_TEXT = "Não informado.";

function Badge({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "brand" | "success" | "warning" | "danger";
}) {
  const tones = {
    muted: "border-border bg-muted text-muted-foreground",
    brand: "border-brand/40 bg-brand/10 text-brand",
    success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    warning: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    danger: "border-destructive/40 bg-destructive/10 text-destructive",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function OriginBadge({ origin }: { origin: "UNIVERSE" | "EXTERNAL" }) {
  return origin === "UNIVERSE" ? (
    <Badge tone="brand">{PILOT_ORIGIN_LABELS.UNIVERSE}</Badge>
  ) : (
    <Badge>{PILOT_ORIGIN_LABELS.EXTERNAL}</Badge>
  );
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function formatPeriod(validFrom: string | null, validTo: string | null): string {
  const start = validFrom ? formatDate(validFrom) : "—";
  const end = validTo ? formatDate(validTo) : "sem data final conhecida";
  return `${start} – ${end}`;
}

function PilotUnavailable({
  reason,
  sync,
}: {
  reason: string;
  sync?: { providersConfigured: boolean; lastStatus: string | null };
}) {
  return (
    <div className="space-y-1 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
      <p>{UNAVAILABLE_TEXT[reason] ?? "Informação pública indisponível para este piloto."}</p>
      {reason === "NO_EXTERNAL_PROFILE" && (
        <p className="text-xs">
          {sync?.providersConfigured
            ? "Use Sincronizar para buscar dados públicos deste piloto."
            : "Nenhum provider externo está configurado neste ambiente; dados do espelho interno são provisionados ao abrir o piloto."}
          {sync?.lastStatus === "FAILED" && " A última sincronização falhou."}
        </p>
      )}
    </div>
  );
}

function BiographyCard({
  characterId,
  pilot,
}: {
  characterId: string;
  pilot: Extract<PilotKnowledgeView, { available: true }>;
}) {
  const biography = pilot.profile.biography;
  const refresh = pilot.profile.refresh;
  const updateMutation = useUpdatePilotBiography(characterId);
  const restoreMutation = useRestorePilotBiography(characterId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setDraft(biography.display ?? "");
    setError(null);
    setEditing(true);
  }

  function save() {
    const display = draft.trim();
    if (display.length === 0) {
      setError("Escreva a biografia antes de salvar.");
      return;
    }
    setError(null);
    updateMutation.mutate(display, {
      onSuccess: () => setEditing(false),
      onError: (err) => setError(err instanceof Error ? err.message : "Falha ao salvar"),
    });
  }

  function restore() {
    setError(null);
    restoreMutation.mutate(undefined, {
      onSuccess: () => setEditing(false),
      onError: (err) => setError(err instanceof Error ? err.message : "Falha ao restaurar"),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Biografia</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {editing ? (
          <div className="space-y-2">
            <Label htmlFor="pilot-biography">Biografia do Universe</Label>
            <Textarea
              id="pilot-biography"
              rows={5}
              maxLength={1200}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={updateMutation.isPending} onClick={save}>
                {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
              {biography.origin === "UNIVERSE" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={restoreMutation.isPending}
                  onClick={restore}
                >
                  {restoreMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Restaurar da fonte
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            {biography.display ? (
              <>
                <div className="space-y-3">
                  {biography.display
                    .split(/\n{2,}/)
                    .map((paragraph) => paragraph.trim())
                    .filter((paragraph) => paragraph.length > 0)
                    .map((paragraph, index) => (
                      <p
                        key={`bio-paragraph-${index}`}
                        className="text-sm leading-relaxed text-foreground"
                      >
                        {paragraph}
                      </p>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {biography.origin !== "NONE" && <OriginBadge origin={biography.origin} />}
                  {biography.origin === "EXTERNAL" && (
                    <span className="text-xs text-muted-foreground">
                      Última verificação: {formatDate(refresh.lastVerifiedAt)}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhuma informação pública confiável encontrada.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={startEditing}>
                Editar biografia
              </Button>
              {biography.origin === "UNIVERSE" && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={restoreMutation.isPending}
                  onClick={restore}
                >
                  Restaurar da fonte
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function OverviewPanel({
  characterId,
  pilot,
}: {
  characterId: string;
  pilot: Extract<PilotKnowledgeView, { available: true }>;
}) {
  const { profile, history } = pilot;
  const milestones = history.events
    .slice()
    .sort((a, b) => (b.seasonYear ?? 0) - (a.seasonYear ?? 0))
    .slice(0, 3);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Visão geral</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="divide-y divide-border text-sm">
            {[
              ["Nome público", profile.identity.publicName],
              ["Nome completo", profile.identity.fullName ?? NO_DATA_TEXT],
              [
                "Nascimento",
                profile.identity.dateOfBirth ? formatDate(profile.identity.dateOfBirth) : NO_DATA_TEXT,
              ],
              ["Local de nascimento", profile.identity.placeOfBirth ?? NO_DATA_TEXT],
              [
                "Nacionalidade",
                localizeNationalityPtBr(profile.identity.nationality) ?? NO_DATA_TEXT,
              ],
              [
                "Número",
                profile.identity.driverNumber !== null
                  ? `#${profile.identity.driverNumber}`
                  : NO_DATA_TEXT,
              ],
              ["Código", profile.identity.driverCode ?? NO_DATA_TEXT],
              ["Equipe atual (fonte)", profile.identity.currentTeamName ?? NO_DATA_TEXT],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-4 py-2 first:pt-0">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {label}
                </dt>
                <dd className="min-w-0 truncate text-right font-semibold text-foreground">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          {profile.identity.officialLinks?.website && (
            <a
              className="text-sm font-semibold text-brand underline-offset-4 hover:underline"
              href={profile.identity.officialLinks.website}
              rel="noreferrer"
              target="_blank"
            >
              Site oficial
            </a>
          )}
        </CardContent>
      </Card>

      <BiographyCard characterId={characterId} pilot={pilot} />

      <Card>
        <CardHeader>
          <CardTitle>Marcos principais</CardTitle>
        </CardHeader>
        <CardContent>
          {milestones.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum marco público confiável encontrado.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {milestones.map((event) => (
                <li key={event.id} className="flex items-baseline gap-3">
                  <span className="w-12 shrink-0 font-black tabular-nums text-foreground">
                    {event.seasonYear ?? "—"}
                  </span>
                  <span className="text-foreground">{event.title}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SourcesPanel({ pilot }: { pilot: Extract<PilotKnowledgeView, { available: true }> }) {
  if (pilot.sources.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fontes e licenças</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3 text-sm">
          {pilot.sources.map((source) => (
            <li key={source.id} className="rounded-lg border border-border p-3">
              <p className="font-semibold text-foreground">
                {source.title ?? source.provider}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {source.provider} · {source.sourceKind} · licença {source.license}
                {source.attributionText ? ` · ${source.attributionText}` : ""}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Publicado: {formatDate(source.publishedAt)} · Verificado: {formatDate(source.retrievedAt)}
                {source.sourceVersion ? ` · versão ${source.sourceVersion}` : ""}
              </p>
              {source.url && (
                <a
                  className="mt-1 inline-block text-xs font-semibold text-brand underline-offset-4 hover:underline"
                  href={source.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  Abrir fonte
                </a>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function PublicPersonaPanel({ pilot }: { pilot: Extract<PilotKnowledgeView, { available: true }> }) {
  const persona = pilot.persona;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Perfil público</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!persona.available ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma informação pública confiável encontrada.
            </p>
          ) : (
            <>
              {persona.summary && (
                <p className="text-sm leading-relaxed text-foreground">{persona.summary}</p>
              )}
              {persona.traits.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum traço público suportado por evidência até o momento.
                </p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {persona.traits.map((trait) => (
                    <li key={trait.traitKey} className="flex flex-wrap items-baseline gap-2 py-2 first:pt-0">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        {trait.label}
                      </span>
                      <span className="text-foreground">{trait.value}</span>
                      {trait.status === "CONFLICT" && <Badge tone="warning">Fontes em conflito</Badge>}
                      {trait.status === "UNCERTAIN" && <Badge>Pouco suportado</Badge>}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                Perfil observável publicamente. Verificado em {formatDate(persona.refresh.lastVerifiedAt)}.
                Personalizações do Universe têm precedência e aparecem na Persona acima.
              </p>
            </>
          )}
        </CardContent>
      </Card>
      <SourcesPanel pilot={pilot} />
    </div>
  );
}

function HistoryPanel({ pilot }: { pilot: Extract<PilotKnowledgeView, { available: true }> }) {
  const events = pilot.history.events
    .slice()
    .sort((a, b) => (b.seasonYear ?? 0) - (a.seasonYear ?? 0) || (b.importance - a.importance));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Histórico / Momentos relevantes</CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma informação pública confiável encontrada.
          </p>
        ) : (
          <ol className="space-y-3">
            {events.map((event) => (
              <li key={event.id} className="flex gap-4">
                <span className="w-14 shrink-0 text-lg font-black tabular-nums text-foreground">
                  {event.seasonYear ?? "—"}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{event.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {event.categoryLabel}
                    {event.raceName ? ` · ${event.raceName}` : ""}
                    {event.eventDate ? ` · ${formatDate(event.eventDate)}` : ""}
                  </p>
                  {event.summary && (
                    <p className="mt-1 text-sm text-muted-foreground">{event.summary}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function classificationTone(
  classification: PilotRelationshipEntryView["classification"],
): "success" | "warning" | "danger" | "muted" {
  if (classification === "MATCH") return "success";
  if (classification === "DIVERGENT") return "warning";
  if (classification === "CONFLICT") return "danger";
  return "muted";
}

const RELATIONSHIP_KIND_OPTIONS = [
  { value: "ROMANTIC_PARTNER", label: "Parceiro(a)" },
  { value: "SPOUSE", label: "Cônjuge" },
  { value: "PARENT", label: "Pai/Mãe" },
  { value: "CHILD", label: "Filho(a)" },
  { value: "SIBLING", label: "Irmão/Irmã" },
  { value: "TEAMMATE", label: "Companheiro de equipe" },
  { value: "MENTOR", label: "Mentor" },
  { value: "OTHER_PUBLIC_RELATION", label: "Outra relação pública" },
];

const RELATIONSHIP_STATE_OPTIONS = [
  { value: "ACTIVE", label: "Ativo" },
  { value: "ENDED", label: "Encerrado" },
  { value: "UNKNOWN", label: "Sem data" },
];

function RelationshipForm({
  characterId,
  onDone,
}: {
  characterId: string;
  onDone: () => void;
}) {
  const createMutation = useCreateUniverseRelationship(characterId);
  const [kind, setKind] = useState("ROMANTIC_PARTNER");
  const [displayName, setDisplayName] = useState("");
  const [state, setState] = useState<"ACTIVE" | "ENDED" | "UNKNOWN">("ACTIVE");
  const [validFrom, setValidFrom] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (displayName.trim().length === 0) {
      setError("Informe o nome da pessoa.");
      return;
    }
    setError(null);
    createMutation.mutate(
      {
        kind,
        targetType: "PUBLIC_PERSON",
        displayName: displayName.trim(),
        state,
        validFrom: validFrom.length > 0 ? new Date(`${validFrom}T00:00:00.000Z`).toISOString() : null,
      },
      {
        onSuccess: onDone,
        onError: (err) => setError(err instanceof Error ? err.message : "Falha ao salvar"),
      },
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-brand/40 bg-brand/5 p-3">
      <p className="text-sm font-semibold text-foreground">Personalizar relacionamento</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="pilot-relationship-kind">Tipo</Label>
          <Select
            value={kind}
            onValueChange={setKind}
            options={RELATIONSHIP_KIND_OPTIONS}
            className="block"
          >
            <SelectTrigger id="pilot-relationship-kind" aria-label="Tipo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pilot-relationship-name">Nome</Label>
          <Input
            id="pilot-relationship-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={120}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pilot-relationship-state">Situação</Label>
          <Select
            value={state}
            onValueChange={(value) => setState(value as typeof state)}
            options={RELATIONSHIP_STATE_OPTIONS}
            className="block"
          >
            <SelectTrigger id="pilot-relationship-state" aria-label="Situação">
              <SelectValue />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pilot-relationship-from">Início (opcional)</Label>
          <Input
            id="pilot-relationship-from"
            type="date"
            value={validFrom}
            onChange={(event) => setValidFrom(event.target.value)}
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={createMutation.isPending} onClick={submit}>
          {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Salvar
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function RelationshipsPanel({
  characterId,
  pilot,
}: {
  characterId: string;
  pilot: Extract<PilotKnowledgeView, { available: true }>;
}) {
  const deleteMutation = useDeleteUniverseRelationship(characterId);
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Relacionamentos públicos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {pilot.relationships.entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma informação pública confiável encontrada.
            </p>
          ) : (
            <ul className="space-y-4">
              {pilot.relationships.entries.map((entry) => {
                const overrideId =
                  entry.current?.origin === "UNIVERSE"
                    ? pilot.relationships.universeOverrides.find(
                        (override) =>
                          override.kind === entry.kind &&
                          override.displayName === entry.current?.displayName,
                      )?.id ?? null
                    : null;
                return (
                  <li key={entry.kind} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{entry.label}</p>
                      <Badge tone={classificationTone(entry.classification)}>
                        {PILOT_CLASSIFICATION_LABELS[entry.classification]}
                      </Badge>
                    </div>
                    {entry.current ? (
                      <p className="mt-2 text-sm text-foreground">
                        <span className="font-semibold">{entry.current.displayName}</span>{" "}
                        <span className="text-muted-foreground">
                          ({PILOT_RELATIONSHIP_STATE_LABELS[entry.current.state]}) ·{" "}
                          {formatPeriod(entry.current.validFrom, entry.current.validTo)}
                        </span>
                        {" "}
                        <OriginBadge origin={entry.current.origin} />
                      </p>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">Sem relação atual conhecida.</p>
                    )}
                    {entry.externalCurrent && entry.current?.origin === "UNIVERSE" && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Fonte externa atual: {entry.externalCurrent.displayName} (
                        {PILOT_RELATIONSHIP_STATE_LABELS[entry.externalCurrent.state]})
                      </p>
                    )}
                    {entry.history.length > 0 && (
                      <div className="mt-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          Histórico
                        </p>
                        <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                          {entry.history.map((history, index) => (
                            <li key={`${history.displayName}-${index}`}>
                              {history.displayName} ({PILOT_RELATIONSHIP_STATE_LABELS[history.state]}) ·{" "}
                              {formatPeriod(history.validFrom, history.validTo)} ·{" "}
                              {PILOT_ORIGIN_LABELS[history.origin]}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {overrideId && (
                      <Button
                        className="mt-2"
                        size="sm"
                        variant="ghost"
                        disabled={deleteMutation.isPending}
                        onClick={() =>
                          deleteMutation.mutate(overrideId, {
                            onSuccess: () => undefined,
                          })
                        }
                      >
                        Remover personalização
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {showForm ? (
            <RelationshipForm characterId={characterId} onDone={() => setShowForm(false)} />
          ) : (
            <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
              Personalizar relacionamento
            </Button>
          )}

          <p className="text-xs text-muted-foreground">
            Relacionamentos listados apenas quando há fonte pública confiável. O Universe pode
            divergir da fonte; personalizações são isoladas por Universe.
          </p>
        </CardContent>
      </Card>
      <SourcesPanel pilot={pilot} />
    </div>
  );
}

export function PilotKnowledgeSection({
  characterId,
  section,
}: {
  characterId: string;
  section: PilotKnowledgeSectionKind;
}) {
  const { data, isLoading, isError, error, refetch } = usePilotKnowledge(characterId);
  const [showRetry, setShowRetry] = useState(false);

  useEffect(() => {
    setShowRetry(false);
  }, [characterId, section]);

  if (isLoading) {
    return (
      <div role="status" aria-label="Carregando conhecimento do piloto" className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Não foi possível carregar o piloto."}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setShowRetry(true);
            void refetch();
          }}
        >
          Tentar novamente
        </Button>
        {showRetry && <p className="text-xs text-muted-foreground">Buscando novamente…</p>}
      </div>
    );
  }

  const pilot = data?.pilot as PilotKnowledgeView | undefined;
  if (!pilot || !pilot.available) {
    return (
      <PilotUnavailable
        reason={pilot?.reason ?? "NO_EXTERNAL_PROFILE"}
        sync={data?.sync}
      />
    );
  }

  if (section === "overview") return <OverviewPanel characterId={characterId} pilot={pilot} />;
  if (section === "persona") return <PublicPersonaPanel pilot={pilot} />;
  if (section === "history") return <HistoryPanel pilot={pilot} />;
  return <RelationshipsPanel characterId={characterId} pilot={pilot} />;
}
