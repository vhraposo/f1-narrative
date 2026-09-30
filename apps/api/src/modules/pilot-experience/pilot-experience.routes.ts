import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";

import { prisma } from "../../infrastructure/database/prisma.js";
import {
  PilotKnowledgeError,
  requireOwnedAccess,
  resolvePilotKnowledgeAccess,
  withPilotKnowledgeAvailability,
} from "../pilot-knowledge/pilot-knowledge.access.js";
import { applyPersonaEvolution, previewPersonaEvolution } from "./persona-evolution.service.js";
import { reconcilePilotExperiences } from "./pilot-experience.reconcile.js";

const characterParamsSchema = z.object({ characterId: z.string().uuid() }).strict();
const memoryParamsSchema = z
  .object({ characterId: z.string().uuid(), memoryId: z.string().uuid() })
  .strict();

const memoryTypeEnum = z.enum([
  "CAREER_MILESTONE",
  "SPORTING_VICTORY",
  "SPORTING_DEFEAT",
  "CHAMPIONSHIP",
  "TEAM_CHANGE",
  "RELATIONSHIP_EVENT",
  "CONFLICT",
  "PERSONAL_MILESTONE",
  "NARRATIVE_EVENT",
  "SIGNIFICANT_RACE",
  "OTHER_RELEVANT_EXPERIENCE",
]);

const importanceEnum = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const memoryStatusEnum = z.enum(["ACTIVE", "ARCHIVED", "SUPERSEDED", "INVALIDATED"]);
const derivationEnum = z.enum(["MANUAL", "DERIVED", "RULE_DERIVED"]);

const listQuerySchema = z
  .object({
    status: memoryStatusEnum.optional(),
    type: memoryTypeEnum.optional(),
    importance: importanceEnum.optional(),
    derivation: derivationEnum.optional(),
  })
  .strict();

const createMemorySchema = z
  .object({
    content: z.string().trim().min(1).max(600),
    summary: z.string().trim().max(200).nullish(),
    memoryType: memoryTypeEnum.nullish(),
    importance: importanceEnum.default("MEDIUM"),
    occurredAt: z.coerce.date().nullish(),
  })
  .strict();

const patchMemorySchema = z
  .object({
    content: z.string().trim().min(1).max(600).optional(),
    summary: z.string().trim().max(200).nullish(),
    memoryType: memoryTypeEnum.nullish(),
    importance: importanceEnum.optional(),
    status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  })
  .strict();

const reconcileBodySchema = z
  .object({
    curated: z
      .array(
        z
          .object({
            sourceKey: z.string().trim().min(1).max(120),
            experienceType: memoryTypeEnum,
            title: z.string().trim().min(1).max(200),
            summary: z.string().trim().max(400).nullish(),
            salience: importanceEnum.default("MEDIUM"),
            occurredAt: z.coerce.date().nullish(),
            seasonYear: z.number().int().min(1900).max(2200).nullish(),
          })
          .strict(),
      )
      .max(20)
      .optional(),
  })
  .strict()
  .optional();

const evolutionApplySchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    expectedPendingFingerprint: z.string().trim().min(1).max(128),
  })
  .strict();

function sendInvalid(reply: FastifyReply, message = "Dados inválidos") {
  return reply.code(400).send({ error: message, code: "VALIDATION_ERROR" });
}

function sendPilotContextError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof PilotKnowledgeError) {
    reply.code(error.statusCode).send({ error: error.message, code: error.code });
    return true;
  }
  if (error instanceof z.ZodError) {
    sendInvalid(reply);
    return true;
  }
  return false;
}

function memoryParticipantWhere(characterId: string, universeId: string | null) {
  return {
    participants: { some: { characterId } },
    OR: [{ universeId }, { universeId: null }],
  };
}

function serializeMemory(memory: {
  id: string;
  content: string;
  summary: string | null;
  memoryType: string | null;
  importance: string;
  derivation: string;
  status: string;
  revision: number;
  derivedKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  experience: {
    id: string;
    experienceType: string;
    source: string;
    sourceKey: string;
    seasonYear: number | null;
    raceId: string | null;
    occurredAt: Date | null;
  } | null;
  eventId: string | null;
  timelineEventId: string | null;
}) {
  return {
    id: memory.id,
    content: memory.content,
    summary: memory.summary,
    memoryType: memory.memoryType,
    importance: memory.importance,
    derivation: memory.derivation,
    status: memory.status,
    revision: memory.revision,
    source: memory.experience
      ? {
          experienceId: memory.experience.id,
          type: memory.experience.experienceType,
          source: memory.experience.source,
          sourceKey: memory.experience.sourceKey,
          seasonYear: memory.experience.seasonYear,
          raceId: memory.experience.raceId,
          occurredAt: memory.experience.occurredAt,
        }
      : memory.eventId
        ? { experienceId: null, source: "EVENT", sourceKey: `event:${memory.eventId}` }
        : memory.timelineEventId
          ? { experienceId: null, source: "TIMELINE", sourceKey: memory.timelineEventId }
          : { experienceId: null, source: "MANUAL", sourceKey: null },
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}

const memoryInclude = {
  experience: {
    select: {
      id: true,
      experienceType: true,
      source: true,
      sourceKey: true,
      seasonYear: true,
      raceId: true,
      occurredAt: true,
    },
  },
} as const;

export const pilotExperienceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/pilot-context/:characterId/memories",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = characterParamsSchema.safeParse(request.params);
      if (!params.success) return sendInvalid(reply, "Identificador inválido");
      const query = listQuerySchema.safeParse(request.query);
      if (!query.success) return sendInvalid(reply, "Consulta inválida");
      try {
        const access = await resolvePilotKnowledgeAccess(request.user!.id, params.data.characterId);
        const character = requireOwnedAccess(access);
        const memories = await withPilotKnowledgeAvailability(() =>
          prisma.memory.findMany({
            where: {
              ...memoryParticipantWhere(character.id, character.universeId),
              ...(query.data.status ? { status: query.data.status } : {}),
              ...(query.data.type ? { memoryType: query.data.type } : {}),
              ...(query.data.importance ? { importance: query.data.importance } : {}),
              ...(query.data.derivation ? { derivation: query.data.derivation } : {}),
            },
            include: memoryInclude,
            orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          }),
        );
        return reply.send({ memories: memories.map(serializeMemory) });
      } catch (error) {
        if (sendPilotContextError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.post(
    "/api/pilot-context/:characterId/memories",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = characterParamsSchema.safeParse(request.params);
      if (!params.success) return sendInvalid(reply, "Identificador inválido");
      const body = createMemorySchema.safeParse(request.body);
      if (!body.success) return sendInvalid(reply);
      try {
        const access = await resolvePilotKnowledgeAccess(request.user!.id, params.data.characterId);
        const character = requireOwnedAccess(access);
        const memory = await withPilotKnowledgeAvailability(() =>
          prisma.memory.create({
            data: {
              universeId: character.universeId,
              derivation: "MANUAL",
              status: "ACTIVE",
              revision: 1,
              importance: body.data.importance,
              memoryType: body.data.memoryType ?? null,
              source: "USER_DEFINED",
              content: body.data.content,
              summary: body.data.summary ?? null,
              participants: { create: [{ characterId: character.id }] },
            },
            include: memoryInclude,
          }),
        );
        return reply.code(201).send({ memory: serializeMemory(memory) });
      } catch (error) {
        if (sendPilotContextError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.patch(
    "/api/pilot-context/:characterId/memories/:memoryId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = memoryParamsSchema.safeParse(request.params);
      if (!params.success) return sendInvalid(reply, "Identificador inválido");
      const body = patchMemorySchema.safeParse(request.body);
      if (!body.success) return sendInvalid(reply);
      try {
        const access = await resolvePilotKnowledgeAccess(request.user!.id, params.data.characterId);
        const character = requireOwnedAccess(access);
        const existing = await prisma.memory.findFirst({
          where: {
            id: params.data.memoryId,
            ...memoryParticipantWhere(character.id, character.universeId),
          },
          select: { id: true, derivation: true },
        });
        if (!existing) {
          throw new PilotKnowledgeError("NOT_FOUND", "Memória não encontrada", 404);
        }
        if (existing.derivation !== "MANUAL") {
          throw new PilotKnowledgeError(
            "VALIDATION_ERROR",
            "Memória derivada é imutável; crie uma memória manual ou corrija a fonte.",
            409,
          );
        }
        const memory = await prisma.memory.update({
          where: { id: existing.id },
          data: {
            ...(body.data.content !== undefined ? { content: body.data.content } : {}),
            ...(body.data.summary !== undefined ? { summary: body.data.summary ?? null } : {}),
            ...(body.data.memoryType !== undefined ? { memoryType: body.data.memoryType ?? null } : {}),
            ...(body.data.importance !== undefined ? { importance: body.data.importance } : {}),
            ...(body.data.status !== undefined ? { status: body.data.status } : {}),
          },
          include: memoryInclude,
        });
        return reply.send({ memory: serializeMemory(memory) });
      } catch (error) {
        if (sendPilotContextError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.get(
    "/api/pilot-context/:characterId/experiences",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = characterParamsSchema.safeParse(request.params);
      if (!params.success) return sendInvalid(reply, "Identificador inválido");
      try {
        const access = await resolvePilotKnowledgeAccess(request.user!.id, params.data.characterId);
        const character = requireOwnedAccess(access);
        const experiences = await withPilotKnowledgeAvailability(() =>
          prisma.pilotExperience.findMany({
            where: { universeId: character.universeId ?? "", characterId: character.id },
            orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }, { id: "asc" }],
          }),
        );
        return reply.send({
          experiences: experiences.map((experience) => ({
            id: experience.id,
            experienceType: experience.experienceType,
            source: experience.source,
            sourceKey: experience.sourceKey,
            seasonYear: experience.seasonYear,
            raceId: experience.raceId,
            eventId: experience.eventId,
            timelineEventId: experience.timelineEventId,
            occurredAt: experience.occurredAt,
            salience: experience.salience,
            title: experience.title,
            summary: experience.summary,
            status: experience.status,
            invalidationReason: experience.invalidationReason,
            revision: experience.revision,
          })),
        });
      } catch (error) {
        if (sendPilotContextError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.post(
    "/api/pilot-context/:characterId/reconcile",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = characterParamsSchema.safeParse(request.params);
      if (!params.success) return sendInvalid(reply, "Identificador inválido");
      const body = reconcileBodySchema.safeParse(request.body ?? {});
      if (!body.success) return sendInvalid(reply);
      try {
        const access = await resolvePilotKnowledgeAccess(request.user!.id, params.data.characterId);
        const character = requireOwnedAccess(access);
        if (!character.universeId) {
          throw new PilotKnowledgeError("VALIDATION_ERROR", "Personagem sem Universe", 400);
        }
        const report = await withPilotKnowledgeAvailability(() =>
          reconcilePilotExperiences({
            universeId: character.universeId as string,
            characterId: character.id,
            curated: body.data?.curated?.map((entry) => ({
              sourceKey: entry.sourceKey,
              experienceType: entry.experienceType,
              title: entry.title,
              summary: entry.summary ?? null,
              salience: entry.salience,
              occurredAt: entry.occurredAt ?? null,
              seasonYear: entry.seasonYear ?? null,
            })),
          }),
        );
        return reply.send({ reconcile: report });
      } catch (error) {
        if (sendPilotContextError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.post(
    "/api/pilot-context/:characterId/evolution/preview",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = characterParamsSchema.safeParse(request.params);
      if (!params.success) return sendInvalid(reply, "Identificador inválido");
      try {
        const access = await resolvePilotKnowledgeAccess(request.user!.id, params.data.characterId);
        const character = requireOwnedAccess(access);
        if (!character.universeId) {
          throw new PilotKnowledgeError("VALIDATION_ERROR", "Personagem sem Universe", 400);
        }
        const preview = await withPilotKnowledgeAvailability(() =>
          previewPersonaEvolution(character.universeId as string, character.id),
        );
        return reply.send({ preview });
      } catch (error) {
        if (sendPilotContextError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.post(
    "/api/pilot-context/:characterId/evolution/apply",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = characterParamsSchema.safeParse(request.params);
      if (!params.success) return sendInvalid(reply, "Identificador inválido");
      const body = evolutionApplySchema.safeParse(request.body);
      if (!body.success) return sendInvalid(reply);
      try {
        const access = await resolvePilotKnowledgeAccess(request.user!.id, params.data.characterId);
        const character = requireOwnedAccess(access);
        if (!character.universeId) {
          throw new PilotKnowledgeError("VALIDATION_ERROR", "Personagem sem Universe", 400);
        }
        const result = await withPilotKnowledgeAvailability(() =>
          applyPersonaEvolution(character.universeId as string, character.id, {
            expectedRevision: body.data.expectedRevision,
            expectedPendingFingerprint: body.data.expectedPendingFingerprint,
          }),
        );
        return reply.send({ evolution: result });
      } catch (error) {
        if (sendPilotContextError(reply, error)) return;
        throw error;
      }
    },
  );
};
