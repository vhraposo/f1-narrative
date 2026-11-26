import type { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  addConversationParticipantSchema,
  conversationIdParamSchema,
  conversationParticipantParamSchema,
  createConversationSchema,
  createMessageSchema,
  updateConversationSchema,
} from "./conversation.schema.js";

// select mínimo de Character reutilizado para os participantes de uma
// Conversation. controlledBy/userId permitem distinguir Characters USER de AI.
const characterMinSelect = {
  id: true,
  name: true,
  nationality: true,
  imageUrl: true,
  controlledBy: true,
  userId: true,
} as const;

const conversationSelect = {
  id: true,
  title: true,
  type: true,
  visibility: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Select de Conversation que também traz os participantes (lista plana de
// characters) e a contagem de mensagens — expõe somente campos já existentes.
const conversationWithParticipantsSelect = {
  ...conversationSelect,
  participants: {
    select: { character: { select: characterMinSelect } },
    orderBy: { character: { name: "asc" } },
  },
  _count: { select: { messages: true } },
} as const;

// Converte participants aninhado (`{ character: {...} }`) em lista plana.
function flattenConversation(
  conversation:
    | {
        participants?: Array<{ character: Record<string, unknown> } | undefined>;
        _count?: { messages: number };
      }
    | null
    | undefined,
) {
  if (!conversation) return null;
  const { _count, participants, ...rest } = conversation;
  return {
    ...rest,
    participants: (participants ?? []).map((p) => p?.character),
    messageCount: _count?.messages ?? 0,
  };
}

const messageSelect = {
  id: true,
  conversationId: true,
  senderType: true,
  characterId: true,
  content: true,
  contextJson: true,
  createdAt: true,
} as const;

function isConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2003")
  );
}

async function accessibleConversationId(conversationId: string, userId: string) {
  const membership = await prisma.conversationParticipant.findFirst({
    where: {
      conversationId,
      character: { userId },
    },
    select: { conversationId: true },
  });
  return membership?.conversationId ?? null;
}

type CharacterAccessRow = {
  readonly id: string;
  readonly userId: string | null;
  readonly universeId: string | null;
};

async function callerUniverseId(userId: string): Promise<string | null> {
  const universe = await prisma.universe.findUnique({
    where: { userId },
    select: { id: true },
  });
  return universe?.id ?? null;
}

// F7.1: um personagem só entra numa Conversation do Universe do usuário.
// Global catalog (userId null + universeId null) continua permitido; personagem
// de outro Universe ou de outro usuário é rejeitado sem vazar existência (404).
function characterCompatibleWithUniverse(
  character: CharacterAccessRow,
  userId: string,
  universeId: string | null,
): boolean {
  const ownershipOk = character.userId === null || character.userId === userId;
  const universeOk =
    character.universeId === null ||
    (universeId !== null && character.universeId === universeId);
  return ownershipOk && universeOk;
}

const characterAccessSelect = { id: true, userId: true, universeId: true } as const;

async function validateMessageSender(
  conversationId: string,
  body: { senderType: string; characterId?: string | null },
  userId: string,
): Promise<{ statusCode: number; error: string; code: string } | null> {
  const { senderType, characterId } = body;

  if (senderType === "SYSTEM") {
    if (characterId) {
      return {
        statusCode: 400,
        error: "Mensagens SYSTEM não podem ter remetente (characterId)",
        code: "VALIDATION_ERROR",
      };
    }
    return null;
  }

  if (!characterId) {
    return {
      statusCode: 400,
      error: "Informe o remetente (characterId) para esta mensagem",
      code: "VALIDATION_ERROR",
    };
  }

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true, controlledBy: true, userId: true },
  });
  if (!character) {
    return {
      statusCode: 404,
      error: "Personagem não encontrado",
      code: "NOT_FOUND",
    };
  }

  const participant = await prisma.conversationParticipant.findUnique({
    where: {
      conversationId_characterId: { conversationId, characterId },
    },
    select: { id: true },
  });
  if (!participant) {
    return {
      statusCode: 403,
      error: "Personagem não participa desta conversa",
      code: "FORBIDDEN",
    };
  }

  if (senderType === "USER_CHARACTER") {
    if (character.controlledBy !== "USER" || character.userId !== userId) {
      return {
        statusCode: 403,
        error: "Remetente inválido para este usuário",
        code: "FORBIDDEN",
      };
    }
    return null;
  }

  if (character.controlledBy !== "AI") {
    return {
      statusCode: 400,
      error: "Remetente AI_CHARACTER exige um personagem controlado por IA",
      code: "VALIDATION_ERROR",
    };
  }
  return null;
}

export const conversationRoutes: FastifyPluginAsync = async (fastify) => {
  // ------------------------------------------------------------------
  // Conversation 
  // ------------------------------------------------------------------

  fastify.get(
    "/api/conversations",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;

      const memberships = await prisma.conversationParticipant.findMany({
        where: { character: { userId } },
        select: { conversationId: true },
      });
      const accessibleIds = memberships.map((m) => m.conversationId);

      const conversations = await prisma.conversation.findMany({
        where: { id: { in: accessibleIds } },
        select: conversationWithParticipantsSelect,
        orderBy: { updatedAt: "desc" },
      });

      return reply.send({ conversations: conversations.map(flattenConversation) });
    },
  );

  fastify.post(
    "/api/conversations",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const parsed = createConversationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }

      const { participantIds, type } = parsed.data;

      if (type === "DM" && participantIds.length !== 2) {
        return reply.code(400).send({
          error: "Conversa direta (DM) exige exatamente 2 participantes",
          code: "VALIDATION_ERROR",
        });
      }

      let ownsAny = false;
      const userUniverseId = await callerUniverseId(userId);
      for (const characterId of participantIds) {
        const character = await prisma.character.findUnique({
          where: { id: characterId },
          select: characterAccessSelect,
        });
        if (!character) {
          return reply.code(404).send({
            error: "Personagem não encontrado",
            code: "NOT_FOUND",
          });
        }
        if (!characterCompatibleWithUniverse(character, userId, userUniverseId)) {
          return reply.code(404).send({
            error: "Personagem não encontrado",
            code: "NOT_FOUND",
          });
        }
        if (character.userId === userId) {
          ownsAny = true;
        }
      }

      if (!ownsAny) {
        return reply.code(404).send({
          error: "Conversa não criada",
          code: "NOT_FOUND",
        });
      }

      try {
        const conversation = await prisma.$transaction(async (tx) => {
          const created = await tx.conversation.create({
            data: {
              title: parsed.data.title ?? null,
              type: type ?? "GROUP",
            },
            select: conversationSelect,
          });

          const uniqueIds = [...new Set(participantIds)];
          await tx.conversationParticipant.createMany({
            data: uniqueIds.map((characterId) => ({
              conversationId: created.id,
              characterId,
            })),
          });

          return created;
        });

        const withParticipants = await prisma.conversation.findUnique({
          where: { id: conversation.id },
          select: conversationWithParticipantsSelect,
        });

        return reply.code(201).send({
          conversation: flattenConversation(withParticipants),
        });
      } catch (error) {
        if (isConflict(error)) {
          return reply.code(409).send({
            error: "Não foi possível criar a conversa",
            code: "CONFLICT",
          });
        }
        throw error;
      }
    },
  );

  fastify.get(
    "/api/conversations/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = conversationIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const accessible = await accessibleConversationId(params.data.id, userId);
      if (!accessible) {
        return reply.code(404).send({
          error: "Conversa não encontrada",
          code: "NOT_FOUND",
        });
      }

      const conversation = await prisma.conversation.findUnique({
        where: { id: accessible },
        select: conversationWithParticipantsSelect,
      });

      return reply.send({ conversation: flattenConversation(conversation) });
    },
  );

  fastify.patch(
    "/api/conversations/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = conversationIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const parsed = updateConversationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }

      const accessible = await accessibleConversationId(params.data.id, userId);
      if (!accessible) {
        return reply.code(404).send({
          error: "Conversa não encontrada",
          code: "NOT_FOUND",
        });
      }

      const conversation = await prisma.conversation.update({
        where: { id: accessible },
        data: {
          ...(parsed.data.title !== undefined
            ? { title: parsed.data.title }
            : {}),
          ...(parsed.data.type !== undefined
            ? { type: parsed.data.type }
            : {}),
        },
        select: conversationWithParticipantsSelect,
      });

      return reply.send({ conversation: flattenConversation(conversation) });
    },
  );

  fastify.delete(
    "/api/conversations/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = conversationIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const accessible = await accessibleConversationId(params.data.id, userId);
      if (!accessible) {
        return reply.code(404).send({
          error: "Conversa não encontrada",
          code: "NOT_FOUND",
        });
      }

      await prisma.conversation.delete({ where: { id: accessible } });

      return reply.code(204).send();
    },
  );

  // ------------------------------------------------------------------
  // ConversationParticipant — vínculo N:N Conversation <-> Character.
  // ------------------------------------------------------------------

  fastify.get(
    "/api/conversations/:id/participants",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = conversationIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const accessible = await accessibleConversationId(params.data.id, userId);
      if (!accessible) {
        return reply.code(404).send({
          error: "Conversa não encontrada",
          code: "NOT_FOUND",
        });
      }

      const participants = await prisma.conversationParticipant.findMany({
        where: { conversationId: accessible },
        select: { character: { select: characterMinSelect } },
        orderBy: { character: { name: "asc" } },
      });

      return reply.send({
        participants: participants.map((p) => p.character),
      });
    },
  );

  fastify.post(
    "/api/conversations/:id/participants",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = conversationIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const parsed = addConversationParticipantSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }

      const accessible = await accessibleConversationId(params.data.id, userId);
      if (!accessible) {
        return reply.code(404).send({
          error: "Conversa não encontrada",
          code: "NOT_FOUND",
        });
      }

      const character = await prisma.character.findUnique({
        where: { id: parsed.data.characterId },
        select: characterAccessSelect,
      });
      if (!character) {
        return reply.code(404).send({
          error: "Personagem não encontrado",
          code: "NOT_FOUND",
        });
      }

      const participantUniverseIds = await prisma.conversationParticipant.findMany({
        where: { conversationId: accessible },
        select: { character: { select: { universeId: true } } },
      });
      const distinctUniverseIds = new Set(
        participantUniverseIds
          .map((participant) => participant.character.universeId)
          .filter((universeId): universeId is string => universeId !== null),
      );
      if (distinctUniverseIds.size > 1) {
        return reply.code(409).send({
          error: "Conversa com participantes de universos diferentes",
          code: "CONFLICT",
        });
      }
      const conversationUniverseId =
        [...distinctUniverseIds][0] ?? (await callerUniverseId(userId));
      if (!characterCompatibleWithUniverse(character, userId, conversationUniverseId)) {
        return reply.code(404).send({
          error: "Personagem não encontrado",
          code: "NOT_FOUND",
        });
      }

      try {
        const participant = await prisma.conversationParticipant.create({
          data: {
            conversationId: accessible,
            characterId: parsed.data.characterId,
          },
          select: { character: { select: characterMinSelect } },
        });
        return reply.code(201).send({ participant: participant.character });
      } catch (error) {
        if (isConflict(error)) {
          return reply.code(409).send({
            error: "Este personagem já participa da conversa",
            code: "CONFLICT",
          });
        }
        throw error;
      }
    },
  );

  fastify.delete(
    "/api/conversations/:id/participants/:characterId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = conversationParticipantParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const accessible = await accessibleConversationId(params.data.id, userId);
      if (!accessible) {
        return reply.code(404).send({
          error: "Conversa não encontrada",
          code: "NOT_FOUND",
        });
      }

      const participant = await prisma.conversationParticipant.findUnique({
        where: {
          conversationId_characterId: {
            conversationId: accessible,
            characterId: params.data.characterId,
          },
        },
        select: { id: true },
      });
      if (!participant) {
        return reply.code(404).send({
          error: "Participante não encontrado",
          code: "NOT_FOUND",
        });
      }

      await prisma.conversationParticipant.delete({ where: { id: participant.id } });

      return reply.code(204).send();
    },
  );

  fastify.post(
    "/api/conversations/:id/messages",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = conversationIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const parsed = createMessageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }

      const accessible = await accessibleConversationId(params.data.id, userId);
      if (!accessible) {
        return reply.code(404).send({
          error: "Conversa não encontrada",
          code: "NOT_FOUND",
        });
      }

      const senderError = await validateMessageSender(
        accessible,
        parsed.data,
        userId,
      );
      if (senderError) {
        return reply.code(senderError.statusCode).send(senderError);
      }

      const message = await prisma.message.create({
        data: {
          conversationId: accessible,
          senderType: parsed.data.senderType,
          characterId: parsed.data.characterId ?? null,
          content: parsed.data.content,
        },
        select: messageSelect,
      });

      await prisma.conversation.update({
        where: { id: accessible },
        data: { updatedAt: new Date() },
      });

      return reply.code(201).send({ message });
    },
  );

  fastify.get(
    "/api/conversations/:id/messages",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = conversationIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const accessible = await accessibleConversationId(params.data.id, userId);
      if (!accessible) {
        return reply.code(404).send({
          error: "Conversa não encontrada",
          code: "NOT_FOUND",
        });
      }

      const messages = await prisma.message.findMany({
        where: { conversationId: accessible },
        select: messageSelect,
        orderBy: { createdAt: "asc" },
      });

      return reply.send({ messages });
    },
  );
};

export default conversationRoutes;