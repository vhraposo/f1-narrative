"use client";

import { Loader2, MapPin, Search } from "lucide-react";
import { useState } from "react";

import { SectionHeading } from "@/components/home/section-heading";
import {
  ExternalSectionEmpty,
  ExternalSectionError,
  ExternalSectionLoading,
} from "@/components/external/external-section-state";
import { ExternalSourceBadge } from "@/components/external/external-source-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { API_BASE } from "@/lib/api";
import {
  useExternalCircuitDetail,
  useExternalCircuits,
} from "@/hooks/use-external-circuits";
import {
  localizeCountryPtBr,
} from "@/lib/nationality-pt-br";
import type {
  ExternalCircuitDetail,
  ExternalCircuitListItem,
} from "@/lib/external-circuits";

function formatLength(lengthMeters: number | null): string {
  if (lengthMeters === null) return "Não informado.";
  return `${(lengthMeters / 1000).toLocaleString("pt-BR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })} km`;
}

const CIRCUIT_TYPE_LABELS: Record<string, string> = {
  RACE: "Circuito permanente",
  STREET: "Circuito de rua",
  ROAD: "Circuito de estrada",
};

const DIRECTION_LABELS: Record<string, string> = {
  CLOCKWISE: "Horário",
  ANTI_CLOCKWISE: "Anti-horário",
};

function CircuitCard({
  circuit,
  onSelect,
}: {
  circuit: ExternalCircuitListItem;
  onSelect: (id: string) => void;
}) {
  const country = circuit.country
    ? (localizeCountryPtBr(circuit.country) ?? circuit.country)
    : null;
  return (
    <button
      type="button"
      onClick={() => onSelect(circuit.id)}
      aria-label={`Abrir circuito ${circuit.name}`}
      className="text-left"
    >
      <Card className="h-full transition-colors hover:border-brand/50">
        <CardContent className="space-y-1.5 pt-6">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 flex-1 truncate text-base font-bold tracking-tight text-foreground">
              {circuit.name}
            </h3>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {circuit.raceCount} GP{circuit.raceCount === 1 ? "" : "s"}
            </span>
          </div>
          <p className="flex items-center gap-1 truncate text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {[country, circuit.locality].filter(Boolean).join(" · ") ||
              "Localização não informada"}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatLength(circuit.lengthMeters)}
            {circuit.turns !== null ? ` · ${circuit.turns} curvas` : ""}
            {circuit.firstRaceYear !== null
              ? ` · 1º GP de F1 em ${circuit.firstRaceYear}`
              : ""}
          </p>
        </CardContent>
      </Card>
    </button>
  );
}

function CircuitDetailPanel({ circuitId }: { circuitId: string }) {
  const detailQuery = useExternalCircuitDetail(circuitId);
  if (detailQuery.isLoading) return <ExternalSectionLoading />;
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <ExternalSectionError
        description="Não foi possível carregar o circuito."
        refetching={detailQuery.isRefetching}
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }
  const circuit: ExternalCircuitDetail = detailQuery.data;
  const country = circuit.country
    ? (localizeCountryPtBr(circuit.country) ?? circuit.country)
    : null;
  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div>
          <h3 className="text-xl font-black tracking-tight text-foreground">
            {circuit.name}
          </h3>
          {circuit.fullName && circuit.fullName !== circuit.name ? (
            <p className="text-sm font-semibold text-muted-foreground">
              {circuit.fullName}
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            {[country, circuit.locality].filter(Boolean).join(" · ") ||
              "Localização não informada"}
          </p>
          <p className="text-xs text-muted-foreground">
            Fonte do traçado/dados técnicos: {circuit.provenance.source}
            {circuit.provenance.sourceVersion
              ? ` · versão ${circuit.provenance.sourceVersion}`
              : ""}
          </p>
        </div>

        {circuit.media.photo ? (
          <figure className="space-y-1">
            <img
              src={circuit.media.photo.url}
              alt={`Foto do circuito ${circuit.name}`}
              className="h-48 w-full rounded-lg border border-border object-cover"
            />
            <figcaption className="text-xs text-muted-foreground">
              Foto: {circuit.media.photo.author ?? circuit.media.photo.source} ·{" "}
              {circuit.media.photo.license}
              {circuit.media.photo.licenseUrl ? (
                <>
                  {" "}
                  ·{" "}
                  <a
                    className="font-semibold text-brand underline-offset-4 hover:underline"
                    href={circuit.media.photo.licenseUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    licença
                  </a>
                </>
              ) : null}
            </figcaption>
          </figure>
        ) : (
          <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            Foto real licenciada não disponível para este circuito (nenhuma fonte
            de mídia licenciada configurada).
          </p>
        )}

        {circuit.media.layout.available && circuit.media.layout.url ? (
          <figure className="space-y-1 rounded-lg border border-border bg-white p-3">
            <img
              src={`${API_BASE}${circuit.media.layout.url}`}
              alt={`Layout do circuito ${circuit.name}`}
              className="mx-auto h-44 w-full max-w-sm object-contain"
            />
            <figcaption className="text-center text-xs text-muted-foreground">
              Layout: {circuit.media.layout.attribution ?? circuit.media.layout.source}
              {circuit.media.layout.key ? ` · ${circuit.media.layout.key}` : ""}
            </figcaption>
          </figure>
        ) : (
          <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            Layout não disponível: nenhum asset licenciado (f1-circuits-svg/F1DB)
            resolveu este circuito neste ambiente.
          </p>
        )}

        <dl className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["País", country ?? "Não informado."],
              ["Cidade", circuit.locality ?? "Não informado."],
              ["Extensão", formatLength(circuit.lengthMeters)],
              ["Curvas", circuit.turns !== null ? String(circuit.turns) : "Não informado."],
              [
                "Tipo",
                circuit.type
                  ? (CIRCUIT_TYPE_LABELS[circuit.type] ?? circuit.type)
                  : "Não informado.",
              ],
              [
                "Direção",
                circuit.direction
                  ? (DIRECTION_LABELS[circuit.direction] ?? circuit.direction)
                  : "Não informado.",
              ],
              [
                "Primeiro GP de F1",
                circuit.firstRaceYear !== null
                  ? String(circuit.firstRaceYear)
                  : "Não informado.",
              ],
              [
                "Última utilização",
                circuit.lastRaceYear !== null
                  ? String(circuit.lastRaceYear)
                  : "Não informado.",
              ],
              [
                "Aparições",
                circuit.raceCount > 0
                  ? `${circuit.raceCount} corrida${circuit.raceCount === 1 ? "" : "s"}`
                  : "Não informado.",
              ],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border p-3">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {label}
              </dt>
              <dd className="mt-1 text-sm font-semibold text-foreground">{value}</dd>
            </div>
          ))}
        </dl>

        {circuit.layouts.length > 1 ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Traçados históricos
            </p>
            <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
              {circuit.layouts.map((layout) => (
                <li key={layout.id} className="flex items-center justify-between gap-3">
                  <span>{layout.id}</span>
                  <span className="text-xs">
                    {formatLength(layout.lengthMeters)}
                    {layout.turns !== null ? ` · ${layout.turns} curvas` : ""}
                    {layout.effective ? " · vigente" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Maiores vencedores
            </p>
            {circuit.topWinners.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Nenhuma vitória registrada no espelho para este circuito.
              </p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {circuit.topWinners.map((winner) => (
                  <li key={winner.externalDriverId} className="flex items-center justify-between gap-3">
                    <span className="truncate text-foreground">{winner.name}</span>
                    <span className="font-semibold tabular-nums text-muted-foreground">
                      {winner.wins} vitória{winner.wins === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Vencedores recentes
            </p>
            {circuit.recentWinners.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Nenhuma corrida finalizada registrada no espelho.
              </p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {circuit.recentWinners.map((winner) => (
                  <li key={winner.externalRaceId} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-foreground">
                      {winner.driverName}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {winner.seasonYear}
                      {winner.raceName ? ` · ${winner.raceName}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-1 text-sm">
          <p>
            <span className="text-muted-foreground">Volta mais rápida em corrida (fonte): </span>
            {circuit.fastestRaceLap ? (
              <span className="font-semibold text-foreground">
                {circuit.fastestRaceLap.driverName} · {circuit.fastestRaceLap.time} ·{" "}
                {circuit.fastestRaceLap.seasonYear}
              </span>
            ) : (
              <span className="text-muted-foreground">Não informado.</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            Recorder oficial de volta: não informado por fonte disponível (o
            espelho não traz o recorde oficial homologado do circuito).
          </p>
        </div>

        {circuit.sourceUrl && (
          <a
            className="inline-block text-sm font-semibold text-brand underline-offset-4 hover:underline"
            href={circuit.sourceUrl}
            rel="noreferrer"
            target="_blank"
          >
            Abrir referência da fonte ({circuit.source})
          </a>
        )}
      </CardContent>
    </Card>
  );
}

export function ExternalCircuitsCatalog() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listQuery = useExternalCircuits(search);

  return (
    <section aria-label="Catálogo de circuitos" className="space-y-4">
      <SectionHeading
        kicker="Dados Externos"
        title="Circuitos"
        action={<ExternalSourceBadge />}
      />

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(searchInput.trim());
          setSelectedId(null);
        }}
      >
        <label className="sr-only" htmlFor="circuit-search">
          Buscar circuito
        </label>
        <Input
          id="circuit-search"
          className="max-w-sm"
          placeholder="Buscar por nome, país ou cidade"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />
        <Button type="submit" variant="outline" size="sm">
          <Search className="mr-2 h-4 w-4" />
          Buscar
        </Button>
        {search.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchInput("");
              setSearch("");
              setSelectedId(null);
            }}
          >
            Limpar
          </Button>
        )}
      </form>

      {listQuery.isLoading && <ExternalSectionLoading />}
      {listQuery.isError && (
        <ExternalSectionError
          description="Não foi possível carregar o catálogo de circuitos."
          refetching={listQuery.isRefetching}
          onRetry={() => void listQuery.refetch()}
        />
      )}
      {!listQuery.isLoading && !listQuery.isError && (listQuery.data?.total ?? 0) === 0 && (
        <ExternalSectionEmpty
          title="Nenhum circuito encontrado no espelho."
          description="O catálogo é preenchido pela sincronização externa (Jolpica/F1DB). Nada é inventado quando a fonte não possui o dado."
        />
      )}
      {!listQuery.isLoading &&
        !listQuery.isError &&
        (listQuery.data?.circuits.length ?? 0) > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {listQuery.data!.circuits.map((circuit) => (
              <CircuitCard
                key={circuit.id}
                circuit={circuit}
                onSelect={(id) => setSelectedId(id)}
              />
            ))}
          </div>
        )}

      {selectedId && (
        <section aria-label="Detalhe do circuito" className="space-y-2">
          <div className="flex items-center justify-between">
            <SectionHeading kicker="Circuito" title="Detalhe" />
            <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
              Fechar detalhe
            </Button>
          </div>
          <CircuitDetailPanel circuitId={selectedId} />
        </section>
      )}

      {listQuery.isFetching && !listQuery.isLoading && (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Atualizando catálogo…
        </p>
      )}
    </section>
  );
}

