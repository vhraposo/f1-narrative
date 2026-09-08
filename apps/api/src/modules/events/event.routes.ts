import type { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  addParticipantSchema,
  createEventSchema,
  eventIdParamSchema,
  eventImportanceSchema,
  eventPathParamsSchema,
  eventTypeSchema,
  participantParamsSchema,
  updateEventSchema,
} from "./event.schema.js";

import { z } from "zod";
import { syncNewsForEvent } from "./news.js";

const eventSelect = {
  id: true,
  type: true,
  importance: true,
  source: true,
  title: true,
  description: true,
  worldDate: true,
  payload: true,
  createdAt: true,
} as const;


const newsItemSelect = {
  id: true,
  eventId: true,
  title: true,
  body: true,
  source: true,
  worldDate: true,
  createdAt: true,
} as const;

const participantSelect = {
  id: true,
  name: true,
  nationality: true,
  imageUrl: true,
} as const;

const eventQuerySchema = z.object({
  type: eventTypeSchema.optional(),
  importance: eventImportanceSchema.optional(),
});

// Detecta erros conhecidos do Prisma (violação de unique / FK restrita) e os
// converte em respostas previsíveis de conflito (409).
function isConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2003")
  );
}

export const eventsRoutes: FastifyPluginAsync = async (fastify) => {
  // ------------------------------------------------------------------
  // Events — entidade global compartilhada (sem userId), como Season/Race.
  // ------------------------------------------------------------------

  fastify.get(
    "/api/events",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const query = eventQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: query.error.issues,
        });
      }
      const events = await prisma.event.findMany({
        where: query.data,
        select: eventSelect,
        orderBy: [
          { worldDate: "desc" },
          { createdAt: "desc" },
        ],
      });
      return { events };
    },
  );

  fastify.post(
    "/api/events",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = createEventSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }

      const event = await prisma.$transaction(async (tx) => {
        const created = await tx.event.create({
          data: {
            ...parsed.data,
            payload:
              parsed.data.payload === null || parsed.data.payload === undefined
                ? Prisma.DbNull
                : (parsed.data.payload as Prisma.InputJsonValue),
          },
          select: eventSelect,
        });

        await syncNewsForEvent(tx, created.id);

        return created;
      });

      return reply.code(201).send({ event });
    },
  );

  fastify.get(
    "/api/events/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = eventIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const event = await prisma.event.findUnique({
        where: { id: params.data.id },
        select: eventSelect,
      });

      if (!event) {
        return reply.code(404).send({
          error: "Evento não encontrado",
          code: "NOT_FOUND",
        });
      }

      return reply.send({ event });
    },
  );

  fastify.patch(
    "/api/events/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = eventIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const parsed = updateEventSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }

      const existing = await prisma.event.findUnique({
        where: { id: params.data.id },
        select: { id: true },
      });

      if (!existing) {
        return reply.code(404).send({
          error: "Evento não encontrado",
          code: "NOT_FOUND",
        });
      }

        const event = await prisma.$transaction(async (tx) => {
          const updated = await tx.event.update({
            where: { id: existing.id },
            data: {
              ...parsed.data,
              payload:
                parsed.data.payload === undefined
                  ? undefined
                  : parsed.data.payload === null
                    ? Prisma.DbNull
                    : (parsed.data.payload as Prisma.InputJsonValue),
            },
            select: eventSelect,
          });

          await syncNewsForEvent(tx, updated.id);

          return updated;
        });

        return reply.send({ event });
    },
  );

  fastify.delete(
    "/api/events/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = eventIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const existing = await prisma.event.findUnique({
        where: { id: params.data.id },
        select: { id: true },
      });

      if (!existing) {
        return reply.code(404).send({
          error: "Evento não encontrado",
          code: "NOT_FOUND",
        });
      }

      try {
        await prisma.$transaction(async (tx) => {
          await tx.newsItem.deleteMany({ where: { eventId: existing.id } });
          await tx.event.delete({ where: { id: existing.id } });
        });
      } catch (error) {
        if (isConflict(error)) {
          return reply.code(409).send({
            error: "Não é possível excluir o evento",
            code: "CONFLICT",
          });
        }
        throw error;
      }

      return reply.code(204).send();
    },
  );

  fastify.get(
    "/api/events/:id/news",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = eventIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const event = await prisma.event.findUnique({
        where: { id: params.data.id },
        select: { id: true },
      });

      if (!event) {
        return reply.code(404).send({
          error: "Evento não encontrado",
          code: "NOT_FOUND",
        });
      }

      const news = await prisma.newsItem.findFirst({
        where: { eventId: event.id },
        select: newsItemSelect,
      });

      if (!news) {
        return reply.code(404).send({
          error: "Notícia não encontrada",
          code: "NOT_FOUND",
        });
      }

      return reply.send({ news });
    },
  );

  // EventCharacter — vínculo N:N Event <-> Character.

  fastify.get(
    "/api/events/:eventId/participants",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = eventPathParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const event = await prisma.event.findUnique({
        where: { id: params.data.eventId },
        select: { id: true },
      });

      if (!event) {
        return reply.code(404).send({
          error: "Evento não encontrado",
          code: "NOT_FOUND",
        });
      }

      const participants = await prisma.eventCharacter.findMany({
        where: { eventId: event.id, character: { userId } },
        select: { character: { select: participantSelect } },
        orderBy: { character: { name: "asc" } },
      });

      return reply.send({ participants });
    },
  );

  fastify.post(
    "/api/events/:eventId/participants",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = eventPathParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const parsed = addParticipantSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }

      const event = await prisma.event.findUnique({
        where: { id: params.data.eventId },
        select: { id: true },
      });

      if (!event) {
        return reply.code(404).send({
          error: "Evento não encontrado",
          code: "NOT_FOUND",
        });
      }

      const character = await prisma.character.findFirst({
        where: { id: parsed.data.characterId, userId },
        select: { id: true },
      });

      if (!character) {
        return reply.code(404).send({
          error: "Personagem não encontrado",
          code: "NOT_FOUND",
        });
      }

      const existing = await prisma.eventCharacter.findFirst({
        where: {
          eventId: event.id,
          characterId: character.id,
        },
        select: { id: true },
      });

      if (existing) {
        return reply.code(409).send({
          error: "Este personagem já participa do evento",
          code: "CONFLICT",
        });
      }

      try {
        const participant = await prisma.$transaction(async (tx) => {
          const created = await tx.eventCharacter.create({
            data: { eventId: event.id, characterId: character.id },
            select: { character: { select: participantSelect } },
          });

          await syncNewsForEvent(tx, event.id);

          return created;
        });

        return reply.code(201).send({ participant });
      } catch (error) {
        if (isConflict(error)) {
          return reply.code(409).send({
            error: "Este personagem já participa do evento",
            code: "CONFLICT",
          });
        }
        throw error;
      }
    },
  );

  fastify.delete(
    "/api/events/:eventId/participants/:characterId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = participantParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const event = await prisma.event.findUnique({
        where: { id: params.data.eventId },
        select: { id: true },
      });

      if (!event) {
        return reply.code(404).send({
          error: "Evento não encontrado",
          code: "NOT_FOUND",
        });
      }

      const character = await prisma.character.findFirst({
        where: { id: params.data.characterId, userId },
        select: { id: true },
      });

      if (!character) {
        return reply.code(404).send({
          error: "Personagem não encontrado",
          code: "NOT_FOUND",
        });
      }

      const participant = await prisma.eventCharacter.findFirst({
        where: {
          eventId: event.id,
          characterId: character.id,
        },
        select: { id: true },
      });

      if (!participant) {
        return reply.code(404).send({
          error: "Participante não encontrado",
          code: "NOT_FOUND",
        });
      }

        await prisma.$transaction(async (tx) => {
          await tx.eventCharacter.delete({ where: { id: participant.id } });
          await syncNewsForEvent(tx, event.id);
        });

        return reply.code(204).send();
    },
  );
};

export default eventsRoutes;