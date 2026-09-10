import { get } from "./api";

export const EXTERNAL_SOURCE = "jolpica";
export const EXTERNAL_SOURCE_NAME = "JOLPICA-F1";
export const EXTERNAL_SOURCE_REF = "api.jolpi.ca";

export type ExternalSeason = {
  id: string;
  year: number;
  name: string | null;
  status: string;
};

export type ExternalTeam = {
  id: string;
  externalId: string;
  name: string;
  shortName: string | null;
  color: string | null;
  lastSyncedAt: string | null;
};

export type ExternalDriver = {
  id: string;
  externalId: string;
  name: string;
  fullName: string | null;
  nationality: string | null;
  number: number | null;
  lastSyncedAt: string | null;
};

export type ExternalRace = {
  id: string;
  seasonYear: number;
  round: number;
  grandPrix: string | null;
  name: string | null;
  circuitName: string | null;
  date: string | null;
  status: string | null;
};

export type ExternalDriverSeason = {
  id: string;
  seasonYear: number;
  externalDriver: { externalId: string; name: string };
  teamExternalId: string | null;
  teamNameSnapshot: string | null;
  number: number | null;
  role: string | null;
};

export type ExternalResult = {
  id: string;
  externalRace: { seasonYear: number; round: number };
  externalDriver: { externalId: string; name: string };
  position: number | string | null;
  points: number | null;
  grid: number | null;
  fastestLap: boolean | null;
  status: string | null;
};

export type ExternalStanding = {
  id: string;
  seasonYear: number;
  externalDriver: { externalId: string; name: string };
  position: number | string | null;
  points: number | null;
  wins: number | null;
  podiums: number | null;
};

export type ExternalCandidatesListing = {
  external: { kind: string; source: string; label: string };
  currentBinding: {
    id: string;
    confidence: "SUGGESTED" | "CONFIRMED";
    targetLabel: string | null;
  } | null;
  candidates: { id: string; label: string; score: number }[];
};

type ItemsResponse<T> = { items: T[] };
type ListingResponse<T> = { listing: T };

const sourceQuery = `source=${EXTERNAL_SOURCE}`;

function yearQuery(year: number): string {
  return `${sourceQuery}&seasonYear=${year}`;
}

export function listExternalSeasons(): Promise<ExternalSeason[]> {
  return get<ItemsResponse<ExternalSeason>>(
    `/api/reconciliation/external/SEASON?${sourceQuery}`,
  ).then((r) => r.items);
}

export function listExternalTeams(): Promise<ExternalTeam[]> {
  return get<ItemsResponse<ExternalTeam>>(
    `/api/reconciliation/external/TEAM?${sourceQuery}`,
  ).then((r) => r.items);
}

export function listExternalDrivers(): Promise<ExternalDriver[]> {
  return get<ItemsResponse<ExternalDriver>>(
    `/api/reconciliation/external/DRIVER?${sourceQuery}`,
  ).then((r) => r.items);
}

export function listExternalDriverSeasons(
  year: number,
): Promise<ExternalDriverSeason[]> {
  return get<ItemsResponse<ExternalDriverSeason>>(
    `/api/reconciliation/external/DRIVER_SEASON?${yearQuery(year)}`,
  ).then((r) => r.items);
}

export function listExternalRaces(year: number): Promise<ExternalRace[]> {
  return get<ItemsResponse<ExternalRace>>(
    `/api/reconciliation/external/RACE?${yearQuery(year)}`,
  ).then((r) => r.items);
}

export function listExternalResults(year: number): Promise<ExternalResult[]> {
  return get<ItemsResponse<ExternalResult>>(
    `/api/reconciliation/external/RESULT?${yearQuery(year)}`,
  ).then((r) => r.items);
}

export function listExternalStandings(year: number): Promise<ExternalStanding[]> {
  return get<ItemsResponse<ExternalStanding>>(
    `/api/reconciliation/external/STANDING?${yearQuery(year)}`,
  ).then((r) => r.items);
}

export function listExternalCandidates(
  kind: string,
  externalId: string,
  seasonYear?: number,
): Promise<ExternalCandidatesListing> {
  const season = seasonYear != null ? `&seasonYear=${seasonYear}` : "";
  return get<ListingResponse<ExternalCandidatesListing>>(
    `/api/reconciliation/candidates/${kind}/${encodeURIComponent(externalId)}?${sourceQuery}${season}`,
  ).then((r) => r.listing);
}

export function formatExternalDate(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

export function formatExternalDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return `${value.slice(0, 10)} · ${value.slice(11, 16)} UTC`;
}

export function positionSortKey(position: number | string | null): number {
  if (position == null) return Number.POSITIVE_INFINITY;
  const numeric = typeof position === "number" ? position : Number(position);
  return Number.isFinite(numeric) ? numeric : Number.POSITIVE_INFINITY;
}

const SEASON_STATUS_LABELS: Record<string, string> = {
  PRE_SEASON: "Pré-temporada",
  UPCOMING: "Próxima",
  ACTIVE: "Ativa",
  COMPLETED: "Concluída",
};

export function seasonStatusLabel(status: string): string {
  return SEASON_STATUS_LABELS[status] ?? status;
}

const DRIVER_ROLE_LABELS: Record<string, string> = {
  RESERVE: "Reserva",
  REPLACEMENT: "Substituto",
};

export function driverRoleLabel(role: string | null): string | null {
  if (!role) return null;
  return DRIVER_ROLE_LABELS[role] ?? role;
}