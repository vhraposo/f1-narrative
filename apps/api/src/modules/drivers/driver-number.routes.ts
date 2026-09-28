import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ensureUniverse } from "../universe/universe.service.js";
import {
  DriverNumberError,
  listDriverNumbers,
  setDriverNumber,
} from "./driver-number.service.js";

const seasonParamsSchema = z.object({
  seasonId: z.string().uuid("Identificador de temporada inválido"),
});

const driverParamsSchema = z.object({
  seasonId: z.string().uuid("Identificador de temporada inválido"),
  driverProfileId: z.string().uuid("Identificador de piloto inválido"),
});

const setBodySchema = z
  .object({ number: z.number().int().nullable() })
  .strict();

const boardQuerySchema = z.object({
  driverProfileId: z.string().uuid().optional(),
});

function sendDriverNumberError(
  reply: {
    code: (code: number) => { send: (payload: Record<string, unknown>) => void };
  },
  error: unknown,
): boolean {
  if (error instanceof DriverNumberError) {
    reply.code(error.statusCode).send({ error: error.message, code: error.code });
    return true;
  }
  return false;
}

export const driverNumberRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/seasons/:seasonId/driver-numbers",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = seasonParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const query = boardQuerySchema.safeParse(request.query ?? {});
      if (!query.success) {
        return reply.code(400).send({
          error: "Filtros inválidos",
          code: "VALIDATION_ERROR",
          issues: query.error.issues,
        });
      }
      const universe = await ensureUniverse(request.user!.id);
      try {
        const board = await listDriverNumbers(
          universe.id,
          params.data.seasonId,
          query.data.driverProfileId,
        );
        return reply.send({ board });
      } catch (error) {
        if (sendDriverNumberError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.put(
    "/api/seasons/:seasonId/drivers/:driverProfileId/number",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = driverParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const body = setBodySchema.safeParse(request.body ?? {});
      if (!body.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: body.error.issues,
        });
      }
      const universe = await ensureUniverse(request.user!.id);
      try {
        const result = await setDriverNumber(
          universe.id,
          params.data.seasonId,
          params.data.driverProfileId,
          body.data.number,
        );
        return reply.send({ number: result });
      } catch (error) {
        if (sendDriverNumberError(reply, error)) return;
        throw error;
      }
    },
  );
};

export default driverNumberRoutes;
