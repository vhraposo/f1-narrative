import type { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { rosterService, RosterError } from "./roster.service.js";
import {
  assignDriverSchema,
  hireDriverSchema,
  promoteDriverSchema,
  seasonIdParamSchema,
  teamDriverSchema,
} from "./roster.schema.js";

function sendError(
  reply: {
    code: (code: number) => { send: (payload: Record<string, unknown>) => void };
  },
  error: unknown,
): void {
  if (error instanceof RosterError) {
    reply.code(error.statusCode).send({ error: error.message, code: error.code });
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

export const rosterRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/api/roster/assign",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const parsed = assignDriverSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }
      try {
        const entry = await rosterService.assignDriverToSeat(userId, parsed.data);
        return reply.send({ entry });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    "/api/roster/release",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const parsed = teamDriverSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }
      try {
        const entry = await rosterService.releaseDriver(userId, parsed.data);
        return reply.send({ entry });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    "/api/roster/hire",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const parsed = hireDriverSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }
      try {
        const entry = await rosterService.hireDriver(userId, parsed.data);
        return reply.send({ entry });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    "/api/roster/reserve",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const parsed = teamDriverSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }
      try {
        const entry = await rosterService.assignReserve(userId, parsed.data);
        return reply.send({ entry });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    "/api/roster/promote",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const parsed = promoteDriverSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }
      try {
        const entry = await rosterService.promoteReserve(userId, parsed.data);
        return reply.send({ entry });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    "/api/roster/seasons/:seasonId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = seasonIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const entries = await rosterService.getSeasonRoster(parsed.data.seasonId);
      return reply.send({ entries });
    },
  );

  fastify.get(
    "/api/roster/seasons/:seasonId/available",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const parsed = seasonIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const drivers = await rosterService.getAvailableDrivers(userId, parsed.data.seasonId);
      return reply.send({ drivers });
    },
  );
};

export default rosterRoutes;