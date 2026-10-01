import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { listUniverseNews, NewsError } from "./news.service.js";

const listNewsQuerySchema = z.object({
  seasonId: z.string().uuid("Temporada inválida").optional(),
  raceId: z.string().uuid("Corrida inválida").optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const newsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/news",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = listNewsQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Parâmetros inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }

      try {
        const result = await listUniverseNews({
          userId: request.user!.id,
          ...parsed.data,
        });
        return reply.send(result);
      } catch (error) {
        if (error instanceof NewsError) {
          return reply
            .code(error.statusCode)
            .send({ error: error.message, code: error.code });
        }
        throw error;
      }
    },
  );
};

export default newsRoutes;
