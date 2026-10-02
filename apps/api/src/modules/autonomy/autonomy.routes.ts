import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";

import { ensureUniverse } from "../universe/universe.service.js";
import { AutonomyError, getAutonomyState, runAutonomousTick, updateAutonomy } from "./autonomy.service.js";

const updateSchema = z
  .object({
    mode: z.enum(["OFF", "OBSERVER", "GUIDED", "FULL"]).optional(),
    status: z.enum(["ACTIVE", "PAUSED", "STOPPED"]).optional(),
  })
  .strict();

const tickSchema = z
  .object({
    dryRun: z.boolean().optional(),
    toDate: z.string().datetime().optional(),
  })
  .strict();

function sendAutonomyError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof AutonomyError) {
    reply.code(error.statusCode).send({ error: error.message, code: error.code });
    return true;
  }
  return false;
}

export const autonomyRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/universe/autonomy",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const universe = await ensureUniverse(request.user!.id);
        return reply.send({ autonomy: await getAutonomyState(universe.id) });
      } catch (error) {
        if (sendAutonomyError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.patch(
    "/api/universe/autonomy",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const body = updateSchema.safeParse(request.body ?? {});
      if (!body.success) {
        return reply.code(400).send({ error: "Dados inválidos", code: "VALIDATION_ERROR" });
      }
      try {
        const universe = await ensureUniverse(request.user!.id);
        return reply.send({ autonomy: await updateAutonomy(universe.id, body.data) });
      } catch (error) {
        if (sendAutonomyError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.post(
    "/api/universe/autonomy/tick",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const body = tickSchema.safeParse(request.body ?? {});
      if (!body.success) {
        return reply.code(400).send({ error: "Dados inválidos", code: "VALIDATION_ERROR" });
      }
      try {
        const universe = await ensureUniverse(request.user!.id);
        const result = await runAutonomousTick({
          universeId: universe.id,
          dryRun: body.data.dryRun === true,
          ...(body.data.toDate ? { toDate: new Date(body.data.toDate) } : {}),
        });
        return reply.code(result.status === "EXECUTED" ? 201 : 200).send({ tick: result });
      } catch (error) {
        if (sendAutonomyError(reply, error)) return;
        throw error;
      }
    },
  );
};

export default autonomyRoutes;
