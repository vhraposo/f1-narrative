import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";
import { raceIdParamSchema } from "./qualifying.schema.js";
import {
  simulateRaceForRace,
  type RaceRun,
} from "./race-simulation.service.js";

export const raceSimulationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/api/races/:raceId/race/simulate",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = raceIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const run: RaceRun | null = await simulateRaceForRace(
        prisma,
        parsed.data.raceId,
      );

      if (run === null) {
        return reply.code(404).send({
          error: "Corrida não encontrada",
          code: "NOT_FOUND",
        });
      }

      return reply.send({ results: run.results, incidents: run.incidents });
    },
  );

  fastify.get(
    "/api/races/:raceId/race",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = raceIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const race = await prisma.race.findUnique({
        where: { id: parsed.data.raceId },
        select: { id: true, status: true },
      });

      if (!race) {
        return reply.code(404).send({
          error: "Corrida não encontrada",
          code: "NOT_FOUND",
        });
      }

      const results = await prisma.raceResult.findMany({
        where: { raceId: race.id },
        orderBy: { position: "asc" },
        select: {
          position: true,
          grid: true,
          status: true,
          driverProfileId: true,
          driverProfile: {
            select: {
              character: { select: { name: true } },
            },
          },
        },
      });

      const rows = results.map((row) => ({
        driverProfileId: row.driverProfileId,
        position: row.position,
        grid: row.grid,
        status: row.status,
        driverName: row.driverProfile.character.name,
      }));

      return reply.send({ race: { status: race.status }, results: rows });
    },
  );
};

export default raceSimulationRoutes;