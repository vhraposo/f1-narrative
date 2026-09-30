import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import {
  getExternalCircuitDetail,
  listExternalCircuits,
} from "./circuit-catalog.read.js";

const listQuerySchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict();

const paramsSchema = z.object({ id: z.string().uuid() });

export const circuitCatalogRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/external/circuits",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = listQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Consulta inválida", code: "VALIDATION_ERROR" });
      }
      const result = await listExternalCircuits({
        search: parsed.data.search ?? null,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      });
      return reply.send(result);
    },
  );

  fastify.get(
    "/api/external/circuits/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = paramsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .code(404)
          .send({ error: "Circuito não encontrado", code: "CIRCUIT_NOT_FOUND" });
      }
      const circuit = await getExternalCircuitDetail(parsed.data.id);
      if (!circuit) {
        return reply
          .code(404)
          .send({ error: "Circuito não encontrado", code: "CIRCUIT_NOT_FOUND" });
      }
      return reply.send({ circuit });
    },
  );
};
