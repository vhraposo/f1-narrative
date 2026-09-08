import type { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  driverCharacterIdParamSchema,
  upsertDriverSchema,
} from "./driver-profile.schema.js";

const characterSelect = {
  id: true,
  name: true,
  nationality: true,
  imageUrl: true,
} as const;

const teamSelect = {
  id: true,
  name: true,
  shortName: true,
  color: true,
} as const;

const driverInclude = {
  character: { select: characterSelect },
  team: { select: teamSelect },
} as const;

export const driversRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/drivers",
    { preHandler: [fastify.authenticate] },
    async (request) => {
      const userId = request.user!.id;
      const drivers = await prisma.driverProfile.findMany({
        where: { character: { userId } },
        include: driverInclude,
        orderBy: { createdAt: "asc" },
      });
      return { drivers };
    },
  );

  fastify.put(
    "/api/drivers/:characterId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = driverCharacterIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      if (
        typeof request.body === "object" &&
        request.body !== null &&
        "teamId" in request.body
      ) {
        return reply.code(400).send({
          error:
            "A vinculação de equipe é administrada pelas operações de roster (/api/roster/assign, /api/roster/hire, /api/roster/reserve, /api/roster/release). Edite apenas o número base neste endpoint.",
          code: "ROSTER_OPERATION_REQUIRED",
        });
      }

      const parsed = upsertDriverSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }

      const character = await prisma.character.findFirst({
        where: { id: params.data.characterId, userId },
        select: { id: true },
      });

      if (!character) {
        return reply.code(404).send({
          error: "Personagem não encontrado",
          code: "NOT_FOUND",
        });
      }

      const driver = await prisma.driverProfile.upsert({
        where: { characterId: character.id },
        create: {
          characterId: character.id,
          number: parsed.data.number ?? null,
        },
        update: {
          number: parsed.data.number ?? null,
        },
        include: driverInclude,
      });

      return reply.send({ driver });
    },
  );

  fastify.delete(
    "/api/drivers/:characterId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = driverCharacterIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const driver = await prisma.driverProfile.findFirst({
        where: {
          characterId: params.data.characterId,
          character: { userId },
        },
        select: { id: true },
      });

      if (!driver) {
        return reply.code(404).send({
          error: "Piloto não encontrado",
          code: "NOT_FOUND",
        });
      }

      try {
        await prisma.driverProfile.delete({ where: { id: driver.id } });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2003"
        ) {
          return reply.code(409).send({
            error:
              "Não é possível excluir o piloto enquanto houver resultados ou classificação vinculados",
            code: "CONFLICT",
          });
        }
        throw error;
      }

      return reply.code(204).send();
    },
  );
};

export default driversRoutes;
