import type {
  ExternalRagContext,
} from "./external-rag-adapter.js";

// ---------------------------------------------------------------------------
// External Research — Reconstruction de ExternalRagContext (Fase 13 STEP 17).
//
// Função PURA e DETERMINÍSTICA que monta o contrato de runtime
// `ExternalRagContext` a partir de um snapshot persistido (frame metadata +
// linhas de item), reconstruindo a provenance sem expor o ORM model e sem
// vector/secrets. Preserva score/distance/citation/order original provenientes
// da materialização (o ranking do snapshot NÃO é recalculado aqui).
//
// Persistence model ≠ Runtime model: esta função é o único "adapter" que
// cruza a fronteira persistida → contrato neutro de runtime. NUNCA inclui
// content duplicado além do exigido pelo contrato nem vector/secrets.
// ---------------------------------------------------------------------------

export const CONVERSATION_RAG_RECONSTRUCTION_RULE =
  "conversation-rag-reconstruction.v1#mode=pure#scope=service";

export interface ReconstructionFrameMeta {
  readonly provider: string;
  readonly model: string;
  readonly version: string;
  readonly dimensions: number;
  readonly ruleApplied: string;
}

/** Linha de item pronta para reconstrução (provenance já resolvida). */
export interface ReconstructionItemRow {
  /** Índice/ordem da materialização (0-based) — fonte de ordenação. */
  readonly order: number;
  readonly chunkId: string;
  readonly sourceId: string;
  readonly documentId: string;
  readonly title: string;
  readonly content: string;
  readonly orderOriginal: number;
  readonly score: number;
  readonly distance: number;
  readonly citation: string;
}

/**
 * Reconstrói `ExternalRagContext` a partir do metadata do frame + itens.
 *
 * - Ordenação: por `order` ASC (a ordem da materialização já está persistida);
 *   empate de order → `chunkId` ASC (determinístico).
 * - Preserva score/distance/citation e a provenance (sourceId/documentId/
 *   chunkId/title/content/orderOriginal).
 * - NÃO recria ranking, NÃO recalcula score, NÃO consulta provider/DB/vector.
 * - NÃO inclui embedding/vector/secrets.
 */
export function reconstructExternalRagContext(
  frame: ReconstructionFrameMeta,
  items: readonly ReconstructionItemRow[],
): ExternalRagContext {
  const sorted = Array.from(items)
    .slice()
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0;
    })
    .map((row) => ({
      sourceId: row.sourceId,
      documentId: row.documentId,
      chunkId: row.chunkId,
      title: row.title,
      content: row.content,
      orderOriginal: row.orderOriginal,
      score: row.score,
      distance: row.distance,
      citation: row.citation,
    }));

  return Object.freeze({
    sourceType: "external" as const,
    provider: frame.provider,
    model: frame.model,
    version: frame.version,
    dimensions: frame.dimensions,
    ruleApplied: frame.ruleApplied,
    items: Object.freeze(sorted) as ExternalRagContext["items"],
  });
}

/** Reusa o estilo de score do contrato: esperado [-1, 1] e finito. */
export function reconstructItemToRow(
  order: number,
  item: {
    chunkId: string;
    score: number;
    distance: number;
    citation: string;
    chunk: { documentId: string; text: string; orderOriginal: number };
    document: { sourceId: string; title: string };
  },
): ReconstructionItemRow {
  return {
    order,
    chunkId: item.chunkId,
    sourceId: item.document.sourceId,
    documentId: item.chunk.documentId,
    title: item.document.title,
    content: item.chunk.text,
    orderOriginal: item.chunk.orderOriginal,
    score: item.score,
    distance: item.distance,
    citation: item.citation,
  };
}
