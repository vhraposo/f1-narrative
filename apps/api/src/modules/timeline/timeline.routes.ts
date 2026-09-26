import type { FastifyPluginAsync } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../infrastructure/database/prisma.js";
import { ensureUniverse } from "../universe/universe.service.js";
import {
  advanceUniverseTime,
  applyRetroactiveCorrection,
  listTimelineEvents,
  listWorldSnapshots,
  lockUniverseTimeline,
  recomputeUniverseState,
  TimelineError,
} from "./timeline.service.js";

const advanceBodySchema = z
  .object({
    worldDate: z.string().datetime({ offset: true }),
    currentSeasonId: z.string().uuid().nullable().optional(),
    currentRaceId: z.string().uuid().nullable().optional(),
    currentSession: z
      .enum(["PRACTICE", "QUALIFYING", "RACE"])
      .nullable()
      .optional(),
  })
  .strict();

const correctionBodySchema = z
  .object({
    kind: z.enum([
      "RACE_RESULT_CORRECTED",
      "STANDING_CORRECTED",
      "NUMBER_CORRECTED",
    ]),
    worldDate: z.string().datetime({ offset: true }),
    payload: z.record(z.string(), z.unknown()),
    supersedesId: z.string().uuid().nullable().optional(),
  })
  .strict();

function sendTimelineError(
  reply: {
    code: (code: number) => { send: (payload: Record<string, unknown>) => void };
  },
  error: unknown,
): boolean {
  if (error instanceof TimelineError) {
    reply.code(error.statusCode).send({ error: error.message, code: error.code });
    return true;
  }
  return false;
}

export const timelineRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/timeline",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const universe = await ensureUniverse(userId);
      const events = await listTimelineEvents(universe.id);
      return reply.send({ events });
    },
  );

  fastify.get(
    "/api/timeline/snapshots",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const universe = await ensureUniverse(userId);
      const snapshots = await listWorldSnapshots(universe.id);
      return reply.send({ snapshots });
    },
  );

  fastify.post(
    "/api/timeline/advance",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const parsed = advanceBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }
      const universe = await ensureUniverse(userId);
      try {
        const event = await advanceUniverseTime(universe.id, {
          worldDate: new Date(parsed.data.worldDate),
          currentSeasonId: parsed.data.currentSeasonId,
          currentRaceId: parsed.data.currentRaceId,
          currentSession: parsed.data.currentSession,
        });
        return reply.send({ event });
      } catch (error) {
        if (sendTimelineError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.post(
    "/api/timeline/corrections",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const parsed = correctionBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }
      const universe = await ensureUniverse(userId);
      try {
        const event = await applyRetroactiveCorrection(universe.id, {
          kind: parsed.data.kind,
          worldDate: new Date(parsed.data.worldDate),
          payload: parsed.data.payload as unknown as Prisma.InputJsonValue,
          supersedesId: parsed.data.supersedesId ?? null,
        });
        return reply.send({ event });
      } catch (error) {
        if (sendTimelineError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.post(
    "/api/timeline/recompute",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const universe = await ensureUniverse(userId);
      const result = await prisma.$transaction(async (tx) => {
        await lockUniverseTimeline(tx, universe.id);
        return recomputeUniverseState(tx, universe.id);
      });
      return reply.send({ recompute: result });
    },
  );
};

export default timelineRoutes;
