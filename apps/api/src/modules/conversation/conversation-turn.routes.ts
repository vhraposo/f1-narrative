import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";
import type { GenerationProvider } from "../generation/generation.assembly.js";
import { GenerationRagFrameNotFoundError } from "../generation/generation-rag-context.js";
import { conversationIdParamSchema, turnBodySchema } from "./conversation.schema.js";
import {
  executeTurn,
  TurnUserCharacterError,
} from "./conversation-turn.js";


export interface ConversationTurnRoutesOptions {
  provider: GenerationProvider;
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

export const conversationTurnRoutes: FastifyPluginAsync<ConversationTurnRoutesOptions> =
  async (fastify, opts) => {
    const provider = opts.provider;

    fastify.post(
      "/api/conversations/:id/turn",
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

        const body = turnBodySchema.safeParse(request.body);
        if (!body.success) {
          return reply.code(400).send({
            error: "Dados inválidos",
            code: "VALIDATION_ERROR",
            issues: body.error.issues,
          });
        }

        const accessible = await accessibleConversationId(params.data.id, userId);
        if (!accessible) {
          return reply.code(404).send({
            error: "Conversa não encontrada",
            code: "NOT_FOUND",
          });
        }

        try {
          const result = await executeTurn(prisma, provider, {
            conversationId: accessible,
            userId,
            userPrompt: body.data.userPrompt,
            ...(body.data.ragFrameId !== undefined
              ? { ragFrameId: body.data.ragFrameId }
              : {}),
          });

          return reply.code(201).send({
            userMessage: result.userMessage,
            messages: result.messages,
            failedSpeakers: result.failedSpeakers,
          });
        } catch (err) {
          if (err instanceof TurnUserCharacterError) {
            return reply.code(403).send({
              error: "Nenhum personagem seu participa desta conversa",
              code: "FORBIDDEN",
            });
          }
          if (err instanceof GenerationRagFrameNotFoundError) {
            return reply.code(404).send({
              error: "Frame de RAG não encontrado para esta conversa",
              code: "NOT_FOUND",
            });
          }
          throw err;
        }
      },
    );
  };

export default conversationTurnRoutes;