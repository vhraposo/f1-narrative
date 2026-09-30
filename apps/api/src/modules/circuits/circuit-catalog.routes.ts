import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { prisma } from "../../infrastructure/database/prisma.js";
import { resolveCircuitSvg } from "../f1db/f1db.svg.js";
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

const layoutQuerySchema = z
  .object({ style: z.enum(["black-outline", "white-outline"]).optional() })
  .strict();

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

  fastify.get(
    "/api/external/circuits/:id/layout.svg",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      const query = layoutQuerySchema.safeParse(request.query ?? {});
      if (!params.success || !query.success) {
        return reply
          .code(404)
          .send({ error: "Layout não encontrado", code: "CIRCUIT_LAYOUT_NOT_FOUND" });
      }
      const circuit = await prisma.externalCircuit.findUnique({
        where: { id: params.data.id },
        select: { externalId: true, name: true },
      });
      if (!circuit) {
        return reply
          .code(404)
          .send({ error: "Layout não encontrado", code: "CIRCUIT_LAYOUT_NOT_FOUND" });
      }
      const layout = resolveCircuitSvg({
        externalId: circuit.externalId,
        name: circuit.name,
        ...(query.data.style ? { style: query.data.style } : {}),
      });
      if (!layout) {
        return reply
          .code(404)
          .send({ error: "Layout não encontrado", code: "CIRCUIT_LAYOUT_NOT_FOUND" });
      }
      return reply
        .header("Content-Type", "image/svg+xml; charset=utf-8")
        .header("Cache-Control", "public, max-age=86400")
        .header("X-Circuit-Layout", layout.layoutId)
        .header("X-Attribution", layout.attribution.replace(/[^\x20-\x7E]/g, "-"))
        .send(layout.svg);
    },
  );
};
