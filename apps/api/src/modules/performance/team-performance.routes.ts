import type { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  setTeamPerformanceSchema,
  teamPerformanceParamsSchema,
} from "./team-performance.schema.js";
import { effectivePerformance } from "./team-performance.js";

function isConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2003")
  );
}

export const teamPerformanceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/performance/seasons/:seasonId/teams/:teamId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = teamPerformanceParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const team = await prisma.team.findFirst({
        where: { id: params.data.teamId, userId },
        select: { id: true, name: true },
      });

      if (!team) {
        return reply.code(404).send({
          error: "Equipe não encontrada",
          code: "NOT_FOUND",
        });
      }

      const row = await prisma.teamPerformance.findUnique({
        where: {
          seasonId_teamId: {
            seasonId: params.data.seasonId,
            teamId: params.data.teamId,
          },
        },
      });

      return reply.send({ team, performance: effectivePerformance(row) });
    },
  );

  fastify.put(
    "/api/performance/seasons/:seasonId/teams/:teamId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = teamPerformanceParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const parsed = setTeamPerformanceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }

      const season = await prisma.season.findUnique({
        where: { id: params.data.seasonId },
        select: { id: true },
      });
      if (!season) {
        return reply.code(404).send({
          error: "Temporada não encontrada",
          code: "NOT_FOUND",
        });
      }

      const team = await prisma.team.findFirst({
        where: { id: params.data.teamId, userId },
        select: { id: true },
      });
      if (!team) {
        return reply.code(404).send({
          error: "Equipe não encontrada",
          code: "NOT_FOUND",
        });
      }

      try {
        const row = await prisma.teamPerformance.upsert({
          where: {
            seasonId_teamId: {
              seasonId: params.data.seasonId,
              teamId: params.data.teamId,
            },
          },
          create: {
            seasonId: params.data.seasonId,
            teamId: params.data.teamId,
            ...parsed.data,
          },
          update: {
            ...parsed.data,
          },
        });
        return reply.send({ performance: effectivePerformance(row) });
      } catch (error) {
        if (isConflict(error)) {
          return reply.code(409).send({
            error: "Desempenho já registrado para a equipe nesta temporada",
            code: "CONFLICT",
          });
        }
        throw error;
      }
    },
  );

  fastify.delete(
    "/api/performance/seasons/:seasonId/teams/:teamId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = teamPerformanceParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const team = await prisma.team.findFirst({
        where: { id: params.data.teamId, userId },
        select: { id: true },
      });
      if (!team) {
        return reply.code(404).send({
          error: "Equipe não encontrada",
          code: "NOT_FOUND",
        });
      }

      await prisma.teamPerformance.deleteMany({
        where: {
          seasonId: params.data.seasonId,
          teamId: params.data.teamId,
        },
      });

      return reply.code(204).send();
    },
  );
};

export default teamPerformanceRoutes;