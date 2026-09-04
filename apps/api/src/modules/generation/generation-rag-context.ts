import type { ConversationRagReadResult } from "../context/conversation-rag-read.js";
import type { ExternalRagContext } from "../external-research/external-rag-adapter.js";

// ---------------------------------------------------------------------------
// Generation — Seleção EXPLÍCITA de RAG por `ragFrameId` (Fase 13 STEP 22).
//
// Helper PURA e DETERMINÍSTICA que resolve, a partir de um
// `ConversationRagReadResult` (read service STEP 18, JÁ escopado por
// conversation + ownership) e de um identificador de frame explicitamente
// informado pelo caller, o `ExternalRagContext` a ser anexado ao
// `AssembledContext` via `withExternalRag` (STEP 11).
//
// NÃO acessa banco, NÃO executa retrieval, NÃO materializa, NÃO chama provider,
// NÃO deduplica, NÃO reordena, NÃO recalcula score/distance. Somente resolve.
//
// NENHUMA seleção silenciosa: se o caller não informa `ragFrameId`, o resultado
// é NULL (baseline, sem RAG). Se o caller informa um `ragFrameId` que não
// corresponde a nenhum frame do resultado, é ERRO determinístico (nunca
// fallback para "sem RAG", nunca frames[0], nunca createdAt/score/id inferido).
// ---------------------------------------------------------------------------

export const GENERATION_RAG_CONTEXT_RULE =
  "generation-rag-context.v1#mode=pure#scope=selection";

/**
 * Erro de domínio quando um `ragFrameId` foi explicitamente informado mas não
 * resolve para um frame da Conversation sendo gerada (frame inexistente OU de
 * outra conversation — ambos indistinguíveis por design, pois o read result já
 * é escopado pela conversation). NÃO lança stack de rede/provider.
 */
export class GenerationRagFrameNotFoundError extends Error {
  override readonly name = "GenerationRagFrameNotFoundError";
  constructor(message: string) {
    super(message);
  }
}

/**
 * Resolve o `ExternalRagContext` selecionado por um frame identificado.
 *
 * Regras (contrato STEP 22 §9):
 *   A) `ragFrameId` ausente (undefined)        → `null` (baseline, sem RAG).
 *   B/C) `ragFrameId` presente mas o frame não consta no resultado (inexistente
 *        ou de outra conversation)             → `GenerationRagFrameNotFoundError`.
 *   D) frame encontrado + NO_SNAPSHOT          → `null` (materialização ainda ausente).
 *   E) frame encontrado + STALE                → `null` (não alimenta com RAG velho).
 *   G) frame encontrado + CURRENT + externalRag null → `null`.
 *   F) frame encontrado + CURRENT + RAG        → o próprio `ExternalRagContext`.
 *
 * Pura/determinística: mesmo input → mesmo output; nunca muta a entrada.
 */
export function resolveGenerationRagContext(
  readResult: ConversationRagReadResult,
  ragFrameId?: string,
): ExternalRagContext | null {
  if (ragFrameId === undefined) {
    return null;
  }

  const frame = readResult.frames.find((f) => f.frameId === ragFrameId);

  if (!frame) {
    throw new GenerationRagFrameNotFoundError(
      `ragFrameId '${ragFrameId}' não resolve para um frame da Conversation ` +
        `'${readResult.conversationId}'. Frame inexistente ou de outra ` +
        "conversation. NÃO será feito fallback silencioso para ausência de RAG.",
    );
  }

  if (frame.freshness === "NO_SNAPSHOT") {
    return null;
  }

  if (frame.freshness === "STALE") {
    return null;
  }

  if (frame.freshness === "CURRENT") {
    if (frame.externalRag === null) {
      return null;
    }
    return frame.externalRag;
  }

  // Freshness desconhecida não deveria ocorrer (contrato fechado); caso chegue,
  // FAIL-FAST determinístico em vez de tratar como ausência.
  throw new GenerationRagFrameNotFoundError(
    `Frame '${ragFrameId}' da Conversation '${readResult.conversationId}' ` +
      `com freshness inesperado '${String(frame.freshness)}' ao resolver RAG de geração.`,
  );
}