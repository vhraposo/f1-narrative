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

// select mínimo da NewsItem derivada (leitura read-only).
const newsItemSelect = {
  id: true,
  eventId: true,
  title: true,
  body: true,
  source: true,
  worldDate: true,
  createdAt: true,
} as const;

// select mínimo de Character reutilizado para os participantes do Event.
const participantSelect = {
  id: true,
  name: true,
  nationality: true,
  imageUrl: true,
} as const;

// query opcional de listagem. Filtros limitados aos enums/campos reais do
// schema; nada de paginação ou abstrações novas.
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

  // Listar eventos. Filtro opcional apenas por type/importance (enums reais).
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

  // Criar evento. Entidade global: servidor não injeta userId.
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

      // Criação do Event + geração da notícia derivada em UMA transação:
      // se qualquer uma falhar, nada é persistido. Garante a invariante
      // "Event persistido => NewsItem derivada consistente existe".
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

  // Ler um evento.
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

  // Editar um evento.
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

      // Atualização do Event + regeneração da MESMA notícia derivada em UMA
        // transação (idempotente, nunca duplica). Consistência garantida.
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

  // Excluir um evento. Participantes (EventCharacter) são removidos em
  // cascata (onDelete: Cascade). Como NewsItem.event NÃO possui cascade, a
  // notícia derivada é removida explicitamente antes do Event, evitando órfã e
  // o bloqueio por FK (onDelete padrão NoAction). Tudo em uma transação.
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

  // Ler a notícia derivada (read-only) de um evento.
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
        // Após criação normal sempre existe uma notícia; este caso indica
        // inconsistência e é sinalizado como 404 (evento sem notícia).
        return reply.code(404).send({
          error: "Notícia não encontrada",
          code: "NOT_FOUND",
        });
      }

      return reply.send({ news });
    },
  );

  // ------------------------------------------------------------------
  // EventCharacter — vínculo N:N Event <-> Character.
  // Event não possui ownership; o Character precisa pertencer ao usuário
  // autenticado (ownership indireta, princípio de Relationships).
  // ------------------------------------------------------------------

  // Listar participantes (Characters) de um evento.
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

      // Event é global, mas Characters têm ownership por userId: retornamos
      // apenas EventCharacter cujo Character pertence ao usuário autenticado,
      // sem expor participantes de outros usuários.
      const participants = await prisma.eventCharacter.findMany({
        where: { eventId: event.id, character: { userId } },
        select: { character: { select: participantSelect } },
        orderBy: { character: { name: "asc" } },
      });

      return reply.send({ participants });
    },
  );

  // Associar um Character (do usuário autenticado) a um evento.
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

      // Valida que o Character existe E pertence ao usuário autenticado.
      // 404 para não vazar a existência de characters de outros usuários
      // (inclusive aqueles com userId = null, controlados por IA).
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
        // Associa o participante e regenera a notícia na MESMA transação:
        // a notícia reflete imediatamente o novo participante, sem estado
        // intermediário inconsistente.
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
        // Race condition: outra requisição pode ter criado o vínculo no meio
        // tempo (unique(eventId, characterId)).
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

  // Remover um participante de um evento.
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

      // Valida que o Character existe E pertence ao usuário autenticado.
      // 404 para não vazar a existência de characters de outros usuários
      // (inclusive aqueles com userId = null, controlados por IA).
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

      // Remove o participante e regenera a notícia na MESMA transação: a
        // notícia deixa de refletir o participante removido imediatamente.
        await prisma.$transaction(async (tx) => {
          await tx.eventCharacter.delete({ where: { id: participant.id } });
          await syncNewsForEvent(tx, event.id);
        });

        return reply.code(204).send();
    },
  );
};

export default eventsRoutes;