import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../../infrastructure/database/prisma.js";
import type { OpeningGridClient } from "./opening-grid.client.js";
import { loadOpeningGridFeed } from "./opening-grid.feed.js";
import {
  openingGridIngestBodySchema,
  openingGridIngestParamsSchema,
} from "./opening-grid.schemas.js";
import { OpeningGridIngestService } from "./opening-grid.service.js";
import { OpeningGridError } from "./opening-grid.transport.js";

export interface OpeningGridRoutesOptions {
  readonly client: OpeningGridClient;
}

export const openingGridRoutes: FastifyPluginAsync<OpeningGridRoutesOptions> = async (
  fastify,
  options,
) => {
  const service = new OpeningGridIngestService(options.client);

  fastify.get("/opening-grid/:year/opening-grid.json", async (request, reply) => {
    const params = z
      .object({ year: z.coerce.number().int().min(1950).max(2100) })
      .safeParse(request.params);
    if (!params.success) {
      return reply.code(404).send({
        error: "Feed de Opening Grid não encontrado",
        code: "FEED_NOT_FOUND",
      });
    }
    try {
      const feed = loadOpeningGridFeed(params.data.year);
      if (!feed) {
        return reply.code(404).send({
          error: "Feed de Opening Grid não encontrado",
          code: "FEED_NOT_FOUND",
        });
      }
      return reply.send(feed);
    } catch (error) {
      if (error instanceof OpeningGridError) {
        return reply.code(502).send({
          error: "Feed de Opening Grid malformado",
          code: "SOURCE_MALFORMED",
        });
      }
      throw error;
    }
  });

  fastify.post(
    "/api/external-sync/:source/opening-grid",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = openingGridIngestParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Fonte inválida",
          code: "VALIDATION_ERROR",
        });
      }

      const bodyParsed = openingGridIngestBodySchema.safeParse(request.body ?? {});
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
          error: "Apenas administradores podem ingerir o Opening Grid",
          code: "FORBIDDEN",
        });
      }

      try {
        const report = await service.ingest(bodyParsed.data.seasonYear);
        if (!report.ingested) {
          return reply.code(409).send({
            error: "Payload do Opening Grid contém conflitos",
            code: "OPENING_GRID_CONFLICT",
            report,
          });
        }
        return reply.send({ ok: true, report });
      } catch (error) {
        if (error instanceof OpeningGridError) {
          if (error.code === "HTTP" && error.statusCode === 404) {
            return reply.code(404).send({
              error: "Temporada não encontrada na fonte de Opening Grid",
              code: "SOURCE_NOT_FOUND",
            });
          }
          if (error.code === "MALFORMED") {
            return reply.code(502).send({
              error: "Resposta da fonte de Opening Grid malformada",
              code: "SOURCE_MALFORMED",
            });
          }
          return reply.code(502).send({
            error: "Falha ao consultar a fonte de Opening Grid",
            code: "SOURCE_UNAVAILABLE",
          });
        }
        throw error;
      }
    },
  );
};

export default openingGridRoutes;