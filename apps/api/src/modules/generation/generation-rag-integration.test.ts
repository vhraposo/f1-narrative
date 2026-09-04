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

// ---------------------------------------------------------------------------
// Fase 13 STEP 23 — VALIDAÇÃO INTEGRADA do fluxo HTTP → Generation Assembly →
// RAG selection → prompt, através do endpoint real `GET /craft`.
//
// Cada cenário cria fixtures reais no TEST DB (User/Character/Conversation/
// Participant/Frame/Snapshot/Item/Chunk) e executa o encadeamento completo via
// `app.inject`. A selection reutiliza readConversationRag +
// resolveGenerationRagContext + withExternalRag (STEP 18/22) — NADA é
// reimplementado, NADA é escolhido silenciosamente.
//
// Baseline de referência por conversation: `gen(request sem ragFrameId)`.
// Uma geração sem ragFrameId DEVE continuar byte-a-byte igual ao pré-RAG mesmo
// que existam frames CURRENT no banco (seleção explícita). Portanto, para um
// mesmo conversation no MESMO estado, o key sem ragFrameId é a baseline.
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
    data: { name: "GenRag23", email: `${prefix}-${counter}-${Date.now()}-${Math.random()}@x.com` },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function newCharacter(ownerId: string): Promise<string> {
  const character = await prisma.character.create({
    data: {
      name: "Char23",
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
      url: `https://gen-rag23.test/${counter}/${Date.now()}/${Math.random()}`,
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
  conversationId: string;
  userId: string;
  sourceId: string;
  documentId: string;
};

async function isolatedFixture(prefix: string): Promise<Fixture> {
  counter += 1;
  const ownerId = await newOwner(prefix);
  const characterId = await newCharacter(ownerId);
  const conversationId = await newConversationWithParticipant(characterId);
  const sourceId = await newPrivateSource(ownerId);
  const documentId = await newDocument(sourceId);
  return { conversationId, userId: ownerId, sourceId, documentId };
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
): Promise<{ id: string; freshnessAnchor: string }> {
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
  return { id: snapshot.id, freshnessAnchor };
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
// A–J via HTTP /craft real
// ---------------------------------------------------------------------------

describe("FASE 13 STEP 23 — integração HTTP /craft + RAG (cenários A–J)", () => {
  it("A) baseline — /craft sem ragFrameId → 12 seções, sem EXTERNAL_CONTEXT", async () => {
    const user = await createUserViaApi(`s23-a-${Date.now()}-${Math.random()}@x.com`, "S23A");
    const char = await prisma.character.create({
      data: { name: "CharS23A", nationality: "BR", birthDate: new Date("1995-01-01"), controlledBy: "USER", userId: user.userId },
    });
    createdCharacterIds.push(char.id);
    const conv = (await prisma.conversation.create({ data: { type: "DM" } })).id;
    createdConversationIds.push(conv);
    await prisma.conversationParticipant.create({ data: { conversationId: conv, characterId: char.id } });

    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${conv}/craft`,
      headers: { cookie: user.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.generation.meta.provider).toBe("null");
    expect(body.generation.meta.tokens.contextBlocks).toBe(12);
    expect(body.generation.systemPrompt).not.toContain("EXTERNAL_CONTEXT");
    expect(body.generation.systemPrompt).toContain("<END 12:BEHAVIORAL_INVARIANTS>");
    expect(body.generation.generationKey).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("B) /craft com ragFrameId CURRENT → EXTERNAL_CONTEXT, 2 itens preservados, key != baseline, NullProvider", async () => {
    const user = await createUserViaApi(`s23-b-${Date.now()}-${Math.random()}@x.com`, "S23B");
    const char = await prisma.character.create({
      data: { name: "CharS23B", nationality: "BR", birthDate: new Date("1995-01-01"), controlledBy: "USER", userId: user.userId },
    });
    createdCharacterIds.push(char.id);
    const conv = (await prisma.conversation.create({ data: { type: "DM" } })).id;
    createdConversationIds.push(conv);
    await prisma.conversationParticipant.create({ data: { conversationId: conv, characterId: char.id } });

    const src = await newPrivateSource(user.userId);
    const doc = await newDocument(src);
    const c1 = await newChunk(doc, "primeiro");
    const c2 = await newChunk(doc, "segundo");
    const ch1 = computeChunkContentHash("primeiro");
    const ch2 = computeChunkContentHash("segundo");
    const { id: frameId } = await createFrame(conv, "query b");
    const snap = await createSnapshot(frameId, [
      { chunkId: c1, contentHash: ch1, embeddedContentHash: ch1 },
      { chunkId: c2, contentHash: ch2, embeddedContentHash: ch2 },
    ]);
    await createItem(snap.id, c2, 0.98, 0.02, 0, "Fonte B2 — Doc [chunk 3]");
    await createItem(snap.id, c1, 0.9, 0.1, 1, "Fonte B1 — Doc [chunk 0]");

    const baseRes = await app.inject({
      method: "GET",
      url: `/api/conversations/${conv}/craft`,
      headers: { cookie: user.cookie },
    });
    const baseKey = baseRes.json().generation.generationKey;

    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${conv}/craft?ragFrameId=${frameId}`,
      headers: { cookie: user.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const gen = body.generation;
    expect(gen.meta.provider).toBe("null");
    expect(gen.systemPrompt).toContain("<BEGIN 11:EXTERNAL_CONTEXT>");
    expect(gen.systemPrompt).toContain("<END 11:EXTERNAL_CONTEXT>");
    expect(gen.meta.tokens.contextBlocks).toBe(13);
    // itens preservados + ordem do snapshot (order desc na leitura)
    const rag = gen.context.externalRag;
    expect(rag).not.toBeUndefined();
    expect(rag.items).toHaveLength(2);
    // ordem: snapshot itens com order desc → (c2 order0) primeiro, (c1 order1) depois
    expect(rag.items[0].chunkId).toBe(c2);
    expect(rag.items[1].chunkId).toBe(c1);
    // provenance / citation / score / distance
    expect(rag.items[0].sourceId).toBe(src);
    expect(rag.items[0].documentId).toBe(doc);
    expect(rag.items[0].citation).toBe("Fonte B2 — Doc [chunk 3]");
    expect(rag.items[0].score).toBeCloseTo(0.98, 5);
    expect(rag.items[0].distance).toBeCloseTo(0.02, 5);
    // key diferente do baseline
    expect(gen.generationKey).not.toBe(baseKey);
    expect(gen.generationKey).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("C) /craft com frame NO_SNAPSHOT → sem RAG, sem EXTERNAL_CONTEXT, key == baseline", async () => {
    const user = await createUserViaApi(`s23-c-${Date.now()}-${Math.random()}@x.com`, "S23C");
    const char = await prisma.character.create({
      data: { name: "CharS23C", nationality: "BR", birthDate: new Date("1995-01-01"), controlledBy: "USER", userId: user.userId },
    });
    createdCharacterIds.push(char.id);
    const conv = (await prisma.conversation.create({ data: { type: "DM" } })).id;
    createdConversationIds.push(conv);
    await prisma.conversationParticipant.create({ data: { conversationId: conv, characterId: char.id } });

    const { id: frameId } = await createFrame(conv, "query c");

    const base = await app.inject({
      method: "GET",
      url: `/api/conversations/${conv}/craft`,
      headers: { cookie: user.cookie },
    });
    const baseKey = base.json().generation.generationKey;

    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${conv}/craft?ragFrameId=${frameId}`,
      headers: { cookie: user.cookie },
    });
    expect(res.statusCode).toBe(200);
    const gen = res.json().generation;
    expect(gen.systemPrompt).not.toContain("EXTERNAL_CONTEXT");
    expect(gen.meta.tokens.contextBlocks).toBe(12);
    expect(gen.generationKey).toBe(baseKey);
  });

  it("D) /craft com frame STALE → sem RAG, sem EXTERNAL_CONTEXT, key == baseline, sem mutação", async () => {
    const user = await createUserViaApi(`s23-d-${Date.now()}-${Math.random()}@x.com`, "S23D");
    const char = await prisma.character.create({
      data: { name: "CharS23D", nationality: "BR", birthDate: new Date("1995-01-01"), controlledBy: "USER", userId: user.userId },
    });
    createdCharacterIds.push(char.id);
    const conv = (await prisma.conversation.create({ data: { type: "DM" } })).id;
    createdConversationIds.push(conv);
    await prisma.conversationParticipant.create({ data: { conversationId: conv, characterId: char.id } });

    const src = await newPrivateSource(user.userId);
    const doc = await newDocument(src);
    const chunkId = await newChunk(doc, "v1");
    const ch1 = computeChunkContentHash("v1");
    const { id: frameId } = await createFrame(conv, "query d");
    const snap = await createSnapshot(frameId, [{ chunkId, contentHash: ch1, embeddedContentHash: ch1 }]);
    await createItem(snap.id, chunkId, 0.8, 0.2, 0, "D stale");
    // torna stale
    const newHash = computeChunkContentHash("v2");
    await prisma.externalChunk.update({
      where: { id: chunkId },
      data: { text: "v2", contentHash: newHash, embeddedContentHash: newHash },
    });

    const base = await app.inject({
      method: "GET",
      url: `/api/conversations/${conv}/craft`,
      headers: { cookie: user.cookie },
    });
    const baseKey = base.json().generation.generationKey;

    const snapBefore = await prisma.conversationRagSnapshot.count({ where: { frame: { conversationId: conv } } });

    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${conv}/craft?ragFrameId=${frameId}`,
      headers: { cookie: user.cookie },
    });
    expect(res.statusCode).toBe(200);
    const gen = res.json().generation;
    expect(gen.systemPrompt).not.toContain("EXTERNAL_CONTEXT");
    expect(gen.meta.tokens.contextBlocks).toBe(12);
    expect(gen.generationKey).toBe(baseKey);

    const snapAfter = await prisma.conversationRagSnapshot.count({ where: { frame: { conversationId: conv } } });
    expect(snapAfter).toBe(snapBefore);
  });

  it("E) /craft com ragFrameId inexistente → 404 NOT_FOUND, sem fallback", async () => {
    const user = await createUserViaApi(`s23-e-${Date.now()}-${Math.random()}@x.com`, "S23E");
    const char = await prisma.character.create({
      data: { name: "CharS23E", nationality: "BR", birthDate: new Date("1995-01-01"), controlledBy: "USER", userId: user.userId },
    });
    createdCharacterIds.push(char.id);
    const conv = (await prisma.conversation.create({ data: { type: "DM" } })).id;
    createdConversationIds.push(conv);
    await prisma.conversationParticipant.create({ data: { conversationId: conv, characterId: char.id } });

    const missing = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${conv}/craft?ragFrameId=${missing}`,
      headers: { cookie: user.cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
    expect(res.json()).not.toHaveProperty("generation");
  });

  it("F) /craft com ragFrameId de OUTRA conversation → 404 NOT_FOUND, não vaza", async () => {
    const userA = await createUserViaApi(`s23-f-a-${Date.now()}-${Math.random()}@x.com`, "S23FA");
    const charA = await prisma.character.create({
      data: { name: "CharS23FA", nationality: "BR", birthDate: new Date("1995-01-01"), controlledBy: "USER", userId: userA.userId },
    });
    createdCharacterIds.push(charA.id);
    const convA = (await prisma.conversation.create({ data: { type: "DM" } })).id;
    createdConversationIds.push(convA);
    await prisma.conversationParticipant.create({ data: { conversationId: convA, characterId: charA.id } });

    // frame em outra conversation de outro owner
    const fxB = await isolatedFixture("s23-f-b");
    const src = await newPrivateSource(fxB.userId);
    const doc = await newDocument(src);
    const chunkId = await newChunk(doc, "frame B");
    const ch = computeChunkContentHash("frame B");
    const { id: frameB } = await createFrame(fxB.conversationId, "query f");
    const snapB = await createSnapshot(frameB, [{ chunkId, contentHash: ch, embeddedContentHash: ch }]);
    await createItem(snapB.id, chunkId, 0.9, 0.1, 0, "F frame B");

    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${convA}/craft?ragFrameId=${frameB}`,
      headers: { cookie: userA.cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
    const bodyText = res.body;
    expect(bodyText).not.toContain("frame B");
    expect(bodyText).not.toContain("F frame B");
  });

  it("G) /craft com ragFrameId UUID malformado → 400 VALIDATION_ERROR", async () => {
    const user = await createUserViaApi(`s23-g-${Date.now()}-${Math.random()}@x.com`, "S23G");
    const char = await prisma.character.create({
      data: { name: "CharS23G", nationality: "BR", birthDate: new Date("1995-01-01"), controlledBy: "USER", userId: user.userId },
    });
    createdCharacterIds.push(char.id);
    const conv = (await prisma.conversation.create({ data: { type: "DM" } })).id;
    createdConversationIds.push(conv);
    await prisma.conversationParticipant.create({ data: { conversationId: conv, characterId: char.id } });

    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${conv}/craft?ragFrameId=not-a-uuid`,
      headers: { cookie: user.cookie },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("H) determinismo — mesmo /craft repetido → mesmo prompt e mesma key, sem mudança persistente", async () => {
    const user = await createUserViaApi(`s23-h-${Date.now()}-${Math.random()}@x.com`, "S23H");
    const char = await prisma.character.create({
      data: { name: "CharS23H", nationality: "BR", birthDate: new Date("1995-01-01"), controlledBy: "USER", userId: user.userId },
    });
    createdCharacterIds.push(char.id);
    const conv = (await prisma.conversation.create({ data: { type: "DM" } })).id;
    createdConversationIds.push(conv);
    await prisma.conversationParticipant.create({ data: { conversationId: conv, characterId: char.id } });

    const src = await newPrivateSource(user.userId);
    const doc = await newDocument(src);
    const chunkId = await newChunk(doc, "h");
    const ch = computeChunkContentHash("h");
    const { id: frameId } = await createFrame(conv, "query h");
    const snap = await createSnapshot(frameId, [{ chunkId, contentHash: ch, embeddedContentHash: ch }]);
    await createItem(snap.id, chunkId, 0.9, 0.1, 0, "H");

    const url = `/api/conversations/${conv}/craft?ragFrameId=${frameId}`;
    const r1 = await app.inject({ method: "GET", url, headers: { cookie: user.cookie } });
    const r2 = await app.inject({ method: "GET", url, headers: { cookie: user.cookie } });
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    const g1 = r1.json().generation;
    const g2 = r2.json().generation;
    expect(g1.systemPrompt).toBe(g2.systemPrompt);
    expect(g1.generationKey).toBe(g2.generationKey);
  });

  it("I) isolamento — sem ragFrameId continua baseline mesmo com frame CURRENT existente", async () => {
    const user = await createUserViaApi(`s23-i-${Date.now()}-${Math.random()}@x.com`, "S23I");
    const char = await prisma.character.create({
      data: { name: "CharS23I", nationality: "BR", birthDate: new Date("1995-01-01"), controlledBy: "USER", userId: user.userId },
    });
    createdCharacterIds.push(char.id);
    const conv = (await prisma.conversation.create({ data: { type: "DM" } })).id;
    createdConversationIds.push(conv);
    await prisma.conversationParticipant.create({ data: { conversationId: conv, characterId: char.id } });

    const src = await newPrivateSource(user.userId);
    const doc = await newDocument(src);
    const chunkId = await newChunk(doc, "i");
    const ch = computeChunkContentHash("i");
    const { id: frameId } = await createFrame(conv, "query i");
    const snap = await createSnapshot(frameId, [{ chunkId, contentHash: ch, embeddedContentHash: ch }]);
    await createItem(snap.id, chunkId, 0.9, 0.1, 0, "I");

    // sem ragFrameId → baseline apesar de frame CURRENT existir
    const noRag = await app.inject({
      method: "GET",
      url: `/api/conversations/${conv}/craft`,
      headers: { cookie: user.cookie },
    });
    const noRagGen = noRag.json().generation;
    expect(noRagGen.systemPrompt).not.toContain("EXTERNAL_CONTEXT");
    expect(noRagGen.meta.tokens.contextBlocks).toBe(12);

    // com ragFrameId → RAG
    const withRag = await app.inject({
      method: "GET",
      url: `/api/conversations/${conv}/craft?ragFrameId=${frameId}`,
      headers: { cookie: user.cookie },
    });
    const withRagGen = withRag.json().generation;
    expect(withRagGen.systemPrompt).toContain("EXTERNAL_CONTEXT");
    expect(withRagGen.meta.tokens.contextBlocks).toBe(13);
    expect(noRagGen.generationKey).not.toBe(withRagGen.generationKey);
  });

  it("J) read-only — geração não muta frames/snapshots/items/sources/docs/chunks nem dispara retrieval/materialization", async () => {
    const user = await createUserViaApi(`s23-j-${Date.now()}-${Math.random()}@x.com`, "S23J");
    const char = await prisma.character.create({
      data: { name: "CharS23J", nationality: "BR", birthDate: new Date("1995-01-01"), controlledBy: "USER", userId: user.userId },
    });
    createdCharacterIds.push(char.id);
    const conv = (await prisma.conversation.create({ data: { type: "DM" } })).id;
    createdConversationIds.push(conv);
    await prisma.conversationParticipant.create({ data: { conversationId: conv, characterId: char.id } });

    const src = await newPrivateSource(user.userId);
    const doc = await newDocument(src);
    const chunkId = await newChunk(doc, "j");
    const ch = computeChunkContentHash("j");
    const { id: frameId } = await createFrame(conv, "query j");
    const snap = await createSnapshot(frameId, [{ chunkId, contentHash: ch, embeddedContentHash: ch }]);
    await createItem(snap.id, chunkId, 0.9, 0.1, 0, "J");

    const counts = {
      frame: await prisma.conversationRagFrame.count({ where: { conversationId: conv } }),
      snapshot: await prisma.conversationRagSnapshot.count({ where: { frame: { conversationId: conv } } }),
      item: await prisma.conversationRagSnapshotItem.count({ where: { snapshot: { frame: { conversationId: conv } } } }),
      src: await prisma.externalSource.count(),
      doc: await prisma.externalDocument.count(),
      chunk: await prisma.externalChunk.count(),
    };

    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${conv}/craft?ragFrameId=${frameId}`,
      headers: { cookie: user.cookie },
    });
    expect(res.statusCode).toBe(200);
    const gen = res.json().generation;
    expect(gen.meta.provider).toBe("null"); // nenhum provider real chamado

    expect(await prisma.conversationRagFrame.count({ where: { conversationId: conv } })).toBe(counts.frame);
    expect(await prisma.conversationRagSnapshot.count({ where: { frame: { conversationId: conv } } })).toBe(counts.snapshot);
    expect(await prisma.conversationRagSnapshotItem.count({ where: { snapshot: { frame: { conversationId: conv } } } })).toBe(counts.item);
    expect(await prisma.externalSource.count()).toBe(counts.src);
    expect(await prisma.externalDocument.count()).toBe(counts.doc);
    expect(await prisma.externalChunk.count()).toBe(counts.chunk);
  });
});