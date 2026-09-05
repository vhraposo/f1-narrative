import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  assembleGenerationBundle,
  assemblyOnlyResponseComposer,
  GenerationSpeakerTargetError,
  GenerationUserInputError,
  type GenerationProvider,
} from "./generation.assembly.js";
import { persistGeneratedMessage } from "./generation-persist.js";
import { GenerationRagFrameNotFoundError } from "./generation-rag-context.js";
import { OllamaProviderError } from "./ollama-provider.js";
import { generateBodySchema, generateParamsSchema } from "./generation.schema.js";

// ---------------------------------------------------------------------------
// Rota real de geração (Fase 14 STEP 39): POST /api/conversations/:id/generate.
//
// Conecta peças já existentes SEM criar camada de abstração nova:
//
//   HTTP → authenticate → ownership → zod → assembleGenerationBundle
//         → provider real (DI server-side) → persistGeneratedMessage → resposta.
//
// - O provider é DECISÃO DO SERVIDOR: injetado via buildApp (DI). Nunca por
//   query param/body; cliente nunca escolhe "ollama"/"null".
// - Default de compatibilidade: NullProvider (assembly-only) — o mesmo default
//   que o /craft; geração real exige injeção explícita do OllamaProvider
//   (decisão documentada no relatório do STEP 39).
// - NÃO reimplementa: speaker resolution, RAG resolution, context assembly,
//   GenerationKey (tudo delegado ao bundle).
// - NÃO persiste a Message do usuário (só a resposta AI gerada).
// - Sem idempotência (limitação conhecida e documentada; retry duplica).
// ---------------------------------------------------------------------------

export interface GenerationGenerateRoutesOptions {
  /** Provider real injetado pelo servidor (default: NullProvider). */
  provider: GenerationProvider;
}

// Resolve se a Conversation é alcançável pelo usuário (regra da Fase 11):
// o usuário possui ao menos um dos Characters participantes. Retorna o id ou
// null (404, sem vazar). Mesma política usada por conversation.routes/context.
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

export const generationGenerateRoutes: FastifyPluginAsync<GenerationGenerateRoutesOptions> =
  async (fastify, opts) => {
    const provider = opts.provider;

    fastify.post(
      "/api/conversations/:id/generate",
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const userId = request.user!.id;

        const params = generateParamsSchema.safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send({
            error: "Identificador inválido",
            code: "VALIDATION_ERROR",
            issues: params.error.issues,
          });
        }

        const body = generateBodySchema.safeParse(request.body);
        if (!body.success) {
          return reply.code(400).send({
            error: "Dados inválidos",
            code: "VALIDATION_ERROR",
            issues: body.error.issues,
          });
        }

        // Ownership ANTES da geração: conversation inacessível não chega ao
        // pipeline (404 sem vazar existência).
        const accessible = await accessibleConversationId(params.data.id, userId);
        if (!accessible) {
          return reply.code(404).send({
            error: "Conversa não encontrada",
            code: "NOT_FOUND",
          });
        }

        let result;
        try {
          result = await assembleGenerationBundle(
            prisma,
            {
              conversationId: accessible,
              userId,
              userPrompt: body.data.userPrompt,
              targetCharacterId: body.data.targetCharacterId,
              ...(body.data.ragFrameId !== undefined
                ? { ragFrameId: body.data.ragFrameId }
                : {}),
            },
            provider,
          );
        } catch (err) {
          if (err instanceof GenerationRagFrameNotFoundError) {
            return reply.code(404).send({
              error: "Frame de RAG não encontrado para esta conversa",
              code: "NOT_FOUND",
            });
          }
          if (err instanceof GenerationSpeakerTargetError) {
            // Mapeamento via convenções HTTP existentes (sem vazar internals):
            switch (err.code) {
              case "TARGET_NOT_FOUND":
                return reply.code(404).send({
                  error: "Personagem não encontrado",
                  code: "NOT_FOUND",
                });
              case "TARGET_NOT_PARTICIPANT":
                return reply.code(403).send({
                  error: "Personagem não participa desta conversa",
                  code: "FORBIDDEN",
                });
              case "TARGET_NOT_AI":
                return reply.code(400).send({
                  error: "Alvo de geração deve ser um personagem controlado por IA",
                  code: "VALIDATION_ERROR",
                });
              case "TARGET_MISSING_WHEN_REQUIRED":
                return reply.code(400).send({
                  error: "Alvo de geração obrigatório",
                  code: "VALIDATION_ERROR",
                });
            }
          }
          if (err instanceof GenerationUserInputError) {
            return reply.code(400).send({
              error: "Prompt de usuário inválido",
              code: "VALIDATION_ERROR",
            });
          }
          if (err instanceof OllamaProviderError) {
            // Sem vazar API keys, URLs sensíveis, stack ou mensagens internas.
            return reply.code(500).send({
              error: "Falha ao gerar resposta",
              code: "PROVIDER_ERROR",
            });
          }
          throw err;
        }

        // assembly-only (default NullProvider): NÃO persiste. Resposta de
        // compatibilidade explícita e mínima (sem systemPrompt/context/tokens).
        if (result.meta.mode === "assembly-only") {
          return reply.code(200).send({
            generation: {
              generationKey: result.generationKey,
              provider: result.meta.provider,
              mode: result.meta.mode,
            },
            responseSkeleton: assemblyOnlyResponseComposer.compose(result),
          });
        }

        // generated → persistência (STEP 36). Não re-resolve speaker; usa
        // exatamente result.speakerCharacterId como characterId.
        const decision = await persistGeneratedMessage(prisma, result, userId);
        if (!decision.persisted) {
          // Inatingível em fluxo normal (ownership já validado na rota e
          // revalidado por persist; speaker garanti-do pelo bundle). Guarda
          // honesta de consistência interna.
          return reply.code(500).send({
            error: "Falha ao persistir resposta gerada",
            code: "PERSISTENCE_ERROR",
          });
        }

        return reply.code(201).send({
          message: decision.message,
          generationKey: result.generationKey,
          provider: result.meta.provider,
          mode: result.meta.mode,
        });
      },
    );
  };

export default generationGenerateRoutes;