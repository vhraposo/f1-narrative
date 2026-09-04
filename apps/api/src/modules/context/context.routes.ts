import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../../infrastructure/database/prisma.js";
import { assembleContext, ContextAccessError } from "./context.assembly.js";

// Endpoint READ-ONLY de observação do Context Assembly (Fase 12, SEM LLM).
//
// Este endpoint NÃO gera texto, não chama provedor de IA e não escreve nada.
// Ele apenas expõe o contexto montado (seleção determinística) de uma
// Conversation alcançável, para fins de QA/observação. Fica FORA de qualquer
// fluxo de geração; o fluxo de geração virá em STEP posterior e não dependerá
// deste endpoint.

const conversationIdParamSchema = z.object({
  id: z.string().uuid("Identificador de conversa inválido"),
});

// Resolve se a Conversation é alcançável pelo usuário: o usuário possui ao
// menos um dos Characters participantes. Retorna o id ou null (404, sem vazar).
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

export const contextRoutes: FastifyPluginAsync = async (fastify) => {
  // Monta o contexto determinístico de uma Conversation alcançável (observação).
  fastify.get(
    "/api/conversations/:id/context",
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

      try {
        const context = await assembleContext(prisma, {
          conversationId: accessible,
          userId,
        });
        return reply.send({ context });
      } catch (error) {
        if (error instanceof ContextAccessError) {
          return reply.code(error.statusCode).send({
            error: error.message,
            code: error.code,
          });
        }
        throw error;
      }
    },
  );
};

export default contextRoutes;