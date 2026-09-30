import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { prisma } from "../../infrastructure/database/prisma.js";
import {
  PilotKnowledgeError,
  requireOwnedAccess,
  resolvePilotKnowledgeAccess,
  withPilotKnowledgeAvailability,
} from "./pilot-knowledge.access.js";
import {
  PILOT_SYNC_SCOPES,
  getPilotKnowledgeStatus,
  refreshDriverKnowledge,
  type PilotRefreshScope,
} from "./pilot-knowledge.refresh.js";
import { PROFILE_BIOGRAPHY_DISPLAY_CAP } from "./pilot-knowledge.policy.js";
import { getPilotKnowledgeView } from "./pilot-knowledge.read.js";
import { createLlmBiographyComposer } from "./biography.composer.js";
import { ensurePilotKnowledgeProvisioned } from "./pilot-knowledge.provision.js";
import {
  createUniverseDriverRelationship,
  deleteUniverseDriverRelationship,
  updateUniverseDriverRelationship,
} from "./pilot-knowledge.relationships.js";
import type { ExternalDriverKnowledgeProvider } from "./providers/provider.types.js";
import type { GenerationProvider } from "../generation/generation.assembly.js";

export type PilotKnowledgeRoutesOptions = {
  readonly providers?: readonly ExternalDriverKnowledgeProvider[];
  readonly biographyProvider?: GenerationProvider;
};

const characterParamsSchema = z.object({ characterId: z.string().uuid() }).strict();
const relationshipParamsSchema = z.object({ id: z.string().uuid() }).strict();
const listQuerySchema = z.object({ topic: z.string().max(200).optional() }).strict();

const kindEnum = z.enum([
  "ROMANTIC_PARTNER",
  "SPOUSE",
  "PARENT",
  "CHILD",
  "SIBLING",
  "TEAMMATE",
  "TEAM_RELATION",
  "MENTOR",
  "OTHER_PUBLIC_RELATION",
]);
const stateEnum = z.enum(["ACTIVE", "ENDED", "UNKNOWN"]);
const targetEnum = z.enum(["DRIVER", "PUBLIC_PERSON", "CHARACTER"]);

const relationshipBodySchema = z
  .object({
    kind: kindEnum,
    targetType: targetEnum,
    targetCharacterId: z.string().uuid().nullish(),
    targetWikidataQid: z.string().max(32).nullish(),
    displayName: z.string().trim().min(1).max(120),
    state: stateEnum.default("UNKNOWN"),
    validFrom: z.coerce.date().nullish(),
    validTo: z.coerce.date().nullish(),
  })
  .strict();

const relationshipPatchSchema = relationshipBodySchema.partial().strict();

const biographyBodySchema = z
  .object({
    display: z.string().trim().min(1).max(PROFILE_BIOGRAPHY_DISPLAY_CAP),
  })
  .strict();

const refreshBodySchema = z
  .object({ scope: z.enum(["ALL", ...PILOT_SYNC_SCOPES]).default("ALL") })
  .strict()
  .optional();

function sendInvalid(reply: FastifyReply, message = "Dados inválidos") {
  return reply.code(400).send({ error: message, code: "VALIDATION_ERROR" });
}

function sendPilotError(reply: FastifyReply, error: unknown): boolean {
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

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<string | null> {
  const userId = request.user?.id;
  if (!userId) {
    void reply.code(401).send({ error: "Não autenticado", code: "UNAUTHENTICATED" });
    return null;
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || user.role !== "ADMIN") {
    void reply.code(403).send({
      error: "Apenas administradores podem executar este refresh",
      code: "FORBIDDEN",
    });
    return null;
  }
  return userId;
}

export const pilotKnowledgeRoutes: FastifyPluginAsync<PilotKnowledgeRoutesOptions> = async (
  fastify,
  options,
) => {
  const providers = options.providers ?? [];

  fastify.get(
    "/api/pilot-knowledge/drivers/:characterId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = characterParamsSchema.safeParse(request.params);
      if (!params.success) return sendInvalid(reply, "Identificador inválido");
      const query = listQuerySchema.safeParse(request.query);
      if (!query.success) return sendInvalid(reply, "Consulta inválida");
      try {
        const access = await resolvePilotKnowledgeAccess(request.user!.id, params.data.characterId);
        const character = requireOwnedAccess(access);
        const provision = await withPilotKnowledgeAvailability(() =>
          ensurePilotKnowledgeProvisioned(character.id, new Date(), {
            ...(options.biographyProvider
              ? { biographyComposer: createLlmBiographyComposer(options.biographyProvider) }
              : {}),
          }),
        );
        const pilot = await withPilotKnowledgeAvailability(() =>
          getPilotKnowledgeView(params.data.characterId, { topic: query.data.topic ?? null }),
        );
        const lastRun = await prisma.externalSyncRun.findFirst({
          where: {
            scope: { in: [...PILOT_SYNC_SCOPES] },
            triggeredById: request.user!.id,
          },
          orderBy: [{ startedAt: "desc" }],
          select: { status: true, startedAt: true, finishedAt: true },
        });
        return reply.send({
          pilot,
          sync: {
            providersConfigured: providers.length > 0,
            provisioned: provision.outcome === "PROVISIONED",
            lastStatus: lastRun?.status ?? null,
            lastAt: lastRun?.startedAt ?? null,
          },
        });
      } catch (error) {
        if (sendPilotError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.patch(
    "/api/pilot-knowledge/drivers/:characterId/biography",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = characterParamsSchema.safeParse(request.params);
      if (!params.success) return sendInvalid(reply, "Identificador inválido");
      const body = biographyBodySchema.safeParse(request.body);
      if (!body.success) return sendInvalid(reply, "Biografia inválida");
      try {
        const access = await resolvePilotKnowledgeAccess(request.user!.id, params.data.characterId);
        const character = requireOwnedAccess(access);
        const updated = await prisma.character.update({
          where: { id: character.id },
          data: { biography: body.data.display },
          select: { biography: true },
        });
        return reply.send({
          biography: { display: updated.biography, origin: "UNIVERSE" as const },
        });
      } catch (error) {
        if (sendPilotError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.delete(
    "/api/pilot-knowledge/drivers/:characterId/biography",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = characterParamsSchema.safeParse(request.params);
      if (!params.success) return sendInvalid(reply, "Identificador inválido");
      try {
        const access = await resolvePilotKnowledgeAccess(request.user!.id, params.data.characterId);
        const character = requireOwnedAccess(access);
        await prisma.character.update({
          where: { id: character.id },
          data: { biography: null },
        });
        return reply.code(204).send();
      } catch (error) {
        if (sendPilotError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.post(
    "/api/pilot-knowledge/drivers/:characterId/refresh",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = characterParamsSchema.safeParse(request.params);
      if (!params.success) return sendInvalid(reply, "Identificador inválido");
      const body = refreshBodySchema.safeParse(request.body ?? {});
      if (!body.success) return sendInvalid(reply, "Escopo inválido");
      const adminId = await requireAdmin(request, reply);
      if (!adminId) return;
      try {
        const access = await resolvePilotKnowledgeAccess(request.user!.id, params.data.characterId);
        requireOwnedAccess(access);
        const binding = await prisma.externalBindingDriver.findFirst({
          where: { characterId: params.data.characterId },
          orderBy: { createdAt: "asc" },
          select: { externalDriverId: true },
        });
        if (!binding) {
          throw new PilotKnowledgeError(
            "DRIVER_NOT_FOUND",
            "Este piloto não possui vínculo externo",
            404,
          );
        }
        const result = await refreshDriverKnowledge({
          externalDriverId: binding.externalDriverId,
          scope: (body.data?.scope ?? "ALL") as PilotRefreshScope,
          providers,
          triggeredById: adminId,
        });
        return reply.send({ refresh: result });
      } catch (error) {
        if (sendPilotError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.get(
    "/api/pilot-knowledge/status",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const adminId = await requireAdmin(request, reply);
      if (!adminId) return;
      try {
        const status = await withPilotKnowledgeAvailability(() => getPilotKnowledgeStatus());
        return reply.send({ status });
      } catch (error) {
        if (sendPilotError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.post(
    "/api/pilot-knowledge/drivers/:characterId/relationships",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = characterParamsSchema.safeParse(request.params);
      if (!params.success) return sendInvalid(reply, "Identificador inválido");
      const body = relationshipBodySchema.safeParse(request.body);
      if (!body.success) return sendInvalid(reply);
      try {
        const relationship = await createUniverseDriverRelationship(
          request.user!.id,
          params.data.characterId,
          {
            kind: body.data.kind,
            targetType: body.data.targetType,
            targetCharacterId: body.data.targetCharacterId ?? null,
            targetWikidataQid: body.data.targetWikidataQid ?? null,
            displayName: body.data.displayName,
            state: body.data.state,
            validFrom: body.data.validFrom ?? null,
            validTo: body.data.validTo ?? null,
          },
        );
        return reply.code(201).send({ relationship });
      } catch (error) {
        if (sendPilotError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.patch(
    "/api/pilot-knowledge/relationships/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = relationshipParamsSchema.safeParse(request.params);
      if (!params.success) return sendInvalid(reply, "Identificador inválido");
      const body = relationshipPatchSchema.safeParse(request.body);
      if (!body.success) return sendInvalid(reply);
      try {
        const relationship = await updateUniverseDriverRelationship(
          request.user!.id,
          params.data.id,
          {
            ...(body.data.kind !== undefined ? { kind: body.data.kind } : {}),
            ...(body.data.state !== undefined ? { state: body.data.state } : {}),
            ...(body.data.displayName !== undefined ? { displayName: body.data.displayName } : {}),
            ...(body.data.validFrom !== undefined ? { validFrom: body.data.validFrom ?? null } : {}),
            ...(body.data.validTo !== undefined ? { validTo: body.data.validTo ?? null } : {}),
            ...(body.data.targetWikidataQid !== undefined
              ? { targetWikidataQid: body.data.targetWikidataQid ?? null }
              : {}),
          },
        );
        return reply.send({ relationship });
      } catch (error) {
        if (sendPilotError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.delete(
    "/api/pilot-knowledge/relationships/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = relationshipParamsSchema.safeParse(request.params);
      if (!params.success) return sendInvalid(reply, "Identificador inválido");
      try {
        await deleteUniverseDriverRelationship(request.user!.id, params.data.id);
        return reply.code(204).send();
      } catch (error) {
        if (sendPilotError(reply, error)) return;
        throw error;
      }
    },
  );
};
