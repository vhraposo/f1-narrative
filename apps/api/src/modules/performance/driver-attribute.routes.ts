import type { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  driverAttributesParamsSchema,
  setDriverAttributesSchema,
} from "./driver-attribute.schema.js";
import { effectiveDriverAttributes } from "./driver-attribute.js";

function isConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2003")
  );
}

export const driverAttributeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/attributes/seasons/:seasonId/drivers/:characterId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = driverAttributesParamsSchema.safeParse(request.params);
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
        select: { id: true, character: { select: { name: true } } },
      });

      if (!driver) {
        return reply.code(404).send({
          error: "Piloto não encontrado",
          code: "NOT_FOUND",
        });
      }

      const row = await prisma.driverAttribute.findUnique({
        where: {
          seasonId_driverProfileId: {
            seasonId: params.data.seasonId,
            driverProfileId: driver.id,
          },
        },
      });

      return reply.send({
        driver: { id: driver.id, name: driver.character.name },
        attributes: effectiveDriverAttributes(row),
      });
    },
  );

  fastify.put(
    "/api/attributes/seasons/:seasonId/drivers/:characterId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = driverAttributesParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const parsed = setDriverAttributesSchema.safeParse(request.body);
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
        const row = await prisma.driverAttribute.upsert({
          where: {
            seasonId_driverProfileId: {
              seasonId: params.data.seasonId,
              driverProfileId: driver.id,
            },
          },
          create: {
            seasonId: params.data.seasonId,
            driverProfileId: driver.id,
            ...parsed.data,
          },
          update: {
            ...parsed.data,
          },
        });
        return reply.send({ attributes: effectiveDriverAttributes(row) });
      } catch (error) {
        if (isConflict(error)) {
          return reply.code(409).send({
            error: "Atributos já registrados para o piloto nesta temporada",
            code: "CONFLICT",
          });
        }
        throw error;
      }
    },
  );

  fastify.delete(
    "/api/attributes/seasons/:seasonId/drivers/:characterId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = driverAttributesParamsSchema.safeParse(request.params);
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

      await prisma.driverAttribute.deleteMany({
        where: {
          seasonId: params.data.seasonId,
          driverProfileId: driver.id,
        },
      });

      return reply.code(204).send();
    },
  );
};

export default driverAttributeRoutes;