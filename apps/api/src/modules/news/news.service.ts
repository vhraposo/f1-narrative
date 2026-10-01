import { prisma } from "../../infrastructure/database/prisma.js";
import { ensureUniverse } from "../universe/universe.service.js";

const WORLD_KEY = "default";

export class NewsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "NewsError";
  }
}

export type NewsSeasonContext = { id: string; year: number };
export type NewsRaceContext = {
  id: string;
  name: string;
  round: number | null;
};

export type NewsItemView = {
  id: string;
  eventId: string | null;
  title: string;
  body: string | null;
  source: string;
  worldDate: Date | null;
  createdAt: Date;
  context: {
    season: NewsSeasonContext | null;
    race: NewsRaceContext | null;
  };
};

export type NewsListInput = {
  userId: string;
  seasonId?: string;
  raceId?: string;
  limit: number;
  offset: number;
};

export type NewsListResult = {
  news: NewsItemView[];
  context: {
    season: NewsSeasonContext | null;
    race: NewsRaceContext | null;
  };
  hasMore: boolean;
  nextOffset: number | null;
};

function payloadOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function payloadId(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function listUniverseNews(
  input: NewsListInput,
): Promise<NewsListResult> {
  const universe = await ensureUniverse(input.userId);

  let season: NewsSeasonContext | null = null;
  let race: NewsRaceContext | null = null;
  let filteredSeasonId: string | null = null;

  if (input.raceId) {
    const found = await prisma.race.findUnique({
      where: { id: input.raceId },
      select: {
        id: true,
        name: true,
        round: true,
        seasonId: true,
        season: { select: { id: true, year: true, universeId: true } },
      },
    });
    if (!found) {
      throw new NewsError("RACE_NOT_FOUND", "Corrida não encontrada", 404);
    }
    if (found.season.universeId !== universe.id) {
      throw new NewsError("RACE_NOT_FOUND", "Corrida não encontrada", 404);
    }
    race = { id: found.id, name: found.name, round: found.round };
    season = { id: found.season.id, year: found.season.year };
    filteredSeasonId = found.seasonId;
  } else if (input.seasonId) {
    const found = await prisma.season.findUnique({
      where: { id: input.seasonId },
      select: { id: true, year: true, universeId: true },
    });
    if (!found) {
      throw new NewsError("SEASON_NOT_FOUND", "Temporada não encontrada", 404);
    }
    if (found.universeId !== universe.id) {
      throw new NewsError("SEASON_NOT_FOUND", "Temporada não encontrada", 404);
    }
    season = { id: found.id, year: found.year };
    filteredSeasonId = found.id;
  } else {
    const world = await prisma.worldState.findUnique({
      where: { universeId_key: { universeId: universe.id, key: WORLD_KEY } },
      select: { currentSeasonId: true },
    });
    if (world?.currentSeasonId) {
      const found = await prisma.season.findFirst({
        where: { id: world.currentSeasonId, universeId: universe.id },
        select: { id: true, year: true },
      });
      if (found) {
        season = found;
        filteredSeasonId = found.id;
      }
    }
  }

  if (!filteredSeasonId && !race) {
    return {
      news: [],
      context: { season: null, race: null },
      hasMore: false,
      nextOffset: null,
    };
  }

  const eventWhere = race
    ? { payload: { path: ["raceId"], equals: race.id } }
    : { payload: { path: ["seasonId"], equals: filteredSeasonId as string } };

  const rows = await prisma.newsItem.findMany({
    where: { event: { is: eventWhere } },
    orderBy: [
      { worldDate: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
      { id: "desc" },
    ],
    take: input.limit + 1,
    skip: input.offset,
    select: {
      id: true,
      eventId: true,
      title: true,
      body: true,
      source: true,
      worldDate: true,
      createdAt: true,
    },
  });

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;

  const eventIds = page
    .map((item) => item.eventId)
    .filter((value): value is string => value !== null);
  const events = eventIds.length
    ? await prisma.event.findMany({
        where: { id: { in: eventIds } },
        select: { id: true, payload: true },
      })
    : [];
  const payloadByEvent = new Map(
    events.map((event) => [event.id, payloadOf(event.payload)]),
  );

  const raceIds = new Set<string>();
  const seasonIds = new Set<string>();
  for (const eventId of eventIds) {
    const payload = payloadByEvent.get(eventId) ?? {};
    const value = payloadId(payload, "raceId");
    if (value) raceIds.add(value);
    const seasonValue = payloadId(payload, "seasonId");
    if (seasonValue) seasonIds.add(seasonValue);
  }

  const [raceRows, seasonRows] = await Promise.all([
    raceIds.size
      ? prisma.race.findMany({
          where: { id: { in: [...raceIds] } },
          select: {
            id: true,
            name: true,
            round: true,
            season: { select: { id: true, year: true, universeId: true } },
          },
        })
      : Promise.resolve([]),
    seasonIds.size
      ? prisma.season.findMany({
          where: { id: { in: [...seasonIds] } },
          select: { id: true, year: true, universeId: true },
        })
      : Promise.resolve([]),
  ]);

  const raceById = new Map(
    raceRows
      .filter((row) => row.season.universeId === universe.id)
      .map((row) => [
        row.id,
        {
          id: row.id,
          name: row.name,
          round: row.round,
          season: { id: row.season.id, year: row.season.year },
        },
      ]),
  );
  const seasonById = new Map(
    seasonRows
      .filter((row) => row.universeId === universe.id)
      .map((row) => [row.id, { id: row.id, year: row.year }]),
  );

  const news: NewsItemView[] = page.map((item) => {
    const payload = item.eventId
      ? (payloadByEvent.get(item.eventId) ?? {})
      : {};
    const raceRef = payloadId(payload, "raceId");
    const raceView = raceRef ? raceById.get(raceRef) ?? null : null;
    const seasonRef = payloadId(payload, "seasonId");
    const seasonView = raceView?.season
      ? raceView.season
      : seasonRef
        ? seasonById.get(seasonRef) ?? null
        : null;
    return {
      id: item.id,
      eventId: item.eventId,
      title: item.title,
      body: item.body,
      source: item.source,
      worldDate: item.worldDate,
      createdAt: item.createdAt,
      context: {
        season: seasonView,
        race: raceView
          ? { id: raceView.id, name: raceView.name, round: raceView.round }
          : null,
      },
    };
  });

  return {
    news,
    context: { season, race },
    hasMore,
    nextOffset: hasMore ? input.offset + input.limit : null,
  };
}
