import { get } from "./api";

export type TimelineItem = {
  id: string;
  sequence: number;
  worldDate: string;
  kind: string;
  causedBy: string | null;
  supersedesId: string | null;
  supersededById: string | null;
  isCorrection: boolean;
  isSuperseded: boolean;
  summary: string;
  race: { id: string; name: string; round: number | null } | null;
  season: { id: string; year: number; name: string | null } | null;
  driver: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  number: number | null;
  values: Record<string, string | number | null> | null;
};

export type TimelineEventDetail = {
  item: TimelineItem;
  supersedesChain: TimelineItem[];
  supersededByChain: TimelineItem[];
};

export type TimelineListResponse = {
  events: TimelineItem[];
  nextCursor: string | null;
  hasMore: boolean;
  beyondScanLimit: boolean;
};

export type TimelineListFilters = {
  seasonId?: string;
  from?: string;
  to?: string;
  driverProfileId?: string;
  teamId?: string;
  raceId?: string;
  kind?: string;
  correctionsOnly?: boolean;
  cursor?: string;
  limit?: number;
};

export const TIMELINE_KIND_LABELS: Record<string, string> = {
  WORLD_ADVANCED: "Avanço do mundo",
  RACE_SCHEDULED: "Corrida agendada",
  RACE_UPDATED: "Corrida atualizada",
  SESSION_COMPLETED: "Sessão concluída",
  ATTRIBUTE_EVOLVED: "Evolução aplicada",
  RACE_RESULT_CORRECTED: "Correção de resultado",
  RACE_SESSION_RESULT_CORRECTED: "Correção de sessão",
  STANDING_CORRECTED: "Correção de standing",
  NUMBER_CORRECTED: "Correção de número",
};

export function timelineKindLabel(kind: string): string {
  return TIMELINE_KIND_LABELS[kind] ?? kind;
}

export type DivergenceClassification =
  | "MATCH"
  | "DIVERGENT"
  | "NO_EXTERNAL"
  | "UNIVERSE_ONLY"
  | "EXTERNAL_ONLY";

export const DIVERGENCE_LABELS: Record<DivergenceClassification, string> = {
  MATCH: "Alinhado",
  DIVERGENT: "Divergente",
  NO_EXTERNAL: "Sem externo",
  UNIVERSE_ONLY: "Somente Universe",
  EXTERNAL_ONLY: "Somente externo",
};

export type DivergenceRaceItem = {
  classification: DivergenceClassification;
  raceId: string | null;
  externalRaceId: string | null;
  round: number | null;
  name: string;
  date: string | null;
  fields: string[];
};

export type DivergenceResultItem = {
  classification: DivergenceClassification;
  raceId: string | null;
  raceName: string | null;
  driverProfileId: string | null;
  driverName: string;
  position: number | null;
  externalPosition: number | null;
  grid: number | null;
  externalGrid: number | null;
  status: string | null;
  externalStatus: string | null;
  fields: string[];
};

export type DivergenceStandingItem = {
  classification: DivergenceClassification;
  driverProfileId: string | null;
  driverName: string;
  position: number | null;
  externalPosition: number | null;
  points: number | null;
  externalPoints: number | null;
  wins: number | null;
  externalWins: number | null;
  fields: string[];
};

export type DivergenceReport = {
  season: { id: string; year: number; name: string | null };
  races: DivergenceRaceItem[];
  results: DivergenceResultItem[];
  standings: DivergenceStandingItem[];
  summary: {
    match: number;
    divergent: number;
    noExternal: number;
    universeOnly: number;
    externalOnly: number;
  };
};

function buildQuery(filters: TimelineListFilters): string {
  const params = new URLSearchParams();
  if (filters.seasonId) params.set("seasonId", filters.seasonId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.driverProfileId) params.set("driverProfileId", filters.driverProfileId);
  if (filters.teamId) params.set("teamId", filters.teamId);
  if (filters.raceId) params.set("raceId", filters.raceId);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.correctionsOnly) params.set("correctionsOnly", "true");
  if (filters.cursor) params.set("cursor", filters.cursor);
  if (filters.limit) params.set("limit", String(filters.limit));
  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}

export function listTimeline(
  filters: TimelineListFilters = {},
): Promise<TimelineListResponse> {
  return get<TimelineListResponse>(`/api/timeline${buildQuery(filters)}`);
}

export function getTimelineEvent(eventId: string): Promise<TimelineEventDetail> {
  return get<TimelineEventDetail>(`/api/timeline/events/${eventId}`);
}

export function getDivergence(seasonId: string): Promise<DivergenceReport> {
  return get<{ divergence: DivergenceReport }>(
    `/api/timeline/divergence?seasonId=${seasonId}`,
  ).then((r) => r.divergence);
}
