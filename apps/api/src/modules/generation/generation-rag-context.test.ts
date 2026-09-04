import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { computeDocumentContentHash } from "../external-research/external-ingest.js";
import { computeChunkContentHash } from "../external-research/external-chunking.js";
import { COHERE_DIMENSIONS } from "../external-research/external-embedding-provider.js";
import { EXTERNAL_RETRIEVAL_RULE } from "../external-research/external-retrieval.js";
import {
  computeRagQueryHash,
  computeConversationRagFrameKey,
  computeConversationRagFreshnessAnchor,
} from "../external-research/conversation-rag.js";
import {
  generateGeneration,
  GENERATION_RULE,
} from "./generation.assembly.js";
import {
  resolveGenerationRagContext,
  GenerationRagFrameNotFoundError,
  GENERATION_RAG_CONTEXT_RULE,
} from "./generation-rag-context.js";

// ---------------------------------------------------------------------------
// Fase 13 STEP 22 — Seleção EXPLÍCITA de RAG por `ragFrameId` na geração.
//
// O fluxo sob teste: generateGeneration(request com ragFrameId) →
// readConversationRag (ownership + read) → resolveGenerationRagContext (pure
// selection) → withExternalRag → composeSystemPrompt → NullProvider →
// generationKey.
//
// Provider SEMPRE nullProvider; NENHUM retrieval/materialization/provider.
// Fixtures criadas direto via prisma (controle total de frame/snapshot/item).
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

async function newOwner(prefix: string): Promise<string> {
  counter += 1;
  const user = await prisma.user.create({
    data: { name: "GenRag", email: `${prefix}-${counter}-${Date.now()}-${Math.random()}@x.com` },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function newCharacter(ownerId: string): Promise<string> {
  const character = await prisma.character.create({
    data: {
      name: "Char",
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
      url: `https://gen-rag.test/${counter}/${Date.now()}/${Math.random()}`,
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

async function newChunk(documentId: string, text: string): Promise<string> {
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
  return chunk.id;
}

type Fixture = {
  ownerId: string;
  characterId: string;
  conversationId: string;
  sourceId: string;
  documentId: string;
};

async function isolatedFixture(prefix: string): Promise<Fixture> {
  const ownerId = await newOwner(prefix);
  const characterId = await newCharacter(ownerId);
  const conversationId = await newConversationWithParticipant(characterId);
  const sourceId = await newPrivateSource(ownerId);
  const documentId = await newDocument(sourceId);
  return { ownerId, characterId, conversationId, sourceId, documentId };
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

async function createFrame(
  conversationId: string,
  query: string,
): Promise<{ id: string; frameKey: string }> {
  const queryHash = computeRagQueryHash(query);
  const frameKey = computeConversationRagFrameKey({ queryHash, ...frameDefaults() });
  const frame = await prisma.conversationRagFrame.create({
    data: {
      conversationId,
      queryText: query,
      queryHash,
      ...frameDefaults(),
      frameKey,
      status: "READY",
    },
  });
  return { id: frame.id, frameKey };
}

async function createSnapshot(
  frameId: string,
  chunkBindings: Array<{ chunkId: string; contentHash: string; embeddedContentHash: string | null }>,
): Promise<{ id: string }> {
  const frame = await prisma.conversationRagFrame.findUniqueOrThrow({ where: { id: frameId } });
  const freshnessAnchor = computeConversationRagFreshnessAnchor({
    frameKey: frame.frameKey,
    scopeSourceIds: frame.scopeSourceIds,
    topK: frame.topK,
    threshold: frame.threshold,
    provider: frame.provider,
    model: frame.model,
    version: frame.version,
    dimensions: frame.dimensions,
    ruleApplied: frame.ruleApplied,
    chunkBindings,
  });
  const snapshot = await prisma.conversationRagSnapshot.create({
    data: {
      frameId,
      snapshotKey: `${frame.frameKey}#${freshnessAnchor}`,
      status: "READY",
      retrievedAt: new Date(),
      freshnessAnchor,
    },
  });
  return { id: snapshot.id };
}

async function createItem(
  snapshotId: string,
  chunkId: string,
  score: number,
  distance: number,
  order: number,
  citation: string,
): Promise<void> {
  await prisma.conversationRagSnapshotItem.create({
    data: { snapshotId, chunkId, score, distance, order, citation },
  });
}

afterAll(async () => {
  if (app) await app.close();
  await prisma.conversationRagSnapshotItem.deleteMany({ where: { snapshot: { frame: { conversationId: { in: createdConversationIds } } } } });
  await prisma.conversationRagSnapshot.deleteMany({ where: { frame: { conversationId: { in: createdConversationIds } } } });
  await prisma.conversationRagFrame.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
  await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  await prisma.externalChunk.deleteMany({ where: { id: { in: createdChunkIds } } });
  await prisma.externalDocument.deleteMany({ where: { id: { in: createdDocumentIds } } });
  await prisma.externalSource.deleteMany({ where: { id: { in: createdSourceIds } } });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Helper puro: resolveGenerationRagContext (A–AB unit)
// ---------------------------------------------------------------------------

function mkReadResult(over: {
  conversationId?: string;
  frames?: Array<{ frameId: string; freshness: "CURRENT" | "STALE" | "NO_SNAPSHOT"; hasRag?: boolean }>;
}) {
  return {
    conversationId: over.conversationId ?? "00000000-0000-4000-8000-000000000001",
    frames: (over.frames ?? []).map((f) => ({
      frameId: f.frameId,
      snapshotId: null,
      freshness: f.freshness,
      externalRag: f.hasRag === true ? (mkRagStub() as never) : null,
    })),
  };
}

function mkRagStub() {
  return {
    sourceType: "external",
    provider: "cohere",
    model: "embed-multilingual-v3.0",
    version: "v3.0",
    dimensions: 1024,
    ruleApplied: "external-retrieval.v1",
    items: [{ chunkId: "c1" }],
  };
}

describe("resolveGenerationRagContext — seleção pura/determinística", () => {
  it("A) ragFrameId ausente (undefined) → null", () => {
    const r = mkReadResult({ frames: [{ frameId: "f1", freshness: "CURRENT", hasRag: true }] });
    expect(resolveGenerationRagContext(r, undefined)).toBeNull();
  });

  it("E) frameId inexistente → GenerationRagFrameNotFoundError (não vira sem RAG)", () => {
    const r = mkReadResult({ frames: [{ frameId: "f1", freshness: "CURRENT", hasRag: true }] });
    expect(() => resolveGenerationRagContext(r, "missing")).toThrow(GenerationRagFrameNotFoundError);
  });

  it("D) frame de outra conversation → GenerationRagFrameNotFoundError (não vaza)", () => {
    const r = mkReadResult({ conversationId: "convA", frames: [{ frameId: "fA", freshness: "CURRENT", hasRag: true }] });
    expect(() => resolveGenerationRagContext(r, "fB")).toThrow(GenerationRagFrameNotFoundError);
  });

  it("F) frame NO_SNAPSHOT → null", () => {
    const r = mkReadResult({ frames: [{ frameId: "f1", freshness: "NO_SNAPSHOT" }] });
    expect(resolveGenerationRagContext(r, "f1")).toBeNull();
  });

  it("G) frame STALE → null (não alimenta com RAG velho)", () => {
    const r = mkReadResult({ frames: [{ frameId: "f1", freshness: "STALE", hasRag: true }] });
    expect(resolveGenerationRagContext(r, "f1")).toBeNull();
  });

  it("F: CURRENT + externalRag null → null", () => {
    const r = mkReadResult({ frames: [{ frameId: "f1", freshness: "CURRENT", hasRag: false }] });
    expect(resolveGenerationRagContext(r, "f1")).toBeNull();
  });

  it("CURRENT + RAG → retorna o próprio ExternalRagContext", () => {
    const r = mkReadResult({ frames: [{ frameId: "f1", freshness: "CURRENT", hasRag: true }] });
    const out = resolveGenerationRagContext(r, "f1");
    expect(out).not.toBeNull();
    expect((out as { sourceType: string }).sourceType).toBe("external");
  });
});

// ---------------------------------------------------------------------------
// Integração: generateGeneration com ragFrameId (B–AB, DB real TEST)
// ---------------------------------------------------------------------------

describe("generateGeneration com ragFrameId — seleção explícita (Fase 13 STEP 22)", () => {
  it("A) sem ragFrameId → baseline: mesmo com frame CURRENT existente, sem EXTERNAL_CONTEXT e 12 seções", async () => {
    const fx = await isolatedFixture("a");
    const chunkId = await newChunk(fx.documentId, "conteúdo a");
    const ch = computeChunkContentHash("conteúdo a");
    const { id: frameId } = await createFrame(fx.conversationId, "query a");
    const { id: snapshotId } = await createSnapshot(frameId, [{ chunkId, contentHash: ch, embeddedContentHash: ch }]);
    await createItem(snapshotId, chunkId, 0.9, 0.1, 0, "cite a");

    const gen = await generateGeneration(prisma, { conversationId: fx.conversationId, userId: fx.ownerId });
    expect("externalRag" in gen.context).toBe(false);
    expect(gen.systemPrompt).not.toContain("EXTERNAL_CONTEXT");
    expect(gen.meta.tokens.contextBlocks).toBe(12);
    expect(gen.meta.provider).toBe("null");
  });

  it("B) ragFrameId válido CURRENT → RAG presente, EXTERNAL_CONTEXT, 13 seções", async () => {
    const fx = await isolatedFixture("b");
    const chunkId = await newChunk(fx.documentId, "conteúdo b");
    const ch = computeChunkContentHash("conteúdo b");
    const { id: frameId } = await createFrame(fx.conversationId, "query b");
    const { id: snapshotId } = await createSnapshot(frameId, [{ chunkId, contentHash: ch, embeddedContentHash: ch }]);
    await createItem(snapshotId, chunkId, 0.95, 0.05, 0, "Fonte B — Título [chunk 0]");

    const gen = await generateGeneration(prisma, {
      conversationId: fx.conversationId,
      userId: fx.ownerId,
      ragFrameId: frameId,
    });
    expect(gen.context.externalRag).not.toBeNull();
    expect(gen.systemPrompt).toContain("<BEGIN 11:EXTERNAL_CONTEXT>");
    expect(gen.systemPrompt).toContain("<END 11:EXTERNAL_CONTEXT>");
    expect(gen.meta.tokens.contextBlocks).toBe(13);
    expect(gen.meta.provider).toBe("null");
  });

  it("C) múltiplos frames + frameId explícito → usa SOMENTE o frame selecionado", async () => {
    const fx = await isolatedFixture("c");
    const c1 = await newChunk(fx.documentId, "primeiro");
    const c2 = await newChunk(fx.documentId, "segundo");
    const ch1 = computeChunkContentHash("primeiro");
    const ch2 = computeChunkContentHash("segundo");
    const { id: f1 } = await createFrame(fx.conversationId, "query c1");
    const { id: f2 } = await createFrame(fx.conversationId, "query c2");
    const s1 = await createSnapshot(f1, [{ chunkId: c1, contentHash: ch1, embeddedContentHash: ch1 }]);
    await createItem(s1.id, c1, 0.9, 0.1, 0, "c1");
    const s2 = await createSnapshot(f2, [{ chunkId: c2, contentHash: ch2, embeddedContentHash: ch2 }]);
    await createItem(s2.id, c2, 0.98, 0.02, 0, "c2");

    const gen = await generateGeneration(prisma, {
      conversationId: fx.conversationId,
      userId: fx.ownerId,
      ragFrameId: f2,
    });
    expect(gen.context.externalRag).not.toBeNull();
    const items = gen.context.externalRag!.items;
    expect(items).toHaveLength(1);
    expect(items[0].chunkId).toBe(c2);
    expect(items[0].citation).toBe("c2");
  });

  it("X) dois frames CURRENT no mesmo contexto → sem ragFrameId NÃO escolhe nenhum (não base)", async () => {
    const fx = await isolatedFixture("x");
    const c1 = await newChunk(fx.documentId, "x1");
    const c2 = await newChunk(fx.documentId, "x2");
    const ch1 = computeChunkContentHash("x1");
    const ch2 = computeChunkContentHash("x2");
    const { id: f1 } = await createFrame(fx.conversationId, "query x1");
    const { id: f2 } = await createFrame(fx.conversationId, "query x2");
    const s1 = await createSnapshot(f1, [{ chunkId: c1, contentHash: ch1, embeddedContentHash: ch1 }]);
    await createItem(s1.id, c1, 0.9, 0.1, 0, "x1");
    const s2 = await createSnapshot(f2, [{ chunkId: c2, contentHash: ch2, embeddedContentHash: ch2 }]);
    await createItem(s2.id, c2, 0.8, 0.2, 0, "x2");

    const gen = await generateGeneration(prisma, { conversationId: fx.conversationId, userId: fx.ownerId });
    expect("externalRag" in gen.context).toBe(false);
    expect(gen.meta.tokens.contextBlocks).toBe(12);
  });

  it("D/AA) frameId inexistente → lança GenerationRagFrameNotFoundError", async () => {
    const fx = await isolatedFixture("daa");
    const missing = randomUUID();
    await expect(
      generateGeneration(prisma, { conversationId: fx.conversationId, userId: fx.ownerId, ragFrameId: missing }),
    ).rejects.toBeInstanceOf(GenerationRagFrameNotFoundError);
  });

  it("AB) frameId de outra conversation → GenerationRagFrameNotFoundError (não vaza)", async () => {
    const fxA = await isolatedFixture("ab-a");
    const fxB = await isolatedFixture("ab-b");
    const chunkId = await newChunk(fxB.documentId, "outra conv");
    const ch = computeChunkContentHash("outra conv");
    const { id: frameB } = await createFrame(fxB.conversationId, "query ab");
    const { id: snapshotId } = await createSnapshot(frameB, [{ chunkId, contentHash: ch, embeddedContentHash: ch }]);
    await createItem(snapshotId, chunkId, 0.9, 0.1, 0, "ab");

    await expect(
      generateGeneration(prisma, { conversationId: fxA.conversationId, userId: fxA.ownerId, ragFrameId: frameB }),
    ).rejects.toBeInstanceOf(GenerationRagFrameNotFoundError);
  });

  it("F) frame sem snapshot (NO_SNAPSHOT) → sem RAG, baseline 12", async () => {
    const fx = await isolatedFixture("f");
    const { id: frameId } = await createFrame(fx.conversationId, "query f");
    const gen = await generateGeneration(prisma, {
      conversationId: fx.conversationId,
      userId: fx.ownerId,
      ragFrameId: frameId,
    });
    expect("externalRag" in gen.context).toBe(false);
    expect(gen.meta.tokens.contextBlocks).toBe(12);
  });

  it("G) frame STALE → sem RAG, NÃO alimenta com snapshot antigo", async () => {
    const fx = await isolatedFixture("g");
    const chunkId = await newChunk(fx.documentId, "v1");
    const ch = computeChunkContentHash("v1");
    const { id: frameId } = await createFrame(fx.conversationId, "query g");
    const { id: snapshotId } = await createSnapshot(frameId, [{ chunkId, contentHash: ch, embeddedContentHash: ch }]);
    await createItem(snapshotId, chunkId, 0.8, 0.2, 0, "cite g");
    // torna stale
    const newHash = computeChunkContentHash("v2");
    await prisma.externalChunk.update({
      where: { id: chunkId },
      data: { text: "v2", contentHash: newHash, embeddedContentHash: newHash },
    });

    const gen = await generateGeneration(prisma, {
      conversationId: fx.conversationId,
      userId: fx.ownerId,
      ragFrameId: frameId,
    });
    expect("externalRag" in gen.context).toBe(false);
    expect(gen.meta.tokens.contextBlocks).toBe(12);
  });

  it("H) frame CURRENT → EXTERNAL_CONTEXT emitida na posição 11", async () => {
    const fx = await isolatedFixture("h");
    const chunkId = await newChunk(fx.documentId, "conteúdo h");
    const ch = computeChunkContentHash("conteúdo h");
    const { id: frameId } = await createFrame(fx.conversationId, "query h");
    const { id: snapshotId } = await createSnapshot(frameId, [{ chunkId, contentHash: ch, embeddedContentHash: ch }]);
    await createItem(snapshotId, chunkId, 0.9, 0.1, 0, "cite h");

    const gen = await generateGeneration(prisma, {
      conversationId: fx.conversationId,
      userId: fx.ownerId,
      ragFrameId: frameId,
    });
    const ext = gen.systemPrompt.indexOf("<BEGIN 11:EXTERNAL_CONTEXT>");
    const omitted = gen.systemPrompt.indexOf("<BEGIN 12:OMITTED_CONTEXT>");
    expect(ext).toBeGreaterThan(-1);
    expect(omitted).toBeGreaterThan(ext);
  });

  it("I) provenance preservada (sourceId/documentId)", async () => {
    const fx = await isolatedFixture("i");
    const chunkId = await newChunk(fx.documentId, "conteúdo i");
    const ch = computeChunkContentHash("conteúdo i");
    const { id: frameId } = await createFrame(fx.conversationId, "query i");
    const { id: snapshotId } = await createSnapshot(frameId, [{ chunkId, contentHash: ch, embeddedContentHash: ch }]);
    await createItem(snapshotId, chunkId, 0.9, 0.1, 0, "cite i");

    const gen = await generateGeneration(prisma, { conversationId: fx.conversationId, userId: fx.ownerId, ragFrameId: frameId });
    const item = gen.context.externalRag!.items[0];
    expect(item.sourceId).toBe(fx.sourceId);
    expect(item.documentId).toBe(fx.documentId);
    expect(item.chunkId).toBe(chunkId);
  });

  it("J) citation preservada", async () => {
    const fx = await isolatedFixture("j");
    const chunkId = await newChunk(fx.documentId, "conteúdo j");
    const ch = computeChunkContentHash("conteúdo j");
    const { id: frameId } = await createFrame(fx.conversationId, "query j");
    const { id: snapshotId } = await createSnapshot(frameId, [{ chunkId, contentHash: ch, embeddedContentHash: ch }]);
    await createItem(snapshotId, chunkId, 0.9, 0.1, 0, "Fonte J (linha 7)");

    const gen = await generateGeneration(prisma, { conversationId: fx.conversationId, userId: fx.ownerId, ragFrameId: frameId });
    expect(gen.context.externalRag!.items[0].citation).toBe("Fonte J (linha 7)");
    expect(gen.systemPrompt).toContain("Fonte J (linha 7)");
  });

  it("K) score preservado", async () => {
    const fx = await isolatedFixture("k");
    const chunkId = await newChunk(fx.documentId, "conteúdo k");
    const ch = computeChunkContentHash("conteúdo k");
    const { id: frameId } = await createFrame(fx.conversationId, "query k");
    const { id: snapshotId } = await createSnapshot(frameId, [{ chunkId, contentHash: ch, embeddedContentHash: ch }]);
    await createItem(snapshotId, chunkId, 0.876543, 0.123457, 0, "cite k");

    const gen = await generateGeneration(prisma, { conversationId: fx.conversationId, userId: fx.ownerId, ragFrameId: frameId });
    expect(gen.context.externalRag!.items[0].score).toBeCloseTo(0.876543, 5);
  });

  it("L) distance preservada", async () => {
    const fx = await isolatedFixture("l");
    const chunkId = await newChunk(fx.documentId, "conteúdo l");
    const ch = computeChunkContentHash("conteúdo l");
    const { id: frameId } = await createFrame(fx.conversationId, "query l");
    const { id: snapshotId } = await createSnapshot(frameId, [{ chunkId, contentHash: ch, embeddedContentHash: ch }]);
    await createItem(snapshotId, chunkId, 0.9, 0.123457, 0, "cite l");

    const gen = await generateGeneration(prisma, { conversationId: fx.conversationId, userId: fx.ownerId, ragFrameId: frameId });
    expect(gen.context.externalRag!.items[0].distance).toBeCloseTo(0.123457, 5);
  });

  it("M) ordem dos itens preservada", async () => {
    const fx = await isolatedFixture("m");
    const c1 = await newChunk(fx.documentId, "m primeiro");
    const c2 = await newChunk(fx.documentId, "m segundo");
    const ch1 = computeChunkContentHash("m primeiro");
    const ch2 = computeChunkContentHash("m segundo");
    const { id: frameId } = await createFrame(fx.conversationId, "query m");
    const { id: snapshotId } = await createSnapshot(frameId, [
      { chunkId: c1, contentHash: ch1, embeddedContentHash: ch1 },
      { chunkId: c2, contentHash: ch2, embeddedContentHash: ch2 },
    ]);
    await createItem(snapshotId, c1, 0.9, 0.1, 1, "c1");
    await createItem(snapshotId, c2, 0.8, 0.2, 0, "c2");

    const gen = await generateGeneration(prisma, { conversationId: fx.conversationId, userId: fx.ownerId, ragFrameId: frameId });
    const items = gen.context.externalRag!.items;
    expect(items.map((i) => i.chunkId)).toEqual([c2, c1]);
    expect(items.map((i) => i.citation)).toEqual(["c2", "c1"]);
  });

  it("N) provider continua NullProvider; O) sem retrieval; P) sem materialization", async () => {
    const fx = await isolatedFixture("n");
    const chunkId = await newChunk(fx.documentId, "conteúdo n");
    const ch = computeChunkContentHash("conteúdo n");
    const { id: frameId } = await createFrame(fx.conversationId, "query n");
    const { id: snapshotId } = await createSnapshot(frameId, [{ chunkId, contentHash: ch, embeddedContentHash: ch }]);
    await createItem(snapshotId, chunkId, 0.9, 0.1, 0, "cite n");

    const beforeFrames = await prisma.conversationRagFrame.count({ where: { conversationId: fx.conversationId } });
    const beforeSnap = await prisma.conversationRagSnapshot.count({ where: { frame: { conversationId: fx.conversationId } } });

    const gen = await generateGeneration(prisma, { conversationId: fx.conversationId, userId: fx.ownerId, ragFrameId: frameId });
    expect(gen.meta.provider).toBe("null");
    expect(gen.meta.ruleApplied).toBe(GENERATION_RULE);

    const afterFrames = await prisma.conversationRagFrame.count({ where: { conversationId: fx.conversationId } });
    const afterSnap = await prisma.conversationRagSnapshot.count({ where: { frame: { conversationId: fx.conversationId } } });
    expect(afterFrames).toBe(beforeFrames);
    expect(afterSnap).toBe(beforeSnap);
  });

  it("R) generationKey sem ragFrameId idêntica entre execuções (baseline estável)", async () => {
    const fx = await isolatedFixture("r");
    const chunkId = await newChunk(fx.documentId, "conteúdo r");
    const ch = computeChunkContentHash("conteúdo r");
    const { id: frameId } = await createFrame(fx.conversationId, "query r");
    const { id: snapshotId } = await createSnapshot(frameId, [{ chunkId, contentHash: ch, embeddedContentHash: ch }]);
    await createItem(snapshotId, chunkId, 0.9, 0.1, 0, "cite r");

    const a = await generateGeneration(prisma, { conversationId: fx.conversationId, userId: fx.ownerId });
    const b = await generateGeneration(prisma, { conversationId: fx.conversationId, userId: fx.ownerId });
    expect(a.generationKey).toBe(b.generationKey);
    expect(a.generationKey).toMatch(/^sha256:[0-9a-f]{64}$/);
    // RAG rows presentes não alteram a key sem ragFrameId (seleção explícita)
    const withRag = await generateGeneration(prisma, { conversationId: fx.conversationId, userId: fx.ownerId, ragFrameId: frameId });
    expect(withRag.generationKey).not.toBe(a.generationKey);
  });

  it("S) generationKey com RAG determinística (mesma entrada → mesma key)", async () => {
    const fx = await isolatedFixture("s");
    const chunkId = await newChunk(fx.documentId, "conteúdo s");
    const ch = computeChunkContentHash("conteúdo s");
    const { id: frameId } = await createFrame(fx.conversationId, "query s");
    const { id: snapshotId } = await createSnapshot(frameId, [{ chunkId, contentHash: ch, embeddedContentHash: ch }]);
    await createItem(snapshotId, chunkId, 0.9, 0.1, 0, "cite s");

    const a = await generateGeneration(prisma, { conversationId: fx.conversationId, userId: fx.ownerId, ragFrameId: frameId });
    const b = await generateGeneration(prisma, { conversationId: fx.conversationId, userId: fx.ownerId, ragFrameId: frameId });
    expect(a.systemPrompt).toBe(b.systemPrompt);
    expect(a.generationKey).toBe(b.generationKey);
  });

  it("T) mesma entrada → mesmo prompt (determinismo byte-a-byte)", async () => {
    const fx = await isolatedFixture("t");
    const chunkId = await newChunk(fx.documentId, "conteúdo t");
    const ch = computeChunkContentHash("conteúdo t");
    const { id: frameId } = await createFrame(fx.conversationId, "query t");
    const { id: snapshotId } = await createSnapshot(frameId, [{ chunkId, contentHash: ch, embeddedContentHash: ch }]);
    await createItem(snapshotId, chunkId, 0.9, 0.1, 0, "cite t");

    const a = await generateGeneration(prisma, { conversationId: fx.conversationId, userId: fx.ownerId, ragFrameId: frameId });
    const b = await generateGeneration(prisma, { conversationId: fx.conversationId, userId: fx.ownerId, ragFrameId: frameId });
    expect(a.systemPrompt).toBe(b.systemPrompt);
  });

  it("V) no vector; W) no secrets no prompt serializado", async () => {
    const fx = await isolatedFixture("vw");
    const chunkId = await newChunk(fx.documentId, "conteúdo vw");
    const ch = computeChunkContentHash("conteúdo vw");
    const { id: frameId } = await createFrame(fx.conversationId, "query vw");
    const { id: snapshotId } = await createSnapshot(frameId, [{ chunkId, contentHash: ch, embeddedContentHash: ch }]);
    await createItem(snapshotId, chunkId, 0.9, 0.1, 0, "cite vw");

    const gen = await generateGeneration(prisma, { conversationId: fx.conversationId, userId: fx.ownerId, ragFrameId: frameId });
    const item = gen.context.externalRag!.items[0];
    expect(item).not.toHaveProperty("embedding");
    expect(item).not.toHaveProperty("vector");
    const json = JSON.stringify({ context: gen.context, systemPrompt: gen.systemPrompt });
    expect(json).not.toMatch(/apiKey|bearer|Authorization|secret|password|api.?key|cohere.?key/i);
  });

  it("Y) ragFrameId opcional → ausente comporta como hoje", async () => {
    const fx = await isolatedFixture("y");
    const gen = await generateGeneration(prisma, { conversationId: fx.conversationId, userId: fx.ownerId });
    expect(gen.meta.tokens.contextBlocks).toBe(12);
    expect(gen.meta.provider).toBe("null");
  });
});

// ---------------------------------------------------------------------------
// HTTP: /craft expõe ragFrameId opcional (Y, Z, AA, AB via rota)
// ---------------------------------------------------------------------------

describe("GET /craft com ragFrameId — transporte opcional", () => {
  it("Y) sem query → 200 baseline (sem RAG)", async () => {
    const user = await createUserViaApi(`craft-y-${Date.now()}-${Math.random()}@x.com`, "Craft Y");
    const char = await prisma.character.create({
      data: { name: "CharY", nationality: "BR", birthDate: new Date("1995-01-01"), controlledBy: "USER", userId: user.userId },
    });
    createdCharacterIds.push(char.id);
    const conv = await prisma.conversation.create({ data: { type: "DM" } });
    createdConversationIds.push(conv.id);
    await prisma.conversationParticipant.create({ data: { conversationId: conv.id, characterId: char.id } });

    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${conv.id}/craft`,
      headers: { cookie: user.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.generation.meta.tokens.contextBlocks).toBe(12);
    expect(body.generation.context.externalRag).toBeUndefined();
  });

  it("Z) ragFrameId UUID inválido → 400 VALIDATION_ERROR", async () => {
    const user = await createUserViaApi(`craft-z-${Date.now()}-${Math.random()}@x.com`, "Craft Z");
    const char = await prisma.character.create({
      data: { name: "CharZ", nationality: "BR", birthDate: new Date("1995-01-01"), controlledBy: "USER", userId: user.userId },
    });
    createdCharacterIds.push(char.id);
    const conv = await prisma.conversation.create({ data: { type: "DM" } });
    createdConversationIds.push(conv.id);
    await prisma.conversationParticipant.create({ data: { conversationId: conv.id, characterId: char.id } });

    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${conv.id}/craft?ragFrameId=not-a-uuid`,
      headers: { cookie: user.cookie },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("AA) ragFrameId inexistente → 404 (não vira sem RAG)", async () => {
    const user = await createUserViaApi(`craft-aa-${Date.now()}-${Math.random()}@x.com`, "Craft AA");
    const char = await prisma.character.create({
      data: { name: "CharAA", nationality: "BR", birthDate: new Date("1995-01-01"), controlledBy: "USER", userId: user.userId },
    });
    createdCharacterIds.push(char.id);
    const conv = await prisma.conversation.create({ data: { type: "DM" } });
    createdConversationIds.push(conv.id);
    await prisma.conversationParticipant.create({ data: { conversationId: conv.id, characterId: char.id } });

    const missing = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${conv.id}/craft?ragFrameId=${missing}`,
      headers: { cookie: user.cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("AB) ragFrameId de outra conversation → 404 (não vaza)", async () => {
    const userA = await createUserViaApi(`craft-ab-a-${Date.now()}-${Math.random()}@x.com`, "Craft ABA");
    const charA = await prisma.character.create({
      data: { name: "CharABA", nationality: "BR", birthDate: new Date("1995-01-01"), controlledBy: "USER", userId: userA.userId },
    });
    createdCharacterIds.push(charA.id);
    const convA = await prisma.conversation.create({ data: { type: "DM" } });
    createdConversationIds.push(convA.id);
    await prisma.conversationParticipant.create({ data: { conversationId: convA.id, characterId: charA.id } });

    const fxB = await isolatedFixture("ab-rota-b");
    const chunkId = await newChunk(fxB.documentId, "b");
    const ch = computeChunkContentHash("b");
    const { id: frameB } = await createFrame(fxB.conversationId, "query rota ab");
    const { id: snapshotId } = await createSnapshot(frameB, [{ chunkId, contentHash: ch, embeddedContentHash: ch }]);
    await createItem(snapshotId, chunkId, 0.9, 0.1, 0, "ab rota");

    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${convA.id}/craft?ragFrameId=${frameB}`,
      headers: { cookie: userA.cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// Fronteira pura adicional
// ---------------------------------------------------------------------------

describe("generation-rag-context estática", () => {
  it("regra exposta e erro nomeado", () => {
    expect(GENERATION_RAG_CONTEXT_RULE).toMatch(/mode=pure/);
    const err = new GenerationRagFrameNotFoundError("x");
    expect(err.name).toBe("GenerationRagFrameNotFoundError");
  });
});