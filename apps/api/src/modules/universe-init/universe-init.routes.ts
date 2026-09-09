import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  initializationScopeSchema,
  type InitializationScope,
  universeInitializationBodySchema,
  universeInitializationStatusQuerySchema,
  type UniverseInitializationInput,
} from "./universe-init.schemas.js";
import { UniverseInitError, universeInitService } from "./universe-init.service.js";

function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof UniverseInitError) {
    return reply.code(error.statusCode).send({
      error: error.message,
      code: error.code,
    });
  }
  if (error instanceof Error && error.message.includes("Existem conflitos")) {
    return reply.code(409).send({
      error: error.message,
      code: "CONFLICT",
    });
  }
  throw error;
}

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Role | null> {
  const userId = request.user?.id;
  if (!userId) {
    reply.code(401).send({ error: "Não autenticado", code: "UNAUTHENTICATED" });
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!user || user.role !== "ADMIN") {
    reply.code(403).send({
      error: "Apenas administradores podem inicializar o universo",
      code: "FORBIDDEN",
    });
    return null;
  }
  return user.role;
}

function scopesFromCsv(value?: string): InitializationScope[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  const scopes: InitializationScope[] = [];
  for (const part of parts) {
    const parsed = initializationScopeSchema.safeParse(part);
    if (!parsed.success) return undefined;
    scopes.push(parsed.data);
  }
  return scopes;
}

function inputFrom(body: {
  seasonId: string;
  externalSeasonId: string;
  scopes?: InitializationScope[];
}): UniverseInitializationInput {
  return {
    seasonId: body.seasonId,
    externalSeasonId: body.externalSeasonId,
    scopes: body.scopes,
  };
}

export const universeInitRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/api/universe/initialization/preview",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const adminRole = await requireAdmin(request, reply);
      if (adminRole === null) return;
      const parsed = universeInitializationBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }
      try {
        const report = await universeInitService.preview(
          { id: request.user!.id, role: adminRole },
          inputFrom(parsed.data),
        );
        return reply.send({ report });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    "/api/universe/initialization",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const adminRole = await requireAdmin(request, reply);
      if (adminRole === null) return;
      const parsed = universeInitializationBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }
      try {
        const report = await universeInitService.execute(
          { id: request.user!.id, role: adminRole },
          inputFrom(parsed.data),
        );
        return reply.send({ report });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    "/api/universe/initialization/status",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const adminRole = await requireAdmin(request, reply);
      if (adminRole === null) return;
      const parsed = universeInitializationStatusQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Filtros inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }
      const scopes = scopesFromCsv(parsed.data.scopes);
      if (parsed.data.scopes && scopes === undefined) {
        return reply.code(400).send({
          error: "Escopos inválidos",
          code: "VALIDATION_ERROR",
        });
      }
      try {
        const status = await universeInitService.status(
          { id: request.user!.id, role: adminRole },
          {
            seasonId: parsed.data.seasonId,
            externalSeasonId: parsed.data.externalSeasonId,
            scopes,
          },
        );
        return reply.send({ status });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
};

export default universeInitRoutes;