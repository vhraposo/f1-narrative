import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  COHERE_DIMENSIONS,
  COHERE_INPUT_QUERY,
} from "./external-embedding-provider.js";
import { type EmbeddingConfig } from "./external-embedding.js";
import { computeDocumentContentHash } from "./external-ingest.js";
import { computeChunkContentHash } from "./external-chunking.js";
import { type EmbeddingProviderWithInputType } from "./external-embedding-store.js";
import {
  type ExternalRetrievalConfig,
  type RetrievalResult,
  type RetrievalScope,
  EXTERNAL_RETRIEVAL_RULE,
  DEFAULT_EXTERNAL_RETRIEVAL_CONFIG,
  RETRIEVAL_MAX_TOP_K,
  retrieveExternalContext,
} from "./external-retrieval.js";

// ---------------------------------------------------------------------------
// Testes do Retrieval determinístico via PGVector (Fase 13 STEP 9).
// Provider SEMPRE mock; NUNCA chamamos Cohere/HTTP. Vetores MOCK determinísticos
// (1024 dims) com relação de cosseno conhecida. Similaridade calculada pelo
// PostgreSQL (`<=>`); aqui apenas VALIDAMOS os resultados.
//
// ISOLAMENTO: cada teste cria seu PRÓPRIO owner + source PRIVATE, de modo que a
// retrieval (escopo owner) enxerga APENAS os fixtures do próprio teste. Assim o
// ranking/threshold/topK são verificados sem interferência entre testes.
// ---------------------------------------------------------------------------

const QUERY_VECTOR: number[] = (() => {
  const v = new Array(COHERE_DIMENSIONS).fill(0);
  v[0] = 1;
  return v;
})();

function basisVector(a: number, b: number): number[] {
  const v = new Array(COHERE_DIMENSIONS).fill(0);
  v[0] = a;
  v[1] = b;
  return v;
}

/** Vetor unitário cujo cosseno com e0 é exatamente `score` (0..1). */
function chunkVectorForScore(score: number): number[] {
  return basisVector(score, Math.sqrt(Math.max(0, 1 - score * score)));
}

function vectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

const ACTIVE_CONFIG: EmbeddingConfig = {
  provider: "cohere",
  model: "embed-multilingual-v3.0",
  version: "v3.0",
  dimensions: COHERE_DIMENSIONS,
};

function buildMockProvider(builder?: (input: string) => number[]): {
  provider: EmbeddingProviderWithInputType;
  calls: { count: number };
  inputTypes: string[];
} {
  const calls = { count: 0 };
  const inputTypes: string[] = [];
  const provider: EmbeddingProviderWithInputType = {
    name: "mock",
    model: "mock-model",
    version: "mock-v",
    dimensions: COHERE_DIMENSIONS,
    async embed(input: string, inputType?: string): Promise<number[]> {
      calls.count += 1;
      inputTypes.push(inputType ?? "");
      return builder ? builder(input) : QUERY_VECTOR;
    },
  };
  return { provider, calls, inputTypes };
}

// Tolerância para scores vindos do pgvector (float32): ~1e-7. Usamos 6 dígitos.
const SCORE_PRECISION = 6;

const createdUserIds: string[] = [];
const createdSourceIds: string[] = [];
const createdDocumentIds: string[] = [];

function track<T extends { id: string }>(list: string[], entity: T): T {
  list.push(entity.id);
  return entity;
}

let ownerCounter = 0;
async function newOwner(prefix: string): Promise<string> {
  ownerCounter += 1;
  return track(
    createdUserIds,
    await prisma.user.create({
      data: { name: "Retrieval", email: `${prefix}-${ownerCounter}-${Date.now()}-${Math.random()}@x.com` },
    }),
  ).id;
}

async function createSource(ownerId: string | null, visibility: "PUBLIC" | "PRIVATE" | "SHARED"): Promise<string> {
  return track(
    createdSourceIds,
    await prisma.externalSource.create({
      data: {
        url: `https://ret.test/${Date.now()}/${ownerCounter}/${Math.random()}`,
        title: "src",
        visibility,
        ownerId,
      },
    }),
  ).id;
}

async function createDocument(sourceId: string): Promise<string> {
  return track(
    createdDocumentIds,
    await prisma.externalDocument.create({
      data: {
        sourceId,
        title: "doc",
        content: "conteúdo",
        contentHash: computeDocumentContentHash("conteúdo"),
        status: "READY",
      },
    }),
  ).id;
}

interface ChunkSpec {
  text: string;
  vector: number[] | null;
  provider?: string | null;
  model?: string | null;
  version?: string | null;
  dimensionsMetadata?: number | null;
  embeddedContentHash?: string | null;
}

async function insertChunk(documentId: string, spec: ChunkSpec): Promise<string> {
  const count = await prisma.externalChunk.count({ where: { documentId } });
  const contentHash = computeChunkContentHash(spec.text);
  const chunk = await prisma.externalChunk.create({
    data: {
      documentId,
      text: spec.text,
      orderOriginal: count,
      contentHash,
      embeddedContentHash: spec.embeddedContentHash === undefined ? contentHash : spec.embeddedContentHash,
      embeddingProvider: spec.provider ?? ACTIVE_CONFIG.provider,
      embeddingModel: spec.model ?? ACTIVE_CONFIG.model,
      embeddingVersion: spec.version ?? ACTIVE_CONFIG.version,
      embeddingDimensions: spec.dimensionsMetadata ?? ACTIVE_CONFIG.dimensions,
    },
  });
  if (spec.vector !== null && spec.vector !== undefined) {
    await prisma.$executeRawUnsafe(
      'UPDATE "ExternalChunk" SET "embedding" = $1::vector(1024) WHERE "id" = $2::uuid',
      vectorLiteral(spec.vector),
      chunk.id,
    );
  }
  return chunk.id;
}

async function insertScoredChunk(documentId: string, text: string, score: number): Promise<string> {
  return insertChunk(documentId, { text, vector: chunkVectorForScore(score) });
}

/** Monta owner+source(PRIVATE)+document isolados para um teste. */
async function isolatedDoc(prefix: string): Promise<{ ownerId: string; src: string; doc: string }> {
  const ownerId = await newOwner(prefix);
  const src = await createSource(ownerId, "PRIVATE");
  const doc = await createDocument(src);
  return { ownerId, src, doc };
}

afterAll(async () => {
  await prisma.externalDocument.deleteMany({ where: { id: { in: createdDocumentIds } } });
  await prisma.externalSource.deleteMany({ where: { id: { in: createdSourceIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Validações puras (V, W, X, S/T/U)
// ---------------------------------------------------------------------------

describe("retrieval — validações puras", () => {
  it("V) query vazia → rejeitada", async () => {
    const { provider } = buildMockProvider();
    const scope: RetrievalScope = { ownerId: "00000000-0000-0000-0000-000000000001" };
    const sentinelDb = {
      $queryRawUnsafe: async (): Promise<never> => {
        throw new Error("não deveria chegar ao SQL com query vazia");
      },
    } as unknown as Parameters<typeof retrieveExternalContext>[0];
    await expect(retrieveExternalContext(sentinelDb, provider, "", scope)).rejects.toThrow(/query/);
    await expect(retrieveExternalContext(sentinelDb, provider, "   ", scope)).rejects.toThrow(/query/);
  });

  it("W) topK inválido (0,negativo,NaN,Infinity,absurdamente alto) → rejeitado", async () => {
    const { provider } = buildMockProvider();
    const scope: RetrievalScope = { ownerId: "00000000-0000-0000-0000-000000000001" };
    const sentinelDb = {
      $queryRawUnsafe: async (): Promise<never> => {
        throw new Error("não deveria chegar ao SQL com topK inválido");
      },
    } as unknown as Parameters<typeof retrieveExternalContext>[0];
    for (const topK of [0, -1, NaN, Infinity, -Infinity, RETRIEVAL_MAX_TOP_K + 1]) {
      const cfg: ExternalRetrievalConfig = { ...DEFAULT_EXTERNAL_RETRIEVAL_CONFIG, topK };
      await expect(retrieveExternalContext(sentinelDb, provider, "q", scope, cfg)).rejects.toThrow(/topK/);
    }
  });

  it("X) threshold inválido (NaN,Infinity,fora de [-1,1]) → rejeitado", async () => {
    const { provider } = buildMockProvider();
    const scope: RetrievalScope = { ownerId: "00000000-0000-0000-0000-000000000001" };
    const sentinelDb = {
      $queryRawUnsafe: async (): Promise<never> => {
        throw new Error("não deveria chegar ao SQL com threshold inválido");
      },
    } as unknown as Parameters<typeof retrieveExternalContext>[0];
    for (const threshold of [NaN, Infinity, -Infinity, 1.5, -2]) {
      const cfg: ExternalRetrievalConfig = { ...DEFAULT_EXTERNAL_RETRIEVAL_CONFIG, threshold };
      await expect(retrieveExternalContext(sentinelDb, provider, "q", scope, cfg)).rejects.toThrow(/threshold/);
    }
  });

  it("T/S/U) mock provider recebe search_query; dimensão 1024; sem uso real Cohere", async () => {
    const { provider, calls, inputTypes } = buildMockProvider();
    const scope: RetrievalScope = { ownerId: "00000000-0000-0000-0000-000000000001" };
    const ctx = await retrieveExternalContext(prisma, provider, "consulta", scope);
    expect(inputTypes[0]).toBe(COHERE_INPUT_QUERY); // search_query
    expect(calls.count).toBe(1); // uma chamada de query embedding
    expect(ctx.dimensions).toBe(COHERE_DIMENSIONS);
    expect(provider.dimensions).toBe(COHERE_DIMENSIONS);
    expect(Array.isArray(ctx.results)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Core retrieval (A, B, C, D, E, F, G, H, O, P, Y)
// ---------------------------------------------------------------------------

describe("retrieveExternalContext — ranking/threshold/topK/determinismo", () => {
  it("A) query sem resultados → lista vazia", async () => {
    const { ownerId, src, doc } = await isolatedDoc("a");
    await insertChunk(doc, { text: "ortogonal", vector: basisVector(0, 1) }); // cos 0 < default threshold

    const { provider } = buildMockProvider();
    const ctx = await retrieveExternalContext(prisma, provider, "consulta", { ownerId });
    expect(ctx.results).toEqual([]);
    expect(ctx.ruleApplied).toBe(EXTERNAL_RETRIEVAL_RULE);
    expect(src.length).toBeGreaterThan(0);
  });

  it("B) query com resultado → retorna o chunk com score correto", async () => {
    const { ownerId, doc } = await isolatedDoc("b");
    const chunkId = await insertScoredChunk(doc, "muito relevante", 0.9);

    const { provider } = buildMockProvider();
    const ctx = await retrieveExternalContext(prisma, provider, "consulta", { ownerId });
    expect(ctx.results).toHaveLength(1);
    expect(ctx.results[0].chunkId).toBe(chunkId);
  });

  it("C) topK limita a quantidade, mantendo os mais relevantes", async () => {
    const { ownerId, doc } = await isolatedDoc("c");
    await insertScoredChunk(doc, "a", 0.9);
    await insertScoredChunk(doc, "b", 0.8);
    await insertScoredChunk(doc, "c", 0.7);
    await insertScoredChunk(doc, "d", 0.6);

    const { provider } = buildMockProvider();
    const cfg: ExternalRetrievalConfig = { ...DEFAULT_EXTERNAL_RETRIEVAL_CONFIG, topK: 2, threshold: 0 };
    const ctx = await retrieveExternalContext(prisma, provider, "consulta", { ownerId }, cfg);
    expect(ctx.results).toHaveLength(2);
    expect(ctx.results[0].score).toBeCloseTo(0.9, SCORE_PRECISION);
    expect(ctx.results[1].score).toBeCloseTo(0.8, SCORE_PRECISION);
  });

  it("D) threshold de score exclui abaixo", async () => {
    const { ownerId, doc } = await isolatedDoc("d");
    await insertScoredChunk(doc, "alto", 0.9);
    await insertScoredChunk(doc, "baixo", 0.2);

    const { provider } = buildMockProvider();
    const cfg: ExternalRetrievalConfig = { ...DEFAULT_EXTERNAL_RETRIEVAL_CONFIG, threshold: 0.6, topK: 10 };
    const ctx = await retrieveExternalContext(prisma, provider, "consulta", { ownerId }, cfg);
    expect(ctx.results).toHaveLength(1);
    expect(ctx.results[0].score).toBeCloseTo(0.9, SCORE_PRECISION);
  });

  it("E) threshold boundary: score == threshold é aceito (>=)", async () => {
    const { ownerId, doc } = await isolatedDoc("e");
    await insertScoredChunk(doc, "maior", 0.9);
    await insertScoredChunk(doc, "limite", 0.5);
    await insertScoredChunk(doc, "menor", 0.2);

    const { provider } = buildMockProvider();
    const cfg: ExternalRetrievalConfig = { ...DEFAULT_EXTERNAL_RETRIEVAL_CONFIG, threshold: 0.5, topK: 10 };
    const ctx = await retrieveExternalContext(prisma, provider, "consulta", { ownerId }, cfg);
    // 0.9, 0.5 (score >= threshold) presentes; 0.2 ausente.
    expect(ctx.results).toHaveLength(2);
    expect(ctx.results.every((r) => r.score >= 0.5 - 1e-7)).toBe(true);
    expect(ctx.results.some((r) => r.score >= 0.9 - 1e-7)).toBe(true);
  });

  it("F) score conversion: score = 1 - distance", async () => {
    const { ownerId, doc } = await isolatedDoc("f");
    await insertScoredChunk(doc, "score", 0.8);

    const { provider } = buildMockProvider();
    const ctx = await retrieveExternalContext(prisma, provider, "consulta", { ownerId });
    const r = ctx.results[0];
    expect(r.score).toBeCloseTo(0.8, SCORE_PRECISION);
    expect(r.distance).toBeCloseTo(1 - 0.8, SCORE_PRECISION);
    expect(r.score + r.distance).toBeCloseTo(1, SCORE_PRECISION);
  });

  it("G) distance ordering: mais próximo primeiro (score DESC)", async () => {
    const { ownerId, doc } = await isolatedDoc("g");
    await insertScoredChunk(doc, "m", 0.5);
    await insertScoredChunk(doc, "h", 0.9);
    await insertScoredChunk(doc, "l", 0.2);

    const { provider } = buildMockProvider();
    const cfg: ExternalRetrievalConfig = { ...DEFAULT_EXTERNAL_RETRIEVAL_CONFIG, threshold: 0, topK: 10 };
    const ctx = await retrieveExternalContext(prisma, provider, "consulta", { ownerId }, cfg);
    expect(ctx.results.map((r) => Math.round(r.score * 1e3))).toEqual([900, 500, 200]);
    const distances = ctx.results.map((r) => r.distance);
    expect(distances[0]).toBeLessThan(distances[1]);
    expect(distances[1]).toBeLessThan(distances[2]);
  });

  it("H) deterministic tie-break: empate → chunkId ASC (último tie-break)", async () => {
    const { ownerId, doc } = await isolatedDoc("h");
    const a = await insertScoredChunk(doc, "tie a", 0.7);
    const b = await insertScoredChunk(doc, "tie b", 0.7);

    const { provider } = buildMockProvider();
    const cfg: ExternalRetrievalConfig = { ...DEFAULT_EXTERNAL_RETRIEVAL_CONFIG, threshold: 0, topK: 10 };
    const ctx = await retrieveExternalContext(prisma, provider, "consulta", { ownerId }, cfg);
    expect(ctx.results).toHaveLength(2);
    const ids = ctx.results.map((r) => r.chunkId);
    expect(ids).toEqual([a, b].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
  });

  it("O) provenance completa em cada resultado", async () => {
    const { ownerId, src, doc } = await isolatedDoc("o");
    await insertScoredChunk(doc, "prov", 0.85);

    const { provider } = buildMockProvider();
    const ctx = await retrieveExternalContext(prisma, provider, "consulta", { ownerId });
    expect(ctx.results).toHaveLength(1);
    const r = ctx.results[0] as RetrievalResult;
    expect(typeof r.sourceId).toBe("string");
    expect(typeof r.documentId).toBe("string");
    expect(typeof r.chunkId).toBe("string");
    expect(typeof r.title).toBe("string");
    expect(typeof r.content).toBe("string");
    expect(typeof r.orderOriginal).toBe("number");
    expect(typeof r.score).toBe("number");
    expect(typeof r.distance).toBe("number");
    expect(typeof r.citation).toBe("string");
    expect(r.citation.length).toBeGreaterThan(0);
    expect(r.sourceId).toBe(src);
    expect(r.documentId).toBe(doc);
  });

  it("P) embedding bruto NUNCA é retornado ao caller", async () => {
    const { ownerId, doc } = await isolatedDoc("p");
    await insertScoredChunk(doc, "no leak", 0.9);

    const { provider } = buildMockProvider();
    const ctx = await retrieveExternalContext(prisma, provider, "consulta", { ownerId });
    const json = JSON.stringify(ctx.results);
    expect(json).not.toContain('"embedding"');
    expect(json).not.toMatch(/,0\.5,0\.5,0\.5/);
    expect(ctx.results[0]).not.toHaveProperty("vector");
    expect(ctx.results[0]).not.toHaveProperty("embedding");
  });

  it("Y) repeated identical retrieval → determinístico (mesma sequência)", async () => {
    const { ownerId, doc } = await isolatedDoc("y");
    await insertScoredChunk(doc, "r1", 0.9);
    await insertScoredChunk(doc, "r2", 0.6);

    const { provider: p1 } = buildMockProvider();
    const { provider: p2 } = buildMockProvider();
    const cfg: ExternalRetrievalConfig = { ...DEFAULT_EXTERNAL_RETRIEVAL_CONFIG, threshold: 0, topK: 10 };
    const ctx1 = await retrieveExternalContext(prisma, p1, "consulta", { ownerId }, cfg);
    const ctx2 = await retrieveExternalContext(prisma, p2, "consulta", { ownerId }, cfg);
    expect(JSON.stringify(ctx1.results)).toBe(JSON.stringify(ctx2.results));
  });
});

// ---------------------------------------------------------------------------
// Valid embedding only (I, J, K, L, M, N)
// ---------------------------------------------------------------------------

describe("retrieval — apenas embeddings válidos entram", () => {
  it("I/J/K/L/M/N) chunks inválidos excluídos; só o válido retorna", async () => {
    const { ownerId, doc } = await isolatedDoc("valid");
    const validId = await insertChunk(doc, { text: "válido", vector: chunkVectorForScore(0.99) });

    await insertChunk(doc, { text: "sem vetor", vector: null }); // I
    await insertChunk(doc, { // J
      text: "hash antigo",
      vector: chunkVectorForScore(0.99),
      embeddedContentHash: computeChunkContentHash("outro"),
    });
    await insertChunk(doc, { text: "provider", vector: chunkVectorForScore(0.99), provider: "openai" }); // K
    await insertChunk(doc, { text: "model", vector: chunkVectorForScore(0.99), model: "embed-english-v3.0" }); // L
    await insertChunk(doc, { text: "version", vector: chunkVectorForScore(0.99), version: "v2.0" }); // M
    await insertChunk(doc, { text: "dims", vector: chunkVectorForScore(0.99), dimensionsMetadata: 512 }); // N

    const { provider } = buildMockProvider();
    const cfg: ExternalRetrievalConfig = { ...DEFAULT_EXTERNAL_RETRIEVAL_CONFIG, threshold: 0, topK: 20 };
    const ctx = await retrieveExternalContext(prisma, provider, "consulta", { ownerId }, cfg);
    expect(ctx.results.map((r) => r.chunkId)).toEqual([validId]);
  });
});

// ---------------------------------------------------------------------------
// Source / owner isolation (Q, R)
// ---------------------------------------------------------------------------

describe("retrieval — source/owner isolation", () => {
  it("Q/R) PUBLIC acessível a qualquer um; PRIVATE/SHARED apenas ao owner", async () => {
    const ownerA = await newOwner("iso-a");
    const ownerB = await newOwner("iso-b");

    const srcPublic = await createSource(null, "PUBLIC");
    const docPublic = await createDocument(srcPublic);
    await insertScoredChunk(docPublic, "publico", 0.9);

    const srcPrivA = await createSource(ownerA, "PRIVATE");
    const docPrivA = await createDocument(srcPrivA);
    await insertScoredChunk(docPrivA, "privado A", 0.8);

    const srcPrivB = await createSource(ownerB, "PRIVATE");
    const docPrivB = await createDocument(srcPrivB);
    await insertScoredChunk(docPrivB, "privado B", 0.99);

    const srcSharedB = await createSource(ownerB, "SHARED");
    const docSharedB = await createDocument(srcSharedB);
    await insertScoredChunk(docSharedB, "shared B", 0.97);

    const { provider } = buildMockProvider();
    const cfg: ExternalRetrievalConfig = { ...DEFAULT_EXTERNAL_RETRIEVAL_CONFIG, threshold: 0, topK: 20 };
    const ctxA = await retrieveExternalContext(prisma, provider, "consulta", { ownerId: ownerA }, cfg);

    const returnedSources = new Set(ctxA.results.map((r) => r.sourceId));
    expect(returnedSources.has(srcPublic)).toBe(true); // PUBLIC acessível a todos
    expect(returnedSources.has(srcPrivA)).toBe(true); // PRIVATE do próprio owner
    expect(returnedSources.has(srcPrivB)).toBe(false); // de outro owner
    expect(returnedSources.has(srcSharedB)).toBe(false); // de outro owner (ACL corrente)
  });

  it("Q) source scope: restringir a fontes específicas via RetrievalScope", async () => {
    const ownerA = await newOwner("scope-a");
    const srcA = await createSource(ownerA, "PRIVATE");
    const docA = await createDocument(srcA);
    await insertScoredChunk(docA, "fonte alvo", 0.9);

    const srcOther = await createSource(ownerA, "PRIVATE");
    const docOther = await createDocument(srcOther);
    await insertScoredChunk(docOther, "fonte outra", 0.8);

    const { provider } = buildMockProvider();
    const cfg: ExternalRetrievalConfig = { ...DEFAULT_EXTERNAL_RETRIEVAL_CONFIG, threshold: 0, topK: 20 };
    const ctx = await retrieveExternalContext(
      prisma,
      provider,
      "consulta",
      { ownerId: ownerA, sourceIds: [srcA] },
      cfg,
    );
    expect(ctx.results).toHaveLength(1);
    expect(ctx.results[0].sourceId).toBe(srcA);
  });
});
