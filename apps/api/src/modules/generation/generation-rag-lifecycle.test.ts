import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { computeDocumentContentHash } from "../external-research/external-ingest.js";
import { computeChunkContentHash } from "../external-research/external-chunking.js";
import { COHERE_DIMENSIONS } from "../external-research/external-embedding-provider.js";
import { EXTERNAL_RETRIEVAL_RULE } from "../external-research/external-retrieval.js";
import type { EmbeddingProviderWithInputType } from "../external-research/external-embedding-store.js";
import {
  materializeConversationRag,
  type MaterializeResult,
} from "../external-research/conversation-rag-materialization.js";
import {
  computeRagQueryHash,
  computeConversationRagFrameKey,
  computeConversationRagSnapshotKey,
  type ConversationRagFrameIdentityInput,
} from "../external-research/conversation-rag.js";
import { readConversationRag } from "../context/conversation-rag-read.js";

// ---------------------------------------------------------------------------
// Fase 13 STEP 24 — RAG Snapshot Lifecycle & Freshness.
//
// Fecha o ciclo de vida do ConversationRagSnapshot usando o pipeline REAL:
//   materializeConversationRag (STEP 17/20) → readConversationRag (STEP 18) →
//   /craft + resolveGenerationRagContext (STEP 22/23).
// Nada é reimplementado: frameKey/snapshotKey/freshnessAnchor existentes são
// REUTILIZADOS; a invalidação NUNCA recorre a fallback/refresh automático;
// read/generation permanecem read-only.
//
// Provider SEMPRE mock (nunca Cohere/HTTP real).
// ---------------------------------------------------------------------------

type TestUser = { cookie: string; userId: string };

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];
const createdSourceIds: string[] = [];
const createdDocumentIds: string[] = [];
const createdChunkIds: string[] = [];

let app: FastifyInstance;
let counter = 0;

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

function mockProvider(): EmbeddingProviderWithInputType {
  return {
    name: "mock",
    model: "mock-model",
    version: "mock-v",
    dimensions: COHERE_DIMENSIONS,
    async embed(): Promise<number[]> {
      return QUERY_VECTOR;
    },
  };
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

async function createUserViaApi(email: string, name: string): Promise<TestUser> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name, email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  createdUserIds.push(user.id);
  return { cookie, userId: user.id };
}

async function newOwner(prefix: string): Promise<TestUser> {
  counter += 1;
  return createUserViaApi(
    `${prefix}-${counter}-${Date.now()}-${Math.random()}@x.com`,
    "GenRag24",
  );
}

async function newCharacter(ownerId: string): Promise<string> {
  const character = await prisma.character.create({
    data: {
      name: "Char24",
      nationality: "BR",
      birthDate: new Date("1995-01-01"),
      controlledBy: "USER",
      userId: ownerId,
    },
  });
  createdCharacterIds.push(character.id);
  return character.id;
}

async function newConversationWithParticipant(characterId: string): Promise<string> {
  const conversation = await prisma.conversation.create({ data: { type: "DM" } });
  createdConversationIds.push(conversation.id);
  await prisma.conversationParticipant.create({
    data: { conversationId: conversation.id, characterId },
  });
  return conversation.id;
}

async function newPrivateSource(ownerId: string): Promise<string> {
  const source = await prisma.externalSource.create({
    data: {
      url: `https://gen-rag24.test/${counter}/${Date.now()}/${Math.random()}`,
      title: "src",
      visibility: "PRIVATE",
      ownerId,
    },
  });
  createdSourceIds.push(source.id);
  return source.id;
}

async function newDocument(sourceId: string): Promise<string> {
  const doc = await prisma.externalDocument.create({
    data: {
      sourceId,
      title: "doc",
      content: "conteúdo",
      contentHash: computeDocumentContentHash("conteúdo"),
      status: "READY",
    },
  });
  createdDocumentIds.push(doc.id);
  return doc.id;
}

async function newChunkWithVector(documentId: string, text: string, score: number): Promise<string> {
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
  createdChunkIds.push(chunk.id);
  await prisma.$executeRawUnsafe(
    'UPDATE "ExternalChunk" SET "embedding" = $1::vector(1024) WHERE "id" = $2::uuid',
    vectorLiteral(chunkVectorForScore(score)),
    chunk.id,
  );
  return chunk.id;
}

type Fixture = {
  cookie: string;
  userId: string;
  sourceId: string;
  documentId: string;
  conversationId: string;
};

async function isolatedFixture(prefix: string): Promise<Fixture> {
  counter += 1;
  const owner = await newOwner(prefix);
  const characterId = await newCharacter(owner.userId);
  const conversationId = await newConversationWithParticipant(characterId);
  const sourceId = await newPrivateSource(owner.userId);
  const documentId = await newDocument(sourceId);
  return {
    cookie: owner.cookie,
    userId: owner.userId,
    sourceId,
    documentId,
    conversationId,
  };
}

function frameDefaults() {
  return {
    topK: 5,
    threshold: 0.5,
    provider: "cohere",
    model: "embed-multilingual-v3.0",
    version: "v3.0",
    dimensions: COHERE_DIMENSIONS,
    ruleApplied: EXTERNAL_RETRIEVAL_RULE,
  };
}

async function materialize(
  fixture: Fixture,
  frame: { query: string; scopeSourceIds?: unknown; topK?: number; threshold?: number },
): Promise<MaterializeResult> {
  return materializeConversationRag(prisma, mockProvider(), {
    conversationId: fixture.conversationId,
    ownerId: fixture.userId,
    frame,
  });
}

async function frameKeyOf(frameId: string): Promise<string> {
  const row = await prisma.conversationRagFrame.findUniqueOrThrow({
    where: { id: frameId },
    select: { frameKey: true },
  });
  return row.frameKey;
}

async function craft(
  cookie: string,
  conversationId: string,
  ragFrameId?: string,
) {
  const url = ragFrameId
    ? `/api/conversations/${conversationId}/craft?ragFrameId=${ragFrameId}`
    : `/api/conversations/${conversationId}/craft`;
  return app.inject({ method: "GET", url, headers: { cookie } });
}

async function baselineKey(cookie: string, conversationId: string): Promise<string> {
  const res = await craft(cookie, conversationId);
  return res.json().generation.generationKey;
}

afterAll(async () => {
  if (app) await app.close();
  await prisma.conversationRagSnapshotItem.deleteMany({
    where: { snapshot: { frame: { conversationId: { in: createdConversationIds } } } },
  });
  await prisma.conversationRagSnapshot.deleteMany({
    where: { frame: { conversationId: { in: createdConversationIds } } },
  });
  await prisma.conversationRagFrame.deleteMany({
    where: { conversationId: { in: createdConversationIds } },
  });
  await prisma.conversationRagFrame.deleteMany({
    where: { conversationId: { in: createdConversationIds } },
  });
  await prisma.conversationParticipant.deleteMany({
    where: { conversationId: { in: createdConversationIds } },
  });
  await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  await prisma.externalChunk.deleteMany({ where: { id: { in: createdChunkIds } } });
  await prisma.externalDocument.deleteMany({ where: { id: { in: createdDocumentIds } } });
  await prisma.externalSource.deleteMany({ where: { id: { in: createdSourceIds } } });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

function frameCounts(conversationId: string) {
  return {
    frame: () => prisma.conversationRagFrame.count({ where: { conversationId } }),
    snapshot: () =>
      prisma.conversationRagSnapshot.count({ where: { frame: { conversationId } } }),
    item: () =>
      prisma.conversationRagSnapshotItem.count({ where: { snapshot: { frame: { conversationId } } } }),
  };
}

describe("FASE 13 STEP 24 — RAG Snapshot Lifecycle & Freshness", () => {
  it("A) snapshot CURRENT baseline — materialize → READY/CURRENT → read CURRENT → /craft usa EXTERNAL_CONTEXT", async () => {
    const fx = await isolatedFixture("s24-a");
    const chunkId = await newChunkWithVector(fx.documentId, "gp de monaco", 0.9);

    const m = await materialize(fx, { query: "gp de monaco" });
    expect(m.itemCount).toBe(1);
    expect(m.reused).toBe(false);

    const snap = await prisma.conversationRagSnapshot.findUniqueOrThrow({ where: { id: m.snapshotId } });
    expect(snap.status).toBe("READY");
    expect(snap.freshnessAnchor).toBe(m.freshnessAnchor);
    expect(computeConversationRagSnapshotKey(await frameKeyOf(m.frameId), m.freshnessAnchor)).toBe(m.snapshotKey);

    const read = await readConversationRag(prisma, fx.conversationId, fx.userId);
    expect(read.frames.length).toBe(1);
    expect(read.frames[0].freshness).toBe("CURRENT");
    expect(read.frames[0].externalRag).not.toBeNull();
    expect(read.frames[0].externalRag!.items[0].chunkId).toBe(chunkId);

    const baseKey = await baselineKey(fx.cookie, fx.conversationId);
    const res = await craft(fx.cookie, fx.conversationId, m.frameId);
    expect(res.statusCode).toBe(200);
    expect(res.json().generation.meta.provider).toBe("null");
    expect(res.json().generation.systemPrompt).toContain("<BEGIN 11:EXTERNAL_CONTEXT>");
    expect(res.json().generation.systemPrompt).toContain("<END 11:EXTERNAL_CONTEXT>");
    expect(res.json().generation.meta.tokens.contextBlocks).toBe(13);
    expect(res.json().generation.generationKey).not.toBe(baseKey);
    expect(res.json().generation.context.externalRag.items[0].chunkId).toBe(chunkId);
  });

  it("B) conteúdo alterado → snapshot deixa de CURRENT → read STALE → /craft sem EXTERNAL_CONTEXT antigo", async () => {
    const fx = await isolatedFixture("s24-b");
    const chunkId = await newChunkWithVector(fx.documentId, "v1", 0.9);
    const m = await materialize(fx, { query: "gp" });
    expect((await readConversationRag(prisma, fx.conversationId, fx.userId)).frames[0].freshness).toBe("CURRENT");

    const newHash = computeChunkContentHash("v2");
    await prisma.externalChunk.update({
      where: { id: chunkId },
      data: { text: "v2", contentHash: newHash, embeddedContentHash: newHash },
    });

    const read = await readConversationRag(prisma, fx.conversationId, fx.userId);
    expect(read.frames[0].freshness).toBe("STALE");

    const baseKey = await baselineKey(fx.cookie, fx.conversationId);
    const snapsBefore = await prisma.conversationRagSnapshot.count({ where: { frame: { conversationId: fx.conversationId } } });
    const res = await craft(fx.cookie, fx.conversationId, m.frameId);
    expect(res.statusCode).toBe(200);
    expect(res.json().generation.systemPrompt).not.toContain("EXTERNAL_CONTEXT");
    expect(res.json().generation.meta.tokens.contextBlocks).toBe(12);
    expect(res.json().generation.generationKey).toBe(baseKey);
    const snapsAfter = await prisma.conversationRagSnapshot.count({ where: { frame: { conversationId: fx.conversationId } } });
    expect(snapsAfter).toBe(snapsBefore);
  });

  it("C) embedding alterado (embeddedContentHash) → snapshot deixa de CURRENT → read STALE → /craft sem EXTERNAL_CONTEXT", async () => {
    const fx = await isolatedFixture("s24-c");
    const chunkId = await newChunkWithVector(fx.documentId, "embed a", 0.9);
    const m = await materialize(fx, { query: "gp" });
    expect((await readConversationRag(prisma, fx.conversationId, fx.userId)).frames[0].freshness).toBe("CURRENT");

    const another = computeChunkContentHash("outro-embedding");
    await prisma.externalChunk.update({
      where: { id: chunkId },
      data: { embeddedContentHash: another },
    });

    const read = await readConversationRag(prisma, fx.conversationId, fx.userId);
    expect(read.frames[0].freshness).toBe("STALE");

    const baseKey = await baselineKey(fx.cookie, fx.conversationId);
    const res = await craft(fx.cookie, fx.conversationId, m.frameId);
    expect(res.statusCode).toBe(200);
    expect(res.json().generation.systemPrompt).not.toContain("EXTERNAL_CONTEXT");
    expect(res.json().generation.meta.tokens.contextBlocks).toBe(12);
    expect(res.json().generation.generationKey).toBe(baseKey);
  });

  it("D) configuração alterada → frameKey diferente; configuração incompatível nunca vira o mesmo CURRENT", async () => {
    const base = computeConversationRagFrameKey({
      queryHash: computeRagQueryHash("gp"),
      ...frameDefaults(),
    });

    const variants: Array<{ label: string; patch: Partial<ConversationRagFrameIdentityInput> }> = [
      { label: "queryText", patch: { queryHash: computeRagQueryHash("gp diferente") } },
      { label: "topK", patch: { topK: 3 } },
      { label: "threshold", patch: { threshold: 0.7 } },
      { label: "provider", patch: { provider: "openai" } },
      { label: "model", patch: { model: "other-model" } },
      { label: "version", patch: { version: "v4" } },
      { label: "dimensions", patch: { dimensions: 768 } },
      { label: "ruleApplied", patch: { ruleApplied: "other-rule" } },
      { label: "scopeSourceIds", patch: { scopeSourceIds: ["11111111-1111-1111-1111-111111111111"] } },
    ];

    for (const v of variants) {
      const key = computeConversationRagFrameKey({
        queryHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        ...frameDefaults(),
        ...v.patch,
      });
      expect(key).not.toBe(base);
    }

    // Config diferentes → frames diferentes (nunca coexistir no mesmo CURRENT).
    const fx = await isolatedFixture("s24-d");
    await newChunkWithVector(fx.documentId, "gp de monaco", 0.9);
    const mA = await materialize(fx, { query: "gp de monaco" });
    const mB = await materialize(fx, { query: "gp de monaco", topK: 3 });
    expect(mA.frameId).not.toBe(mB.frameId);

    const read = await readConversationRag(prisma, fx.conversationId, fx.userId);
    expect(read.frames.length).toBe(2);
    const frameKeys = read.frames.map((f) => f.frameId);
    expect(frameKeys).toContain(mA.frameId);
    expect(frameKeys).toContain(mB.frameId);
    expect(read.frames.find((f) => f.frameId === mA.frameId)!.freshness).toBe("CURRENT");
    expect(read.frames.find((f) => f.frameId === mB.frameId)!.freshness).toBe("CURRENT");
  });

  it("E) STALE — read STALE + /craft baseline, sem refresh/materialization/retrieval automático", async () => {
    const fx = await isolatedFixture("s24-e");
    const chunkId = await newChunkWithVector(fx.documentId, "e1", 0.9);
    const m = await materialize(fx, { query: "gp" });

    const newHash = computeChunkContentHash("e2");
    await prisma.externalChunk.update({
      where: { id: chunkId },
      data: { text: "e2", contentHash: newHash, embeddedContentHash: newHash },
    });

    const baseKey = await baselineKey(fx.cookie, fx.conversationId);

    const before = frameCounts(fx.conversationId);
    const snapRowBefore = await prisma.conversationRagSnapshot.findUniqueOrThrow({ where: { id: m.snapshotId } });
    const read = await readConversationRag(prisma, fx.conversationId, fx.userId);
    expect(read.frames[0].freshness).toBe("STALE");
    expect(read.frames[0].externalRag).not.toBeNull();

    const res = await craft(fx.cookie, fx.conversationId, m.frameId);
    expect(res.statusCode).toBe(200);
    expect(res.json().generation.systemPrompt).not.toContain("EXTERNAL_CONTEXT");
    expect(res.json().generation.generationKey).toBe(baseKey);

    // nenhuma mutação: sem novo snapshot/materialização durante read+generation
    expect(await before.frame()).toBe(1);
    expect(await before.snapshot()).toBe(1);
    expect(await before.item()).toBe(1);
    const snapRowAfter = await prisma.conversationRagSnapshot.findUniqueOrThrow({ where: { id: m.snapshotId } });
    expect(snapRowAfter.freshnessAnchor).toBe(snapRowBefore.freshnessAnchor);
    expect(snapRowAfter.status).toBe("READY");
  });

  it("F) rematerialização após STALE → novo snapshot READY/CURRENT, antigo não usado", async () => {
    const fx = await isolatedFixture("s24-f");
    const chunkId = await newChunkWithVector(fx.documentId, "f-v1", 0.9);
    const m1 = await materialize(fx, { query: "gp" });
    expect((await readConversationRag(prisma, fx.conversationId, fx.userId)).frames[0].freshness).toBe("CURRENT");

    // torna stale (conteúdo muda)
    const newHash = computeChunkContentHash("f-v2");
    await prisma.externalChunk.update({
      where: { id: chunkId },
      data: { text: "f-v2", contentHash: newHash, embeddedContentHash: newHash },
    });
    expect((await readConversationRag(prisma, fx.conversationId, fx.userId)).frames[0].freshness).toBe("STALE");

    // rematerializa (mesmo frame config) → novo snapshot, reusa o mesmo frame
    const m2 = await materialize(fx, { query: "gp" });
    expect(m2.reused).toBe(false);
    expect(m2.frameId).toBe(m1.frameId);
    expect(m2.snapshotId).not.toBe(m1.snapshotId);
    expect(m2.freshnessAnchor).not.toBe(m1.freshnessAnchor);
    expect(m2.snapshotKey).not.toBe(m1.snapshotKey);

    const read = await readConversationRag(prisma, fx.conversationId, fx.userId);
    expect(read.frames.length).toBe(1);
    expect(read.frames[0].snapshotId).toBe(m2.snapshotId);
    expect(read.frames[0].freshness).toBe("CURRENT");
    expect(read.frames[0].externalRag!.items[0].content).toBe("f-v2");

    const snapCount = await prisma.conversationRagSnapshot.count({ where: { frame: { conversationId: fx.conversationId } } });
    expect(snapCount).toBe(2); // histórico preservado, mas apenas o novo é CURRENT
  });

  it("G) idempotência — duas materializações idênticas → mesmo frame/snapshot, sem duplicatas, reused", async () => {
    const fx = await isolatedFixture("s24-g");
    await newChunkWithVector(fx.documentId, "gp de monaco", 0.9);

    const m1 = await materialize(fx, { query: "gp de monaco" });
    const m2 = await materialize(fx, { query: "gp de monaco" });
    expect(m2.reused).toBe(true);
    expect(m2.frameId).toBe(m1.frameId);
    expect(m2.snapshotId).toBe(m1.snapshotId);
    expect(m2.snapshotKey).toBe(m1.snapshotKey);
    expect(m2.freshnessAnchor).toBe(m1.freshnessAnchor);

    const c = frameCounts(fx.conversationId);
    expect(await c.frame()).toBe(1);
    expect(await c.snapshot()).toBe(1);
    expect(await c.item()).toBe(1);
  });

  it("H) chave determinística — mesmo estado semântico → snapshotKey estável; estado diferente → muda", async () => {
    // Pure (helper reutilizado, não reinventado): mesmo par (frameKey, anchor) →
    // sempre o mesmo snapshotKey; pares diferentes → chaves diferentes.
    const fkA = computeConversationRagFrameKey({
      queryHash: computeRagQueryHash("gp"),
      ...frameDefaults(),
    });
    const fkB = computeConversationRagFrameKey({
      queryHash: computeRagQueryHash("gp outra"),
      ...frameDefaults(),
    });
    const anchorA = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const anchorB = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    expect(computeConversationRagSnapshotKey(fkA, anchorA)).toBe(computeConversationRagSnapshotKey(fkA, anchorA));
    expect(computeConversationRagSnapshotKey(fkA, anchorA)).not.toBe(computeConversationRagSnapshotKey(fkB, anchorA));
    expect(computeConversationRagSnapshotKey(fkA, anchorA)).not.toBe(computeConversationRagSnapshotKey(fkA, anchorB));

    // Via pipeline real (mesma conversation, mesmo frame): conteúdo alterado muda
    // anchor/key; materialização idêntica mantém key (consistente com G).
    const fx = await isolatedFixture("s24-h");
    const chunkId = await newChunkWithVector(fx.documentId, "h1", 0.9);
    const m1 = await materialize(fx, { query: "gp" });
    expect(computeConversationRagSnapshotKey(await frameKeyOf(m1.frameId), m1.freshnessAnchor)).toBe(m1.snapshotKey);

    const newHash = computeChunkContentHash("h2");
    await prisma.externalChunk.update({
      where: { id: chunkId },
      data: { text: "h2", contentHash: newHash, embeddedContentHash: newHash },
    });
    const m2 = await materialize(fx, { query: "gp" });
    expect(m2.freshnessAnchor).not.toBe(m1.freshnessAnchor);
    expect(m2.snapshotKey).not.toBe(m1.snapshotKey);
    expect(computeConversationRagSnapshotKey(await frameKeyOf(m2.frameId), m2.freshnessAnchor)).toBe(m2.snapshotKey);
  });

  it("I) CURRENT único — read escolhe o snapshot READY mais recente; STALE antigo não vence; sem ambiguidade", async () => {
    const fx = await isolatedFixture("s24-i");
    const chunkId = await newChunkWithVector(fx.documentId, "i-v1", 0.9);
    const m1 = await materialize(fx, { query: "gp" });

    // v2 → m1 fica STALE, rematerializa → novo READY (mais recente) CURRENT
    const newHash = computeChunkContentHash("i-v2");
    await prisma.externalChunk.update({
      where: { id: chunkId },
      data: { text: "i-v2", contentHash: newHash, embeddedContentHash: newHash },
    });
    const m2 = await materialize(fx, { query: "gp" });
    expect(m2.snapshotId).not.toBe(m1.snapshotId);

    const read = await readConversationRag(prisma, fx.conversationId, fx.userId);
    // único frame; read seleciona o READY mais recente (m2) e o avalia
    expect(read.frames.length).toBe(1);
    expect(read.frames[0].snapshotId).toBe(m2.snapshotId);
    expect(read.frames[0].freshness).toBe("CURRENT");
    expect(read.frames[0].externalRag!.items[0].content).toBe("i-v2");

    // m1 (STALE) não é reportado como CURRENT nem causa ambiguidade
    const snapshots = await prisma.conversationRagSnapshot.findMany({
      where: { frame: { conversationId: fx.conversationId } },
    });
    expect(snapshots.some((s) => s.id === m2.snapshotId && s.status === "READY")).toBe(true);
    expect(snapshots.length).toBe(2);
  });

  it("J) integração com generation — CURRENT→EXTERNAL_CONTEXT → STALE→baseline → rematerializar→novo EXTERNAL_CONTEXT (sem vazamento)", async () => {
    const fx = await isolatedFixture("s24-j");
    const chunkId = await newChunkWithVector(fx.documentId, "j-v1", 0.9);
    const m1 = await materialize(fx, { query: "gp" });
    const baseKey = await baselineKey(fx.cookie, fx.conversationId);

    // 1) CURRENT → EXTERNAL_CONTEXT
    const r1 = await craft(fx.cookie, fx.conversationId, m1.frameId);
    expect(r1.json().generation.systemPrompt).toContain("EXTERNAL_CONTEXT");
    expect(r1.json().generation.generationKey).not.toBe(baseKey);

    // 2) STALE → mesmo /craft → sem EXTERNAL_CONTEXT (baseline)
    const newHash = computeChunkContentHash("j-v2");
    await prisma.externalChunk.update({
      where: { id: chunkId },
      data: { text: "j-v2", contentHash: newHash, embeddedContentHash: newHash },
    });
    const r2 = await craft(fx.cookie, fx.conversationId, m1.frameId);
    expect(r2.statusCode).toBe(200);
    expect(r2.json().generation.systemPrompt).not.toContain("EXTERNAL_CONTEXT");
    expect(r2.json().generation.meta.tokens.contextBlocks).toBe(12);
    expect(r2.json().generation.generationKey).toBe(baseKey);

    // 3) rematerializa estado atualizado (mesmo frame) → novo EXTERNAL_CONTEXT (v2)
    const m2 = await materialize(fx, { query: "gp" });
    expect(m2.frameId).toBe(m1.frameId);
    const r3 = await craft(fx.cookie, fx.conversationId, m2.frameId);
    expect(r3.statusCode).toBe(200);
    expect(r3.json().generation.systemPrompt).toContain("EXTERNAL_CONTEXT");
    expect(r3.json().generation.meta.tokens.contextBlocks).toBe(13);
    const items = r3.json().generation.context.externalRag.items;
    expect(items.length).toBe(1);
    expect(items[0].content).toBe("j-v2");
    expect(r3.json().generation.generationKey).not.toBe(baseKey);
    // dados antigos não vazam
    const body = JSON.stringify(r3.json());
    expect(body).not.toContain("j-v1");
  });

  it("K) read-only — readConversationRag não muta frames/snapshots/items e não dispara provider/retrieval/materialization", async () => {
    const fx = await isolatedFixture("s24-k");
    await newChunkWithVector(fx.documentId, "k1", 0.9);
    const m = await materialize(fx, { query: "gp" });

    const counts = {
      frame: await prisma.conversationRagFrame.count({ where: { conversationId: fx.conversationId } }),
      snapshot: await prisma.conversationRagSnapshot.count({ where: { frame: { conversationId: fx.conversationId } } }),
      item: await prisma.conversationRagSnapshotItem.count({ where: { snapshot: { frame: { conversationId: fx.conversationId } } } }),
      src: await prisma.externalSource.count(),
      doc: await prisma.externalDocument.count(),
      chunk: await prisma.externalChunk.count(),
    };

    const read = await readConversationRag(prisma, fx.conversationId, fx.userId);
    expect(read.frames[0].freshness).toBe("CURRENT");

    const res = await craft(fx.cookie, fx.conversationId, m.frameId);
    expect(res.statusCode).toBe(200);
    expect(res.json().generation.meta.provider).toBe("null");

    expect(await prisma.conversationRagFrame.count({ where: { conversationId: fx.conversationId } })).toBe(counts.frame);
    expect(await prisma.conversationRagSnapshot.count({ where: { frame: { conversationId: fx.conversationId } } })).toBe(counts.snapshot);
    expect(await prisma.conversationRagSnapshotItem.count({ where: { snapshot: { frame: { conversationId: fx.conversationId } } } })).toBe(counts.item);
    expect(await prisma.externalSource.count()).toBe(counts.src);
    expect(await prisma.externalDocument.count()).toBe(counts.doc);
    expect(await prisma.externalChunk.count()).toBe(counts.chunk);
  });

  it("L) segurança — lifecycle não vaza vector/embedding/secrets/outro-owner/outra-conversation", async () => {
    const fx = await isolatedFixture("s24-l");
    await newChunkWithVector(fx.documentId, "gp de monaco", 0.9);
    const m = await materialize(fx, { query: "gp" });

    // materialize + craft responses sem vector/embedding/secrets
    const res = await craft(fx.cookie, fx.conversationId, m.frameId);
    expect(res.statusCode).toBe(200);
    const body = JSON.stringify(res.json());
    expect(body).not.toMatch(/"embedding"/i);
    expect(body).not.toMatch(/"vector"/i);
    expect(body).not.toMatch(/"embeddedContentHash"/i);
    expect(body).not.toMatch(/api[-_ ]?key/i);
    expect(body).not.toMatch(/bearer/i);
    expect(body).not.toMatch(/authorization/i);
    expect(body).not.toMatch(/secret/i);
    expect(body).not.toMatch(/access[_-]?token/i);
    expect(body).not.toMatch(/refresh[_-]?token/i);
    expect(body).not.toMatch(/senha/i);

    // conversa de outro owner/sem participação → readConversationRag lança acesso negado
    const intruder = await newOwner("s24-intruder");
    await expect(
      readConversationRag(prisma, fx.conversationId, intruder.userId),
    ).rejects.toThrow();
  });
});
