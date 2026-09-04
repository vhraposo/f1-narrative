import { type PrismaClient } from "@prisma/client";
import {
  COHERE_PROVIDER,
  COHERE_MODEL,
  COHERE_VERSION,
  COHERE_DIMENSIONS,
  COHERE_INPUT_QUERY,
} from "./external-embedding-provider.js";
import {
  type EmbeddingProviderWithInputType,
} from "./external-embedding-store.js";

// ---------------------------------------------------------------------------
// External Research — Retrieval Determinístico com PGVector (Fase 13 STEP 9).
//
// SERVICE-ONLY: não cria endpoint; não faz RAG; não integra Context Assembly;
// não altera Generation/ResponseComposer/Memory/Event/WorldState. Termina em
// `RetrievedExternalContext`.
//
// Fluxo oficial:
//   QUERY TEXT → Cohere search_query embedding → PGVector cosine retrieval
//   (exact search, `<=>`) → TOP-K → THRESHOLD → PROVENANCE → RetrievedContext.
//
// DECISÕES (fechadas):
//   - Similaridade calculada PELO PostgreSQL/pgvector (`embedding <=> vetor`).
//     NÃO implementamos cosineSimilarity manual em TS; NÃO duplicamos `<=>`.
//   - score = 1 - distance (distance = cosine distance de pgvector).
//     distance menor = mais próximo; score maior = mais relevante.
//   - threshold é de SCORE: aceita resultado quando score >= threshold.
//     NÃO misturar threshold de score com threshold de distance (rejeitamos do
//     ponto de vista do caller: o caller consulta por SCORE).
//   - exact nearest neighbor search (baseline). NÃO há HNSW/IVFFlat aqui.
//   - Segurança: SQL 100% parametrizado; casts explícitos vector(1024)/uuid;
//     NUNCA concatenamos vetor/ids/threshold/topK.
//   - O caller recebe apenas provenance (ids/title/content/order/score/etc.);
//     o vetor bruto NUNCA é retornado.
// ---------------------------------------------------------------------------

export const EXTERNAL_RETRIEVAL_RULE = "external-retrieval.v1#mode=pgvector#scope=service";

// ---------------------------------------------------------------------------
// Constantes oficiais / defaults (não duplicar valores mágicos)
// ---------------------------------------------------------------------------

export const RETRIEVAL_DEFAULT_TOP_K = 5;
export const RETRIEVAL_MAX_TOP_K = 50;
export const RETRIEVAL_DEFAULT_THRESHOLD = 0.55;

export interface ExternalRetrievalConfig {
  readonly topK: number;
  readonly threshold: number;
  readonly provider: string;
  readonly model: string;
  readonly version: string;
  readonly dimensions: number;
}

/** Config padrão: constants oficiais Cohere + defaults de retrieval. */
export const DEFAULT_EXTERNAL_RETRIEVAL_CONFIG: ExternalRetrievalConfig = Object.freeze({
  topK: RETRIEVAL_DEFAULT_TOP_K,
  threshold: RETRIEVAL_DEFAULT_THRESHOLD,
  provider: COHERE_PROVIDER,
  model: COHERE_MODEL,
  version: COHERE_VERSION,
  dimensions: COHERE_DIMENSIONS,
});

// ---------------------------------------------------------------------------
// Escopo autorizado (owner/source isolation) — sem inventar ACL
// ---------------------------------------------------------------------------

export interface RetrievalScope {
  /** UserId que dispara a consulta. Define o acesso a fontes. */
  readonly ownerId: string;
  /** (Opcional) restringe a retrieval a fontes específicas (source scope). */
  readonly sourceIds?: string[];
}

// ---------------------------------------------------------------------------
// Resultado + contexto retornados
// ---------------------------------------------------------------------------

export interface RetrievalResult {
  sourceId: string;
  documentId: string;
  chunkId: string;
  title: string;
  content: string;
  orderOriginal: number;
  score: number;
  distance: number;
  citation: string;
}

export interface RetrievedExternalContext {
  query: string;
  provider: string;
  model: string;
  version: string;
  dimensions: number;
  ruleApplied: string;
  topK: number;
  threshold: number;
  results: RetrievalResult[];
}

// ---------------------------------------------------------------------------
// Db: leitura somente (SELECT via SQL raw). Retrieval é READ-ONLY.
// ---------------------------------------------------------------------------

export type RetrievalDb = {
  $queryRawUnsafe: PrismaClient["$queryRawUnsafe"];
};

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

export function validateRetrievalConfig(config: ExternalRetrievalConfig): void {
  if (!Number.isInteger(config.topK) || config.topK <= 0 || config.topK > RETRIEVAL_MAX_TOP_K) {
    throw new Error(
      `Embedding retrieval rejeitado: 'topK' deve ser um inteiro em (0, ${RETRIEVAL_MAX_TOP_K}].`,
    );
  }
  if (!Number.isFinite(config.threshold)) {
    throw new Error("Embedding retrieval rejeitado: 'threshold' deve ser um número finito.");
  }
  if (config.threshold < -1 || config.threshold > 1) {
    throw new Error(
      "Embedding retrieval rejeitado: 'threshold' deve estar em [-1, 1] (score de cosseno).",
    );
  }
  if (!config.provider || !config.model || !config.version) {
    throw new Error("Embedding retrieval rejeitado: provider/model/version obrigatórios.");
  }
  if (!Number.isInteger(config.dimensions) || config.dimensions <= 0) {
    throw new Error("Embedding retrieval rejeitado: 'dimensions' deve ser um inteiro > 0.");
  }
}

export function validateRetrievalQuery(query: string): void {
  if (!query || query.trim().length === 0) {
    throw new Error("Embedding retrieval rejeitado: query vazia.");
  }
}

// ---------------------------------------------------------------------------
// Validação do vetor de query (1024 dims, finito), coerente com a config
// ---------------------------------------------------------------------------

function assertQueryVector(vector: number[], dimensions: number): void {
  if (!Array.isArray(vector) || vector.length !== dimensions) {
    throw new Error(
      `Embedding retrieval: vetor de query com ${vector?.length ?? 0} dims; esperado ${dimensions}.`,
    );
  }
  for (const v of vector) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error("Embedding retrieval: vetor de query com valor não-finito.");
    }
  }
}

// ---------------------------------------------------------------------------
// Retrieval principal
// ---------------------------------------------------------------------------

/**
 * Retrieval determinístico de chunks relevantes via pgvector cosine.
 *
 * - Gera o embedding de query com `input_type = search_query`.
 * - Filtra APENAS embeddings válidos ANTES do ranking (vector presente, hash
 *   consistente, metadata compatível com a config, dims corretas).
 * - Aplica isolamento de fonte/owner (PUBLIC acessível a todos; PRIVATE/SHARED
 *   apenas ao owner). SHARED segue a ACL CORRENTE (owner-scoped) — não
 *   inventamos ACL.
 * - Ordena por score DESC com tie-breaks estáveis; `chunkId ASC` é o último.
 * - score >= threshold; `topK` (validado).
 * - NUNCA retorna o vetor bruto.
 */
export async function retrieveExternalContext(
  db: RetrievalDb,
  provider: EmbeddingProviderWithInputType,
  query: string,
  scope: RetrievalScope,
  config: ExternalRetrievalConfig = DEFAULT_EXTERNAL_RETRIEVAL_CONFIG,
): Promise<RetrievedExternalContext> {
  validateRetrievalQuery(query);
  validateRetrievalConfig(config);

  // Query embedding com `search_query` (nunca search_document). O texto da
  // query NÃO é persistido e não carrega credenciais — apenas o texto puro.
  const queryVector = await provider.embed(query, COHERE_INPUT_QUERY);
  assertQueryVector(queryVector, config.dimensions);

  const vectorLiteral = `[${queryVector.join(",")}]`;

  // $1 é reservado para o vetor de query (passado como 1º argumento posicional).
  // Cada parâmetro subsequente é `$params.length + 1` (offset de 1 pelo vetor).
  const where: string[] = [];
  const params: unknown[] = [];
  const pHref = (param: unknown): string => {
    params.push(param);
    return "$" + (params.length + 1);
  };

  where.push(`c.embedding IS NOT NULL`);
  where.push(`c."embeddedContentHash" IS NOT NULL`);
  where.push(`c."embeddedContentHash" = c."contentHash"`);
  where.push(`c."embeddingProvider" = ${pHref(config.provider)}`);
  where.push(`c."embeddingModel" = ${pHref(config.model)}`);
  where.push(`c."embeddingVersion" = ${pHref(config.version)}`);
  where.push(`c."embeddingDimensions" = ${pHref(config.dimensions)}`);
  where.push(`vector_dims(c.embedding) = (${pHref(config.dimensions)}::int)`);
  // owner/source isolation (PUBLIC acessível; PRIVATE/SHARED owner-scoped).
  where.push(
    `(s."visibility" = 'PUBLIC' OR s."ownerId" = ${pHref(scope.ownerId)}::uuid)`,
  );
  if (scope.sourceIds && scope.sourceIds.length > 0) {
    where.push(`s.id = ANY(${pHref(scope.sourceIds)}::uuid[])`);
  }
  where.push(`(1 - (c.embedding <=> $1::vector(1024))) >= ${pHref(config.threshold)}`);

  const topKPlaceholder = pHref(config.topK);

  const rows = await db.$queryRawUnsafe<Array<RawRetrievalRow>>(
    `SELECT
       c.id                                   AS "chunkId",
       c."documentId",
       c."orderOriginal",
       c.text                                 AS content,
       d.title,
       d."publishedAt",
       d."fetchedAt",
       s.id                                   AS "sourceId",
       s.url                                  AS "sourceUrl",
       s.title                                AS "sourceTitle",
       1 - (c.embedding <=> $1::vector(1024)) AS score
     FROM "ExternalChunk" c
     JOIN "ExternalDocument" d ON d.id = c."documentId"
     JOIN "ExternalSource" s ON s.id = d."sourceId"
     WHERE ${where.join("\n       AND ")}
     ORDER BY score DESC,
       COALESCE(d."publishedAt", d."fetchedAt") DESC,
       s.id ASC,
       d.id ASC,
       c.id ASC
     LIMIT ${topKPlaceholder}`,
    vectorLiteral,
    ...params,
  );

  return Object.freeze({
    query,
    provider: config.provider,
    model: config.model,
    version: config.version,
    dimensions: config.dimensions,
    ruleApplied: EXTERNAL_RETRIEVAL_RULE,
    topK: config.topK,
    threshold: config.threshold,
    results: Object.freeze(rows.map(toRetrievalResult)) as RetrievalResult[],
  });
}

interface RawRetrievalRow {
  chunkId: string;
  documentId: string;
  orderOriginal: number;
  content: string;
  title: string;
  publishedAt: Date | null;
  fetchedAt: Date | null;
  sourceId: string;
  sourceUrl: string;
  sourceTitle: string | null;
  score: number;
}

/**
 * Provenance + score/distance/citation. distance = 1 - score (relação
 * determinística e documentada com `<=>`).
 */
function toRetrievalResult(row: RawRetrievalRow): RetrievalResult {
  const score = computeStableScore(row.score);
  const distance = 1 - score;
  return Object.freeze({
    sourceId: row.sourceId,
    documentId: row.documentId,
    chunkId: row.chunkId,
    title: row.title,
    content: row.content,
    orderOriginal: row.orderOriginal,
    score,
    distance,
    citation: `${row.sourceTitle ?? row.sourceUrl} — ${row.title} [chunk ${row.orderOriginal}]`,
  });
}

/** Normaliza o score para número finito (guarda contra NaN vindo do DB). */
function computeStableScore(raw: number): number {
  return Number.isFinite(raw) ? raw : -1;
}

