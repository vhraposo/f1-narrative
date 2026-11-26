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
import { applyEventEvolution } from "./event-evolution.js";
import { validateEventPayloadContext } from "./event-context.js";
import { createEventWithDerivations } from "./event-create.js";

const eventSelect = {
  id: true,
  type: true,
  importance: true,
  source: true,
  visibility: true,
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

function isMissing(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

async function findMutatableEventId(userId: string, eventId: string): Promise<string | null> {
  const owned = await prisma.event.findFirst({
    where: {
      id: eventId,
      OR: [
        { createdById: userId },
        { participants: { some: { character: { userId } } } },
        { participants: { some: { character: { universe: { userId } } } } },
      ],
    },
    select: { id: true },
  });
  if (owned) return owned.id;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!user || user.role !== "ADMIN") return null;
  const any = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
  return any?.id ?? null;
}

// F7.3: Event RESTRICTED só é visível ao criador/participantes (audiência
// EventCharacter). PUBLIC continua visível a qualquer usuário autenticado.
function eventVisibilityScope(userId: string) {
  return {
    OR: [
      { visibility: "PUBLIC" as const },
      { createdById: userId },
      { participants: { some: { character: { userId } } } },
      { participants: { some: { character: { universe: { userId } } } } },
    ],
  };
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
      const userId = request.user!.id;
      const events = await prisma.event.findMany({
        where: { ...query.data, ...eventVisibilityScope(userId) },
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

      const contextError = await validateEventPayloadContext(
        request.user!.id,
        parsed.data.payload,
      );
      if (contextError) {
        return reply
          .code(contextError.statusCode)
          .send({ error: contextError.error, code: contextError.code });
      }

      const event = await prisma.$transaction(async (tx) => {
        const created = await createEventWithDerivations(tx, {
          type: parsed.data.type,
          title: parsed.data.title,
          description: parsed.data.description ?? null,
          importance: parsed.data.importance,
          source: parsed.data.source,
          ...(parsed.data.visibility !== undefined
            ? { visibility: parsed.data.visibility }
            : {}),
          worldDate: parsed.data.worldDate ?? null,
          payload: parsed.data.payload as Prisma.InputJsonValue | null | undefined,
          createdById: request.user!.id,
        });
        return tx.event.findUniqueOrThrow({
          where: { id: created.id },
          select: eventSelect,
        });
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

      const event = await prisma.event.findFirst({
        where: { id: params.data.id, ...eventVisibilityScope(request.user!.id) },
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

      if (parsed.data.payload !== undefined) {
        const contextError = await validateEventPayloadContext(
          request.user!.id,
          parsed.data.payload,
        );
        if (contextError) {
          return reply
            .code(contextError.statusCode)
            .send({ error: contextError.error, code: contextError.code });
        }
      }

      const existingId = await findMutatableEventId(request.user!.id, params.data.id);

      if (!existingId) {
        return reply.code(404).send({
          error: "Evento não encontrado",
          code: "NOT_FOUND",
        });
      }

      try {
        const event = await prisma.$transaction(async (tx) => {
          const updated = await tx.event.update({
            where: { id: existingId },
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

          await applyEventEvolution(tx, updated.id);

          return updated;
        });

        return reply.send({ event });
      } catch (error) {
        if (isConflict(error)) {
          return reply.code(409).send({
            error: "Conflito ao atualizar o evento",
            code: "CONFLICT",
          });
        }
        if (isMissing(error)) {
          return reply.code(404).send({
            error: "Evento não encontrado",
            code: "NOT_FOUND",
          });
        }
        throw error;
      }
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

      const existingId = await findMutatableEventId(request.user!.id, params.data.id);

      if (!existingId) {
        return reply.code(404).send({
          error: "Evento não encontrado",
          code: "NOT_FOUND",
        });
      }

      try {
        await prisma.$transaction(async (tx) => {
          await tx.memoryCharacter.deleteMany({
            where: { memory: { eventId: existingId } },
          });
          await tx.memory.deleteMany({ where: { eventId: existingId } });
          await tx.newsItem.deleteMany({ where: { eventId: existingId } });
          await tx.event.delete({ where: { id: existingId } });
        });
      } catch (error) {
        if (isConflict(error)) {
          return reply.code(409).send({
            error: "Não é possível excluir o evento",
            code: "CONFLICT",
          });
        }
        if (isMissing(error)) {
          return reply.code(404).send({
            error: "Evento não encontrado",
            code: "NOT_FOUND",
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

          await applyEventEvolution(tx, event.id);

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

      try {
        await prisma.$transaction(async (tx) => {
          await tx.eventCharacter.delete({ where: { id: participant.id } });
          await syncNewsForEvent(tx, event.id);
        });
      } catch (error) {
        if (isMissing(error)) {
          return reply.code(404).send({
            error: "Participante não encontrado",
            code: "NOT_FOUND",
          });
        }
        throw error;
      }

      return reply.code(204).send();
    },
  );
};

export default eventsRoutes;