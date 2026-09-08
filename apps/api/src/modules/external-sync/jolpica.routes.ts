import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../../infrastructure/database/prisma.js";
import type { JolpicaClient } from "./jolpica.client.js";
import {
  JOLPICA_SOURCE,
  JOLPICA_SYNC_SCOPES,
  JolpicaSyncService,
} from "./jolpica.service.js";
import { JolpicaError } from "./jolpica.transport.js";

export interface JolpicaSyncRoutesOptions {
  readonly client: JolpicaClient;
  readonly requestDelayMs?: number;
}

const routeParamsSchema = z.object({
  source: z.literal(JOLPICA_SOURCE),
  scope: z.enum(JOLPICA_SYNC_SCOPES),
});

const syncBodySchema = z
  .object({
    seasonYear: z.number().int().min(1950).max(2100),
  })
  .strict();

export const jolpicaSyncRoutes: FastifyPluginAsync<JolpicaSyncRoutesOptions> =
  async (fastify, options) => {
    const service = new JolpicaSyncService(options.client, {
      requestDelayMs: options.requestDelayMs ?? 0,
    });

    fastify.post(
      "/api/external-sync/:source/:scope",
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const params = routeParamsSchema.safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send({
            error: "Fonte ou escopo inválidos",
            code: "VALIDATION_ERROR",
          });
        }

        const bodyParsed = syncBodySchema.safeParse(request.body ?? {});
        if (!bodyParsed.success) {
          return reply.code(400).send({
            error: "Corpo inválido",
            code: "VALIDATION_ERROR",
          });
        }

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
            error: "Apenas administradores podem sincronizar dados externos",
            code: "FORBIDDEN",
          });
        }

        try {
          const report = await service.sync(
            bodyParsed.data.seasonYear,
            params.data.scope,
          );
          return reply.send({ ok: true, report });
        } catch (error) {
          if (error instanceof JolpicaError) {
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

export default jolpicaSyncRoutes;