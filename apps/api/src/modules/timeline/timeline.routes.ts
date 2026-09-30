import type { FastifyPluginAsync } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../infrastructure/database/prisma.js";
import { ensureUniverse } from "../universe/universe.service.js";
import {
  advanceUniverseTime,
  applyRetroactiveCorrection,
  listWorldSnapshots,
  lockUniverseTimeline,
  recomputeUniverseState,
  TimelineError,
} from "./timeline.service.js";
import {
  TIMELINE_KINDS,
  getTimelineEventDetail,
  queryTimelineItems,
} from "./timeline.read.js";
import { buildDivergenceReport } from "./divergence.service.js";

const advanceBodySchema = z
  .object({
    worldDate: z.string().datetime({ offset: true }),
    currentSeasonId: z.string().uuid().nullable().optional(),
    currentRaceId: z.string().uuid().nullable().optional(),
    currentSession: z
      .enum(["PRACTICE", "SPRINT_QUALIFYING", "SPRINT", "QUALIFYING", "RACE"])
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

const timelineQuerySchema = z
  .object({
    seasonId: z.string().uuid().optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    driverProfileId: z.string().uuid().optional(),
    teamId: z.string().uuid().optional(),
    raceId: z.string().uuid().optional(),
    kind: z.enum(TIMELINE_KINDS).optional(),
    correctionsOnly: z.enum(["true", "false"]).optional(),
    cursor: z.string().max(80).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

const timelineEventParamsSchema = z.object({
  eventId: z.string().uuid("Identificador de evento inválido"),
});

const divergenceQuerySchema = z
  .object({
    seasonId: z.string().uuid("Identificador de temporada inválido"),
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
      const query = timelineQuerySchema.safeParse(request.query ?? {});
      if (!query.success) {
        return reply.code(400).send({
          error: "Filtros inválidos",
          code: "VALIDATION_ERROR",
          issues: query.error.issues,
        });
      }
      const universe = await ensureUniverse(userId);
      const page = await queryTimelineItems(universe.id, {
        seasonId: query.data.seasonId,
        from: query.data.from ? new Date(query.data.from) : undefined,
        to: query.data.to ? new Date(query.data.to) : undefined,
        driverProfileId: query.data.driverProfileId,
        teamId: query.data.teamId,
        raceId: query.data.raceId,
        kind: query.data.kind,
        correctionsOnly:
          query.data.correctionsOnly === undefined
            ? undefined
            : query.data.correctionsOnly === "true",
        cursor: query.data.cursor,
        limit: query.data.limit,
      });
      return reply.send({
        events: page.items,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        beyondScanLimit: page.beyondScanLimit,
      });
    },
  );

  fastify.get(
    "/api/timeline/events/:eventId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = timelineEventParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const universe = await ensureUniverse(userId);
      try {
        const detail = await getTimelineEventDetail(
          universe.id,
          params.data.eventId,
        );
        return reply.send(detail);
      } catch (error) {
        if (sendTimelineError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.get(
    "/api/timeline/divergence",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const query = divergenceQuerySchema.safeParse(request.query ?? {});
      if (!query.success) {
        return reply.code(400).send({
          error: "Filtros inválidos",
          code: "VALIDATION_ERROR",
          issues: query.error.issues,
        });
      }
      const universe = await ensureUniverse(userId);
      try {
        const divergence = await buildDivergenceReport(
          universe.id,
          query.data.seasonId,
        );
        return reply.send({ divergence });
      } catch (error) {
        if (sendTimelineError(reply, error)) return;
        throw error;
      }
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
