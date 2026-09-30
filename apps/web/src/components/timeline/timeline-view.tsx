"use client";

import { History, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

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
import { useRaces, useSeasons } from "@/hooks/use-championship";
import { useDrivers } from "@/hooks/use-driver-profiles";
import { useTeams } from "@/hooks/use-teams";
import {
  useDivergence,
  useTimeline,
  useTimelineEvent,
} from "@/hooks/use-timeline";
import {
  DIVERGENCE_LABELS,
  TIMELINE_KIND_LABELS,
  timelineKindLabel,
  type DivergenceClassification,
  type TimelineItem,
  type TimelineListFilters,
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

function classificationTone(
  classification: DivergenceClassification,
): BadgeTone {
  if (classification === "MATCH") return "success";
  if (classification === "DIVERGENT") return "warning";
  if (classification === "EXTERNAL_ONLY") return "brand";
  return "muted";
}

function formatWorldDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function EventRow({
  item,
  selected,
  onSelect,
}: {
  item: TimelineItem;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`w-full rounded-lg border px-4 py-3 text-left transition-colors motion-safe:transition-colors ${
          selected
            ? "border-brand bg-brand/5"
            : "border-border bg-card hover:bg-accent/40"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {formatWorldDate(item.worldDate)}
          </span>
          <Badge tone={item.isCorrection ? "brand" : "muted"}>
            {timelineKindLabel(item.kind)}
          </Badge>
          {item.isSuperseded && <Badge tone="muted">Substituído</Badge>}
          {item.isCorrection && !item.isSuperseded && (
            <Badge tone="success">Efetivo</Badge>
          )}
        </div>
        <p className="mt-1 text-sm font-medium text-foreground">{item.summary}</p>
        {item.race && (
          <p className="text-xs text-muted-foreground">
            {item.race.round != null ? `Rodada ${item.race.round} · ` : ""}
            {item.race.name}
          </p>
        )}
      </button>
    </li>
  );
}

function EventDetail({ eventId }: { eventId: string }) {
  const { data, isLoading, isError, error, refetch } = useTimelineEvent(eventId);

  if (isLoading) {
    return (
      <div className="flex justify-center py-6" role="status" aria-label="Carregando evento">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive" role="alert">
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

  const values = data.item.values
    ? Object.entries(data.item.values).filter(([, value]) => value !== null)
    : [];

  return (
    <div className="space-y-3">
      <dl className="space-y-2 text-sm">
        <div className="flex gap-2">
          <dt className="w-32 shrink-0 text-muted-foreground">Evento</dt>
          <dd className="font-medium text-foreground">{data.item.summary}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-32 shrink-0 text-muted-foreground">Tipo</dt>
          <dd>{timelineKindLabel(data.item.kind)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-32 shrink-0 text-muted-foreground">Data do mundo</dt>
          <dd>{formatWorldDate(data.item.worldDate)}</dd>
        </div>
        {data.item.season && (
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-muted-foreground">Temporada</dt>
            <dd>{data.item.season.year}</dd>
          </div>
        )}
        {data.item.driver && (
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-muted-foreground">Piloto</dt>
            <dd>{data.item.driver.name}</dd>
          </div>
        )}
        {values.length > 0 && (
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-muted-foreground">Valores</dt>
            <dd className="space-x-3">
              {values.map(([key, value]) => (
                <span key={key} className="text-foreground">
                  {key}: <span className="font-semibold">{String(value)}</span>
                </span>
              ))}
            </dd>
          </div>
        )}
      </dl>

      {data.supersedesChain.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Substitui
          </p>
          <ul className="mt-1 space-y-1 text-sm">
            {data.supersedesChain.map((item) => (
              <li key={item.id} className="text-muted-foreground">
                #{item.sequence} · {item.summary}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.supersededByChain.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Substituído por
          </p>
          <ul className="mt-1 space-y-1 text-sm">
            {data.supersededByChain.map((item) => (
              <li key={item.id} className="text-muted-foreground">
                #{item.sequence} · {item.summary}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DivergencePanel({ seasonId }: { seasonId: string }) {
  const { data, isLoading, isError, error } = useDivergence(seasonId);

  if (isLoading) {
    return (
      <div className="flex justify-center py-6" role="status" aria-label="Carregando divergência">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {error instanceof Error
          ? error.message
          : "Não foi possível carregar a divergência."}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Realidade externa × Universe (temporada {data.season.year}):{" "}
        {data.summary.match} alinhados, {data.summary.divergent} divergentes,{" "}
        {data.summary.universeOnly} somente no Universe,{" "}
        {data.summary.externalOnly} somente no externo.
      </p>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Corridas
        </p>
        <ul className="mt-2 divide-y divide-border">
          {data.races.map((race, index) => (
            <li
              key={`${race.raceId ?? race.externalRaceId ?? index}`}
              className="flex flex-wrap items-center gap-2 py-2 text-sm"
            >
              <Badge tone={classificationTone(race.classification)}>
                {DIVERGENCE_LABELS[race.classification]}
              </Badge>
              <span className="font-medium text-foreground">
                {race.round != null ? `R${race.round} · ` : ""}
                {race.name}
              </span>
              {race.fields.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  campos: {race.fields.join(", ")}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Resultados
        </p>
        <ul className="mt-2 divide-y divide-border">
          {data.results.map((result, index) => (
            <li
              key={`${result.raceId ?? "ext"}-${result.driverProfileId ?? result.driverName}-${index}`}
              className="flex flex-wrap items-center gap-2 py-2 text-sm"
            >
              <Badge tone={classificationTone(result.classification)}>
                {DIVERGENCE_LABELS[result.classification]}
              </Badge>
              <span className="font-medium text-foreground">{result.driverName}</span>
              <span className="text-muted-foreground">
                Universe: {result.position ?? "—"} · Externo:{" "}
                {result.externalPosition ?? "—"}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Campeonato
        </p>
        <ul className="mt-2 divide-y divide-border">
          {data.standings.map((standing, index) => (
            <li
              key={`${standing.driverProfileId ?? standing.driverName}-${index}`}
              className="flex flex-wrap items-center gap-2 py-2 text-sm"
            >
              <Badge tone={classificationTone(standing.classification)}>
                {DIVERGENCE_LABELS[standing.classification]}
              </Badge>
              <span className="font-medium text-foreground">
                {standing.driverName}
              </span>
              <span className="text-muted-foreground">
                Universe: {standing.position ?? "—"} · Externo:{" "}
                {standing.externalPosition ?? "—"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function TimelineView() {
  const seasonsQuery = useSeasons();
  const teamsQuery = useTeams();
  const driversQuery = useDrivers();

  const [seasonId, setSeasonId] = useState("");
  const [raceId, setRaceId] = useState("");
  const [driverProfileId, setDriverProfileId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [kind, setKind] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [correctionsOnly, setCorrectionsOnly] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [divergenceOn, setDivergenceOn] = useState(false);

  const racesQuery = useRaces(seasonId);

  useEffect(() => {
    setRaceId("");
    setDivergenceOn(false);
  }, [seasonId]);

  const filters = useMemo<TimelineListFilters>(
    () => ({
      ...(seasonId ? { seasonId } : {}),
      ...(raceId ? { raceId } : {}),
      ...(driverProfileId ? { driverProfileId } : {}),
      ...(teamId ? { teamId } : {}),
      ...(kind ? { kind } : {}),
      ...(from ? { from: `${from}T00:00:00.000Z` } : {}),
      ...(to ? { to: `${to}T23:59:59.999Z` } : {}),
      ...(correctionsOnly ? { correctionsOnly: true } : {}),
      limit: 50,
    }),
    [seasonId, raceId, driverProfileId, teamId, kind, from, to, correctionsOnly],
  );

  const timelineQuery = useTimeline(filters);

  const seasonOptions = (seasonsQuery.data ?? []).map((season) => ({
    value: season.id,
    label: String(season.year),
  }));
  const raceOptions = (racesQuery.data ?? []).map((race) => ({
    value: race.id,
    label: race.round != null ? `R${race.round} · ${race.name}` : race.name,
  }));
  const driverOptions = (driversQuery.data ?? []).map((driver) => ({
    value: driver.id,
    label: driver.character.name,
  }));
  const teamOptions = (teamsQuery.data ?? []).map((team) => ({
    value: team.id,
    label: team.name,
  }));
  const kindOptions = Object.entries(TIMELINE_KIND_LABELS).map(
    ([value, label]) => ({ value, label }),
  );

  const events = timelineQuery.data?.events ?? [];

  return (
    <div className="space-y-8">
      <section aria-label="Filtros da linha do tempo" className="space-y-4">
        <SectionHeading kicker="História" title="Linha do tempo" />
        <p className="text-xs text-muted-foreground">
          Esta é a história do seu universo. Divergências da realidade externa
          são informativas e nunca sobrescrevem o seu universo.
        </p>
        <div className="grid gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label id="timeline-season-label">Temporada</Label>
            <Select
              value={seasonId}
              onValueChange={setSeasonId}
              options={seasonOptions}
              placeholder="Todas"
            >
              <SelectTrigger aria-labelledby="timeline-season-label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label id="timeline-race-label">Corrida</Label>
            <Select
              value={raceId}
              onValueChange={setRaceId}
              options={raceOptions}
              placeholder="Todas"
            >
              <SelectTrigger aria-labelledby="timeline-race-label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label id="timeline-driver-label">Piloto</Label>
            <Select
              value={driverProfileId}
              onValueChange={setDriverProfileId}
              options={driverOptions}
              placeholder="Todos"
            >
              <SelectTrigger aria-labelledby="timeline-driver-label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label id="timeline-team-label">Equipe</Label>
            <Select
              value={teamId}
              onValueChange={setTeamId}
              options={teamOptions}
              placeholder="Todas"
            >
              <SelectTrigger aria-labelledby="timeline-team-label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label id="timeline-kind-label">Tipo</Label>
            <Select
              value={kind}
              onValueChange={setKind}
              options={kindOptions}
              placeholder="Todos"
            >
              <SelectTrigger aria-labelledby="timeline-kind-label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="timeline-from">De</Label>
            <Input
              id="timeline-from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="timeline-to">Até</Label>
            <Input
              id="timeline-to"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
          <div className="flex items-end gap-2 pb-1">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={correctionsOnly}
                onChange={(event) => setCorrectionsOnly(event.target.checked)}
              />
              Somente correções
            </label>
          </div>
        </div>
        {seasonId && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDivergenceOn(true)}
            >
              <History className="mr-2 h-4 w-4" />
              Verificar divergência externa
            </Button>
          </div>
        )}
      </section>

      {divergenceOn && seasonId && (
        <section
          aria-label="Divergência externa"
          className="space-y-3 rounded-xl border border-border bg-card p-5"
        >
          <SectionHeading kicker="Externo" title="Divergência externa" />
          <DivergencePanel seasonId={seasonId} />
        </section>
      )}

      <section aria-label="Eventos da linha do tempo" className="space-y-3">
        <SectionHeading kicker="Eventos" title="Histórico" />
        {timelineQuery.isLoading ? (
          <div
            className="flex justify-center py-10"
            role="status"
            aria-label="Carregando linha do tempo"
          >
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : timelineQuery.isError ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive" role="alert">
              {timelineQuery.error instanceof Error
                ? timelineQuery.error.message
                : "Não foi possível carregar a linha do tempo."}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void timelineQuery.refetch()}
            >
              Tentar novamente
            </Button>
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            kicker="Linha do tempo"
            title="Nenhum evento encontrado"
            description="Ajuste os filtros ou avance a temporada para registrar acontecimentos."
          />
        ) : (
          <>
            <ol className="space-y-2">
              {events.map((item) => (
                <EventRow
                  key={item.id}
                  item={item}
                  selected={selectedEventId === item.id}
                  onSelect={() => setSelectedEventId(item.id)}
                />
              ))}
            </ol>
            {timelineQuery.data?.hasMore && (
              <p className="text-xs text-muted-foreground">
                Há mais eventos no histórico; refine os filtros para uma janela
                menor.
              </p>
            )}
          </>
        )}
      </section>

      {selectedEventId && (
        <section
          aria-label="Detalhe do evento"
          className="space-y-3 rounded-xl border border-border bg-card p-5"
        >
          <SectionHeading kicker="Detalhe" title="Evento selecionado" />
          <EventDetail eventId={selectedEventId} />
        </section>
      )}
    </div>
  );
}
