import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import { COHERE_DIMENSIONS } from "./external-embedding-provider.js";
import { type EmbeddingConfig } from "./external-embedding.js";
import { computeDocumentContentHash } from "./external-ingest.js";
import { computeChunkContentHash } from "./external-chunking.js";
import {
  type EmbeddingIntegrityState,
  verifyExternalDocumentEmbeddings,
} from "./external-embedding-integrity.js";
import {
  type EmbeddingProviderWithInputType,
} from "./external-embedding-store.js";
import {
  type EmbeddingRepairAction,
  type RepairDb,
  EXTERNAL_EMBEDDING_REPAIR_RULE,
  mapReasonsToAction,
  repairExternalDocumentEmbeddings,
} from "./external-embedding-repair.js";

// Testes do REPAIR CONTROLADO de embeddings (Fase 13 STEP 8a).
// O serviço é document-scoped, NUNCA global, com dry-run por padrão.
// O provider é SEMPRE mock; NUNCA chamamos Cohere/HTTP aqui. Os fixtures são
// montados no TEST DB com vetor MOCK determinístico de 1024 dims, explicitamente
// identificado como fixture. O SAFETY GATE bloqueia apply em database que não
// seja autorizado (DEV/não-identificado), testado via datasource SIMULADO.

const ACTIVE_CONFIG: EmbeddingConfig = {
  provider: "cohere",
  model: "embed-multilingual-v3.0",
  version: "v3.0",
  dimensions: COHERE_DIMENSIONS,
};

const FIXTURE_MOCK_VECTOR: number[] = Array.from({ length: COHERE_DIMENSIONS }, () => 0.5);

function vectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

// Provider MOCK determinístico (NUNCA HTTP). Contadores de chamadas para provar
// que dry-run não chama provider e que apply corrige e depois é idempotente.
function makeMockProvider(): { provider: EmbeddingProviderWithInputType; calls: { count: number } } {
  const calls = { count: 0 };
  const dims = COHERE_DIMENSIONS;
  const provider: EmbeddingProviderWithInputType = {
    name: "mock",
    model: "mock-model",
    version: "mock-v",
    dimensions: dims,
    async embed(): Promise<number[]> {
      calls.count += 1;
      return Array.from({ length: dims }, (_, i) => (i % 2 === 0 ? 0.75 : 0.25));
    },
  };
  return { provider, calls };
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
  vector?: number[] | null;
}

async function createDocument(content: string): Promise<string> {
  const user = track(
    createdUserIds,
    await prisma.user.create({
      data: { name: "Repair", email: `rep-${Date.now()}-${Math.random()}@x.com` },
    }),
  );
  const source = track(
    createdSourceIds,
    await prisma.externalSource.create({
      data: {
        url: `https://rep.test/${Date.now()}/${Math.random()}`,
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

/** Chunk válido (vector 1024 + metadata correta + hash igual). */
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

/** Chunk sem vetor (embedding ausente). */
async function insertPendingChunk(documentId: string, text: string): Promise<string> {
  return insertChunk(documentId, {
    text,
    contentHash: computeChunkContentHash(text),
  });
}

/** Chunk com hash divergente (vetor para conteúdo diferente). */
async function insertStaleChunk(documentId: string, text: string): Promise<string> {
  return insertChunk(documentId, {
    text,
    contentHash: computeChunkContentHash(text),
    embeddedContentHash: computeChunkContentHash("OUTRO conteúdo antigo"),
    provider: ACTIVE_CONFIG.provider,
    model: ACTIVE_CONFIG.model,
    version: ACTIVE_CONFIG.version,
    dimensionsMetadata: ACTIVE_CONFIG.dimensions,
    vector: FIXTURE_MOCK_VECTOR,
  });
}

/** Chunk com provider divergente (vetor de outro provider). */
async function insertForeignProviderChunk(documentId: string, text: string): Promise<string> {
  return insertChunk(documentId, {
    text,
    contentHash: computeChunkContentHash(text),
    embeddedContentHash: computeChunkContentHash(text),
    provider: "openai",
    model: "text-embedding-3-small",
    version: "2024-02-01",
    dimensionsMetadata: ACTIVE_CONFIG.dimensions,
    vector: FIXTURE_MOCK_VECTOR,
  });
}

async function findChunk(chunkId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    contentHash: string;
    embeddedContentHash: string | null;
    provider: string | null;
    vectorDimensions: number;
  }>>(
    `SELECT c."id", c."contentHash", c."embeddedContentHash",
            c."embeddingProvider" AS "provider",
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

// ---------------------------------------------------------------------------
// Mapeamento razão → ação (puro/determinístico)
// ---------------------------------------------------------------------------

describe("mapReasonsToAction (regra de ação por razão)", () => {
  it("A) MISSING_VECTOR → EMBED", () => {
    expect(mapReasonsToAction(["MISSING_VECTOR"], false)).toBe("EMBED");
    expect(mapReasonsToAction(["MISSING_VECTOR"], true)).toBe("EMBED");
  });

  it("A) MISSING_EMBEDDED_CONTENT_HASH → RE-EMBED", () => {
    expect(mapReasonsToAction(["MISSING_EMBEDDED_CONTENT_HASH"], false)).toBe("RE-EMBED");
  });

  it("A) CONTENT_HASH_MISMATCH → RE-EMBED", () => {
    expect(mapReasonsToAction(["CONTENT_HASH_MISMATCH"], false)).toBe("RE-EMBED");
  });

  it("I) VECTOR_DIMENSION_MISMATCH → RE-EMBED (regenera, nunca resize)", () => {
    expect(mapReasonsToAction(["VECTOR_DIMENSION_MISMATCH"], true)).toBe("RE-EMBED");
  });

  it("J) INVALID_VECTOR → RE-EMBED (regenera, nunca resize)", () => {
    expect(mapReasonsToAction(["INVALID_VECTOR"], true)).toBe("RE-EMBED");
  });

  it("G) PROVIDER/MODEL/VERSION/METADATA_DIMENSION com config explícita → RE-EMBED_REQUIRED", () => {
    for (const r of ["PROVIDER_MISMATCH", "MODEL_MISMATCH", "VERSION_MISMATCH", "METADATA_DIMENSION_MISMATCH"] as EmbeddingIntegrityState[]) {
      expect(mapReasonsToAction([r], true)).toBe("RE-EMBED_REQUIRED");
    }
  });

  it("H) PROVIDER/MODEL/VERSION/METADATA_DIMENSION sem config explícita → skip seguro", () => {
    for (const r of ["PROVIDER_MISMATCH", "MODEL_MISMATCH", "VERSION_MISMATCH", "METADATA_DIMENSION_MISMATCH"] as EmbeddingIntegrityState[]) {
      expect(mapReasonsToAction([r], false)).toBe("SKIPPED_EXPLICIT_CONFIG_REQUIRED");
    }
  });

  it("G) múltiplas razões (hash+provider) sem config → skip; com config → RE-EMBED_REQUIRED", () => {
    const reasons = ["CONTENT_HASH_MISMATCH", "PROVIDER_MISMATCH"] as EmbeddingIntegrityState[];
    expect(mapReasonsToAction(reasons, false)).toBe("SKIPPED_EXPLICIT_CONFIG_REQUIRED");
    expect(mapReasonsToAction(reasons, true)).toBe("RE-EMBED_REQUIRED");
  });

  it("sem razões → NONE (chunk válido; nunca ação de repair)", () => {
    expect(mapReasonsToAction([], true)).toBe("NONE");
  });

  it("nunca produz ação de resize/truncation/padding", () => {
    const allActions: EmbeddingRepairAction[] = ["EMBED", "RE-EMBED", "RE-EMBED_REQUIRED", "SKIPPED_EXPLICIT_CONFIG_REQUIRED", "NONE"];
    for (const r of [
      "MISSING_VECTOR", "MISSING_EMBEDDED_CONTENT_HASH", "CONTENT_HASH_MISMATCH",
      "PROVIDER_MISMATCH", "MODEL_MISMATCH", "VERSION_MISMATCH", "METADATA_DIMENSION_MISMATCH",
      "VECTOR_DIMENSION_MISMATCH", "INVALID_VECTOR",
    ] as EmbeddingIntegrityState[]) {
      expect(mapReasonsToAction([r], true)).not.toMatch(/resize|pad|truncate/i);
    }
    expect(allActions).not.toContain("RESIZE");
  });
});

// ---------------------------------------------------------------------------
// Guarda de documentId + dry-run (B, C, D)
// ---------------------------------------------------------------------------

describe("repairExternalDocumentEmbeddings — documentId obrigatório + dry-run default", () => {
  it("A) documentId ausente/vazio → rejeita com erro (nunca global)", async () => {
    const { provider } = makeMockProvider();
    await expect(
      repairExternalDocumentEmbeddings(prisma, provider, { documentId: "" }),
    ).rejects.toThrow(/documentId/);
    await expect(
      repairExternalDocumentEmbeddings(prisma, provider, { documentId: "   " }),
    ).rejects.toThrow(/documentId/);
  });

  it("B) dry-run é o padrão (apply ausente/false → dryRun:true, status dry-run)", async () => {
    const docId = await createDocument("dry por padrao.");
    await insertPendingChunk(docId, "dry por padrao.");
    const { provider } = makeMockProvider();

    const res = await repairExternalDocumentEmbeddings(prisma, provider, { documentId: docId });
    expect(res.dryRun).toBe(true);
    expect(res.status).toBe("dry-run");
    expect(res.ruleApplied).toBe(EXTERNAL_EMBEDDING_REPAIR_RULE);

    const res2 = await repairExternalDocumentEmbeddings(prisma, provider, {
      documentId: docId,
      apply: false,
    });
    expect(res2.dryRun).toBe(true);
    expect(res2.status).toBe("dry-run");
  });

  it("C) dry-run NÃO chama provider (0 chamadas)", async () => {
    const docId = await createDocument("dry sem provider.");
    await insertPendingChunk(docId, "dry sem provider.");
    const { provider, calls } = makeMockProvider();

    await repairExternalDocumentEmbeddings(prisma, provider, { documentId: docId });
    expect(calls.count).toBe(0);
  });

  it("D) dry-run NÃO altera nada persistido (readonly)", async () => {
    const docId = await createDocument("dry readonly.");
    const chunkId = await insertPendingChunk(docId, "dry readonly.");
    const before = await findChunk(chunkId);
    const { provider } = makeMockProvider();

    await repairExternalDocumentEmbeddings(prisma, provider, { documentId: docId });

    const after = await findChunk(chunkId);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(after.embeddedContentHash).toBeNull();
    expect(after.vectorDimensions).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Plano de ações por razão (E, F, G, H, I)
// ---------------------------------------------------------------------------

describe("repairExternalDocumentEmbeddings — plano de ações", () => {
  it("E) cargo sem vetor → action EMBED + totals", async () => {
    const docId = await createDocument("plano embed.");
    await insertPendingChunk(docId, "plano embed.");
    const { provider } = makeMockProvider();

    const res = await repairExternalDocumentEmbeddings(prisma, provider, { documentId: docId });
    expect(res.dryRun).toBe(true);
    expect(res.actions).toHaveLength(1);
    expect(res.actions[0].action).toBe("EMBED");
    expect(res.totals).toMatchObject({ examined: 1, valid: 0, repairable: 1, skipped: 0 });
  });

  it("F) hash divergente → RE-EMBED", async () => {
    const docId = await createDocument("plano re-embed.");
    await insertStaleChunk(docId, "plano re-embed.");
    const { provider } = makeMockProvider();

    const res = await repairExternalDocumentEmbeddings(prisma, provider, { documentId: docId });
    expect(res.actions[0].action).toBe("RE-EMBED");
  });

  it("H) provider diverso SEM config explícita → skip seguro (sem write, sem chamar store)", async () => {
    const docId = await createDocument("provider sem config.");
    await insertForeignProviderChunk(docId, "provider sem config.");
    const { provider, calls } = makeMockProvider();

    const res = await repairExternalDocumentEmbeddings(prisma, provider, { documentId: docId });
    expect(res.actions[0].action).toBe("SKIPPED_EXPLICIT_CONFIG_REQUIRED");
    expect(res.totals.skipped).toBe(1);
    expect(res.totals.repairable).toBe(0);
    expect(calls.count).toBe(0);
  });

  it("G) provider diverso COM config explícita → RE-EMBED_REQUIRED (plano dry-run)", async () => {
    const docId = await createDocument("provider com config.");
    await insertForeignProviderChunk(docId, "provider com config.");
    const { provider } = makeMockProvider();

    const res = await repairExternalDocumentEmbeddings(prisma, provider, {
      documentId: docId,
      config: ACTIVE_CONFIG,
    });
    expect(res.actions[0].action).toBe("RE-EMBED_REQUIRED");
    expect(res.dryRun).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// APPLY: corrige fixtures no TEST DB e reaudita (K, L, M, O, R)
// ---------------------------------------------------------------------------

describe("repairExternalDocumentEmbeddings — APPLY controlado (TEST only)", () => {
  it("K) apply corrige vetor ausente + hash divergente → 100% VALID após", async () => {
    const docId = await createDocument("apply fix.");
    await insertValidChunk(docId, "chunk ja valido.");
    const missingId = await insertPendingChunk(docId, "chunk sem vetor.");
    const staleId = await insertStaleChunk(docId, "chunk com hash antigo.");
    const { provider, calls } = makeMockProvider();

    const res = await repairExternalDocumentEmbeddings(prisma, provider, {
      documentId: docId,
      apply: true,
    });

    expect(res.dryRun).toBe(false);
    expect(res.status).toBe("success");
    expect(res.postAudit.allValid).toBe(true);
    expect(res.postAudit.invalidEmbeddings).toBe(0);
    expect(calls.count).toBe(2); // apenas os 2 chunks reparáveis

    const missingAfter = await findChunk(missingId);
    const staleAfter = await findChunk(staleId);
    expect(missingAfter.embeddedContentHash).toBe(missingAfter.contentHash);
    expect(missingAfter.vectorDimensions).toBe(1024);
    expect(missingAfter.provider).toBe(ACTIVE_CONFIG.provider);
    expect(staleAfter.embeddedContentHash).toBe(staleAfter.contentHash);
    expect(staleAfter.vectorDimensions).toBe(1024);
  });

  it("K2) apply corrige provider diverso (config explícita) → provider passa a cohere + 100% VALID", async () => {
    const docId = await createDocument("apply provider.");
    const foreignId = await insertForeignProviderChunk(docId, "apply provider.");
    const { provider, calls } = makeMockProvider();

    const res = await repairExternalDocumentEmbeddings(prisma, provider, {
      documentId: docId,
      config: ACTIVE_CONFIG,
      apply: true,
    });

    expect(res.status).toBe("success");
    expect(res.postAudit.allValid).toBe(true);
    expect(calls.count).toBe(1);

    const after = await findChunk(foreignId);
    expect(after.embeddedContentHash).toBe(after.contentHash);
    expect(after.provider).toBe(ACTIVE_CONFIG.provider);
    expect(after.vectorDimensions).toBe(1024);
  });

  it("H2) apply de provider diverso SEM config explícita → skip; nada é gravado; status partial", async () => {
    const docId = await createDocument("apply provider sem config.");
    const foreignId = await insertForeignProviderChunk(docId, "apply provider sem config.");
    const { provider, calls } = makeMockProvider();

    const res = await repairExternalDocumentEmbeddings(prisma, provider, {
      documentId: docId,
      apply: true,
    });

    expect(res.status).toBe("partial");
    expect(res.actions[0].action).toBe("SKIPPED_EXPLICIT_CONFIG_REQUIRED");
    expect(calls.count).toBe(0);
    const after = await findChunk(foreignId);
    expect(after.provider).toBe("openai"); // inalterado — safe skip
  });

  it("L) documento íntegro → sem ações, provider NÃO chamado, nada muda (no-op)", async () => {
    const docId = await createDocument("apply noop.");
    await insertValidChunk(docId, "a.");
    await insertValidChunk(docId, "b.");
    const { provider, calls } = makeMockProvider();

    const res = await repairExternalDocumentEmbeddings(prisma, provider, {
      documentId: docId,
      apply: true,
    });
    expect(res.status).toBe("success");
    expect(res.actions).toEqual([]);
    expect(res.totals.repairable).toBe(0);
    expect(calls.count).toBe(0);
  });

  it("M) idempotência: segunda execução do mesmo apply → sem provider call, sem mudança, ainda VALID", async () => {
    const docId = await createDocument("apply idempotent.");
    await insertPendingChunk(docId, "chunk para aplicar.");
    const chunkId = (await prisma.externalChunk.findFirst({ where: { documentId: docId } }))!.id;
    const { provider, calls } = makeMockProvider();

    const r1 = await repairExternalDocumentEmbeddings(prisma, provider, {
      documentId: docId,
      apply: true,
    });
    expect(r1.status).toBe("success");
    expect(calls.count).toBe(1);
    const afterFirst = await findChunk(chunkId);

    const r2 = await repairExternalDocumentEmbeddings(prisma, provider, {
      documentId: docId,
      apply: true,
    });
    expect(r2.status).toBe("success");
    expect(r2.actions).toEqual([]);
    expect(calls.count).toBe(1); // provider NÃO chamado de novo
    const afterSecond = await findChunk(chunkId);
    expect(JSON.stringify(afterSecond)).toBe(JSON.stringify(afterFirst));
  });

  it("O) múltiplos chunks do mesmo documento → todos corrigidos no apply", async () => {
    const docId = await createDocument("apply multi.");
    for (const t of ["um", "dois", "tres", "quatro"]) {
      await insertPendingChunk(docId, t);
    }
    const { provider, calls } = makeMockProvider();

    const res = await repairExternalDocumentEmbeddings(prisma, provider, {
      documentId: docId,
      apply: true,
    });
    expect(res.status).toBe("success");
    expect(calls.count).toBe(4);
    const report = await verifyExternalDocumentEmbeddings(prisma, docId, ACTIVE_CONFIG);
    expect(report.totalChunks).toBe(4);
    expect(report.validEmbeddings).toBe(4);
  });

  it("R) não repara documento DIFERENTE (escopo document-scoped)", async () => {
    const docA = await createDocument("doc A.");
    const docB = await createDocument("doc B.");
    await insertPendingChunk(docA, "invalido em A.");
    const bChunkId = await insertPendingChunk(docB, "invalido em B também.");
    const { provider, calls } = makeMockProvider();

    const res = await repairExternalDocumentEmbeddings(prisma, provider, {
      documentId: docA,
      apply: true,
    });
    expect(res.status).toBe("success");
    expect(calls.count).toBe(1); // apenas o chunk de A

    const bAfter = await findChunk(bChunkId);
    expect(bAfter.embeddedContentHash).toBeNull();
    expect(bAfter.vectorDimensions).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SAFETY GATE (T): apply NUNCA em DEV / base não autorizada
// ---------------------------------------------------------------------------

describe("SAFETY GATE — apply só em base de TEST autorizada", () => {
  // Datasource SIMULADO (fixture) que reporta um database DEV (`f1_narrative`).
  // Nenhuma conexão real DEV é usada. Métodos de escrita são armadilhas que
  // provam que o gate bloqueia ANTES de qualquer gravação.
  function simulatedDb(currentDatabase: string) {
    const writeCalls = { count: 0 };
    const db = {
      externalChunk: {
        findMany: async (): Promise<never> => {
          writeCalls.count += 1;
          throw new Error("deveria ser bloqueado antes de ler chunks para escrita");
        },
      },
      $transaction: async (): Promise<never> => {
        writeCalls.count += 1;
        throw new Error("deveria ser bloqueado antes da transação");
      },
      $executeRawUnsafe: async (): Promise<never> => {
        writeCalls.count += 1;
        throw new Error("deveria ser bloqueado antes de executar escrita");
      },
      $queryRawUnsafe: async (_sql: string): Promise<unknown> =>
        typeof _sql === "string" && _sql.toLowerCase().includes("current_database")
          ? [{ current_database: currentDatabase }]
          : [],
    } as unknown as RepairDb;
    return { db, writeCalls };
  }

  it("T) apply com datasource DEV ('f1_narrative') → rejeitado, sem nenhuma escrita", async () => {
    const { db, writeCalls } = simulatedDb("f1_narrative");
    const { provider } = makeMockProvider();

    await expect(
      repairExternalDocumentEmbeddings(db, provider, {
        documentId: "00000000-0000-0000-0000-000000000001",
        apply: true,
      }),
    ).rejects.toThrow(/não está autorizado/);
    expect(writeCalls.count).toBe(0);
  });

  it("T) apply com database desconhecido → rejeitado, sem nenhuma escrita", async () => {
    const { db, writeCalls } = simulatedDb("some_random_db");
    const { provider } = makeMockProvider();

    await expect(
      repairExternalDocumentEmbeddings(db, provider, {
        documentId: "00000000-0000-0000-0000-000000000001",
        apply: true,
      }),
    ).rejects.toThrow(/não está autorizado/);
    expect(writeCalls.count).toBe(0);
  });

  it("dry-run permanece readonly e é permitido (não aciona o gate de apply)", async () => {
    const { db, writeCalls } = simulatedDb("f1_narrative");
    const { provider } = makeMockProvider();

    const res = await repairExternalDocumentEmbeddings(db, provider, {
      documentId: "00000000-0000-0000-0000-000000000001",
    });
    expect(res.dryRun).toBe(true);
    expect(writeCalls.count).toBe(0);
  });

  it("apply em base de TEST autorizada → prossegue (gate não bloqueia)", async () => {
    const docId = await createDocument("gate permite test.");
    await insertPendingChunk(docId, "gate permite test.");
    const { provider } = makeMockProvider();

    const res = await repairExternalDocumentEmbeddings(prisma, provider, {
      documentId: docId,
      apply: true,
    });
    expect(res.status).toBe("success");
    expect(res.postAudit.allValid).toBe(true);
  });
});
