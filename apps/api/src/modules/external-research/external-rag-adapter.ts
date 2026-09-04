import {
  type RetrievedExternalContext,
  type RetrievalResult,
  EXTERNAL_RETRIEVAL_RULE,
} from "./external-retrieval.js";

// ---------------------------------------------------------------------------
// External Research — Adapter RAG → Context Assembly (Fase 13 STEP 10).
//
// OBJETIVO:
//   Consumir um `RetrievedExternalContext` já materializado (STEP 9) e produzir
//   um contrato NEUTRO `ExternalRagContext`, pronto para uma futura integração
//   com Context Assembly.
//
// POR QUE ELE EXISTE:
//   Separa o retrieval (STEP 9, que decide score/ranking via pgvector `<=>`) da
//   futura montagem de contexto. O adapter NÃO recalcula ranking/score, NÃO
//   aplica threshold/topK, NÃO consulta pgvector, NÃO gera embedding.
//
// INTERFACE-ONLY:
//   Este STEP NÃO integra de fato com Context Assembly. Context Assembly ainda
//   NÃO consome `ExternalRagContext`; `AssembledContext`/Generation/
//   ResponseComposer permanecem intactos.
//
// PURITY:
//   Funções puras/determinísticas: sem DB, sem HTTP, sem provider, sem Cohere,
//   sem mutation da entrada. O adapter apenas transforma o que já veio pronto.
// ---------------------------------------------------------------------------

export const EXTERNAL_RAG_ADAPTER_RULE = "external-rag-adapter.v1#mode=pure#scope=service";

/** Item neutro do RAG. Mesma forma aprovada do retrieval (provenance). */
export type ExternalRagItem = RetrievalResult;

/**
 * Contrato neutro preparado para futura integração com Context Assembly.
 * NÃO inclui embedding/vector/API key/headers/secrets.
 */
export interface ExternalRagContext {
  readonly sourceType: "external";
  readonly provider: string;
  readonly model: string;
  readonly version: string;
  readonly dimensions: number;
  readonly ruleApplied: string;
  readonly items: readonly ExternalRagItem[];
}

/**
 * Convenção de score herdada do retrieval (STEP 9): score = 1 - distance,
 * com cosine distance em [0, 2] → score em [-1, 1].
 */
export const RAG_SCORE_MIN = -1;
export const RAG_SCORE_MAX = 1;

/**
 * Regra de validade de um item de RAG:
 *   - `chunkId` não-vazio (chave de dedup/provenance);
 *   - score FINITO (rejeita NaN/Infinity);
 *   - score dentro da convenção [RAG_SCORE_MIN, RAG_SCORE_MAX].
 *
 * NÃO corrigimos score inválido e NÃO o recalculamos a partir de campos
 * ausentes — itens inválidos são IGNORADOS (drop), de forma documentada.
 */
export function isValidRagItem(item: RetrievalResult): boolean {
  if (!item || typeof item.chunkId !== "string" || item.chunkId.trim().length === 0) {
    return false;
  }
  const s = item.score;
  if (typeof s !== "number" || !Number.isFinite(s)) {
    return false;
  }
  return s >= RAG_SCORE_MIN && s <= RAG_SCORE_MAX;
}

/**
 * Converte um `RetrievedExternalContext` em `ExternalRagContext`.
 *
 * - Pura/determinística/sem side effects; NÃO muta a entrada.
 * - Preserva a ORDEM dos resultados recebida do retrieval (o ranking já foi
 *   decidido pelo STEP 9 e não deve ser recalculado aqui).
 * - Preserva provider/model/version/dimensions/ruleApplied.
 * - Itens inválidos (definição acima) são descartados.
 */
export function toExternalRagContext(retrieved: RetrievedExternalContext): ExternalRagContext {
  const items: RetrievalResult[] = [];
  for (const item of retrieved.results) {
    if (isValidRagItem(item)) {
      items.push({
        sourceId: item.sourceId,
        documentId: item.documentId,
        chunkId: item.chunkId,
        title: item.title,
        content: item.content,
        orderOriginal: item.orderOriginal,
        score: item.score,
        distance: item.distance,
        citation: item.citation,
      });
    }
  }
  return Object.freeze({
    sourceType: "external" as const,
    provider: retrieved.provider,
    model: retrieved.model,
    version: retrieved.version,
    dimensions: retrieved.dimensions,
    ruleApplied: retrieved.ruleApplied,
    items: Object.freeze(items) as readonly RetrievalResult[],
  });
}

/**
 * Merge/dedup determinístico de vários contextos de RAG.
 *
 * REGRA DE DEDUP:
 *   - chave = `chunkId`;
 *   - mesmo chunk repetido → mantém o item com MAIOR score;
 *   - empate de score → tie-break `chunkId ASC` (determinístico, não random,
 *     não timestamp, independente da ordem física/entrada).
 *
 * ORDEM CANÔNICA DE SAÍDA:
 *   - score DESC, depois chunkId ASC.
 *
 * Essa ordenação canônica garante o mesmo resultado serializado para a MESMA
 * entrada, independentemente da ordem em que os contextos/items chegam (o
 * single-context `toExternalRagContext` preserva a ordem do retrieval; já o
 * merge, por combinar fontes arbitrárias, adota ordem canônica determinística).
 *
 * Metadata de contexto (provider/model/version/dimensions/ruleApplied) é
 * preservada do PRIMEIRO contexto não-destrutivo fornecido.
 */
export function mergeExternalRagContexts(
  ...contexts: ExternalRagContext[]
): ExternalRagContext {
  const bestByChunkId = new Map<string, RetrievalResult>();
  let meta: Pick<ExternalRagContext, "provider" | "model" | "version" | "dimensions" | "ruleApplied"> | null = null;

  for (const ctx of contexts) {
    if (!meta) {
      meta = {
        provider: ctx.provider,
        model: ctx.model,
        version: ctx.version,
        dimensions: ctx.dimensions,
        ruleApplied: ctx.ruleApplied,
      };
    }
    for (const item of ctx.items) {
      if (!isValidRagItem(item)) continue;
      const current = bestByChunkId.get(item.chunkId);
      if (!current || item.score > current.score) {
        bestByChunkId.set(item.chunkId, item);
      }
      // Empate de score NÃO substitui: mantém o documento que já estava
      // (primeiro a chegar), gerando comportamento determinístico independente
      // da ordem de entrada quando scores são iguais + chunkIds iguais (o que
      // só pode ser o MESMO item duplicado).
    }
  }

  const items = Array.from(bestByChunkId.values()).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score; // score DESC
    return a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0; // chunkId ASC
  });

  const m = meta ?? {
    provider: "",
    model: "",
    version: "",
    dimensions: 0,
    ruleApplied: EXTERNAL_RETRIEVAL_RULE,
  };

  return Object.freeze({
    sourceType: "external" as const,
    provider: m.provider,
    model: m.model,
    version: m.version,
    dimensions: m.dimensions,
    ruleApplied: m.ruleApplied,
    items: Object.freeze(items) as readonly RetrievalResult[],
  });
}
