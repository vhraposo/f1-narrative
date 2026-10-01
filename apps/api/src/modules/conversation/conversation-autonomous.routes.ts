import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";

import { prisma } from "../../infrastructure/database/prisma.js";
import {
  ConversationAutonomousError,
  runAutonomousConversationTurn,
} from "./conversation.autonomous.js";
import { planTurnForConversation } from "./conversation.turn-engine.js";
import type { GenerationProvider } from "../generation/generation.assembly.js";
import { nullProvider } from "../generation/generation.assembly.js";

const paramsSchema = z.object({ conversationId: z.string().uuid() });
const planQuerySchema = z.object({ worldDate: z.string().datetime().optional() });
const turnBodySchema = z.object({ worldDate: z.string().datetime().optional() }).strict();

function sendAutonomousError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof ConversationAutonomousError) {
    reply.code(error.statusCode).send({ error: error.message, code: error.code });
    return true;
  }
  return false;
}

async function accessibleConversation(conversationId: string, userId: string): Promise<boolean> {
  const participant = await prisma.conversationParticipant.findFirst({
    where: { conversationId, character: { userId } },
    select: { id: true },
  });
  return participant !== null;
}

async function defaultWorldDate(conversationId: string): Promise<Date> {
  const lastMessage = await prisma.message.findFirst({
    where: { conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: { createdAt: true },
  });
  return lastMessage?.createdAt ?? new Date();
}

export type ConversationAutonomousRoutesOptions = {
  readonly provider?: GenerationProvider;
};

export const conversationAutonomousRoutes: FastifyPluginAsync<
  ConversationAutonomousRoutesOptions
> = async (fastify, options) => {
  const provider = options.provider ?? nullProvider;

  fastify.get(
    "/api/conversations/:conversationId/turn-plan",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Identificador inválido", code: "VALIDATION_ERROR" });
      }
      const query = planQuerySchema.safeParse(request.query ?? {});
      if (!query.success) {
        return reply.code(400).send({ error: "Consulta inválida", code: "VALIDATION_ERROR" });
      }
      try {
        const accessible = await accessibleConversation(
          params.data.conversationId,
          request.user!.id,
        );
        if (!accessible) {
          throw new ConversationAutonomousError("CONVERSATION_NOT_FOUND", "Conversa não encontrada", 404);
        }
        const worldDate = query.data.worldDate
          ? new Date(query.data.worldDate)
          : await defaultWorldDate(params.data.conversationId);
        const plan = await planTurnForConversation(params.data.conversationId, { worldDate });
        return reply.send({ plan });
      } catch (error) {
        if (sendAutonomousError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.post(
    "/api/conversations/:conversationId/autonomous-turn",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Identificador inválido", code: "VALIDATION_ERROR" });
      }
      const body = turnBodySchema.safeParse(request.body ?? {});
      if (!body.success) {
        return reply.code(400).send({ error: "Dados inválidos", code: "VALIDATION_ERROR" });
      }
      try {
        const accessible = await accessibleConversation(
          params.data.conversationId,
          request.user!.id,
        );
        if (!accessible) {
          throw new ConversationAutonomousError("CONVERSATION_NOT_FOUND", "Conversa não encontrada", 404);
        }
        const result = await runAutonomousConversationTurn(params.data.conversationId, {
          userId: request.user!.id,
          ...(body.data.worldDate ? { worldDate: new Date(body.data.worldDate) } : {}),
          provider,
        });
        return reply.code(result.executed ? 201 : 200).send({ turn: result });
      } catch (error) {
        if (sendAutonomousError(reply, error)) return;
        throw error;
      }
    },
  );
};

export default conversationAutonomousRoutes;
