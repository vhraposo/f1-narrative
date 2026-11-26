import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";

import { prisma } from "../../infrastructure/database/prisma.js";
import { ensureUniverse } from "../universe/universe.service.js";
import { runSimulationTick, SimulationTickError } from "./world-simulation.tick.js";

const tickBodySchema = z
  .object({
    universeId: z.string().uuid().optional(),
    fromDate: z.string().datetime().optional(),
    toDate: z.string().datetime().optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();

const listQuerySchema = z.object({ universeId: z.string().uuid().optional() }).strict();

function sendSimulationError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof SimulationTickError) {
    reply.code(error.statusCode).send({ error: error.message, code: error.code });
    return true;
  }
  return false;
}

export const worldSimulationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/api/world/simulation-tick",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const body = tickBodySchema.safeParse(request.body ?? {});
      if (!body.success) {
        return reply.code(400).send({ error: "Dados inválidos", code: "VALIDATION_ERROR" });
      }
      try {
        const universe = await ensureUniverse(request.user!.id);
        if (body.data.universeId && body.data.universeId !== universe.id) {
          throw new SimulationTickError("UNIVERSE_NOT_FOUND", "Universe não encontrado", 404);
        }
        const worldState = await prisma.worldState.findUnique({
          where: { universeId_key: { universeId: universe.id, key: "default" } },
          select: { currentDate: true },
        });
        const toDate = body.data.toDate
          ? new Date(body.data.toDate)
          : worldState?.currentDate;
        if (!toDate) {
          throw new SimulationTickError("INVALID_WINDOW", "WorldState sem currentDate", 400);
        }
        const result = await runSimulationTick({
          universeId: universe.id,
          ...(body.data.fromDate ? { fromDate: new Date(body.data.fromDate) } : {}),
          toDate,
          dryRun: body.data.dryRun === true,
        });
        return reply.code(result.reused ? 200 : 201).send({ tick: result });
      } catch (error) {
        if (sendSimulationError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.get(
    "/api/world/simulation-ticks",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const query = listQuerySchema.safeParse(request.query ?? {});
      if (!query.success) {
        return reply.code(400).send({ error: "Consulta inválida", code: "VALIDATION_ERROR" });
      }
      try {
        const universe = await ensureUniverse(request.user!.id);
        if (query.data.universeId && query.data.universeId !== universe.id) {
          throw new SimulationTickError("UNIVERSE_NOT_FOUND", "Universe não encontrado", 404);
        }
        const ticks = await prisma.simulationTick.findMany({
          where: { universeId: universe.id },
          orderBy: [{ startedAt: "desc" }, { id: "asc" }],
          take: 20,
        });
        return reply.send({ ticks });
      } catch (error) {
        if (sendSimulationError(reply, error)) return;
        throw error;
      }
    },
  );
};

export default worldSimulationRoutes;
