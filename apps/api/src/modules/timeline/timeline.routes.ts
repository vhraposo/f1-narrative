import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../../infrastructure/database/prisma.js";
import { ensureUniverse } from "../universe/universe.service.js";
import {
  advanceUniverseTime,
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
import { buildTimelineEventEditModel } from "./timeline.editor.js";
import {
  applyChampionChange,
  getChampionDetail,
  listUniverseChampions,
  previewChampionChange,
} from "./champions.service.js";
import { applyCorrection } from "./correction.apply.js";
import { previewCorrection } from "./correction.preview.js";
import type { CorrectionCommand } from "./correction.service.js";

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

const championParamsSchema = z.object({
  seasonId: z.string().uuid("Identificador de temporada inválido"),
});

const championPreviewSchema = z.discriminatedUnion("mode", [
  z
    .object({ mode: z.literal("EDIT"), driverProfileId: z.string().uuid() })
    .strict(),
  z.object({ mode: z.literal("RESTORE") }).strict(),
]);

const championApplySchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("EDIT"),
      driverProfileId: z.string().uuid(),
      previewToken: z.string().min(16).max(80),
    })
    .strict(),
  z
    .object({
      mode: z.literal("RESTORE"),
      previewToken: z.string().min(16).max(80),
    })
    .strict(),
]);

const worldDateSchema = z.string().datetime({ offset: true });
const supersedesSchema = z.string().uuid().nullable().optional();

const raceResultCorrectionSchema = z
  .object({
    kind: z.literal("RACE_RESULT_CORRECTED"),
    worldDate: worldDateSchema,
    raceId: z.string().uuid(),
    driverProfileId: z.string().uuid(),
    position: z.number().int().min(1).nullable().optional(),
    grid: z.number().int().min(0).nullable().optional(),
    status: z.string().trim().min(1).max(40).nullable().optional(),
    supersedesId: supersedesSchema,
  })
  .strict();

const sprintCorrectionSchema = z
  .object({
    kind: z.literal("RACE_SESSION_RESULT_CORRECTED"),
    worldDate: worldDateSchema,
    raceId: z.string().uuid(),
    driverProfileId: z.string().uuid(),
    position: z.number().int().min(1).nullable().optional(),
    status: z.string().trim().min(1).max(40).nullable().optional(),
    eligibility: z
      .object({
        neutralizedStart: z.boolean(),
        distancePct: z.number().min(0).max(100),
      })
      .nullable()
      .optional(),
    supersedesId: supersedesSchema,
  })
  .strict();

const numberCorrectionSchema = z
  .object({
    kind: z.literal("NUMBER_CORRECTED"),
    worldDate: worldDateSchema,
    seasonId: z.string().uuid(),
    driverProfileId: z.string().uuid(),
    number: z.number().int().min(1).max(99).nullable(),
    supersedesId: supersedesSchema,
  })
  .strict();

const standingCorrectionSchema = z
  .object({
    kind: z.literal("STANDING_CORRECTED"),
    worldDate: worldDateSchema,
    seasonId: z.string().uuid(),
    driverProfileId: z.string().uuid(),
    points: z.number().optional(),
    wins: z.number().int().min(0).optional(),
    podiums: z.number().int().min(0).optional(),
    position: z.number().int().min(1).nullable().optional(),
    supersedesId: supersedesSchema,
  })
  .strict();

const calendarCorrectionSchema = z
  .object({
    kind: z.literal("RACE_UPDATED"),
    worldDate: worldDateSchema,
    raceId: z.string().uuid(),
    name: z.string().trim().min(1).max(120).optional(),
    date: z.string().datetime({ offset: true }).nullable().optional(),
    round: z.number().int().min(1).optional(),
    status: z.string().trim().min(1).max(30).optional(),
    sprintOverride: z.boolean().nullable().optional(),
    supersedesId: supersedesSchema,
  })
  .strict();

const correctionCommandSchema = z.discriminatedUnion("kind", [
  raceResultCorrectionSchema,
  sprintCorrectionSchema,
  numberCorrectionSchema,
  standingCorrectionSchema,
  calendarCorrectionSchema,
]);

const correctionApplyBodySchema = z
  .object({
    command: correctionCommandSchema,
    previewToken: z.string().min(16).max(80),
  })
  .strict();

function hasDerivedPointsField(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const record = body as Record<string, unknown>;
  return (
    "points" in record &&
    (record.kind === "RACE_RESULT_CORRECTED" ||
      record.kind === "RACE_SESSION_RESULT_CORRECTED")
  );
}

function toCorrectionCommand(
  data: z.infer<typeof correctionCommandSchema>,
): CorrectionCommand {
  switch (data.kind) {
    case "RACE_RESULT_CORRECTED":
      return { ...data, worldDate: new Date(data.worldDate), supersedesId: data.supersedesId ?? null };
    case "RACE_SESSION_RESULT_CORRECTED":
      return { ...data, worldDate: new Date(data.worldDate), supersedesId: data.supersedesId ?? null };
    case "NUMBER_CORRECTED":
      return { ...data, worldDate: new Date(data.worldDate), supersedesId: data.supersedesId ?? null };
    case "STANDING_CORRECTED":
      return { ...data, worldDate: new Date(data.worldDate), supersedesId: data.supersedesId ?? null };
    default:
      return {
        ...data,
        worldDate: new Date(data.worldDate),
        date:
          data.date === undefined
            ? undefined
            : data.date === null
              ? null
              : new Date(data.date),
        supersedesId: data.supersedesId ?? null,
      };
  }
}

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
        const edit = await buildTimelineEventEditModel(
          universe.id,
          detail.item,
        );
        return reply.send({ ...detail, edit });
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
    async (_request, reply) => {
      return reply.code(409).send({
        error:
          "Este endpoint foi desativado por segurança; use /api/timeline/corrections/preview e /api/timeline/corrections/apply.",
        code: "USE_TIMELINE_CORRECTION",
      });
    },
  );

  fastify.get(
    "/api/timeline/champions",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const universe = await ensureUniverse(request.user!.id);
      const champions = await listUniverseChampions(universe.id);
      return reply.send({ champions });
    },
  );

  fastify.get(
    "/api/timeline/champions/:seasonId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = championParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const universe = await ensureUniverse(request.user!.id);
      try {
        const detail = await getChampionDetail(universe.id, params.data.seasonId);
        return reply.send(detail);
      } catch (error) {
        if (sendTimelineError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.post(
    "/api/timeline/champions/:seasonId/preview",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = championParamsSchema.safeParse(request.params);
      const body = championPreviewSchema.safeParse(request.body ?? {});
      if (!params.success || !body.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          ...(body.success ? {} : { issues: body.error.issues }),
        });
      }
      const universe = await ensureUniverse(request.user!.id);
      try {
        const preview = await previewChampionChange(
          universe.id,
          params.data.seasonId,
          body.data.mode,
          body.data.mode === "EDIT" ? body.data.driverProfileId : undefined,
        );
        return reply.send({ preview });
      } catch (error) {
        if (sendTimelineError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.post(
    "/api/timeline/champions/:seasonId/apply",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = championParamsSchema.safeParse(request.params);
      const body = championApplySchema.safeParse(request.body ?? {});
      if (!params.success || !body.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          ...(body.success ? {} : { issues: body.error.issues }),
        });
      }
      const universe = await ensureUniverse(request.user!.id);
      try {
        const result = await applyChampionChange(
          universe.id,
          params.data.seasonId,
          body.data.mode,
          body.data.previewToken,
          body.data.mode === "EDIT" ? body.data.driverProfileId : undefined,
        );
        return reply.send(result);
      } catch (error) {
        if (sendTimelineError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.post(
    "/api/timeline/corrections/preview",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const raw = request.body ?? {};
      if (hasDerivedPointsField(raw)) {
        return reply.code(400).send({
          error:
            "points é derivado de position e não pode ser corrigido diretamente.",
          code: "DERIVED_FIELD",
        });
      }
      const parsed = correctionCommandSchema.safeParse(raw);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }
      const universe = await ensureUniverse(userId);
      try {
        const preview = await previewCorrection(
          universe.id,
          toCorrectionCommand(parsed.data),
        );
        return reply.send({ preview });
      } catch (error) {
        if (sendTimelineError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.post(
    "/api/timeline/corrections/apply",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const raw = request.body ?? {};
      const commandField =
        typeof raw === "object" && raw !== null
          ? (raw as Record<string, unknown>).command
          : undefined;
      if (hasDerivedPointsField(commandField)) {
        return reply.code(400).send({
          error:
            "points é derivado de position e não pode ser corrigido diretamente.",
          code: "DERIVED_FIELD",
        });
      }
      const parsed = correctionApplyBodySchema.safeParse(raw);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }
      const universe = await ensureUniverse(userId);
      try {
        const event = await applyCorrection(
          universe.id,
          toCorrectionCommand(parsed.data.command),
          parsed.data.previewToken,
        );
        return reply.send({
          event: {
            id: event.id,
            sequence: event.sequence,
            kind: event.kind,
            worldDate: event.worldDate,
            supersedesId: event.supersedesId,
          },
        });
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
