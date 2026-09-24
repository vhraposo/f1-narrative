import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";
import { raceIdPathParamsSchema } from "../championship/championship.schema.js";
import { processRaceNarrative } from "./race-narrative.service.js";

export const raceNarrativeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/api/races/:raceId/narrative/process",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = raceIdPathParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const raceExists = await prisma.race.findUnique({
        where: { id: params.data.raceId },
        select: { id: true },
      });
      if (!raceExists) {
        return reply.code(404).send({
          error: "Corrida não encontrada",
          code: "NOT_FOUND",
        });
      }

      const result = await processRaceNarrative(prisma, params.data.raceId);
      if (!result) {
        return reply.code(404).send({
          error: "Corrida não encontrada",
          code: "NOT_FOUND",
        });
      }

      return reply.send({
        raceId: result.raceId,
        events: result.created.map((candidate) => ({
          key: candidate.key,
          type: candidate.type,
          importance: candidate.importance,
          title: candidate.title,
        })),
      });
    },
  );
};

export default raceNarrativeRoutes;