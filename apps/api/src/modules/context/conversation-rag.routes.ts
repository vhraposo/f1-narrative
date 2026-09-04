import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../../infrastructure/database/prisma.js";
import { readConversationRag } from "./conversation-rag-read.js";
import { ConversationRagAccessError } from "../external-research/conversation-rag-materialization.js";

// Endpoint READ-ONLY (Fase 13 STEP 19) de observação do RAG materializado por
// Conversation. Reexecuta exclusivamente o read service do STEP 18.
//
// Este endpoint NÃO executa retrieval, materialization, embedding, pgvector ou
// provider. Ele apenas localiza os frames/snapshots JÁ persistidos e reconstrói
// o `ExternalRagContext` correspondente, preservando freshness (CURRENT/STALE/
// NO_SNAPSHOT) e a ordem decidida pelo service.

const conversationIdParamSchema = z.object({
  id: z.string().uuid("Identificador de conversa inválido"),
});

export const conversationRagRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/conversations/:id/external-rag",
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

      try {
        const result = await readConversationRag(prisma, params.data.id, userId);
        return reply.send(result);
      } catch (error) {
        if (error instanceof ConversationRagAccessError) {
          return reply.code(404).send({
            error: "Conversa não encontrada",
            code: "NOT_FOUND",
          });
        }
        throw error;
      }
    },
  );
};

export default conversationRagRoutes;