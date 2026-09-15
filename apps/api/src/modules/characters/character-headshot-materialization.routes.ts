import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";
import { CharacterHeadshotMaterializationService } from "./character-headshot-materialization.js";

export const characterHeadshotMaterializationRoutes: FastifyPluginAsync =
  async (fastify) => {
    fastify.post(
      "/api/enrichment/characters/headshots",
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const userId = request.user?.id;
        if (!userId) {
          return reply.code(401).send({
            error: "Não autenticado",
            code: "UNAUTHENTICATED",
          });
        }

        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { role: true },
        });
        if (!user || user.role !== "ADMIN") {
          return reply.code(403).send({
            error: "Apenas administradores podem materializar imagens de personagens",
            code: "FORBIDDEN",
          });
        }

        const report = await new CharacterHeadshotMaterializationService().materialize();
        return reply.send({ ok: true, report });
      },
    );
  };

export default characterHeadshotMaterializationRoutes;