import type { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import {
  seasonIdParamSchema,
  teamIdBodySchema,
} from "./universe-editor.schemas.js";
import { universeEditorService, UniverseEditorError } from "./universe-editor.service.js";
import { RosterError } from "../roster/roster.service.js";

function sendError(
  reply: {
    code: (code: number) => { send: (payload: Record<string, unknown>) => void };
  },
  error: unknown,
): void {
  if (error instanceof UniverseEditorError || error instanceof RosterError) {
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

export const universeEditorRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/universe/roster-comparison/:seasonId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = seasonIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }
      try {
        const comparison = await universeEditorService.comparison(
          request.user!.id,
          parsed.data.seasonId,
        );
        return reply.send(comparison);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    "/api/universe/roster-comparison/:seasonId/keep-universe",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const paramsParsed = seasonIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: paramsParsed.error.issues,
        });
      }
      const bodyParsed = teamIdBodySchema.safeParse(request.body ?? {});
      if (!bodyParsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: bodyParsed.error.issues,
        });
      }
      try {
        const result = await universeEditorService.keepUniverse(
          request.user!.id,
          bodyParsed.data.teamId,
          paramsParsed.data.seasonId,
        );
        return reply.send(result);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    "/api/universe/roster-comparison/:seasonId/restore-source",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const paramsParsed = seasonIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: paramsParsed.error.issues,
        });
      }
      const bodyParsed = teamIdBodySchema.safeParse(request.body ?? {});
      if (!bodyParsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: bodyParsed.error.issues,
        });
      }
      try {
        const result = await universeEditorService.restoreSource(
          request.user!.id,
          bodyParsed.data.teamId,
          paramsParsed.data.seasonId,
        );
        return reply.send(result);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
};

export default universeEditorRoutes;
