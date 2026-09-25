import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";
import { ensureUniverse } from "../universe/universe.service.js";
import { rosterService } from "../roster/roster.service.js";
import { updateWorldSchema } from "./world.schema.js";

const WORLD_KEY = "default";

const worldSelect = {
  id: true,
  key: true,
  currentDate: true,
  currentSeasonId: true,
  currentRaceId: true,
  currentSession: true,
  createdAt: true,
  updatedAt: true,
} as const;

async function resolveWorld(userId: string) {
  const universe = await ensureUniverse(userId);
  try {
    return await prisma.worldState.upsert({
      where: { universeId_key: { universeId: universe.id, key: WORLD_KEY } },
      update: {},
      create: { universeId: universe.id, key: WORLD_KEY },
      select: worldSelect,
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return prisma.worldState.findUniqueOrThrow({
        where: { universeId_key: { universeId: universe.id, key: WORLD_KEY } },
        select: worldSelect,
      });
    }
    throw error;
  }
}

async function findInvalidReference(
  universeId: string,
  seasonId: string | null | undefined,
  raceId: string | null | undefined,
): Promise<string | null> {
  if (seasonId) {
    const season = await prisma.season.findFirst({
      where: { id: seasonId, universeId },
      select: { id: true },
    });
    if (!season) return "Temporada não encontrada";
  }
  if (raceId) {
    const race = await prisma.race.findFirst({
      where: { id: raceId, season: { universeId } },
      select: { id: true },
    });
    if (!race) return "Corrida não encontrada";
  }
  return null;
}

export const worldRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/world",
    { preHandler: [fastify.authenticate] },
    async (request) => {
      const world = await resolveWorld(request.user!.id);
      return { world };
    },
  );

  fastify.patch(
    "/api/world",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = updateWorldSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }

      const universe = await ensureUniverse(request.user!.id);
      const invalid = await findInvalidReference(
        universe.id,
        parsed.data.currentSeasonId,
        parsed.data.currentRaceId,
      );
      if (invalid) {
        return reply.code(400).send({
          error: invalid,
          code: "VALIDATION_ERROR",
        });
      }

      const world = await prisma.worldState.upsert({
        where: { universeId_key: { universeId: universe.id, key: WORLD_KEY } },
        update: {
          ...(parsed.data.currentDate !== undefined
            ? { currentDate: new Date(parsed.data.currentDate) }
            : {}),
          ...(parsed.data.currentSeasonId !== undefined
            ? { currentSeasonId: parsed.data.currentSeasonId }
            : {}),
          ...(parsed.data.currentRaceId !== undefined
            ? { currentRaceId: parsed.data.currentRaceId }
            : {}),
          ...(parsed.data.currentSession !== undefined
            ? { currentSession: parsed.data.currentSession }
            : {}),
        },
        create: {
          universeId: universe.id,
          key: WORLD_KEY,
          ...(parsed.data.currentDate !== undefined
            ? { currentDate: new Date(parsed.data.currentDate) }
            : {}),
          ...(parsed.data.currentSeasonId !== undefined
            ? { currentSeasonId: parsed.data.currentSeasonId }
            : {}),
          ...(parsed.data.currentRaceId !== undefined
            ? { currentRaceId: parsed.data.currentRaceId }
            : {}),
          ...(parsed.data.currentSession !== undefined
            ? { currentSession: parsed.data.currentSession }
            : {}),
        },
        select: worldSelect,
      });

      if (parsed.data.currentSeasonId !== undefined) {
        await rosterService.resyncAllDriverTeamCaches(universe.id);
      }

      return reply.send({ world });
    },
  );
};

export default worldRoutes;