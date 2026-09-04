import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import { COHERE_DIMENSIONS } from "./external-embedding-provider.js";
import { type EmbeddingConfig } from "./external-embedding.js";
import { computeDocumentContentHash } from "./external-ingest.js";
import { computeChunkContentHash } from "./external-chunking.js";
import {
  type EmbeddingIntegrityState,
  EXTERNAL_EMBEDDING_INTEGRITY_RULE,
  classifyChunkIntegrity,
  verifyExternalDocumentEmbeddings,
} from "./external-embedding-integrity.js";

// Testes da AUDITORIA de integridade/proveniência de embeddings (Fase 13 STEP 8).
// O serviço auditado é READ-ONLY. Os FIXTURES são montados de forma controlada
// no TEST DB com um vetor MOCK determinístico de 1024 dims, claramente
// identificado como fixture — NUNCA chamam Cohere real. Nenhuma correção.

const ACTIVE_CONFIG: EmbeddingConfig = {
  provider: "cohere",
  model: "embed-multilingual-v3.0",
  version: "v3.0",
  dimensions: COHERE_DIMENSIONS,
};

// Vetor fixture MOCK (determinístico, 1024 dims, NUNCA HTTP). Usado apenas
// para popular a coluna `embedding` nos cenários de teste.
const FIXTURE_MOCK_VECTOR: number[] = Array.from({ length: COHERE_DIMENSIONS }, () => 0.5);

function vectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

const createdUserIds: string[] = [];
const createdSourceIds: string[] = [];
const createdDocumentIds: string[] = [];

function track<T extends { id: string }>(list: string[], entity: T): T {
  list.push(entity.id);
  return entity;
}

interface ChunkFixture {
  text: string;
  contentHash: string;
  embeddedContentHash?: string | null;
  provider?: string | null;
  model?: string | null;
  version?: string | null;
  dimensionsMetadata?: number | null;
  vector?: number[] | null; // ausente (null) => sem embedding
}

async function createDocument(content: string): Promise<string> {
  const user = track(
    createdUserIds,
    await prisma.user.create({
      data: { name: "Integrity", email: `int-${Date.now()}-${Math.random()}@x.com` },
    }),
  );
  const source = track(
    createdSourceIds,
    await prisma.externalSource.create({
      data: {
        url: `https://int.test/${Date.now()}/${Math.random()}`,
        title: "src",
        visibility: "PRIVATE",
        ownerId: user.id,
      },
    }),
  );
  const doc = track(
    createdDocumentIds,
    await prisma.externalDocument.create({
      data: {
        sourceId: source.id,
        title: "doc",
        content,
        contentHash: computeDocumentContentHash(content),
        status: "READY",
      },
    }),
  );
  return doc.id;
}

async function insertChunk(documentId: string, fixture: ChunkFixture): Promise<string> {
  const count = await prisma.externalChunk.count({ where: { documentId } });
  const chunk = await prisma.externalChunk.create({
    data: {
      documentId,
      text: fixture.text,
      orderOriginal: count,
      contentHash: fixture.contentHash,
      embeddedContentHash: fixture.embeddedContentHash ?? null,
      embeddingProvider: fixture.provider ?? null,
      embeddingModel: fixture.model ?? null,
      embeddingVersion: fixture.version ?? null,
      embeddingDimensions: fixture.dimensionsMetadata ?? null,
    },
  });
  if (fixture.vector !== undefined && fixture.vector !== null) {
    await prisma.$executeRawUnsafe(
      'UPDATE "ExternalChunk" SET "embedding" = $1::vector(1024) WHERE "id" = $2::uuid',
      vectorLiteral(fixture.vector),
      chunk.id,
    );
  }
  return chunk.id;
}

/** Fixture padrão de chunk válido (com vector 1024 + metadata correta). */
async function insertValidChunk(documentId: string, text: string): Promise<string> {
  const contentHash = computeChunkContentHash(text);
  return insertChunk(documentId, {
    text,
    contentHash,
    embeddedContentHash: contentHash,
    provider: ACTIVE_CONFIG.provider,
    model: ACTIVE_CONFIG.model,
    version: ACTIVE_CONFIG.version,
    dimensionsMetadata: ACTIVE_CONFIG.dimensions,
    vector: FIXTURE_MOCK_VECTOR,
  });
}

async function findChunk(chunkId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{
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
  }>>(
    `SELECT c."id", c."documentId", c."contentHash", c."embeddedContentHash",
            c."embeddingProvider" AS "provider", c."embeddingModel" AS "model",
            c."embeddingVersion" AS "version", c."embeddingDimensions" AS "dimensionsMetadata",
            (c."embedding" IS NOT NULL) AS "hasEmbedding",
            COALESCE(vector_dims(c."embedding"),0)::int AS "vectorDimensions"
     FROM "ExternalChunk" c WHERE c."id" = $1::uuid`,
    chunkId,
  );
  return rows[0];
}

afterAll(async () => {
  await prisma.externalDocument.deleteMany({ where: { id: { in: createdDocumentIds } } });
  await prisma.externalSource.deleteMany({ where: { id: { in: createdSourceIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("classifyChunkIntegrity", () => {
  it("M) determinismo puro: mesmo estado + mesma config → mesmas razões", () => {
    const base = {
      id: "x", documentId: "d", contentHash: "h1",
      embeddedContentHash: "h1", provider: "cohere", model: "embed-multilingual-v3.0",
      version: "v3.0", dimensionsMetadata: 1024, hasEmbedding: true, vectorDimensions: 1024,
    };
    const a = classifyChunkIntegrity(base, ACTIVE_CONFIG);
    const b = classifyChunkIntegrity(base, ACTIVE_CONFIG);
    expect(a).toEqual(b);
    expect(a).toEqual([]);
  });

  it("M) classificador puro acumula múltiplas razões em ordem fixa", () => {
    const row = {
      id: "x", documentId: "d", contentHash: "h1",
      embeddedContentHash: "h2", provider: "other", model: "other-model",
      version: "other-v", dimensionsMetadata: 888, hasEmbedding: true, vectorDimensions: 1024,
    };
    expect(classifyChunkIntegrity(row, ACTIVE_CONFIG)).toEqual([
      "CONTENT_HASH_MISMATCH",
      "PROVIDER_MISMATCH",
      "MODEL_MISMATCH",
      "VERSION_MISMATCH",
      "METADATA_DIMENSION_MISMATCH",
    ]);
  });
});

describe("verifyExternalDocumentEmbeddings (auditoria completa)", () => {
  it("A) chunk sem embedding → MISSING_VECTOR / missingEmbeddings=1", async () => {
    const docId = await createDocument("sem vetor aqui.");
    const text = "sem vetor aqui.";
    await insertChunk(docId, { text, contentHash: computeChunkContentHash(text) });

    const report = await verifyExternalDocumentEmbeddings(prisma, docId, ACTIVE_CONFIG);
    expect(report.totalChunks).toBe(1);
    expect(report.validEmbeddings).toBe(0);
    expect(report.missingEmbeddings).toBe(1);
    expect(report.invalidEmbeddings).toBe(1);
    expect(report.chunks[0].reasons).toContain("MISSING_VECTOR");
    expect(report.chunks[0].hasEmbedding).toBe(false);
  });

  it("B) embedding válido → status valid / validEmbeddings=1", async () => {
    const docId = await createDocument("embedding ok.");
    await insertValidChunk(docId, "embedding ok.");

    const report = await verifyExternalDocumentEmbeddings(prisma, docId, ACTIVE_CONFIG);
    expect(report.validEmbeddings).toBe(1);
    expect(report.invalidEmbeddings).toBe(0);
    expect(report.chunks[0].status).toBe("valid");
    expect(report.chunks[0].reasons).toEqual([]);
    expect(report.chunks[0].vectorDimensions).toBe(1024);
  });

  it("C) vector presente mas embeddedContentHash ausente → MISSING_EMBEDDED_CONTENT_HASH", async () => {
    const docId = await createDocument("hash ausente.");
    const text = "hash ausente.";
    await insertChunk(docId, {
      text,
      contentHash: computeChunkContentHash(text),
      embeddedContentHash: null,
      provider: ACTIVE_CONFIG.provider,
      model: ACTIVE_CONFIG.model,
      version: ACTIVE_CONFIG.version,
      dimensionsMetadata: ACTIVE_CONFIG.dimensions,
      vector: FIXTURE_MOCK_VECTOR,
    });

    const report = await verifyExternalDocumentEmbeddings(prisma, docId, ACTIVE_CONFIG);
    expect(report.missingEmbeddedContentHash).toBe(1);
    expect(report.chunks[0].reasons).toContain("MISSING_EMBEDDED_CONTENT_HASH");
  });

  it("D) embeddedContentHash diferente → CONTENT_HASH_MISMATCH", async () => {
    const docId = await createDocument("hash diferente.");
    const text = "hash diferente.";
    await insertChunk(docId, {
      text,
      contentHash: computeChunkContentHash(text),
      embeddedContentHash: computeChunkContentHash("OUTRO conteudo"),
      provider: ACTIVE_CONFIG.provider,
      model: ACTIVE_CONFIG.model,
      version: ACTIVE_CONFIG.version,
      dimensionsMetadata: ACTIVE_CONFIG.dimensions,
      vector: FIXTURE_MOCK_VECTOR,
    });

    const report = await verifyExternalDocumentEmbeddings(prisma, docId, ACTIVE_CONFIG);
    expect(report.contentHashMismatch).toBe(1);
    expect(report.chunks[0].reasons).toContain("CONTENT_HASH_MISMATCH");
  });

  it("E) provider diferente → PROVIDER_MISMATCH", async () => {
    const docId = await createDocument("provider diferente.");
    const text = "provider diferente.";
    await insertChunk(docId, {
      text,
      contentHash: computeChunkContentHash(text),
      embeddedContentHash: computeChunkContentHash(text),
      provider: "openai",
      model: ACTIVE_CONFIG.model,
      version: ACTIVE_CONFIG.version,
      dimensionsMetadata: ACTIVE_CONFIG.dimensions,
      vector: FIXTURE_MOCK_VECTOR,
    });

    const report = await verifyExternalDocumentEmbeddings(prisma, docId, ACTIVE_CONFIG);
    expect(report.providerMismatch).toBe(1);
    expect(report.chunks[0].reasons).toContain("PROVIDER_MISMATCH");
  });

  it("F) model diferente → MODEL_MISMATCH", async () => {
    const docId = await createDocument("model diferente.");
    const text = "model diferente.";
    await insertChunk(docId, {
      text,
      contentHash: computeChunkContentHash(text),
      embeddedContentHash: computeChunkContentHash(text),
      provider: ACTIVE_CONFIG.provider,
      model: "embed-english-v3.0",
      version: ACTIVE_CONFIG.version,
      dimensionsMetadata: ACTIVE_CONFIG.dimensions,
      vector: FIXTURE_MOCK_VECTOR,
    });

    const report = await verifyExternalDocumentEmbeddings(prisma, docId, ACTIVE_CONFIG);
    expect(report.modelMismatch).toBe(1);
    expect(report.chunks[0].reasons).toContain("MODEL_MISMATCH");
  });

  it("G) version diferente → VERSION_MISMATCH", async () => {
    const docId = await createDocument("version diferente.");
    const text = "version diferente.";
    await insertChunk(docId, {
      text,
      contentHash: computeChunkContentHash(text),
      embeddedContentHash: computeChunkContentHash(text),
      provider: ACTIVE_CONFIG.provider,
      model: ACTIVE_CONFIG.model,
      version: "v2.0",
      dimensionsMetadata: ACTIVE_CONFIG.dimensions,
      vector: FIXTURE_MOCK_VECTOR,
    });

    const report = await verifyExternalDocumentEmbeddings(prisma, docId, ACTIVE_CONFIG);
    expect(report.versionMismatch).toBe(1);
    expect(report.chunks[0].reasons).toContain("VERSION_MISMATCH");
  });

  it("H) metadata dimensions diferente → METADATA_DIMENSION_MISMATCH", async () => {
    const docId = await createDocument("dims metadata diferente.");
    const text = "dims metadata diferente.";
    await insertChunk(docId, {
      text,
      contentHash: computeChunkContentHash(text),
      embeddedContentHash: computeChunkContentHash(text),
      provider: ACTIVE_CONFIG.provider,
      model: ACTIVE_CONFIG.model,
      version: ACTIVE_CONFIG.version,
      dimensionsMetadata: 512,
      vector: FIXTURE_MOCK_VECTOR,
    });

    const report = await verifyExternalDocumentEmbeddings(prisma, docId, ACTIVE_CONFIG);
    expect(report.dimensionsMetadataMismatch).toBe(1);
    expect(report.chunks[0].reasons).toContain("METADATA_DIMENSION_MISMATCH");
  });

  it("I) vector_dims diferente da config → VECTOR_DIMENSION_MISMATCH", async () => {
    const docId = await createDocument("vector dims diverge da config.");
    const text = "vector dims diverge da config.";
    // Vector armazenado tem 1024 dims (coluna vector(1024)), mas auditamos sob
    // uma config que espera 8 dims → vector_dims(1024) != 8.
    await insertChunk(docId, {
      text,
      contentHash: computeChunkContentHash(text),
      embeddedContentHash: computeChunkContentHash(text),
      provider: ACTIVE_CONFIG.provider,
      model: ACTIVE_CONFIG.model,
      version: ACTIVE_CONFIG.version,
      dimensionsMetadata: 8,
      vector: FIXTURE_MOCK_VECTOR,
    });
    const config8: EmbeddingConfig = { ...ACTIVE_CONFIG, dimensions: 8 };

    const report = await verifyExternalDocumentEmbeddings(prisma, docId, config8);
    expect(report.vectorDimensionsMismatch).toBe(1);
    expect(report.chunks[0].reasons).toContain("VECTOR_DIMENSION_MISMATCH");
    // metadata (8) === config.dimensions (8) → NÃO é metadata mismatch aqui.
    expect(report.chunks[0].reasons).not.toContain("METADATA_DIMENSION_MISMATCH");
  });

  it("J) múltiplas inconsistências na MESMA chunk → todas as razões preservadas", async () => {
    const docId = await createDocument("muitas inconsistências.");
    const text = "muitas inconsistências.";
    await insertChunk(docId, {
      text,
      contentHash: computeChunkContentHash(text),
      embeddedContentHash: computeChunkContentHash("outro"),
      provider: "vertex",
      model: "other-model",
      version: "v9",
      dimensionsMetadata: 999,
      vector: FIXTURE_MOCK_VECTOR,
    });

    const report = await verifyExternalDocumentEmbeddings(prisma, docId, ACTIVE_CONFIG);
    const chunk = report.chunks[0];
    for (const r of ["CONTENT_HASH_MISMATCH", "PROVIDER_MISMATCH", "MODEL_MISMATCH", "VERSION_MISMATCH", "METADATA_DIMENSION_MISMATCH"] as EmbeddingIntegrityState[]) {
      expect(chunk.reasons).toContain(r);
    }
    expect(chunk.reasons).toHaveLength(5);
    expect(report.invalidEmbeddings).toBe(1);
  });

  it("K) múltiplos chunks com estados diferentes → totaliza corretamente (L)", async () => {
    const docId = await createDocument("varios chunks.");
    await insertValidChunk(docId, "chunk valido 1.");
    await insertValidChunk(docId, "chunk valido 2.");
    const missingText = "chunk sem vetor.";
    await insertChunk(docId, { text: missingText, contentHash: computeChunkContentHash(missingText) });
    const badText = "chunk com hash errado.";
    await insertChunk(docId, {
      text: badText,
      contentHash: computeChunkContentHash(badText),
      embeddedContentHash: computeChunkContentHash("errado"),
      provider: ACTIVE_CONFIG.provider,
      model: ACTIVE_CONFIG.model,
      version: ACTIVE_CONFIG.version,
      dimensionsMetadata: ACTIVE_CONFIG.dimensions,
      vector: FIXTURE_MOCK_VECTOR,
    });

    const report = await verifyExternalDocumentEmbeddings(prisma, docId, ACTIVE_CONFIG);
    expect(report.totalChunks).toBe(4);
    expect(report.validEmbeddings).toBe(2);
    expect(report.missingEmbeddings).toBe(1);
    expect(report.contentHashMismatch).toBe(1);
    expect(report.invalidEmbeddings).toBe(2);
    expect(report.validEmbeddings + report.invalidEmbeddings).toBe(report.totalChunks);
  });

  it("M/N) produção determinística e estável (mesma voz → mesmo relatório)", async () => {
    const docId = await createDocument("determinismo.");
    await insertValidChunk(docId, "a.");
    const empty = "b.";
    await insertChunk(docId, { text: empty, contentHash: computeChunkContentHash(empty) });

    const r1 = await verifyExternalDocumentEmbeddings(prisma, docId, ACTIVE_CONFIG);
    const r2 = await verifyExternalDocumentEmbeddings(prisma, docId, ACTIVE_CONFIG);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    // Ordenação lexicográfica por chunkId.
    const ids = r1.chunks.map((c) => c.chunkId);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it("O) relatório não expõe o vetor (sem arrays de floats / sem campo embedding)", async () => {
    const docId = await createDocument("sem vazamento de vetor.");
    await insertValidChunk(docId, "sem vazamento de vetor.");

    const report = await verifyExternalDocumentEmbeddings(prisma, docId, ACTIVE_CONFIG);
    const json = JSON.stringify(report);
    expect(json).not.toContain("embedding\": [");
    expect(json).not.toContain("0.5,0.5");
    // Exposição segura: presença e dims, nunca o vetor.
    expect(report.chunks[0].hasEmbedding).toBe(true);
    expect(report.chunks[0].vectorDimensions).toBe(1024);
    expect(report.chunks[0]).not.toHaveProperty("vector");
  });

  it("P) relatório não contém secrets / credenciais", async () => {
    const docId = await createDocument("sem secrets.");
    await insertValidChunk(docId, "sem secrets.");

    const report = await verifyExternalDocumentEmbeddings(prisma, docId, ACTIVE_CONFIG);
    const json = JSON.stringify(report);
    expect(json.toLowerCase()).not.toContain("api_key");
    expect(json.toLowerCase()).not.toContain("apikey");
    expect(json.toLowerCase()).not.toContain("authorization");
    expect(json.toLowerCase()).not.toContain("bearer");
    expect(json).not.toContain("sk-");
    expect(report.ruleApplied).toBe(EXTERNAL_EMBEDDING_INTEGRITY_RULE);
  });

  it("fork: documento sem chunks → relatório zerado, sem erro", async () => {
    const docId = await createDocument("sem chunks nenhum.");
    const report = await verifyExternalDocumentEmbeddings(prisma, docId, ACTIVE_CONFIG);
    expect(report.totalChunks).toBe(0);
    expect(report.validEmbeddings).toBe(0);
    expect(report.invalidEmbeddings).toBe(0);
    expect(report.chunks).toEqual([]);
  });

  it("read-only: auditoria não altera nada persistido", async () => {
    const docId = await createDocument("readonly check.");
    await insertValidChunk(docId, "readonly check.");
    const before = await findChunk(
      (await prisma.externalChunk.findFirst({ where: { documentId: docId } }))!.id,
    );

    await verifyExternalDocumentEmbeddings(prisma, docId, ACTIVE_CONFIG);

    const after = await findChunk(
      (await prisma.externalChunk.findFirst({ where: { documentId: docId } }))!.id,
    );
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});