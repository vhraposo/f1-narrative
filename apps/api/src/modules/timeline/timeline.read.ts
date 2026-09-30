import type { Prisma, TimelineEvent } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import { TimelineError } from "./timeline.service.js";

export const TIMELINE_KINDS = [
  "WORLD_ADVANCED",
  "RACE_SCHEDULED",
  "RACE_UPDATED",
  "SESSION_COMPLETED",
  "ATTRIBUTE_EVOLVED",
  "RACE_RESULT_CORRECTED",
  "RACE_SESSION_RESULT_CORRECTED",
  "STANDING_CORRECTED",
  "NUMBER_CORRECTED",
  "PERSONA_UPDATED",
] as const;

export type TimelineKind = (typeof TIMELINE_KINDS)[number];

const CORRECTION_KINDS: readonly string[] = [
  "RACE_RESULT_CORRECTED",
  "RACE_SESSION_RESULT_CORRECTED",
  "STANDING_CORRECTED",
  "NUMBER_CORRECTED",
];

const MAX_SCAN = 1000;

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

export type TimelineListFilters = {
  seasonId?: string;
  from?: Date;
  to?: Date;
  driverProfileId?: string;
  teamId?: string;
  raceId?: string;
  kind?: string;
  correctionsOnly?: boolean;
  cursor?: string;
  limit?: number;
};

export type TimelinePage = {
  items: TimelineItem[];
  nextCursor: string | null;
  hasMore: boolean;
  beyondScanLimit: boolean;
};

function eventReferences(event: TimelineEvent): {
  raceId?: string;
  driverProfileId?: string;
  seasonId?: string;
  number?: number | null;
} {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const refs: {
    raceId?: string;
    driverProfileId?: string;
    seasonId?: string;
    number?: number | null;
  } = {};
  if (typeof payload.raceId === "string") refs.raceId = payload.raceId;
  if (typeof payload.driverProfileId === "string") {
    refs.driverProfileId = payload.driverProfileId;
  }
  if (typeof payload.seasonId === "string") refs.seasonId = payload.seasonId;
  if (typeof payload.currentRaceId === "string") refs.raceId = payload.currentRaceId;
  if (typeof payload.currentSeasonId === "string") {
    refs.seasonId = payload.currentSeasonId;
  }
  if (typeof payload.number === "number" || payload.number === null) {
    refs.number = payload.number as number | null;
  }
  return refs;
}

function stringValue(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

function numberValue(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" ? value : null;
}

export function valuesForEvent(event: TimelineEvent): Record<string, string | number | null> | null {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  switch (event.kind as string) {
    case "RACE_RESULT_CORRECTED":
      return {
        position: numberValue(payload, "position"),
        grid: numberValue(payload, "grid"),
        status: stringValue(payload, "status"),
      };
    case "RACE_SESSION_RESULT_CORRECTED":
      return {
        session: stringValue(payload, "session"),
        position: numberValue(payload, "position"),
        status: stringValue(payload, "status"),
      };
    case "STANDING_CORRECTED":
      return {
        points: numberValue(payload, "points"),
        wins: numberValue(payload, "wins"),
        podiums: numberValue(payload, "podiums"),
        position: numberValue(payload, "position"),
      };
    case "NUMBER_CORRECTED":
      return { number: numberValue(payload, "number") };
    case "SESSION_COMPLETED":
      return {
        session: stringValue(payload, "session"),
        resultCount: numberValue(payload, "resultCount"),
      };
    case "RACE_SCHEDULED":
    case "RACE_UPDATED":
      return {
        round: numberValue(payload, "round"),
        name: stringValue(payload, "name"),
        date: stringValue(payload, "date"),
        hasSprint:
          typeof payload.hasSprint === "boolean" ? (payload.hasSprint ? 1 : 0) : null,
      };
    case "ATTRIBUTE_EVOLVED":
      return {
        fingerprint: stringValue(payload, "fingerprint"),
        racesConsidered: numberValue(payload, "racesConsidered"),
      };
    case "PERSONA_UPDATED":
      return {
        characterId: stringValue(payload, "characterId"),
        evolutionRevision: numberValue(payload, "evolutionRevision"),
      };
    case "WORLD_ADVANCED":
      return {
        currentSeasonId: stringValue(payload, "currentSeasonId"),
        currentRaceId: stringValue(payload, "currentRaceId"),
        currentSession: stringValue(payload, "currentSession"),
      };
    default:
      return null;
  }
}

type NameMaps = {
  races: Map<
    string,
    {
      id: string;
      name: string;
      round: number | null;
      seasonId: string;
      season: { id: string; year: number; name: string | null };
    }
  >;
  drivers: Map<
    string,
    {
      id: string;
      name: string;
      team: { id: string; name: string } | null;
    }
  >;
  seasons: Map<string, { id: string; year: number; name: string | null }>;
  supersededById: Map<string, string>;
};

async function loadNameMaps(events: TimelineEvent[], universeId: string): Promise<NameMaps> {
  const raceIds = new Set<string>();
  const driverIds = new Set<string>();
  const seasonIds = new Set<string>();
  for (const event of events) {
    const refs = eventReferences(event);
    if (refs.raceId) raceIds.add(refs.raceId);
    if (refs.driverProfileId) driverIds.add(refs.driverProfileId);
    if (refs.seasonId) seasonIds.add(refs.seasonId);
  }

  const raceRows = raceIds.size
    ? await prisma.race.findMany({
        where: { id: { in: [...raceIds] }, season: { universeId } },
        select: {
          id: true,
          name: true,
          round: true,
          seasonId: true,
          season: { select: { id: true, year: true, name: true } },
        },
      })
    : [];

  const driverRows = driverIds.size
    ? await prisma.driverProfile.findMany({
        where: { id: { in: [...driverIds] }, character: { universeId } },
        select: {
          id: true,
          character: { select: { name: true } },
          team: { select: { id: true, name: true } },
        },
      })
    : [];

  for (const race of raceRows) seasonIds.add(race.seasonId);

  const seasonRows = seasonIds.size
    ? await prisma.season.findMany({
        where: { id: { in: [...seasonIds] }, universeId },
        select: { id: true, year: true, name: true },
      })
    : [];

  const eventIds = events.map((event) => event.id);
  const supersedingRows = eventIds.length
    ? await prisma.timelineEvent.findMany({
        where: { universeId, supersedesId: { in: eventIds } },
        select: { id: true, supersedesId: true },
        orderBy: { sequence: "asc" },
      })
    : [];

  const supersededById = new Map<string, string>();
  for (const row of supersedingRows) {
    if (row.supersedesId && !supersededById.has(row.supersedesId)) {
      supersededById.set(row.supersedesId, row.id);
    }
  }

  return {
    races: new Map(raceRows.map((race) => [race.id, race])),
    drivers: new Map(
      driverRows.map((driver) => [
        driver.id,
        { id: driver.id, name: driver.character.name, team: driver.team },
      ]),
    ),
    seasons: new Map(seasonRows.map((season) => [season.id, season])),
    supersededById,
  };
}

function buildItem(event: TimelineEvent, maps: NameMaps): TimelineItem {
  const refs = eventReferences(event);
  const race = refs.raceId ? (maps.races.get(refs.raceId) ?? null) : null;
  const driver = refs.driverProfileId
    ? (maps.drivers.get(refs.driverProfileId) ?? null)
    : null;
  const season = refs.seasonId
    ? (maps.seasons.get(refs.seasonId) ?? null)
    : race
      ? race.season
      : null;
  const values = valuesForEvent(event);
  const supersededById = maps.supersededById.get(event.id) ?? null;
  const raceLabel = race ? race.name : "corrida";
  const driverLabel = driver ? driver.name : "piloto";

  let summary: string;
  switch (event.kind as string) {
    case "RACE_RESULT_CORRECTED":
      summary = `Resultado corrigido em ${raceLabel}: ${driverLabel}`;
      break;
    case "RACE_SESSION_RESULT_CORRECTED":
      summary = `Sessão corrigida em ${raceLabel}: ${driverLabel}`;
      break;
    case "STANDING_CORRECTED":
      summary = `Standing corrigido: ${driverLabel}`;
      break;
    case "NUMBER_CORRECTED":
      summary = `Número corrigido: ${driverLabel}`;
      break;
    case "RACE_SCHEDULED":
      summary = `Corrida agendada: ${raceLabel}`;
      break;
    case "RACE_UPDATED":
      summary = `Corrida atualizada: ${raceLabel}`;
      break;
    case "SESSION_COMPLETED":
      summary = `Sessão concluída em ${raceLabel}`;
      break;
    case "ATTRIBUTE_EVOLVED":
      summary = season
        ? `Evolução aplicada na temporada ${season.year}`
        : "Evolução aplicada";
      break;
    case "PERSONA_UPDATED":
      summary = "Persona atualizada por experiência do Universe";
      break;
    case "WORLD_ADVANCED":
      summary = "Mundo avançado";
      break;
    default:
      summary = event.kind;
      break;
  }

  return {
    id: event.id,
    sequence: event.sequence,
    worldDate: event.worldDate.toISOString(),
    kind: event.kind,
    causedBy: event.causedBy,
    supersedesId: event.supersedesId,
    supersededById,
    isCorrection: CORRECTION_KINDS.includes(event.kind),
    isSuperseded: supersededById !== null,
    summary,
    race: race
      ? { id: race.id, name: race.name, round: race.round }
      : null,
    season: season
      ? { id: season.id, year: season.year, name: season.name }
      : null,
    driver: driver ? { id: driver.id, name: driver.name } : null,
    team: driver?.team
      ? { id: driver.team.id, name: driver.team.name }
      : null,
    number: refs.number ?? null,
    values,
  };
}

export async function buildTimelineItems(
  events: TimelineEvent[],
  universeId: string,
): Promise<TimelineItem[]> {
  if (events.length === 0) return [];
  const maps = await loadNameMaps(events, universeId);
  return events.map((event) => buildItem(event, maps));
}

function matchesFilters(item: TimelineItem, filters: TimelineListFilters): boolean {
  if (filters.seasonId && item.season?.id !== filters.seasonId) return false;
  if (filters.driverProfileId && item.driver?.id !== filters.driverProfileId) {
    return false;
  }
  if (filters.teamId && item.team?.id !== filters.teamId) return false;
  if (filters.raceId && item.race?.id !== filters.raceId) return false;
  return true;
}

function encodeCursor(item: TimelineItem): string {
  return `${item.worldDate}|${item.sequence}`;
}

function parseCursor(cursor: string): { worldDate: number; sequence: number } | null {
  const separator = cursor.lastIndexOf("|");
  if (separator <= 0) return null;
  const date = Date.parse(cursor.slice(0, separator));
  const sequence = Number.parseInt(cursor.slice(separator + 1), 10);
  if (Number.isNaN(date) || Number.isNaN(sequence)) return null;
  return { worldDate: date, sequence };
}

function isBelowCursor(item: TimelineItem, cursor: { worldDate: number; sequence: number }): boolean {
  const itemDate = Date.parse(item.worldDate);
  if (itemDate < cursor.worldDate) return true;
  if (itemDate > cursor.worldDate) return false;
  return item.sequence < cursor.sequence;
}

export async function queryTimelineItems(
  universeId: string,
  filters: TimelineListFilters = {},
): Promise<TimelinePage> {
  const where: Prisma.TimelineEventWhereInput = { universeId };
  if (filters.correctionsOnly) {
    where.kind = {
      in: [
        "RACE_RESULT_CORRECTED",
        "RACE_SESSION_RESULT_CORRECTED",
        "STANDING_CORRECTED",
        "NUMBER_CORRECTED",
      ] as TimelineEvent["kind"][],
    };
  } else if (filters.kind) {
    where.kind = filters.kind as TimelineEvent["kind"];
  }
  if (filters.from || filters.to) {
    where.worldDate = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  const rows = await prisma.timelineEvent.findMany({
    where,
    orderBy: [{ worldDate: "desc" }, { sequence: "desc" }],
    take: MAX_SCAN + 1,
  });
  const beyondScanLimit = rows.length > MAX_SCAN;
  const events = rows.slice(0, MAX_SCAN);

  let items = await buildTimelineItems(events, universeId);
  items = items.filter((item) => matchesFilters(item, filters));

  if (filters.cursor) {
    const cursor = parseCursor(filters.cursor);
    if (cursor) items = items.filter((item) => isBelowCursor(item, cursor));
  }

  const limit = filters.limit ?? 50;
  const page = items.slice(0, limit);
  const hasMore = items.length > limit;
  const last = page[page.length - 1];

  return {
    items: page,
    nextCursor: hasMore && last ? encodeCursor(last) : null,
    hasMore,
    beyondScanLimit,
  };
}

export async function getTimelineEventDetail(
  universeId: string,
  eventId: string,
): Promise<{
  item: TimelineItem;
  supersedesChain: TimelineItem[];
  supersededByChain: TimelineItem[];
}> {
  const event = await prisma.timelineEvent.findFirst({
    where: { id: eventId, universeId },
  });
  if (!event) {
    throw new TimelineError("NOT_FOUND", "Evento da timeline não encontrado.", 404);
  }

  const ancestors: TimelineEvent[] = [];
  let current = event;
  for (let depth = 0; depth < 20 && current.supersedesId; depth += 1) {
    const parent = await prisma.timelineEvent.findFirst({
      where: { id: current.supersedesId, universeId },
    });
    if (!parent) break;
    ancestors.push(parent);
    current = parent;
  }

  const successors: TimelineEvent[] = [];
  current = event;
  for (let depth = 0; depth < 20; depth += 1) {
    const next = await prisma.timelineEvent.findFirst({
      where: { universeId, supersedesId: current.id },
      orderBy: { sequence: "asc" },
    });
    if (!next) break;
    successors.push(next);
    current = next;
  }

  const all = [event, ...ancestors, ...successors];
  const items = await buildTimelineItems(all, universeId);
  const byId = new Map(items.map((item) => [item.id, item]));
  const root = byId.get(event.id) as TimelineItem;

  return {
    item: root,
    supersedesChain: ancestors
      .map((ancestor) => byId.get(ancestor.id))
      .filter((item): item is TimelineItem => item !== undefined),
    supersededByChain: successors
      .map((successor) => byId.get(successor.id))
      .filter((item): item is TimelineItem => item !== undefined),
  };
}
