import type { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  createTeamSchema,
  teamIdParamSchema,
  updateTeamSchema,
} from "./team.schema.js";
import {
  buildTeamCreateInput,
  buildTeamUpdateInput,
  teamSelectWithIdentity,
} from "./team-identity.js";

const baseTeamSelect = {
  id: true,
  name: true,
  shortName: true,
  color: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
} as const;

function isConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2003")
  );
}

export const teamsRoutes: FastifyPluginAsync = async (fastify) => {
  const teamSelect = await teamSelectWithIdentity(baseTeamSelect);

  fastify.get(
    "/api/teams",
    { preHandler: [fastify.authenticate] },
    async (request) => {
      const userId = request.user!.id;
      const teams = await prisma.team.findMany({
        where: { userId },
        select: teamSelect,
        orderBy: { createdAt: "asc" },
      });
      return { teams };
    },
  );

  fastify.post(
    "/api/teams",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const parsed = createTeamSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }

      try {
        const data = await buildTeamCreateInput(userId, parsed.data);
        const team = await prisma.team.create({
          data,
          select: teamSelect,
        });
        return reply.code(201).send({ team });
      } catch (error) {
        if (isConflict(error)) {
          return reply.code(409).send({
            error: "Já existe uma equipe com esse nome",
            code: "CONFLICT",
          });
        }
        throw error;
      }
    },
  );

  fastify.get(
    "/api/teams/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = teamIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const team = await prisma.team.findFirst({
        where: { id: params.data.id, userId },
        select: teamSelect,
      });

      if (!team) {
        return reply.code(404).send({
          error: "Equipe não encontrada",
          code: "NOT_FOUND",
        });
      }

      return reply.send({ team });
    },
  );

  fastify.patch(
    "/api/teams/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = teamIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const parsed = updateTeamSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }

      const existing = await prisma.team.findFirst({
        where: { id: params.data.id, userId },
        select: { id: true },
      });

      if (!existing) {
        return reply.code(404).send({
          error: "Equipe não encontrada",
          code: "NOT_FOUND",
        });
      }

      try {
        const data = await buildTeamUpdateInput(parsed.data);
        const team = await prisma.team.update({
          where: { id: existing.id },
          data,
          select: teamSelect,
        });
        return reply.send({ team });
      } catch (error) {
        if (isConflict(error)) {
          return reply.code(409).send({
            error: "Já existe uma equipe com esse nome",
            code: "CONFLICT",
          });
        }
        throw error;
      }
    },
  );

  fastify.delete(
    "/api/teams/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = teamIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const existing = await prisma.team.findFirst({
        where: { id: params.data.id, userId },
        select: { id: true },
      });

      if (!existing) {
        return reply.code(404).send({
          error: "Equipe não encontrada",
          code: "NOT_FOUND",
        });
      }

      const linked = await prisma.driverProfile.count({
        where: { teamId: existing.id },
      });

      if (linked > 0) {
        return reply.code(409).send({
          error: "Não é possível excluir a equipe com pilotos vinculados",
          code: "CONFLICT",
        });
      }

      try {
        await prisma.team.delete({ where: { id: existing.id } });
      } catch (error) {
        if (isConflict(error)) {
          return reply.code(409).send({
            error: "Não é possível excluir a equipe com pilotos vinculados",
            code: "CONFLICT",
          });
        }
        throw error;
      }

      return reply.code(204).send();
    },
  );
};

export default teamsRoutes;
