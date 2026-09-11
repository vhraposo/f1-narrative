import type { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import {
  playerEntryBodySchema,
  playerEntrySeasonQuerySchema,
} from "./player-entry.schemas.js";
import { PlayerEntryError, playerEntryService } from "./player-entry.service.js";
import { RosterError } from "../roster/roster.service.js";

function sendError(
  reply: {
    code: (code: number) => { send: (payload: Record<string, unknown>) => void };
  },
  error: unknown,
): void {
  if (error instanceof PlayerEntryError || error instanceof RosterError) {
    reply.code(error.statusCode).send({
      error: error.message,
      code: error.code,
    });
    return;
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    reply.code(409).send({
      error: "Conflito de integridade: vínculo já existente",
      code: "CONFLICT",
    });
    return;
  }
  throw error;
}

export const playerEntryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/universe/player-entry/setup",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = playerEntrySeasonQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Filtros inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }
      try {
        const { seasons, selection } = await playerEntryService.setup(
          request.user!.id,
          { seasonId: parsed.data.seasonId },
        );
        return reply.send({ seasons, selection });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    "/api/universe/player-entry",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = playerEntryBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }
      try {
        const result = await playerEntryService.create(request.user!.id, {
          ...parsed.data,
        });
        return reply.code(201).send(result);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
};

export default playerEntryRoutes;