import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  ReconciliationError,
  reconciliationService,
} from "./reconciliation.service.js";
import type { ReconciliationQuery } from "./reconciliation.service.js";
import {
  bindingIdParamsSchema,
  bindingsListQuerySchema,
  candidatesParamsSchema,
  candidatesQuerySchema,
  confirmBindingSchema,
  externalListQuerySchema,
  kindParamsSchema,
  raceIdParamSchema,
  seasonIdParamSchema,
  suggestBindingSchema,
} from "./reconciliation.schemas.js";

function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof ReconciliationError) {
    return reply.code(error.statusCode).send({
      error: error.message,
      code: error.code,
    });
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2002"
  ) {
    return reply.code(409).send({
      error: "A entidade já está vinculada (invariante 1:1)",
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
      error: "Apenas administradores podem reconciliar dados externos",
      code: "FORBIDDEN",
    });
    return null;
  }
  return user.role;
}

function toQuery(input: {
  source?: string;
  externalId?: string;
  seasonYear?: number;
  round?: number;
}): ReconciliationQuery {
  return {
    source: input.source ?? "jolpica",
    externalId: input.externalId,
    seasonYear: input.seasonYear,
    round: input.round,
  };
}

export const reconciliationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/reconciliation/external/:kind",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = kindParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Tipo inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const query = externalListQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({
          error: "Filtros inválidos",
          code: "VALIDATION_ERROR",
        });
      }
      const items = await reconciliationService.listExternal(params.data.kind, {
        source: query.data.source,
        seasonYear: query.data.seasonYear,
      });
      return reply.send({ items });
    },
  );

  fastify.get(
    "/api/reconciliation/bindings",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const query = bindingsListQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({
          error: "Filtros inválidos",
          code: "VALIDATION_ERROR",
        });
      }
      const bindings = await reconciliationService.listBindings({
        source: query.data.source,
        confidence: query.data.confidence,
      });
      return reply.send({ bindings });
    },
  );

  fastify.get(
    "/api/reconciliation/candidates/:kind/:externalId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = candidatesParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Parâmetros inválidos",
          code: "VALIDATION_ERROR",
        });
      }
      const query = candidatesQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({
          error: "Filtros inválidos",
          code: "VALIDATION_ERROR",
        });
      }
      try {
        const listing = await reconciliationService.listCandidates(
          request.user!.id,
          params.data.kind,
          toQuery({
            source: query.data.source,
            externalId: params.data.externalId,
            seasonYear: query.data.seasonYear,
            round: query.data.round,
          }),
        );
        return reply.send({ listing });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    "/api/reconciliation/bindings/suggest",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const adminRole = await requireAdmin(request, reply);
      if (adminRole === null) return;
      const parsed = suggestBindingSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }
      try {
        const binding = await reconciliationService.suggestBinding(
          { id: request.user!.id, role: adminRole },
          parsed.data.kind,
          toQuery(parsed.data),
          parsed.data.candidateId,
        );
        return reply.code(201).send({ binding });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    "/api/reconciliation/bindings/confirm",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const adminRole = await requireAdmin(request, reply);
      if (adminRole === null) return;
      const parsed = confirmBindingSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }
      try {
        const binding = await reconciliationService.confirmBinding(
          { id: request.user!.id, role: adminRole },
          parsed.data.kind,
          toQuery(parsed.data),
        );
        return reply.send({ binding });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.delete(
    "/api/reconciliation/bindings/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const adminRole = await requireAdmin(request, reply);
      if (adminRole === null) return;
      const params = bindingIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      try {
        const result = await reconciliationService.unbindBinding(
          { id: request.user!.id, role: adminRole },
          params.data.id,
        );
        return reply.send(result);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    "/api/reconciliation/seasons/:seasonId/roster",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = seasonIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      try {
        const diff = await reconciliationService.buildRosterDiff(params.data.seasonId);
        return reply.send({ diff });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    "/api/reconciliation/seasons/:seasonId/championship",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = seasonIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      try {
        const diff = await reconciliationService.buildChampionshipDiff(params.data.seasonId);
        return reply.send({ diff });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    "/api/reconciliation/races/:raceId/results",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = raceIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      try {
        const diff = await reconciliationService.buildResultsDiff(params.data.raceId);
        return reply.send({ diff });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
};

export default reconciliationRoutes;