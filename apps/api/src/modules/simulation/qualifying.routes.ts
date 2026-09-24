import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";
import { raceIdParamSchema } from "./qualifying.schema.js";
import {
  simulateQualifyingForRace,
  type QualifyingRunEntry,
} from "./qualifying.service.js";

export const simulationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/api/races/:raceId/qualifying/simulate",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = raceIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const run: QualifyingRunEntry[] | null = await simulateQualifyingForRace(
        prisma,
        parsed.data.raceId,
      );

      if (run === null) {
        return reply.code(404).send({
          error: "Corrida não encontrada",
          code: "NOT_FOUND",
        });
      }

      return reply.send({ grid: run });
    },
  );

  fastify.get(
    "/api/races/:raceId/qualifying",
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
        where: { raceId: race.id, grid: { not: null } },
        orderBy: { grid: "asc" },
        select: {
          grid: true,
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
        grid: row.grid,
        driverName: row.driverProfile.character.name,
      }));

      return reply.send({ race: { status: race.status }, grid: rows });
    },
  );
};

export default simulationRoutes;