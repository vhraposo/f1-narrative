import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";

import {
  getRaceWeekend,
  RaceWeekendError,
  runWeekendSession,
} from "./race-weekend.service.js";

const raceParamsSchema = z.object({
  raceId: z.string().uuid("Identificador de corrida inválido"),
});

const sessionParamsSchema = z.object({
  raceId: z.string().uuid("Identificador de corrida inválido"),
  session: z.enum([
    "PRACTICE",
    "SPRINT_QUALIFYING",
    "SPRINT",
    "QUALIFYING",
    "RACE",
  ]),
});

const runBodySchema = z
  .object({
    rerun: z.boolean().optional(),
  })
  .strict();

function sendWeekendError(reply: FastifyReply, error: unknown) {
  if (error instanceof RaceWeekendError) {
    return reply
      .code(error.statusCode)
      .send({ error: error.message, code: error.code });
  }
  throw error;
}

export const raceWeekendRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/races/:raceId/weekend",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = raceParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      try {
        const weekend = await getRaceWeekend(
          request.user!.id,
          params.data.raceId,
        );
        return reply.send({ weekend });
      } catch (error) {
        return sendWeekendError(reply, error);
      }
    },
  );

  fastify.post(
    "/api/races/:raceId/weekend/sessions/:session/run",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = sessionParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const body = runBodySchema.safeParse(request.body ?? {});
      if (!body.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: body.error.issues,
        });
      }
      try {
        const weekend = await runWeekendSession(
          request.user!.id,
          params.data.raceId,
          params.data.session,
          body.data.rerun !== undefined ? { rerun: body.data.rerun } : {},
        );
        return reply.send({ weekend });
      } catch (error) {
        return sendWeekendError(reply, error);
      }
    },
  );
};

export default raceWeekendRoutes;
