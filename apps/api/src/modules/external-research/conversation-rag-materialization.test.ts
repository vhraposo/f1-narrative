import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import { type EmbeddingProviderWithInputType } from "./external-embedding-store.js";
import { computeDocumentContentHash } from "./external-ingest.js";
import { computeChunkContentHash } from "./external-chunking.js";
import { COHERE_DIMENSIONS } from "./external-embedding-provider.js";
import {
  ConversationRagAccessError,
  materializeConversationRag,
  resolveConversationRagFrame,
} from "./conversation-rag-materialization.js";

// ---------------------------------------------------------------------------
// Materialização de RAG por Conversation (Fase 13 STEP 17). Provider SEMPRE
// mock; NUNCA chamamos Cohere/HTTP. Vetores MOCK (1024 dims) com cosseno
// conhecido (score = 1 - distance, calculado pelo pgvector).
//
// ISOLAMENTO: cada cenário cria PRÓPRIO owner + source PRIVATE + Conversation,
// de modo que retrieval/ownership são verificados sem interferência.
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

function chunkVectorForScore(score: number): number[] {
  return basisVector(score, Math.sqrt(Math.max(0, 1 - score * score)));
}

function vectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

function mockProvider(recorder?: { queries: string[] }): EmbeddingProviderWithInputType {
  return {
    name: "mock",
    model: "mock-model",
    version: "mock-v",
    dimensions: COHERE_DIMENSIONS,
    async embed(input: string): Promise<number[]> {
      recorder?.queries.push(input);
      return QUERY_VECTOR;
    },
  };
}

// Tolerância float32 do pgvector.
const SCORE_PRECISION = 6;

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];
const createdSourceIds: string[] = [];
const createdDocumentIds: string[] = [];

function track<T extends { id: string }>(list: string[], entity: T): T {
  list.push(entity.id);
  return entity;
}

let counter = 0;

async function newOwner(prefix: string): Promise<string> {
  counter += 1;
  return track(
    createdUserIds,
    await prisma.user.create({
      data: { name: "Rag", email: `${prefix}-${counter}-${Date.now()}-${Math.random()}@x.com` },
    }),
  ).id;
}

async function newCharacter(ownerId: string): Promise<string> {
  return track(
    createdCharacterIds,
    await prisma.character.create({
      data: {
        name: "Char",
        nationality: "BR",
        birthDate: new Date("1995-01-01"),
        controlledBy: "USER",
        userId: ownerId,
      },
    }),
  ).id;
}

async function newConversationWithParticipant(
  characterId: string,
): Promise<{ conversationId: string }> {
  const conversationId = track(
    createdConversationIds,
    await prisma.conversation.create({ data: { type: "DM" } }),
  ).id;
  await prisma.conversationParticipant.create({
    data: { conversationId, characterId },
  });
  return { conversationId };
}

async function newPrivateSource(ownerId: string): Promise<string> {
  return track(
    createdSourceIds,
    await prisma.externalSource.create({
      data: {
        url: `https://rag.test/${counter}/${Date.now()}/${Math.random()}`,
        title: "src",
        visibility: "PRIVATE",
        ownerId,
      },
    }),
  ).id;
}

async function newDocument(sourceId: string): Promise<string> {
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

async function insertScoredChunk(documentId: string, text: string, score: number): Promise<string> {
  const count = await prisma.externalChunk.count({ where: { documentId } });
  const contentHash = computeChunkContentHash(text);
  const chunk = await prisma.externalChunk.create({
    data: {
      documentId,
      text,
      orderOriginal: count,
      contentHash,
      embeddedContentHash: contentHash,
      embeddingProvider: "cohere",
      embeddingModel: "embed-multilingual-v3.0",
      embeddingVersion: "v3.0",
      embeddingDimensions: COHERE_DIMENSIONS,
    },
  });
  await prisma.$executeRawUnsafe(
    'UPDATE "ExternalChunk" SET "embedding" = $1::vector(1024) WHERE "id" = $2::uuid',
    vectorLiteral(chunkVectorForScore(score)),
    chunk.id,
  );
  return chunk.id;
}

type Fixture = {
  ownerId: string;
  characterId: string;
  conversationId: string;
  sourceId: string;
  documentId: string;
};

/** Monta owner + character + conversation(participant) + source/document isolados. */
async function isolatedFixture(prefix: string): Promise<Fixture> {
  const ownerId = await newOwner(prefix);
  const characterId = await newCharacter(ownerId);
  const { conversationId } = await newConversationWithParticipant(characterId);
  const sourceId = await newPrivateSource(ownerId);
  const documentId = await newDocument(sourceId);
  return { ownerId, characterId, conversationId, sourceId, documentId };
}

afterAll(async () => {
  // Ordem segura com ON DELETE RESTRICT do SnapshotItem → ExternalChunk:
  // remove as linhas RAG (via cascade do Conversation) ANTES dos chunks/sources.
  await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  await prisma.externalDocument.deleteMany({ where: { id: { in: createdDocumentIds } } });
  await prisma.externalSource.deleteMany({ where: { id: { in: createdSourceIds } } });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("conversation-rag — materialização (A-Z)", () => {
  it("A) owner autorizado materializa e eleva snapshot a READY", async () => {
    const fx = await isolatedFixture("a");
    await insertScoredChunk(fx.documentId, "gp de monaco", 0.9);

    const res = await materializeConversationRag(prisma, mockProvider(), {
      conversationId: fx.conversationId,
      ownerId: fx.ownerId,
      frame: { query: "mônaco gp" },
    });

    expect(res.itemCount).toBe(1);
    expect(res.reused).toBe(false);
    const snapshot = await prisma.conversationRagSnapshot.findUnique({
      where: { id: res.snapshotId },
      include: { frame: true, items: true },
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot!.status).toBe("READY");
    expect(snapshot!.frame.conversationId).toBe(fx.conversationId);
    expect(snapshot!.items).toHaveLength(1);
  });

  it("B) conversation inacessível (não-participante) → ConversationRagAccessError", async () => {
    const owner = await newOwner("b");
    const otherConversationId = track(
      createdConversationIds,
      await prisma.conversation.create({ data: { type: "DM" } }),
    ).id;
    await expect(
      materializeConversationRag(prisma, mockProvider(), {
        conversationId: otherConversationId,
        ownerId: owner,
        frame: { query: "consulta" },
      }),
    ).rejects.toBeInstanceOf(ConversationRagAccessError);
  });

  it("C) intruder (conversation de outro usuário) → rejeitado sem vazar", async () => {
    const fx = await isolatedFixture("c");
    const intruder = await newOwner("c-intruder");
    await expect(
      materializeConversationRag(prisma, mockProvider(), {
        conversationId: fx.conversationId,
        ownerId: intruder,
        frame: { query: "consulta" },
      }),
    ).rejects.toBeInstanceOf(ConversationRagAccessError);
  });

  it("D) retrieval é chamado com a query correta (query text, não conversation)", async () => {
    const fx = await isolatedFixture("d");
    await insertScoredChunk(fx.documentId, "relevante", 0.9);
    const recorder = { queries: [] as string[] };

    await materializeConversationRag(prisma, mockProvider(recorder), {
      conversationId: fx.conversationId,
      ownerId: fx.ownerId,
      frame: { query: "sprint sábado" },
    });

    expect(recorder.queries).toContain("sprint sábado");
  });

  it("G/H/I/J/K/L/M/N) snapshot READY com items e score/distance/order/citation/provenance", async () => {
    const fx = await isolatedFixture("g");
    const high = await insertScoredChunk(fx.documentId, "alto", 0.9);
    const low = await insertScoredChunk(fx.documentId, "baixo", 0.8);

    const res = await materializeConversationRag(prisma, mockProvider(), {
      conversationId: fx.conversationId,
      ownerId: fx.ownerId,
      frame: { query: "consulta", topK: 5, threshold: 0.5 },
    });

    expect(res.itemCount).toBe(2);
    const items = await prisma.conversationRagSnapshotItem.findMany({
      where: { snapshotId: res.snapshotId },
      orderBy: { order: "asc" },
    });
    expect(items).toHaveLength(2);
    const [first, second] = items;
    expect(first.chunkId).toBe(high);
    expect(second.chunkId).toBe(low);
    expect(first.order).toBe(0);
    expect(second.order).toBe(1);
    expect(first.score).toBeCloseTo(0.9, SCORE_PRECISION);
    expect(second.score).toBeCloseTo(0.8, SCORE_PRECISION);
    expect(first.distance).toBeCloseTo(1 - 0.9, SCORE_PRECISION);
    expect(first.citation.trim().length).toBeGreaterThan(0);

    // provenance reconstruída:
    expect(res.context.items[0]).toMatchObject({
      sourceId: fx.sourceId,
      documentId: fx.documentId,
      chunkId: high,
      score: first.score,
    });
  });

  it("O/R) idempotência/duplicate prevention: mesma materialização reusa snapshot", async () => {
    const fx = await isolatedFixture("o");
    await insertScoredChunk(fx.documentId, "relevante", 0.9);

    const input = {
      conversationId: fx.conversationId,
      ownerId: fx.ownerId,
      frame: { query: "mesma consulta" },
    };
    const a = await materializeConversationRag(prisma, mockProvider(), input);
    const b = await materializeConversationRag(prisma, mockProvider(), input);

    expect(a.reused).toBe(false);
    expect(b.reused).toBe(true);
    expect(b.snapshotId).toBe(a.snapshotId);
    const count = await prisma.conversationRagSnapshot.count({
      where: { frame: { conversationId: fx.conversationId } },
    });
    expect(count).toBe(1);
  });

  it("P/Q) snapshotKey e freshnessAnchor determinísticos", async () => {
    const fx = await isolatedFixture("p");
    await insertScoredChunk(fx.documentId, "relevante", 0.9);

    const input = {
      conversationId: fx.conversationId,
      ownerId: fx.ownerId,
      frame: { query: "determinístico" },
    };
    const a = await materializeConversationRag(prisma, mockProvider(), input);
    const b = await materializeConversationRag(prisma, mockProvider(), input);

    expect(b.snapshotKey).toBe(a.snapshotKey);
    expect(b.freshnessAnchor).toBe(a.freshnessAnchor);
  });

  it("S) failed materialization registra FAILED (sem provider real)", async () => {
    const fx = await isolatedFixture("s");
    await insertScoredChunk(fx.documentId, "relevante", 0.9);

    const failingProvider: EmbeddingProviderWithInputType = {
      name: "mock-fail",
      model: "mock-model",
      version: "mock-v",
      dimensions: COHERE_DIMENSIONS,
      async embed(): Promise<number[]> {
        throw new Error("provider fora do ar");
      },
    };

    await expect(
      materializeConversationRag(prisma, failingProvider, {
        conversationId: fx.conversationId,
        ownerId: fx.ownerId,
        frame: { query: "consulta" },
      }),
    ).rejects.toThrow(/provider fora do ar/);

    const anyFailed = await prisma.conversationRagSnapshot.count({
      where: { frame: { conversationId: fx.conversationId }, status: "FAILED" },
    });
    expect(anyFailed).toBeGreaterThanOrEqual(1);
  });

  it("T) reconstruction preserva o contrato neutro (sem vector/secrets)", async () => {
    const fx = await isolatedFixture("t");
    await insertScoredChunk(fx.documentId, "relevante", 0.9);

    const res = await materializeConversationRag(prisma, mockProvider(), {
      conversationId: fx.conversationId,
      ownerId: fx.ownerId,
      frame: { query: "reconstruir" },
    });

    const json = JSON.stringify(res.context);
    expect(res.context.items[0]).not.toHaveProperty("embedding");
    expect(res.context.items[0]).not.toHaveProperty("vector");
    expect(json).not.toMatch(/apiKey|bearer|Authorization|secret|token/i);
    expect(res.context.sourceType).toBe("external");
  });

  it("U) não duplica content: item guarda só referência chunkId", async () => {
    const fx = await isolatedFixture("u");
    await insertScoredChunk(fx.documentId, "conteúdo longo", 0.9);

    const res = await materializeConversationRag(prisma, mockProvider(), {
      conversationId: fx.conversationId,
      ownerId: fx.ownerId,
      frame: { query: "consulta" },
    });

    const item = await prisma.conversationRagSnapshotItem.findFirst({
      where: { snapshotId: res.snapshotId },
    });
    expect(item).not.toBeNull();
    expect(item!.chunkId.length).toBeGreaterThan(0);
    // item não contém coluna de texto duplicada — verificação da shape DB:
    expect(Object.prototype.hasOwnProperty.call(item, "text")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(item, "embedding")).toBe(false);
  });

  it("W) empty retrieval → snapshot READY sem items", async () => {
    const fx = await isolatedFixture("w");
    // sem chunk com score acima do threshold
    await insertScoredChunk(fx.documentId, "ortogonal", 0.1);

    const res = await materializeConversationRag(prisma, mockProvider(), {
      conversationId: fx.conversationId,
      ownerId: fx.ownerId,
      frame: { query: "consulta", threshold: 0.5 },
    });

    expect(res.itemCount).toBe(0);
    const items = await prisma.conversationRagSnapshotItem.count({
      where: { snapshotId: res.snapshotId },
    });
    expect(items).toBe(0);
  });

  it("X) multiple chunks preserva ordenação por score", async () => {
    const fx = await isolatedFixture("x");
    await insertScoredChunk(fx.documentId, "a", 0.6);
    await insertScoredChunk(fx.documentId, "b", 0.95);
    await insertScoredChunk(fx.documentId, "c", 0.7);

    const res = await materializeConversationRag(prisma, mockProvider(), {
      conversationId: fx.conversationId,
      ownerId: fx.ownerId,
      frame: { query: "consulta", topK: 3, threshold: 0 },
    });

    expect(res.itemCount).toBe(3);
    const scores = res.context.items.map((i) => i.score);
    expect(scores[0]).toBeCloseTo(0.95, SCORE_PRECISION);
    expect(scores[1]).toBeCloseTo(0.7, SCORE_PRECISION);
    expect(scores[2]).toBeCloseTo(0.6, SCORE_PRECISION);
  });

  it("Y) conteúdo alterado → nova freshnessAnchor (novo snapshot, não reusa)", async () => {
    const fx = await isolatedFixture("y");
    const chunkId = await insertScoredChunk(fx.documentId, "versão 1", 0.9);

    const first = await materializeConversationRag(prisma, mockProvider(), {
      conversationId: fx.conversationId,
      ownerId: fx.ownerId,
      frame: { query: "freshness" },
    });

    // altera o conteúdo do chunk (mesmo chunk, novo contentHash/embedding)
    const contentHash = computeChunkContentHash("versão 2");
    await prisma.externalChunk.update({
      where: { id: chunkId },
      data: {
        text: "versão 2",
        contentHash,
        embeddedContentHash: contentHash,
      },
    });

    const second = await materializeConversationRag(prisma, mockProvider(), {
      conversationId: fx.conversationId,
      ownerId: fx.ownerId,
      frame: { query: "freshness" },
    });

    expect(second.snapshotId).not.toBe(first.snapshotId);
    expect(second.reused).toBe(false);
    expect(second.freshnessAnchor).not.toBe(first.freshnessAnchor);
  });

  it("AA) query diferentes → frames diferentes", async () => {
    const fx = await isolatedFixture("aa");
    await insertScoredChunk(fx.documentId, "relevante", 0.9);

    const input = { conversationId: fx.conversationId, ownerId: fx.ownerId };
    await materializeConversationRag(prisma, mockProvider(), { ...input, frame: { query: "query um" } });
    const resolved = resolveConversationRagFrame(fx.conversationId, { query: "query dois" });
    expect(resolved.frameKey).not.toBe(
      resolveConversationRagFrame(fx.conversationId, { query: "query um" }).frameKey,
    );
  });

  it("AB) threshold/topK diferentes → identidade diferente", async () => {
    const fx = await isolatedFixture("ab");
    await insertScoredChunk(fx.documentId, "relevante", 0.9);

    const a = resolveConversationRagFrame(fx.conversationId, { query: "q", topK: 5, threshold: 0.5 });
    const b = resolveConversationRagFrame(fx.conversationId, { query: "q", topK: 10, threshold: 0.5 });
    const c = resolveConversationRagFrame(fx.conversationId, { query: "q", topK: 5, threshold: 0.8 });
    expect(b.frameKey).not.toBe(a.frameKey);
    expect(c.frameKey).not.toBe(a.frameKey);
  });
});
