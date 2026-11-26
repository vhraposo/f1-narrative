import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";

import { prisma } from "../../infrastructure/database/prisma.js";
import { ensureUniverse } from "../universe/universe.service.js";
import {
  getDecisionTrace,
  getSimulationTrace,
  getUniverseActivity,
  getUniverseMetrics,
  ObservabilityError,
} from "./observability.service.js";

const decisionParamsSchema = z.object({ decisionId: z.string().uuid() });
const tickParamsSchema = z.object({ tickId: z.string().uuid() });

function sendObservabilityError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof ObservabilityError) {
    reply.code(error.statusCode).send({ error: error.message, code: error.code });
    return true;
  }
  return false;
}

async function ownsDecision(universeId: string, userId: string): Promise<boolean> {
  const universe = await prisma.universe.findUnique({ where: { userId }, select: { id: true } });
  return universe?.id === universeId;
}

export const observabilityRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/observability/decisions/:decisionId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = decisionParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Identificador inválido", code: "VALIDATION_ERROR" });
      }
      try {
        const trace = await getDecisionTrace(params.data.decisionId);
        if (!(await ownsDecision(trace.decision.universeId, request.user!.id))) {
          throw new ObservabilityError("DECISION_NOT_FOUND", "Decisão não encontrada", 404);
        }
        return reply.send(trace);
      } catch (error) {
        if (sendObservabilityError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.get(
    "/api/observability/simulation-ticks/:tickId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = tickParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Identificador inválido", code: "VALIDATION_ERROR" });
      }
      try {
        const trace = await getSimulationTrace(params.data.tickId);
        if (!(await ownsDecision(trace.tick.universeId, request.user!.id))) {
          throw new ObservabilityError("TICK_NOT_FOUND", "Tick não encontrado", 404);
        }
        return reply.send(trace);
      } catch (error) {
        if (sendObservabilityError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.get(
    "/api/observability/activity",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const universe = await ensureUniverse(request.user!.id);
        return reply.send({ activity: await getUniverseActivity(universe.id) });
      } catch (error) {
        if (sendObservabilityError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.get(
    "/api/observability/metrics",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const universe = await ensureUniverse(request.user!.id);
        return reply.send({ metrics: await getUniverseMetrics(universe.id) });
      } catch (error) {
        if (sendObservabilityError(reply, error)) return;
        throw error;
      }
    },
  );
};

export default observabilityRoutes;
