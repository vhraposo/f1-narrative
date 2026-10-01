import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";

import {
  applySeasonEvolution,
  evaluateSeasonEvolutionForUser,
  EvolutionError,
  getSeasonEvolutionStatus,
} from "./evolution.service.js";

const seasonParamsSchema = z.object({
  seasonId: z.string().uuid("Temporada inválida"),
});

function sendEvolutionError(reply: FastifyReply, error: unknown) {
  if (error instanceof EvolutionError) {
    return reply
      .code(error.statusCode)
      .send({ error: error.message, code: error.code });
  }
  throw error;
}

export const evolutionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/api/evolution/seasons/:seasonId/evaluate",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = seasonParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      try {
        const changeSet = await evaluateSeasonEvolutionForUser(
          request.user!.id,
          params.data.seasonId,
        );
        return reply.send({ changeSet });
      } catch (error) {
        return sendEvolutionError(reply, error);
      }
    },
  );

  fastify.post(
    "/api/evolution/seasons/:seasonId/apply",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = seasonParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      try {
        const changeSet = await applySeasonEvolution(
          request.user!.id,
          params.data.seasonId,
        );
        return reply.send({ changeSet });
      } catch (error) {
        return sendEvolutionError(reply, error);
      }
    },
  );

  fastify.get(
    "/api/evolution/seasons/:seasonId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = seasonParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      try {
        const status = await getSeasonEvolutionStatus(
          request.user!.id,
          params.data.seasonId,
        );
        return reply.send(status);
      } catch (error) {
        return sendEvolutionError(reply, error);
      }
    },
  );
};

export default evolutionRoutes;
