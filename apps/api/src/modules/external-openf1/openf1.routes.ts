import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";
import type { OpenF1Client } from "./openf1.client.js";
import { OpenF1EnrichmentService } from "./openf1.enrich.js";
import { OpenF1Error } from "./openf1.transport.js";

export interface OpenF1EnrichmentRoutesOptions {
  readonly client: OpenF1Client;
}

export const openF1EnrichmentRoutes: FastifyPluginAsync<OpenF1EnrichmentRoutesOptions> =
  async (fastify, options) => {
    const service = new OpenF1EnrichmentService(options.client);

    fastify.post(
      "/api/enrichment/openf1/drivers",
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
            error: "Apenas administradores podem enriquecer dados externos",
            code: "FORBIDDEN",
          });
        }

        try {
          const report = await service.enrich();
          return reply.send({ ok: true, report });
        } catch (error) {
          if (error instanceof OpenF1Error) {
            if (error.code === "HTTP" && error.statusCode === 404) {
              return reply.code(404).send({
                error: "Recurso não encontrado na fonte externa",
                code: "SOURCE_NOT_FOUND",
              });
            }
            if (error.code === "MALFORMED") {
              return reply.code(502).send({
                error: "Resposta da fonte externa malformada",
                code: "SOURCE_MALFORMED",
              });
            }
            return reply.code(502).send({
              error: "Falha ao consultar a fonte externa",
              code: "SOURCE_UNAVAILABLE",
            });
          }
          throw error;
        }
      },
    );
  };

export default openF1EnrichmentRoutes;