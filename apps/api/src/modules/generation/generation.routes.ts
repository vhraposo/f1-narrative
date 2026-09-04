import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  assemblyOnlyResponseComposer,
  generateGeneration,
} from "./generation.assembly.js";
import { GenerationRagFrameNotFoundError } from "./generation-rag-context.js";

// Endpoint READ-ONLY de QA/orquestração (Fase 12 STEP 3, SEM LLM).
//
// Este endpoint monta o contexto determinístico, compõe o systemPrompt e o
// passa pelo NullProvider, retornando o `GenerationResult` para inspeção.
// NÃO gera texto real, não chama provedor de IA, não persiste nada e NÃO está
// conectado a nenhum fluxo de chat (o composer de mensagens permanece intacto).
//
// Fase 13 STEP 22: o query param OPCIONAL `ragFrameId` (UUID) seleciona
// explicitamente o frame de RAG cujo ExternalRagContext é anexado ao contexto.
// Ausente → baseline (sem RAG). UUID inválido → 400. UUID válido mas inexistente
// (ou de outra conversation) → 404 (nunca fallback silencioso para sem RAG).

const conversationIdParamSchema = z.object({
  id: z.string().uuid("Identificador de conversa inválido"),
});

const ragFrameIdQuerySchema = z.object({
  ragFrameId: z.string().uuid("Identificador de frame de RAG inválido").optional(),
});

// Resolve se a Conversation é alcançável pelo usuário (regra da Fase 11):
// usuário possui ao menos um dos Characters participantes. Retorna id ou null.
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

export const generationRoutes: FastifyPluginAsync = async (fastify) => {
  // Compõe o systemPrompt (via Context Assembly + NullProvider) de uma
  // Conversation alcançável — SOMENTE inspeção/QA.
  fastify.get(
    "/api/conversations/:id/craft",
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
      const query = ragFrameIdQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({
          error: "Identificador de frame de RAG inválido",
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

      let generation;
      try {
        generation = await generateGeneration(prisma, {
          conversationId: accessible,
          userId,
          ...(query.data.ragFrameId
            ? { ragFrameId: query.data.ragFrameId }
            : {}),
        });
      } catch (err) {
        if (err instanceof GenerationRagFrameNotFoundError) {
          return reply.code(404).send({
            error: "Frame de RAG não encontrado para esta conversa",
            code: "NOT_FOUND",
          });
        }
        throw err;
      }
      // QA: expõe o skeleton determinístico derivado do generation (SEM LLM).
      const responseSkeleton = assemblyOnlyResponseComposer.compose(generation);
      return reply.send({ generation, responseSkeleton });
    },
  );
};

export default generationRoutes;