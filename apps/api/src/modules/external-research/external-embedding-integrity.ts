import { type PrismaClient } from "@prisma/client";
import { type EmbeddingConfig } from "./external-embedding.js";
import {
  COHERE_PROVIDER,
  COHERE_MODEL,
  COHERE_VERSION,
  COHERE_DIMENSIONS,
} from "./external-embedding-provider.js";

// ---------------------------------------------------------------------------
// External Research — Auditoria de Proveniência e Integridade de Embeddings
// (Fase 13 STEP 8).
//
// SERVICE-ONLY e READ-ONLY: não cria endpoint, não toca frontend/Conversation.
// Responde à pergunta: "Os embeddings existentes representam corretamente os
// chunks que estão no banco e a configuração ativa?"
//
// SOMENTE AUDIT → REPORT. NÃO corrige nada: NÃO gera vector, NÃO re-embeda,
// NÃO chama Cohere, NÃO faz UPDATE/INSERT/DELETE, NÃO executa `$executeRaw`,
// NÃO faz similarity/retrieval/RAG.
//
// Regra central (embedding válido) — TODOS devem valer:
//   1. embedding IS NOT NULL
//   2. embeddedContentHash === contentHash
//   3. embeddingDimensions === 1024
//   4. vector_dims(embedding) === 1024
//   5. provider === cohere
//   6. model === embed-multilingual-v3.0
//   7. version === v3.0
//   8. dimensions === 1024
//
// Divergências NÃO são mutuamente exclusivas: um chunk pode acumular vários
// problemas; o relatório preserva TODAS as razões aplicáveis, em ordem fixa.
//
// Safety:
//   - O parâmetro `db` é tipado para expor APENAS `$queryRawUnsafe` (SELECT);
//     nenhum caminho de escrita é alcançável pela API pública.
//   - O relatório NÃO exporta vector/floats/API key/headers — apenas hashes,
//     metadata, presença, dims e ids.
// ---------------------------------------------------------------------------

export const EXTERNAL_EMBEDDING_INTEGRITY_RULE =
  "external-embedding-integrity.v1#mode=readonly#scope=service";

/** Configuração ativa (default) do provider de embeddings. */
export const COHERE_EMBEDDING_CONFIG: EmbeddingConfig = Object.freeze({
  provider: COHERE_PROVIDER,
  model: COHERE_MODEL,
  version: COHERE_VERSION,
  dimensions: COHERE_DIMENSIONS,
});

// ---------------------------------------------------------------------------
// Estados de classificação
// ---------------------------------------------------------------------------

export type EmbeddingIntegrityState =
  | "VALID"
  | "MISSING_VECTOR"
  | "MISSING_EMBEDDED_CONTENT_HASH"
  | "CONTENT_HASH_MISMATCH"
  | "PROVIDER_MISMATCH"
  | "MODEL_MISMATCH"
  | "VERSION_MISMATCH"
  | "METADATA_DIMENSION_MISMATCH"
  | "VECTOR_DIMENSION_MISMATCH"
  | "INVALID_VECTOR";

/**
 * Ordem canônica e FIXA das razões. Usada para (a) emissão determinística do
 * relatório e (b) iteração das verificações sem depender da ordem física do
 * banco ou da ordem de empush.
 */
const REASON_ORDER: readonly EmbeddingIntegrityState[] = [
  "MISSING_VECTOR",
  "MISSING_EMBEDDED_CONTENT_HASH",
  "CONTENT_HASH_MISMATCH",
  "PROVIDER_MISMATCH",
  "MODEL_MISMATCH",
  "VERSION_MISMATCH",
  "METADATA_DIMENSION_MISMATCH",
  "VECTOR_DIMENSION_MISMATCH",
  "INVALID_VECTOR",
] as const;

// ---------------------------------------------------------------------------
// Tipos de retorno
// ---------------------------------------------------------------------------

export interface ChunkIntegrityAudit {
  chunkId: string;
  documentId: string;
  /** `valid` (sem razões) ou `invalid` (≥ 1 razão). */
  status: "valid" | "invalid";
  /** Lista vazia = VALID; caso contrário, todas as razões em ordem fixa. */
  reasons: EmbeddingIntegrityState[];
  hasEmbedding: boolean;
  vectorDimensions: number | null;
  contentHash: string;
  embeddedContentHash: string | null;
  provider: string | null;
  model: string | null;
  version: string | null;
  dimensionsMetadata: number | null;
}

export interface EmbeddingIntegrityReport {
  documentId: string;
  totalChunks: number;
  validEmbeddings: number;
  missingEmbeddings: number;
  missingEmbeddedContentHash: number;
  contentHashMismatch: number;
  providerMismatch: number;
  modelMismatch: number;
  versionMismatch: number;
  dimensionsMetadataMismatch: number;
  vectorDimensionsMismatch: number;
  invalidEmbeddings: number;
  chunks: ChunkIntegrityAudit[];
  ruleApplied: string;
}

// ---------------------------------------------------------------------------
// Linha crua vinda do banco (SELECT apenas)
// ---------------------------------------------------------------------------

interface ChunkRow {
  id: string;
  documentId: string;
  contentHash: string;
  embeddedContentHash: string | null;
  provider: string | null;
  model: string | null;
  version: string | null;
  dimensionsMetadata: number | null;
  hasEmbedding: boolean;
  vectorDimensions: number;
}

// ---------------------------------------------------------------------------
// Núcleo determinístico de classificação (puro, testável)
// ---------------------------------------------------------------------------

/**
 * Classifica um chunk. Puro e determinístico: dada a mesma linha + config,
 * produz exatamente as mesmas razões. Preserva TODAS as divergências (@ver
 * REASON_ORDER). Vetor ausente → apenas MISSING_VECTOR (metadata/proveniência
 * só fazem sentido quando existe vetor).
 */
export function classifyChunkIntegrity(row: ChunkRow, config: EmbeddingConfig): EmbeddingIntegrityState[] {
  const reasons: EmbeddingIntegrityState[] = [];

  const checks: Array<[EmbeddingIntegrityState, boolean]> = [
    ["MISSING_VECTOR", !row.hasEmbedding],
    ["MISSING_EMBEDDED_CONTENT_HASH", row.hasEmbedding && row.embeddedContentHash == null],
    [
      "CONTENT_HASH_MISMATCH",
      row.hasEmbedding && row.embeddedContentHash != null && row.embeddedContentHash !== row.contentHash,
    ],
    ["PROVIDER_MISMATCH", row.hasEmbedding && row.provider !== config.provider],
    ["MODEL_MISMATCH", row.hasEmbedding && row.model !== config.model],
    ["VERSION_MISMATCH", row.hasEmbedding && row.version !== config.version],
    [
      "METADATA_DIMENSION_MISMATCH",
      row.hasEmbedding && row.dimensionsMetadata !== config.dimensions,
    ],
    [
      "VECTOR_DIMENSION_MISMATCH",
      row.hasEmbedding && row.vectorDimensions > 0 && row.vectorDimensions !== config.dimensions,
    ],
    ["INVALID_VECTOR", row.hasEmbedding && row.vectorDimensions <= 0],
  ];

  for (const state of REASON_ORDER) {
    const found = checks.find(([s]) => s === state);
    if (found && found[1]) {
      reasons.push(state);
    }
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// Serviço de auditoria (READ-ONLY)
// ---------------------------------------------------------------------------

export type IntegrityDb = {
  $queryRawUnsafe: PrismaClient["$queryRawUnsafe"];
};

/**
 * Audita a integridade/proveniência dos embeddings de todos os chunks de um
 * documento. SOMENTE leitura (SELECT + vector_dims). Produz um relatório
 * determinístico e NÃO corrige nada.
 */
export async function verifyExternalDocumentEmbeddings(
  db: IntegrityDb,
  documentId: string,
  config: EmbeddingConfig = COHERE_EMBEDDING_CONFIG,
): Promise<EmbeddingIntegrityReport> {
  const rows = await db.$queryRawUnsafe<ChunkRow[]>(
    `SELECT
       c."id",
       c."documentId",
       c."contentHash",
       c."embeddedContentHash",
       c."embeddingProvider"  AS "provider",
       c."embeddingModel"     AS "model",
       c."embeddingVersion"   AS "version",
       c."embeddingDimensions" AS "dimensionsMetadata",
       (c."embedding" IS NOT NULL) AS "hasEmbedding",
       COALESCE(vector_dims(c."embedding"), 0)::int AS "vectorDimensions"
     FROM "ExternalChunk" c
     WHERE c."documentId" = $1::uuid
     ORDER BY c."id" ASC`,
    documentId,
  );

  const audits: ChunkIntegrityAudit[] = rows.map((row) => {
    const reasons = classifyChunkIntegrity(row, config);
    return Object.freeze({
      chunkId: row.id,
      documentId: row.documentId,
      status: reasons.length === 0 ? "valid" as const : "invalid" as const,
      reasons: Object.freeze(reasons) as EmbeddingIntegrityState[],
      hasEmbedding: row.hasEmbedding,
      vectorDimensions: row.hasEmbedding ? row.vectorDimensions : null,
      contentHash: row.contentHash,
      embeddedContentHash: row.embeddedContentHash,
      provider: row.provider,
      model: row.model,
      version: row.version,
      dimensionsMetadata: row.dimensionsMetadata,
    });
  });

  // Ordenação defensiva por chunkId lexicográfico (determinismo garantido,
  // independentemente da ordem física do banco).
  audits.sort((a, b) => (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0));

  const totalChunks = audits.length;
  const validEmbeddings = audits.filter((a) => a.status === "valid").length;

  const count = (state: EmbeddingIntegrityState): number =>
    audits.reduce((acc, a) => acc + (a.reasons.includes(state) ? 1 : 0), 0);

  return Object.freeze({
    documentId,
    totalChunks,
    validEmbeddings,
    invalidEmbeddings: totalChunks - validEmbeddings,
    missingEmbeddings: count("MISSING_VECTOR"),
    missingEmbeddedContentHash: count("MISSING_EMBEDDED_CONTENT_HASH"),
    contentHashMismatch: count("CONTENT_HASH_MISMATCH"),
    providerMismatch: count("PROVIDER_MISMATCH"),
    modelMismatch: count("MODEL_MISMATCH"),
    versionMismatch: count("VERSION_MISMATCH"),
    dimensionsMetadataMismatch: count("METADATA_DIMENSION_MISMATCH"),
    vectorDimensionsMismatch: count("VECTOR_DIMENSION_MISMATCH"),
    chunks: Object.freeze(audits) as ChunkIntegrityAudit[],
    ruleApplied: EXTERNAL_EMBEDDING_INTEGRITY_RULE,
  });
}

// ---------------------------------------------------------------------------
// Helper determinístico (puro) para montar razões a partir de campos avulsos,
// útil em testes e para representar a enum como string.
// ---------------------------------------------------------------------------

export function formatStateList(states: readonly EmbeddingIntegrityState[]): string {
  return REASON_ORDER.filter((s) => states.includes(s)).join(",");
}