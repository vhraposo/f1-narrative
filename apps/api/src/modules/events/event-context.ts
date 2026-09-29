import { prisma } from "../../infrastructure/database/prisma.js";
import { ensureUniverse } from "../universe/universe.service.js";

export type EventContextError = {
  statusCode: number;
  code: string;
  error: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function contextId(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function validateEventPayloadContext(
  userId: string,
  payload: Record<string, unknown> | null | undefined,
): Promise<EventContextError | null> {
  if (!payload) return null;

  const seasonId = contextId(payload, "seasonId");
  const raceId = contextId(payload, "raceId");
  if (!seasonId && !raceId) return null;

  if ((seasonId && !UUID_PATTERN.test(seasonId)) || (raceId && !UUID_PATTERN.test(raceId))) {
    return {
      statusCode: 400,
      code: "INVALID_EVENT_CONTEXT",
      error: "Contexto de temporada/corrida inválido",
    };
  }

  const universe = await ensureUniverse(userId);
  let raceSeasonId: string | null = null;

  if (raceId) {
    const race = await prisma.race.findUnique({
      where: { id: raceId },
      select: {
        id: true,
        seasonId: true,
        season: { select: { universeId: true } },
      },
    });
    if (!race) {
      return {
        statusCode: 404,
        code: "RACE_NOT_FOUND",
        error: "Corrida não encontrada",
      };
    }
    if (race.season.universeId !== universe.id) {
      return {
        statusCode: 403,
        code: "RACE_NOT_IN_UNIVERSE",
        error: "Corrida não pertence ao seu Universe",
      };
    }
    raceSeasonId = race.seasonId;
  }

  if (seasonId) {
    const season = await prisma.season.findUnique({
      where: { id: seasonId },
      select: { id: true, universeId: true },
    });
    if (!season) {
      return {
        statusCode: 404,
        code: "SEASON_NOT_FOUND",
        error: "Temporada não encontrada",
      };
    }
    if (season.universeId !== universe.id) {
      return {
        statusCode: 403,
        code: "SEASON_NOT_IN_UNIVERSE",
        error: "Temporada não pertence ao seu Universe",
      };
    }
    if (raceSeasonId && raceSeasonId !== seasonId) {
      return {
        statusCode: 400,
        code: "INVALID_EVENT_CONTEXT",
        error: "Corrida e temporada informadas não correspondem",
      };
    }
  }

  return null;
}
