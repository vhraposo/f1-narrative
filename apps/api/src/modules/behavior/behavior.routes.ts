import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../../infrastructure/database/prisma.js";
import { ensureUniverse } from "../universe/universe.service.js";
import { evaluateBehaviorDecision } from "./behavior.decision.js";
import { executeBehaviorDecision } from "./behavior.execution.js";
import { GOAL_PRIORITIES } from "./behavior.goals.js";
import {
  BehaviorError,
  type BehaviorDecisionRequest,
  type BehaviorTrigger,
} from "./behavior.types.js";

const TRIGGERS = [
  "MESSAGE_RECEIVED",
  "EVENT_CREATED",
  "RACE_SESSION_COMPLETED",
  "RACE_FINISHED",
  "RELATIONSHIP_CHANGED",
  "MEMORY_CREATED",
  "SCHEDULE_DUE",
  "WORLD_ADVANCED",
  "USER_REQUESTED",
  "AUTONOMOUS_TICK",
] as const;

const SESSIONS = ["PRACTICE", "SPRINT_QUALIFYING", "SPRINT", "QUALIFYING", "RACE"] as const;

const GOAL_KINDS = [
  "WIN_RACE",
  "WIN_CHAMPIONSHIP",
  "OUTPERFORM_TEAMMATE",
  "RECOVER_AFTER_SETBACK",
  "PROTECT_RELATIONSHIP",
  "CONFRONT_RIVAL",
  "SUPPORT_FRIEND",
  "MAINTAIN_POSITION",
  "BUILD_REPUTATION",
  "RESTORE_CONFIDENCE",
  "USER_DEFINED_GOAL",
] as const;

const GOAL_STATUSES = ["ACTIVE", "PAUSED", "COMPLETED", "FAILED", "EXPIRED", "CANCELLED"] as const;

const goalQuerySchema = z.object({ characterId: z.string().uuid() });

const createGoalSchema = z
  .object({
    characterId: z.string().uuid(),
    kind: z.enum(GOAL_KINDS),
    priority: z.number().int().min(1).max(100).optional(),
    targetCharacterId: z.string().uuid().nullable().optional(),
    targetRaceId: z.string().uuid().nullable().optional(),
    seasonId: z.string().uuid().nullable().optional(),
    validTo: z.string().datetime().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const updateGoalSchema = z
  .object({
    status: z.enum(GOAL_STATUSES).optional(),
    priority: z.number().int().min(1).max(100).optional(),
  })
  .strict();

const decisionBodySchema = z
  .object({
    characterId: z.string().uuid(),
    trigger: z.enum(TRIGGERS),
    worldDate: z.string().datetime().optional(),
    conversationId: z.string().uuid().nullable().optional(),
    eventId: z.string().uuid().nullable().optional(),
    raceId: z.string().uuid().nullable().optional(),
    session: z.enum(SESSIONS).nullable().optional(),
    userInitiated: z.boolean().optional(),
    targetCharacterId: z.string().uuid().nullable().optional(),
  })
  .strict();

const decisionParamsSchema = z.object({ decisionId: z.string().uuid() });

function sendBehaviorError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof BehaviorError) {
    reply.code(error.statusCode).send({ error: error.message, code: error.code });
    return true;
  }
  return false;
}

async function requireOwnedCharacter(userId: string, characterId: string) {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true, userId: true, universeId: true },
  });
  if (!character) {
    throw new BehaviorError("TARGET_NOT_FOUND", "Personagem não encontrado", 404);
  }
  if (character.userId === userId) return character;
  if (character.universeId) {
    const universe = await ensureUniverse(userId);
    if (character.universeId === universe.id) return character;
  }
  throw new BehaviorError("TARGET_NOT_FOUND", "Personagem não encontrado", 404);
}

export const behaviorRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/behavior/goals",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const query = goalQuerySchema.safeParse(request.query ?? {});
      if (!query.success) {
        return reply.code(400).send({ error: "Consulta inválida", code: "VALIDATION_ERROR" });
      }
      try {
        const character = await requireOwnedCharacter(request.user!.id, query.data.characterId);
        const goals = await prisma.characterGoal.findMany({
          where: { universeId: character.universeId ?? undefined, characterId: character.id },
          orderBy: [{ priority: "desc" }, { kind: "asc" }, { id: "asc" }],
        });
        return reply.send({ goals });
      } catch (error) {
        if (sendBehaviorError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.post(
    "/api/behavior/goals",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const body = createGoalSchema.safeParse(request.body ?? {});
      if (!body.success) {
        return reply.code(400).send({ error: "Dados inválidos", code: "VALIDATION_ERROR" });
      }
      try {
        const character = await requireOwnedCharacter(request.user!.id, body.data.characterId);
        if (!character.universeId) {
          throw new BehaviorError("UNIVERSE_MISMATCH", "Personagem sem Universe", 403);
        }
        if (body.data.targetCharacterId) {
          const target = await prisma.character.findUnique({
            where: { id: body.data.targetCharacterId },
            select: { universeId: true },
          });
          if (!target || target.universeId !== character.universeId) {
            throw new BehaviorError("UNIVERSE_MISMATCH", "Alvo pertence a outro Universe", 403);
          }
        }
        const goal = await prisma.characterGoal.create({
          data: {
            universeId: character.universeId,
            characterId: character.id,
            kind: body.data.kind,
            priority: body.data.priority ?? GOAL_PRIORITIES[body.data.kind],
            status: "ACTIVE",
            source: "MANUAL",
            ruleCode: null,
            fingerprint: null,
            targetCharacterId: body.data.targetCharacterId ?? null,
            targetRaceId: body.data.targetRaceId ?? null,
            seasonId: body.data.seasonId ?? null,
            validFrom: new Date(),
            validTo: body.data.validTo ? new Date(body.data.validTo) : null,
            metadata: (body.data.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          },
        });
        return reply.code(201).send({ goal });
      } catch (error) {
        if (sendBehaviorError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.patch(
    "/api/behavior/goals/:goalId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = z.object({ goalId: z.string().uuid() }).safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Identificador inválido", code: "VALIDATION_ERROR" });
      }
      const body = updateGoalSchema.safeParse(request.body ?? {});
      if (!body.success) {
        return reply.code(400).send({ error: "Dados inválidos", code: "VALIDATION_ERROR" });
      }
      try {
        const goal = await prisma.characterGoal.findUnique({
          where: { id: params.data.goalId },
          select: { id: true, characterId: true, source: true },
        });
        if (!goal) {
          throw new BehaviorError("GOAL_NOT_FOUND", "Goal não encontrado", 404);
        }
        await requireOwnedCharacter(request.user!.id, goal.characterId);
        const updated = await prisma.characterGoal.update({
          where: { id: goal.id },
          data: {
            ...(body.data.status ? { status: body.data.status } : {}),
            ...(body.data.priority ? { priority: body.data.priority } : {}),
          },
        });
        return reply.send({ goal: updated });
      } catch (error) {
        if (sendBehaviorError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.post(
    "/api/behavior/decisions",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const body = decisionBodySchema.safeParse(request.body ?? {});
      if (!body.success) {
        return reply.code(400).send({ error: "Dados inválidos", code: "VALIDATION_ERROR" });
      }
      try {
        const character = await requireOwnedCharacter(request.user!.id, body.data.characterId);
        if (!character.universeId) {
          throw new BehaviorError("UNIVERSE_MISMATCH", "Personagem sem Universe", 403);
        }
        const worldState = await prisma.worldState.findUnique({
          where: { universeId_key: { universeId: character.universeId, key: "default" } },
          select: { currentDate: true },
        });
        const worldDate = body.data.worldDate
          ? new Date(body.data.worldDate)
          : worldState?.currentDate;
        if (!worldDate) {
          throw new BehaviorError("PRECONDITION_FAILED", "WorldState sem currentDate", 400);
        }
        const decisionRequest: BehaviorDecisionRequest = {
          universeId: character.universeId,
          characterId: character.id,
          trigger: body.data.trigger as BehaviorTrigger,
          worldDate,
          conversationId: body.data.conversationId ?? null,
          eventId: body.data.eventId ?? null,
          raceId: body.data.raceId ?? null,
          session: body.data.session ?? null,
          userInitiated: body.data.userInitiated ?? body.data.trigger === "USER_REQUESTED",
          ...(body.data.targetCharacterId
            ? { metadata: { targetCharacterId: body.data.targetCharacterId } }
            : {}),
        };
        const result = await evaluateBehaviorDecision(decisionRequest);
        return reply.code(201).send({ decision: result });
      } catch (error) {
        if (sendBehaviorError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.get(
    "/api/behavior/decisions/:decisionId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = decisionParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Identificador inválido", code: "VALIDATION_ERROR" });
      }
      try {
        const decision = await prisma.aiDecision.findUnique({
          where: { id: params.data.decisionId },
        });
        if (!decision) {
          throw new BehaviorError("GOAL_NOT_FOUND", "Decisão não encontrada", 404);
        }
        await requireOwnedCharacter(request.user!.id, decision.characterId);
        return reply.send({ decision });
      } catch (error) {
        if (sendBehaviorError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.post(
    "/api/behavior/decisions/:decisionId/execute",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = decisionParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Identificador inválido", code: "VALIDATION_ERROR" });
      }
      try {
        const decision = await prisma.aiDecision.findUnique({
          where: { id: params.data.decisionId },
          select: { characterId: true },
        });
        if (!decision) {
          throw new BehaviorError("GOAL_NOT_FOUND", "Decisão não encontrada", 404);
        }
        await requireOwnedCharacter(request.user!.id, decision.characterId);
        const result = await executeBehaviorDecision(params.data.decisionId);
        return reply.send({ execution: result });
      } catch (error) {
        if (sendBehaviorError(reply, error)) return;
        throw error;
      }
    },
  );
};

export default behaviorRoutes;
