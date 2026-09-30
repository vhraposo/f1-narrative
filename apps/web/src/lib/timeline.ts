import { get, post } from "./api";

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

export type TimelineEditorKind =
  | "RACE_RESULT"
  | "SPRINT"
  | "NUMBER"
  | "STANDING"
  | "RACE";

export type TimelineEditBlockedReason =
  | "NO_VISUAL_EDITOR"
  | "EVOLUTION_STALE"
  | "DERIVED_STANDING"
  | "RESULT_NOT_FOUND"
  | "DRIVER_NOT_IN_SEASON"
  | "RACE_NOT_FOUND"
  | "SEASON_NOT_FOUND"
  | "WORLD_STATE_MISSING";

export type TimelineEventEditModel = {
  editorKind: TimelineEditorKind | null;
  canEdit: boolean;
  blockedReason: TimelineEditBlockedReason | null;
  defaultWorldDate: string | null;
  suggestedSupersedesId: string | null;
  values: Record<string, string | number | null> | null;
  currentValues: Record<string, string | number | null> | null;
  narrativeStaleEventIds: string[];
};

export type TimelineEventDetail = {
  item: TimelineItem;
  supersedesChain: TimelineItem[];
  supersededByChain: TimelineItem[];
  edit: TimelineEventEditModel;
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
  PERSONA_UPDATED: "Persona atualizada",
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

export type RaceResultCorrectionCommand = {
  kind: "RACE_RESULT_CORRECTED";
  worldDate: string;
  raceId: string;
  driverProfileId: string;
  position?: number | null;
  grid?: number | null;
  status?: string | null;
  supersedesId?: string | null;
};

export type SprintCorrectionCommand = {
  kind: "RACE_SESSION_RESULT_CORRECTED";
  worldDate: string;
  raceId: string;
  driverProfileId: string;
  position?: number | null;
  status?: string | null;
  eligibility?: { neutralizedStart: boolean; distancePct: number } | null;
  supersedesId?: string | null;
};

export type NumberCorrectionCommand = {
  kind: "NUMBER_CORRECTED";
  worldDate: string;
  seasonId: string;
  driverProfileId: string;
  number: number | null;
  supersedesId?: string | null;
};

export type StandingCorrectionCommand = {
  kind: "STANDING_CORRECTED";
  worldDate: string;
  seasonId: string;
  driverProfileId: string;
  points?: number;
  wins?: number;
  podiums?: number;
  position?: number | null;
  supersedesId?: string | null;
};

export type CalendarCorrectionCommand = {
  kind: "RACE_UPDATED";
  worldDate: string;
  raceId: string;
  name?: string;
  date?: string | null;
  round?: number;
  status?: string;
  sprintOverride?: boolean | null;
  supersedesId?: string | null;
};

export type CorrectionCommand =
  | RaceResultCorrectionCommand
  | SprintCorrectionCommand
  | NumberCorrectionCommand
  | StandingCorrectionCommand
  | CalendarCorrectionCommand;

export type CorrectionPreview = {
  previewToken: string;
  kind: string;
  changes: Array<{
    area: "RESULT" | "STANDING" | "CHAMPION" | "NUMBER" | "CALENDAR";
    label: string;
    field: string;
    before: string | number | null;
    after: string | number | null;
  }>;
  championBefore: string | null;
  championAfter: string | null;
  narrativeStaleEventIds: string[];
  numberImpact: {
    seasonId: string;
    year: number;
    currentHolderId: string | null;
    expectedChampionId: string | null;
    requiresAction: boolean;
  } | null;
};

export function previewCorrection(
  command: CorrectionCommand,
): Promise<CorrectionPreview> {
  return post<{ preview: CorrectionPreview }>(
    "/api/timeline/corrections/preview",
    command,
  ).then((r) => r.preview);
}

export function applyCorrection(
  command: CorrectionCommand,
  previewToken: string,
): Promise<{ event: { id: string; sequence: number; kind: string; supersedesId: string | null } }> {
  return post<{
    event: { id: string; sequence: number; kind: string; supersedesId: string | null };
  }>("/api/timeline/corrections/apply", { command, previewToken });
}

export function getDivergence(seasonId: string): Promise<DivergenceReport> {
  return get<{ divergence: DivergenceReport }>(
    `/api/timeline/divergence?seasonId=${seasonId}`,
  ).then((r) => r.divergence);
}

export type ChampionState =
  | "MATCH"
  | "DIVERGENT"
  | "UNIVERSE_ONLY"
  | "EXTERNAL_ONLY"
  | "NONE";

export const CHAMPION_STATE_LABELS: Record<ChampionState, string> = {
  MATCH: "Original",
  DIVERGENT: "Divergente",
  UNIVERSE_ONLY: "Somente Universe",
  EXTERNAL_ONLY: "Somente externo",
  NONE: "Sem campeão",
};

export type ExternalChampionSourceType = "STANDING" | "CANONICAL";

export type ExternalChampionDescriptor = {
  externalDriverId: string | null;
  name: string;
  source: string;
  sourceType: ExternalChampionSourceType;
};

export type CanonicalChampionDescriptor = {
  name: string;
  source: string;
};

export type UniverseChampionDescriptor = {
  driverProfileId: string;
  characterId: string;
  name: string;
  externalDriverId: string | null;
};

export type ChampionBlockedReason =
  | "DERIVED_CHAMPION"
  | "SEASON_IN_PROGRESS"
  | "SEASON_NOT_IN_UNIVERSE";

export type ChampionEntry = {
  seasonId: string | null;
  year: number;
  externalChampion: ExternalChampionDescriptor | null;
  canonicalChampion: CanonicalChampionDescriptor | null;
  universeChampion: UniverseChampionDescriptor | null;
  state: ChampionState;
  origin: "DERIVED" | "STANDING" | "NONE";
  baseline: boolean;
  sourceConflict: boolean;
  canEdit: boolean;
  canRestore: boolean;
  blockedReason: ChampionBlockedReason | null;
  restoreDriverProfileId: string | null;
};

export const CHAMPION_BLOCKED_REASONS: Record<ChampionBlockedReason, string> = {
  DERIVED_CHAMPION:
    "Este campeão é derivado dos resultados e da classificação desta temporada.",
  SEASON_IN_PROGRESS:
    "Temporada em andamento: o campeão só é definido ao final da temporada.",
  SEASON_NOT_IN_UNIVERSE:
    "Esta temporada ainda não existe no seu Universe.",
};

export type ChampionChangeMode = "EDIT" | "RESTORE";

export type ChampionChangeRequest =
  | { mode: "EDIT"; driverProfileId: string }
  | { mode: "RESTORE" };

export type ChampionChangePreview = {
  previewToken: string;
  seasonId: string;
  year: number;
  mode: ChampionChangeMode;
  externalChampion: ExternalChampionDescriptor | null;
  before: UniverseChampionDescriptor | null;
  after: UniverseChampionDescriptor;
  changes: Array<{ field: "champion"; before: string | null; after: string }>;
  commandCount: number;
};

export type ChampionDetail = {
  champion: ChampionEntry;
  history: TimelineItem[];
};

export function getChampions(): Promise<ChampionEntry[]> {
  return get<{ champions: ChampionEntry[] }>("/api/timeline/champions").then(
    (r) => r.champions,
  );
}

export function getChampionDetail(seasonId: string): Promise<ChampionDetail> {
  return get<ChampionDetail>(`/api/timeline/champions/${seasonId}`);
}

export function previewChampionChange(
  seasonId: string,
  request: ChampionChangeRequest,
): Promise<ChampionChangePreview> {
  return post<{ preview: ChampionChangePreview }>(
    `/api/timeline/champions/${seasonId}/preview`,
    request,
  ).then((r) => r.preview);
}

export function applyChampionChange(
  seasonId: string,
  request: ChampionChangeRequest & { previewToken: string },
): Promise<{ events: Array<{ id: string; sequence: number; kind: string }> }> {
  return post<{ events: Array<{ id: string; sequence: number; kind: string }> }>(
    `/api/timeline/champions/${seasonId}/apply`,
    request,
  );
}
