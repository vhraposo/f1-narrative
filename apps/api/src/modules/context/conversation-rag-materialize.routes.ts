import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../../infrastructure/database/prisma.js";
import type { EmbeddingProviderWithInputType } from "../external-research/external-embedding-store.js";
import {
  ConversationRagAccessError,
  materializeConversationRag,
} from "../external-research/conversation-rag-materialization.js";

// Endpoint WRITE/ON-DEMAND (Fase 13 STEP 20) de materialização de um
// ConversationRagFrame por Conversation. O handler é um DRIVER: autentica,
// verifica ownership, valida input e delega a materialização EXCLUSIVAMENTE ao
// service `materializeConversationRag` (STEP 17). Não duplica retrieval,
// embedding, hashing de frame, snapshot persistence, freshness ou
// reconstruction — responsabilidades dos serviços já existentes.
//
// READ/WRITE separação: GET /external-rag (readConversationRag, READ ONLY) e
// POST /external-rag/materialize (materializeConversationRag, WRITE) permanecem
// isolados. Este POST NÃO chama o endpoint/read de leitura.

export interface ConversationRagMaterializeRoutesOptions {
  readonly provider: EmbeddingProviderWithInputType;
}

const conversationIdParamSchema = z.object({
  id: z.string().uuid("Identificador de conversa inválido"),
});

const materializeBodySchema = z
  .object({
    queryText: z.string().min(1, "queryText é obrigatório"),
    scopeSourceIds: z.array(z.string().uuid("scopeSourceIds inválido")).optional(),
    topK: z.number().int().min(1).max(50).optional(),
    threshold: z.number().min(-1).max(1).optional(),
  })
  .strict();

export const conversationRagMaterializeRoutes: FastifyPluginAsync<
  ConversationRagMaterializeRoutesOptions
> = async (fastify, options) => {
  fastify.post(
    "/api/conversations/:id/external-rag/materialize",
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

      const bodyParsed = materializeBodySchema.safeParse(request.body ?? {});
      if (!bodyParsed.success) {
        return reply.code(400).send({
          error: "Corpo inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const body = bodyParsed.data;

      try {
        const result = await materializeConversationRag(prisma, options.provider, {
          conversationId: params.data.id,
          ownerId: userId,
          frame: {
            query: body.queryText,
            scopeSourceIds: body.scopeSourceIds,
            topK: body.topK,
            threshold: body.threshold,
          },
        });

        return reply.send({
          conversationId: params.data.id,
          frameId: result.frameId,
          snapshotId: result.snapshotId,
          status: "READY",
          freshness: "CURRENT",
          reused: result.reused,
          itemCount: result.itemCount,
          externalRag: result.context,
        });
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

export default conversationRagMaterializeRoutes;