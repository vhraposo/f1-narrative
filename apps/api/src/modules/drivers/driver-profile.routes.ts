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
  // Listar os pilotos (DriverProfiles) do usuário autenticado.
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

  // Criar/atualizar (upsert idempotente) o perfil de piloto de um Character
  // pertencente ao usuário autenticado. 404 para personagem de outro usuário.
  //
  // Semântica de teamId (PUT):
  // - omitido  -> preserva a Team atual;
  // - null     -> remove a vinculação;
  // - "<uuid>" -> define/troca a vinculação (validada contra o usuário).
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
        // 404 para não vazar a existência de personagens de outros usuários.
        return reply.code(404).send({
          error: "Personagem não encontrado",
          code: "NOT_FOUND",
        });
      }

      // Quando teamId é informado (UUID), a Team deve pertencer ao usuário
      // autenticado. Se não existir ou for de outro usuário, responde 404.
      const teamId = parsed.data.teamId;
      if (typeof teamId === "string") {
        const team = await prisma.team.findFirst({
          where: { id: teamId, userId },
          select: { id: true },
        });

        if (!team) {
          return reply.code(404).send({
            error: "Equipe não encontrada",
            code: "NOT_FOUND",
          });
        }
      }

      // No create, teamId omitido ou null vira null (sem vinculação).
      // No update, teamId só é alterado quando de fato enviado (undefined é
      // preservado; null remove; UUID define/troca).
      const driver = await prisma.driverProfile.upsert({
        where: { characterId: character.id },
        create: {
          characterId: character.id,
          number: parsed.data.number ?? null,
          teamId: teamId ?? null,
        },
        update: {
          number: parsed.data.number ?? null,
          ...(teamId !== undefined ? { teamId } : {}),
        },
        include: driverInclude,
      });

      return reply.send({ driver });
    },
  );

  // Remover o perfil de piloto de um Character pertencente ao usuário.
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
