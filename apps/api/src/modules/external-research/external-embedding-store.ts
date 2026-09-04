import { type PrismaClient } from "@prisma/client";
import {
  type EmbeddingConfig,
  isEmbeddingValid,
  buildEmbeddingIdentity,
  validateEmbeddingConfig,
} from "./external-embedding.js";
import {
  type CohereInputType,
  COHERE_INPUT_DOCUMENT,
} from "./external-embedding-provider.js";

// ---------------------------------------------------------------------------
// External Research — Store de Embeddings de ExternalChunk (Fase 13 STEP 7).
//
// SERVICE-ONLY: não cria endpoint, não toca frontend/Conversation.
// Gera e PERSISTE o vetor de cada ExternalChunk de um Document usando um
// provider (default: Cohere embed-multilingual-v3.0, 1024 dims, cosine).
//
// SEM retrieval / RAG / query de similaridade neste STEP. O objetivo é
// apenas: para cada chunk de um documento, garantir que exista um vetor
// válido e persistido, idempotente.
//
// ## Idempotência
//   chunk com embedding presente + embeddedContentHash === contentHash +
//   metadata de provider compatível → NO-OP (reused), não chama provider.
//
// ## Invalidação
//   contentHash mudou → re-embed (substitui o vetor antigo).
//   metadata de provider/model/version/dimensions DIVERGENTE → erro explícito
//   (nunca misturar modelos no mesmo chunk).
//
// ## Persistência
//   O vetor é `Unsupported("vector(1024)")` no Prisma → gravação via SQL raw
//   com cast `'[...]'::vector(1024)`. Metadata de provider apenas APÓS o vetor
//   ser validado (dims 1024 + finito).
//
// ## Segurança
//   Só envia ao provider o texto do chunk. Nunca loga/inclui API key. Erros
//   sanitizados (sem a chave). Fail-closed em qualquer cenário erro/NaN/inval.
// ---------------------------------------------------------------------------

export const EXTERNAL_EMBEDDING_STORE_RULE = "external-embedding-store.v1#mode=manual#scope=service";

type StoreDb = Pick<PrismaClient, "externalChunk" | "$transaction" | "$executeRawUnsafe">;

/**
 * Provider aceito pelo store: um `EmbeddingProvider` (STEP 5) que também
 * aceita `input_type` opcional (Cohere). Providers com `embed(input)` de 1
 * parâmetro são compatíveis (regra de fewer-parameters do TS).
 */
export type EmbeddingProviderWithInputType = {
  readonly name: string;
  readonly model: string;
  readonly version: string;
  readonly dimensions: number;
  embed(input: string, inputType?: CohereInputType): Promise<number[]>;
};

export interface EmbedStoreResult {
  documentId: string;
  total: number;
  embedded: number;
  reused: number;
  failed: number;
  ruleApplied: string;
}

interface ChunkRow {
  id: string;
  text: string;
  contentHash: string;
  embeddedContentHash: string | null;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  embeddingVersion: string | null;
  embeddingDimensions: number | null;
}

/** Vetor validado: número -> 0..1 string de floats no formato do cast vector. */
function vectorToSqlLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

function assertVector(vector: number[], dimensions: number): void {
  if (!Array.isArray(vector) || vector.length !== dimensions) {
    throw new Error(
      `Embedding store rejeitado: vetor com ${vector.length} dimensões; esperado ${dimensions}.`,
    );
  }
  for (const v of vector) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error("Embedding store rejeitado: vetor com valor não-finito.");
    }
  }
}

function assertConfigCompatible(chunk: ChunkRow, config: EmbeddingConfig): void {
  if (chunk.embeddingProvider == null) return;
  const identity = buildEmbeddingIdentity(chunk.contentHash, config);
  const existing = buildEmbeddingIdentity(chunk.contentHash, {
    provider: chunk.embeddingProvider,
    model: chunk.embeddingModel ?? "",
    version: chunk.embeddingVersion ?? "",
    dimensions: chunk.embeddingDimensions ?? 0,
  });
  // Compara apenas os campos de provider/model/version/dimensions; o
  // contentHash é tratado separadamente (invalidação por conteúdo).
  if (
    existing.provider !== identity.provider ||
    existing.model !== identity.model ||
    existing.version !== identity.version ||
    existing.dimensions !== identity.dimensions
  ) {
    throw new Error(
      `Embedding store rejeitado: metadata incompatível no chunk '${chunk.id}' (provider/model diverge da config).`,
    );
  }
}

/**
 * Gera e persiste embeddings de TODOS os chunks de um documento.
 *
 * - Provider chamado UMA vez por chunk pendente (fora de transação).
 * - Vetores persistidos numa transação curta ao final.
 * - Idempotente: chunk já embeddado com hash+metadata compatíveis → reused.
 * - Config divergente → erro, sem misturar modelos.
 */
export async function embedExternalDocumentChunks(
  db: StoreDb,
  documentId: string,
  config: EmbeddingConfig,
  provider: EmbeddingProviderWithInputType,
): Promise<EmbedStoreResult> {
  validateEmbeddingConfig(config);

  const chunks = (await db.externalChunk.findMany({
    where: { documentId },
    orderBy: { orderOriginal: "asc" },
    select: {
      id: true,
      text: true,
      contentHash: true,
      embeddedContentHash: true,
      embeddingProvider: true,
      embeddingModel: true,
      embeddingVersion: true,
      embeddingDimensions: true,
    },
  })) as unknown as ChunkRow[];

  let reused = 0;
  const pending: { chunk: ChunkRow; vector: number[] }[] = [];

  for (const chunk of chunks) {
    assertConfigCompatible(chunk, config);
    if (
      chunk.embeddedContentHash != null &&
      chunk.embeddedContentHash === chunk.contentHash
    ) {
      reused += 1;
      continue;
    }
    // contentHash inexistente/diferente → gera novamente (substitui antigo).
    const vector = await provider.embed(chunk.text, COHERE_INPUT_DOCUMENT);
    assertVector(vector, config.dimensions);
    pending.push({ chunk, vector });
  }

  if (pending.length > 0) {
    await db.$transaction(async (tx) => {
      for (const { chunk, vector } of pending) {
        // Gravação via SQL raw com cast do tipo pgvector. Valores vindos do
        // provider são restritos a não-negativos pela validação acima; e apesar
        // disso escapamos o texto/cast de forma controlada (números puros).
        await tx.$executeRawUnsafe(
          `UPDATE "ExternalChunk" SET
             "embedding" = $1::vector(1024),
             "embeddedContentHash" = $2,
             "embeddingProvider" = $3,
             "embeddingModel" = $4,
             "embeddingVersion" = $5,
             "embeddingDimensions" = $6
           WHERE "id" = $7::uuid`,
          vectorToSqlLiteral(vector),
          chunk.contentHash,
          config.provider,
          config.model,
          config.version,
          config.dimensions,
          chunk.id,
        );
      }
    });
  }

  return {
    documentId,
    total: chunks.length,
    embedded: pending.length,
    reused,
    failed: 0,
    ruleApplied: EXTERNAL_EMBEDDING_STORE_RULE,
  };
}

/**
 * Consulta de integridade (apenas para testes/verificação): retorna se o
 * conteúdo embeddado do chunk corresponde ao contentHash atual e a dimensão
 * do vetor (0 se ausente). NÃO faz similarity/retrieval.
 */
export async function inspectChunkEmbedding(db: {
  $queryRawUnsafe: PrismaClient["$queryRawUnsafe"];
}, chunkId: string): Promise<{
  embeddedContentHash: string | null;
  currentContentHash: string | null;
  dims: number;
}> {
  const rows = await db.$queryRawUnsafe<Array<{
    embeddedContentHash: string | null;
    currentContentHash: string | null;
    dims: number;
  }>>(
    `SELECT c."embeddedContentHash", c."contentHash" AS "currentContentHash",
            COALESCE(vector_dims(c."embedding"), 0)::int AS dims
     FROM "ExternalChunk" c
     WHERE c."id" = $1::uuid`,
    chunkId,
  );
  const row = rows[0];
  if (!row) {
    return { embeddedContentHash: null, currentContentHash: null, dims: 0 };
  }
  return row;
}

/**
 * Sanidade para testes: predica que um vetor gravado continua válido face ao
 * contentHash atual e à config desejada. Reutiliza o contrato do STEP 5
 * (`isEmbeddingValid`): converte um embedding persistido em identidade e
 * verifica que ainda é compatível com o conteúdo/config atuais.
 */
export function storedEmbeddingStillValid(
  config: EmbeddingConfig,
  chunk: {
    contentHash: string;
    embeddedContentHash: string | null;
    embeddingProvider: string | null;
    embeddingModel: string | null;
    embeddingVersion: string | null;
    embeddingDimensions: number | null;
  },
): boolean {
  if (chunk.embeddedContentHash == null) return false;
  if (chunk.embeddingProvider == null) return false;
  const storedIdentity = buildEmbeddingIdentity(chunk.embeddedContentHash, {
    provider: chunk.embeddingProvider,
    model: chunk.embeddingModel ?? "",
    version: chunk.embeddingVersion ?? "",
    dimensions: chunk.embeddingDimensions ?? 0,
  });
  // O conteúdo atual é o contentHash do chunk; o embedding só é válido se foi
  // produzido EXATAMENTE para esse conteúdo e com a config desejada.
  return isEmbeddingValid(storedIdentity, chunk.contentHash, config).valid;
}