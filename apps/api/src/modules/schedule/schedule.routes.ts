import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  createScheduleSchema,
  scheduleCharacterIdParamSchema,
  scheduleIdParamSchema,
  updateScheduleSchema,
} from "./schedule.schema.js";

const scheduleSelect = {
  id: true,
  characterId: true,
  activity: true,
  startsAt: true,
  endsAt: true,
  createdAt: true,
} as const;

// Confere se um par (startsAt, endsAt) viola a regra `endsAt < startsAt`.
function isEndBeforeStart(startsAt: string, endsAt: string | null | undefined): boolean {
  if (!endsAt) return false;
  return new Date(endsAt).getTime() < new Date(startsAt).getTime();
}

export const scheduleRoutes: FastifyPluginAsync = async (fastify) => {
  // Listar a agenda de um Character próprio, ordenada por startsAt ASC.
  fastify.get(
    "/api/characters/:characterId/schedule",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = scheduleCharacterIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const character = await prisma.character.findFirst({
        where: { id: params.data.characterId, userId },
        select: { id: true },
      });

      if (!character) {
        // 404 para não vazar a existência de personagens de outros usuários.
        return reply.code(404).send({
          error: "Personagem não encontrado",
          code: "NOT_FOUND",
        });
      }

      const schedules = await prisma.characterSchedule.findMany({
        where: { characterId: character.id },
        select: scheduleSelect,
        orderBy: { startsAt: "asc" },
      });

      return reply.send({ schedules });
    },
  );

  // Criar um agendamento em um Character próprio.
  fastify.post(
    "/api/characters/:characterId/schedule",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = scheduleCharacterIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const parsed = createScheduleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }

      if (isEndBeforeStart(parsed.data.startsAt, parsed.data.endsAt)) {
        return reply.code(400).send({
          error: "A data final não pode ser anterior à data de início",
          code: "VALIDATION_ERROR",
        });
      }

      const character = await prisma.character.findFirst({
        where: { id: params.data.characterId, userId },
        select: { id: true },
      });

      if (!character) {
        // 404 para não vazar a existência de personagens de outros usuários.
        return reply.code(404).send({
          error: "Personagem não encontrado",
          code: "NOT_FOUND",
        });
      }

      const schedule = await prisma.characterSchedule.create({
        data: {
          characterId: character.id,
          activity: parsed.data.activity,
          startsAt: new Date(parsed.data.startsAt),
          endsAt:
            parsed.data.endsAt !== undefined && parsed.data.endsAt !== null
              ? new Date(parsed.data.endsAt)
              : null,
        },
        select: scheduleSelect,
      });

      return reply.code(201).send({ schedule });
    },
  );

  // Editar um agendamento de um Character próprio.
  fastify.patch(
    "/api/characters/:characterId/schedule/:scheduleId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = scheduleIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const parsed = updateScheduleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }

      // Resolve o Character do usuário autenticado e o Schedule vinculado a ele.
      const schedule = await prisma.characterSchedule.findFirst({
        where: {
          id: params.data.scheduleId,
          characterId: params.data.characterId,
          character: { userId },
        },
        select: { id: true, startsAt: true },
      });

      if (!schedule) {
        // 404 para não vazar existência (caracter/schedule de outro usuário).
        return reply.code(404).send({
          error: "Agendamento não encontrado",
          code: "NOT_FOUND",
        });
      }

      const startsAt = parsed.data.startsAt ?? schedule.startsAt.toISOString();
      if (isEndBeforeStart(startsAt, parsed.data.endsAt)) {
        return reply.code(400).send({
          error: "A data final não pode ser anterior à data de início",
          code: "VALIDATION_ERROR",
        });
      }

      const updated = await prisma.characterSchedule.update({
        where: { id: schedule.id },
        data: {
          ...(parsed.data.activity !== undefined
            ? { activity: parsed.data.activity }
            : {}),
          ...(parsed.data.startsAt !== undefined
            ? { startsAt: new Date(parsed.data.startsAt) }
            : {}),
          ...(parsed.data.endsAt !== undefined
            ? {
                endsAt:
                  parsed.data.endsAt === null
                    ? null
                    : new Date(parsed.data.endsAt),
              }
            : {}),
        },
        select: scheduleSelect,
      });

      return reply.send({ schedule: updated });
    },
  );

  // Excluir um agendamento de um Character próprio.
  fastify.delete(
    "/api/characters/:characterId/schedule/:scheduleId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = scheduleIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const schedule = await prisma.characterSchedule.findFirst({
        where: {
          id: params.data.scheduleId,
          characterId: params.data.characterId,
          character: { userId },
        },
        select: { id: true },
      });

      if (!schedule) {
        // 404 para não vazar existência (caracter/schedule de outro usuário).
        return reply.code(404).send({
          error: "Agendamento não encontrado",
          code: "NOT_FOUND",
        });
      }

      await prisma.characterSchedule.delete({ where: { id: schedule.id } });

      return reply.code(204).send();
    },
  );
};

export default scheduleRoutes;