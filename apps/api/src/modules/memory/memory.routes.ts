import type { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  createMemorySchema,
  memoryAddParticipantSchema,
  memoryCharacterIdParamSchema,
  memoryIdParamSchema,
  memoryListQuerySchema,
  memoryParticipantCharacterIdParamSchema,
  updateMemorySchema,
} from "./memory.schema.js";

// select mínimo de Character reutilizado para os participantes de uma Memory.
// controlledBy/userId permitem à UI distinguir Characters USER de AI (entidade
// central do domínio); não altera schema, apenas expõe campos já existentes.
const characterMinSelect = {
  id: true,
  name: true,
  nationality: true,
  imageUrl: true,
  controlledBy: true,
  userId: true,
} as const;

const memorySelect = {
  id: true,
  eventId: true,
  importance: true,
  source: true,
  content: true,
  summary: true,
  context: true,
  emotionalImpact: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Select de Memory que também traz os participantes (Character USER/AI).
// A UI espera `memory.participants` como lista plana de characters; por isso o
// resultado é "achatado" por flattenMemory, removendo o wrapper `{ character }`.
const memoryWithParticipantsSelect = {
  ...memorySelect,
  participants: {
    select: { character: { select: characterMinSelect } },
    orderBy: { character: { name: "asc" } },
  },
} as const;

// Converte o participants aninhado (`{ character: {...} }`) de uma Memory em uma
// lista plana de characters, que é o contrato consumido pela UI do frontend.
// Aceita `null` para os casos em que o findUnique pode teoricamente não achar.
function flattenMemory(
  memory:
    | {
        participants?: Array<{ character: Record<string, unknown> } | undefined>;
      }
    | null
    | undefined,
) {
  if (!memory) return null;
  return {
    ...memory,
    participants: (memory.participants ?? []).map((p) => p?.character),
  };
}

// Detecta erros conhecidos do Prisma (violação de unique / FK restrita) e os
// converte em respostas previsíveis de conflito (409).
function isConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2003")
  );
}

// Indica se um Character pertence ao usuário autenticado (ownership direta).
async function isOwnedByUser(characterId: string, userId: string): Promise<boolean> {
  const character = await prisma.character.findFirst({
    where: { id: characterId, userId },
    select: { id: true },
  });
  return character !== null;
}

// Verifica apenas se um Character existe (USER ou AI), sem exigir propriedade.
async function characterExists(characterId: string): Promise<boolean> {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true },
  });
  return character !== null;
}

// Resolve uma Memory alcançável pelo usuário: a Memory é alcançável quando o
// usuário possui ao menos um dos Characters que participam dela. Retorna o id
// ou null (404, sem vazar existência).
async function accessibleMemoryId(memoryId: string, userId: string) {
  const membership = await prisma.memoryCharacter.findFirst({
    where: {
      memoryId,
      character: { userId },
    },
    select: { memoryId: true },
  });
  return membership?.memoryId ?? null;
}

function normalizeContext(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
}

export const memoryRoutes: FastifyPluginAsync = async (fastify) => {
  // ------------------------------------------------------------------
  // Memory — entidade narrativa ancorada em Characters (ownership indireta).
  // ------------------------------------------------------------------

  // Listar Memories alcançáveis pelo usuário (possui ao menos um participante).
  // Filtro determinístico opcional por importance e/ou eventId; order createdAt DESC.
  fastify.get(
    "/api/memories",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const query = memoryListQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: query.error.issues,
        });
      }

      const memberships = await prisma.memoryCharacter.findMany({
        where: {
          character: { userId },
          ...(query.data.eventId !== undefined
            ? { memory: { eventId: query.data.eventId } }
            : {}),
        },
        select: { memoryId: true },
      });
      const accessibleIds = memberships.map((m) => m.memoryId);

      const memories = await prisma.memory.findMany({
        where: {
          id: { in: accessibleIds },
          ...(query.data.importance !== undefined
            ? { importance: query.data.importance }
            : {}),
        },
        select: memoryWithParticipantsSelect,
        orderBy: { createdAt: "desc" },
      });

      return reply.send({ memories: memories.map(flattenMemory) });
    },
  );

  // Criar Memory ancorada em ao menos um Character próprio.
  fastify.post(
    "/api/memories",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const parsed = createMemorySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }

      // eventId opcional: deve referenciar um Event existente.
      if (parsed.data.eventId) {
        const event = await prisma.event.findUnique({
          where: { id: parsed.data.eventId },
          select: { id: true },
        });
        if (!event) {
          return reply.code(404).send({
            error: "Evento não encontrado",
            code: "NOT_FOUND",
          });
        }
      }

      // Participantes iniciais: todos precisam EXISTIR (404 se algum não existir).
      // Não é exigido que todos pertençam ao usuário: a Memory pode envolver
      // Characters USER e AI. Exige-se que AO MENOS um pertença ao usuário
      // (ownership da Memory ancorada na participação de um Character próprio).
      const characterIds = parsed.data.characterIds;
      let ownsAny = false;
      for (const characterId of characterIds) {
        const exists = await characterExists(characterId);
        if (!exists) {
          return reply.code(404).send({
            error: "Personagem não encontrado",
            code: "NOT_FOUND",
          });
        }
        if (await isOwnedByUser(characterId, userId)) {
          ownsAny = true;
        }
      }

      // Sem nenhum participante próprio, o usuário não tem como ancorar a
      // Memory: 404 preserva o princípio de não vazamento (sem 403).
      if (!ownsAny) {
        return reply.code(404).send({
          error: "Memória não criada",
          code: "NOT_FOUND",
        });
      }

      // Cria Memory + vínculos MemoryCharacter em UMA transação.
      try {
        const memory = await prisma.$transaction(async (tx) => {
          const created = await tx.memory.create({
            data: {
              content: parsed.data.content,
              summary: parsed.data.summary ?? null,
              context: normalizeContext(parsed.data.context),
              importance: parsed.data.importance,
              source: parsed.data.source,
              emotionalImpact: parsed.data.emotionalImpact ?? null,
              eventId: parsed.data.eventId ?? null,
            },
            select: memorySelect,
          });

          await tx.memoryCharacter.createMany({
            data: characterIds.map((characterId) => ({
              memoryId: created.id,
              characterId,
            })),
          });

          return created;
        });

        // Recarrega com participantes (criados na transação) e achata a lista.
        const withParticipants = await prisma.memory.findUnique({
          where: { id: memory.id },
          select: memoryWithParticipantsSelect,
        });

        return reply.code(201).send({ memory: flattenMemory(withParticipants) });
      } catch (error) {
        if (isConflict(error)) {
          return reply.code(409).send({
            error: "Não foi possível criar a memória",
            code: "CONFLICT",
          });
        }
        throw error;
      }
    },
  );

  // Ler uma Memory (alcançável pelo usuário) com participantes.
  fastify.get(
    "/api/memories/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = memoryIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const accessible = await accessibleMemoryId(params.data.id, userId);
      if (!accessible) {
        return reply.code(404).send({
          error: "Memória não encontrada",
          code: "NOT_FOUND",
        });
      }

      const memory = await prisma.memory.findUnique({
        where: { id: accessible },
        select: memoryWithParticipantsSelect,
      });

      return reply.send({ memory: flattenMemory(memory) });
    },
  );

  // Editar uma Memory (alcançável pelo usuário).
  fastify.patch(
    "/api/memories/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = memoryIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const parsed = updateMemorySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }

      const accessible = await accessibleMemoryId(params.data.id, userId);
      if (!accessible) {
        return reply.code(404).send({
          error: "Memória não encontrada",
          code: "NOT_FOUND",
        });
      }

      // eventId opcional: deve referenciar um Event existente.
      if (parsed.data.eventId) {
        const event = await prisma.event.findUnique({
          where: { id: parsed.data.eventId },
          select: { id: true },
        });
        if (!event) {
          return reply.code(404).send({
            error: "Evento não encontrado",
            code: "NOT_FOUND",
          });
        }
      }

      const memory = await prisma.memory.update({
        where: { id: accessible },
        data: {
          ...(parsed.data.content !== undefined
            ? { content: parsed.data.content }
            : {}),
          ...(parsed.data.summary !== undefined
            ? { summary: parsed.data.summary }
            : {}),
          ...(parsed.data.context !== undefined
            ? { context: normalizeContext(parsed.data.context) }
            : {}),
          ...(parsed.data.importance !== undefined
            ? { importance: parsed.data.importance }
            : {}),
          ...(parsed.data.source !== undefined
            ? { source: parsed.data.source }
            : {}),
          ...(parsed.data.emotionalImpact !== undefined
            ? { emotionalImpact: parsed.data.emotionalImpact }
            : {}),
          ...(parsed.data.eventId !== undefined
            ? { eventId: parsed.data.eventId }
            : {}),
        },
        select: memoryWithParticipantsSelect,
      });

      return reply.send({ memory: flattenMemory(memory) });
    },
  );

  // Excluir uma Memory (alcançável pelo usuário). MemoryCharacter é removido em
  // cascata (onDelete: Cascade).
  fastify.delete(
    "/api/memories/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = memoryIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const accessible = await accessibleMemoryId(params.data.id, userId);
      if (!accessible) {
        return reply.code(404).send({
          error: "Memória não encontrada",
          code: "NOT_FOUND",
        });
      }

      await prisma.memory.delete({ where: { id: accessible } });

      return reply.code(204).send();
    },
  );

  // ------------------------------------------------------------------
  // Character retrieval: Memories de um Character próprio.
  // ------------------------------------------------------------------
  fastify.get(
    "/api/characters/:characterId/memories",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = memoryCharacterIdParamSchema.safeParse(request.params);
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

      const memberships = await prisma.memoryCharacter.findMany({
        where: { characterId: character.id },
        select: { memory: { select: memoryWithParticipantsSelect } },
        orderBy: { memory: { createdAt: "desc" } },
      });

      // Achata os vínculos em uma lista plana de Memories, ordenadas por createdAt DESC.
      const memories = memberships.map((m) => flattenMemory(m.memory));

      return reply.send({ memories });
    },
  );

  // ------------------------------------------------------------------
  // MemoryCharacter — vínculo N:N Memory <-> Character.
  // O acesso à Memory exige possuir ao menos um participante; o Character a
  // associar/remover deve pertencer ao usuário autenticado.
  // ------------------------------------------------------------------

  // Adicionar um Character (do usuário) como participante de uma Memory própria.
  fastify.post(
    "/api/memories/:id/characters",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = memoryIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const parsed = memoryAddParticipantSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }

      const accessible = await accessibleMemoryId(params.data.id, userId);
      if (!accessible) {
        return reply.code(404).send({
          error: "Memória não encontrada",
          code: "NOT_FOUND",
        });
      }

      // Valida que o Character EXISTE (USER ou AI). Caracteres AI podem ser
      // associados livremente; a autorização sobre a Memory já foi garantida
      // pelo gate accessibleMemoryId acima.
      if (!(await characterExists(parsed.data.characterId))) {
        return reply.code(404).send({
          error: "Personagem não encontrado",
          code: "NOT_FOUND",
        });
      }

      const existing = await prisma.memoryCharacter.findFirst({
        where: {
          memoryId: accessible,
          characterId: parsed.data.characterId,
        },
        select: { id: true },
      });

      if (existing) {
        return reply.code(409).send({
          error: "Este personagem já participa da memória",
          code: "CONFLICT",
        });
      }

      try {
        const participant = await prisma.memoryCharacter.create({
          data: { memoryId: accessible, characterId: parsed.data.characterId },
          select: { character: { select: characterMinSelect } },
        });
        return reply.code(201).send({ participant });
      } catch (error) {
        if (isConflict(error)) {
          return reply.code(409).send({
            error: "Este personagem já participa da memória",
            code: "CONFLICT",
          });
        }
        throw error;
      }
    },
  );

  // Remover um Character como participante de uma Memory própria.
  fastify.delete(
    "/api/memories/:id/characters/:characterId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = memoryParticipantCharacterIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const accessible = await accessibleMemoryId(params.data.id, userId);
      if (!accessible) {
        return reply.code(404).send({
          error: "Memória não encontrada",
          code: "NOT_FOUND",
        });
      }

      // Localiza o vínculo participante pela Memory (acesso já garantido via
      // accessibleMemoryId acima). O participante pode ser USER ou AI; a
      // remoção é autorizada pelo acesso à Memory, não pela posse do Character.
      const participant = await prisma.memoryCharacter.findFirst({
        where: {
          memoryId: accessible,
          characterId: params.data.characterId,
        },
        select: { id: true },
      });

      if (!participant) {
        return reply.code(404).send({
          error: "Participante não encontrado",
          code: "NOT_FOUND",
        });
      }

      await prisma.memoryCharacter.delete({ where: { id: participant.id } });

      return reply.code(204).send();
    },
  );
};

export default memoryRoutes;