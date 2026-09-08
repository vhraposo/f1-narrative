import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";
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

async function resolveWorld() {
  return prisma.worldState.upsert({
    where: { key: WORLD_KEY },
    update: {},
    create: { key: WORLD_KEY },
    select: worldSelect,
  });
}

async function findInvalidReference(
  seasonId: string | null | undefined,
  raceId: string | null | undefined,
): Promise<string | null> {
  if (seasonId) {
    const season = await prisma.season.findUnique({
      where: { id: seasonId },
      select: { id: true },
    });
    if (!season) return "Temporada não encontrada";
  }
  if (raceId) {
    const race = await prisma.race.findUnique({
      where: { id: raceId },
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
    async () => {
      const world = await resolveWorld();
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

      const invalid = await findInvalidReference(
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
        where: { key: WORLD_KEY },
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
        await rosterService.resyncAllDriverTeamCaches();
      }

      return reply.send({ world });
    },
  );
};

export default worldRoutes;