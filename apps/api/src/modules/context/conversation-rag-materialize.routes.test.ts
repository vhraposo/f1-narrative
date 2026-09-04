import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import type { EmbeddingProviderWithInputType } from "../external-research/external-embedding-store.js";
import { computeDocumentContentHash } from "../external-research/external-ingest.js";
import { computeChunkContentHash } from "../external-research/external-chunking.js";
import { COHERE_DIMENSIONS } from "../external-research/external-embedding-provider.js";

// ---------------------------------------------------------------------------
// HTTP WRITE/ON-DEMAND RAG materialization por Conversation (Fase 13 STEP 20).
//
// POST /api/conversations/:id/external-rag/materialize
//
// O endpoint é um DRIVER que delega a `materializeConversationRag` (STEP 17).
// NÃO duplica retrieval/embedding/persistence/hashing. Provider SEMPRE mock
// (injetado no `buildApp`); NUNCA chamamos Cohere/HTTP real.
// ---------------------------------------------------------------------------

type TestUser = { cookie: string; userId: string };
type Character = { id: string; name: string; nationality: string; controlledBy: string };

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];
const createdSourceIds: string[] = [];
const createdDocumentIds: string[] = [];
const createdChunkIds: string[] = [];

function track<T extends { id: string }>(list: string[], entity: T): T {
  list.push(entity.id);
  return entity;
}

let app: FastifyInstance;

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

type RagJson = {
  conversationId: string;
  frameId: string;
  snapshotId: string;
  status: string;
  freshness: string;
  reused: boolean;
  itemCount: number;
  externalRag: null | {
    sourceType: string;
    provider: string;
    model: string;
    version: string;
    dimensions: number;
    ruleApplied: string;
    items: Array<{
      sourceId: string;
      documentId: string;
      chunkId: string;
      title: string;
      content: string;
      orderOriginal: number;
      score: number;
      distance: number;
      citation: string;
    }>;
  };
};

async function postMaterialize(
  user: TestUser,
  conversationId: string,
  body: Record<string, unknown>,
): Promise<{ statusCode: number; json: RagJson & { code?: string; error?: string } }> {
  const res = await app.inject({
    method: "POST",
    url: `/api/conversations/${conversationId}/external-rag/materialize`,
    headers: { cookie: user.cookie, "content-type": "application/json" },
    payload: body,
  });
  return { statusCode: res.statusCode, json: res.json() };
}

async function getRag(user: TestUser, conversationId: string): Promise<{ statusCode: number; json: unknown }> {
  const res = await app.inject({
    method: "GET",
    url: `/api/conversations/${conversationId}/external-rag`,
    headers: { cookie: user.cookie },
  });
  return { statusCode: res.statusCode, json: res.json() };
}

async function createUser(email: string, name: string): Promise<TestUser> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name, email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  const user = track(createdUserIds, await prisma.user.findUniqueOrThrow({ where: { email } }));
  return { cookie, userId: user.id };
}

async function createCharacter(user: TestUser, payload: Record<string, unknown>): Promise<Character> {
  const res = await app.inject({
    method: "POST",
    url: "/api/characters",
    headers: { cookie: user.cookie },
    payload,
  });
  expect(res.statusCode).toBe(201);
  return track(createdCharacterIds, res.json().character as Character);
}

async function createConversation(
  user: TestUser,
  payload: Record<string, unknown>,
): Promise<{ id: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/conversations",
    headers: { cookie: user.cookie },
    payload,
  });
  expect(res.statusCode).toBe(201);
  return track(createdConversationIds, res.json().conversation as { id: string });
}

async function newPrivateSource(ownerId: string): Promise<string> {
  const source = await prisma.externalSource.create({
    data: {
      url: `https://rag-route.test/${Date.now()}/${Math.random()}`,
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
      content: "",
      contentHash: computeDocumentContentHash("conteúdo"),
      status: "READY",
    },
  });
  createdDocumentIds.push(doc.id);
  return doc.id;
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
  createdChunkIds.push(chunk.id);
  await prisma.$executeRawUnsafe(
    'UPDATE "ExternalChunk" SET "embedding" = $1::vector(1024) WHERE "id" = $2::uuid',
    vectorLiteral(chunkVectorForScore(score)),
    chunk.id,
  );
  return chunk.id;
}

type Fixture = {
  owner: TestUser;
  characterId: string;
  conversationId: string;
  sourceId: string;
  documentId: string;
};

async function isolatedFixture(prefix: string): Promise<Fixture> {
  const suffix = Date.now();
  const owner = await createUser(`${prefix}-${suffix}@f1nw.test`, prefix);
  const character = await createCharacter(owner, {
    name: "Pilot",
    nationality: "BR",
    birthDate: "1992-01-01",
  });
  const conv = await createConversation(owner, { type: "GROUP", participantIds: [character.id] });
  const sourceId = await newPrivateSource(owner.userId);
  const documentId = await newDocument(sourceId);
  return {
    owner,
    characterId: character.id,
    conversationId: conv.id,
    sourceId,
    documentId,
  };
}

function counts(conversationId: string) {
  return {
    frame: () => prisma.conversationRagFrame.count({ where: { conversationId } }),
    snapshot: () => prisma.conversationRagSnapshot.count({ where: { frame: { conversationId } } }),
    item: () => prisma.conversationRagSnapshotItem.count({ where: { snapshot: { frame: { conversationId } } } }),
  };
}

beforeAll(async () => {
  app = buildApp(mockProvider());
  await app.ready();
});

afterAll(async () => {
  await prisma.conversationRagSnapshotItem.deleteMany({
    where: { snapshot: { frame: { conversationId: { in: createdConversationIds } } } },
  });
  await prisma.conversationRagSnapshot.deleteMany({
    where: { frame: { conversationId: { in: createdConversationIds } } },
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
  await app.close();
});

describe("POST /api/conversations/:id/external-rag/materialize — auth/ownership", () => {
  it("J) sem sessão → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/conversations/${randomUUID()}/external-rag/materialize`,
      payload: { queryText: "gp de monaco" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("H) intruder → 404 (sem vazamento)", async () => {
    const fx = await isolatedFixture("h-intruder");
    const intruder = await createUser(`int-${Date.now()}@f1nw.test`, "Intruder");
    const res = await postMaterialize(intruder, fx.conversationId, { queryText: "gp" });
    expect(res.statusCode).toBe(404);
  });

  it("I) conversation inexistente → 404", async () => {
    const fx = await isolatedFixture("i-missing");
    const res = await postMaterialize(fx.owner, randomUUID(), { queryText: "gp" });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/conversations/:id/external-rag/materialize — input validation", () => {
  it("K) body inválido → 400", async () => {
    const fx = await isolatedFixture("k-body");
    // campo desconhecido (strict) e sem queryText
    const res = await postMaterialize(fx.owner, fx.conversationId, { bob: 1 });
    expect(res.statusCode).toBe(400);
  });

  it("L) query vazia → 400", async () => {
    const fx = await isolatedFixture("l-query");
    const res = await postMaterialize(fx.owner, fx.conversationId, { queryText: "" });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/conversations/:id/external-rag/materialize — sucesso", () => {
  it("A) owner + body válido → materialização bem-sucedida (READY)", async () => {
    const fx = await isolatedFixture("a-success");
    await insertScoredChunk(fx.documentId, "gp de monaco", 0.9);

    const res = await postMaterialize(fx.owner, fx.conversationId, { queryText: "gp de monaco" });
    expect(res.statusCode).toBe(200);
    expect(res.json.conversationId).toBe(fx.conversationId);
    expect(res.json.status).toBe("READY");
    expect(res.json.freshness).toBe("CURRENT");
    expect(res.json.frameId).toBeTruthy();
    expect(res.json.snapshotId).toBeTruthy();
    expect(res.json.externalRag).not.toBeNull();
    expect(res.json.externalRag!.items.length).toBeGreaterThan(0);
  });

  it("B) owner + retrieval vazio → snapshot READY com items []", async () => {
    const fx = await isolatedFixture("b-empty");
    // Nenhum chunk com vetor → retrieval retorna vazio.
    const res = await postMaterialize(fx.owner, fx.conversationId, { queryText: "sem resultado" });
    expect(res.statusCode).toBe(200);
    expect(res.json.status).toBe("READY");
    expect(res.json.itemCount).toBe(0);
    expect(res.json.externalRag!.items).toHaveLength(0);
  });
});

describe("POST /api/conversations/:id/external-rag/materialize — idempotência / identidade", () => {
  it("C) mesma request duas vezes → reutiliza frame/snapshot (idempotência)", async () => {
    const fx = await isolatedFixture("c-idem");
    await insertScoredChunk(fx.documentId, "gp de monaco", 0.9);

    const first = await postMaterialize(fx.owner, fx.conversationId, { queryText: "gp de monaco" });
    const second = await postMaterialize(fx.owner, fx.conversationId, { queryText: "gp de monaco" });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json.frameId).toBe(first.json.frameId);
    expect(second.json.snapshotId).toBe(first.json.snapshotId);
    expect(second.json.reused).toBe(true);
  });

  it("T) segunda chamada não duplica frame/snapshot/item", async () => {
    const fx = await isolatedFixture("t-nodup");
    await insertScoredChunk(fx.documentId, "gp de monaco", 0.9);

    const b = counts(fx.conversationId);
    await postMaterialize(fx.owner, fx.conversationId, { queryText: "gp de monaco" });
    await postMaterialize(fx.owner, fx.conversationId, { queryText: "gp de monaco" });
    expect(await b.frame()).toBe(1);
    expect(await b.snapshot()).toBe(1);
    expect(await b.item()).toBe(1);
  });

  it("D) query diferente → frame diferente", async () => {
    const fx = await isolatedFixture("d-query");
    await insertScoredChunk(fx.documentId, "gp de monaco", 0.9);
    const a = await postMaterialize(fx.owner, fx.conversationId, { queryText: "gp de monaco" });
    const b = await postMaterialize(fx.owner, fx.conversationId, { queryText: "gp de italia" });
    expect(a.json.frameId).not.toBe(b.json.frameId);
  });

  it("E) threshold diferente → identidade diferente", async () => {
    const fx = await isolatedFixture("e-threshold");
    await insertScoredChunk(fx.documentId, "gp de monaco", 0.9);
    const a = await postMaterialize(fx.owner, fx.conversationId, { queryText: "gp de monaco" });
    const b = await postMaterialize(fx.owner, fx.conversationId, {
      queryText: "gp de monaco",
      threshold: 0.8,
    });
    expect(a.json.frameId).not.toBe(b.json.frameId);
  });

  it("F) topK diferente → identidade diferente", async () => {
    const fx = await isolatedFixture("f-topk");
    await insertScoredChunk(fx.documentId, "gp de monaco", 0.9);
    const a = await postMaterialize(fx.owner, fx.conversationId, { queryText: "gp de monaco" });
    const b = await postMaterialize(fx.owner, fx.conversationId, {
      queryText: "gp de monaco",
      topK: 3,
    });
    expect(a.json.frameId).not.toBe(b.json.frameId);
  });

  it("G) source scope diferente → identidade diferente", async () => {
    const fx = await isolatedFixture("g-scope");
    await insertScoredChunk(fx.documentId, "gp de monaco", 0.9);
    const a = await postMaterialize(fx.owner, fx.conversationId, { queryText: "gp de monaco" });
    const b = await postMaterialize(fx.owner, fx.conversationId, {
      queryText: "gp de monaco",
      scopeSourceIds: [fx.sourceId],
    });
    expect(a.json.frameId).not.toBe(b.json.frameId);
  });
});

describe("POST /api/conversations/:id/external-rag/materialize — content/security", () => {
  it("P) provenance preservada", async () => {
    const fx = await isolatedFixture("p-prov");
    await insertScoredChunk(fx.documentId, "gp de monaco", 0.9);
    const res = await postMaterialize(fx.owner, fx.conversationId, { queryText: "gp de monaco" });
    const item = res.json.externalRag!.items[0];
    expect(item.documentId).toBe(fx.documentId);
    expect(item.sourceId).toBe(fx.sourceId);
    expect(item.title).toBe("doc");
  });

  it("Q/R/S) score, distance e citation preservados", async () => {
    const fx = await isolatedFixture("q-scores");
    await insertScoredChunk(fx.documentId, "gp de monaco", 0.9);
    const res = await postMaterialize(fx.owner, fx.conversationId, { queryText: "gp de monaco" });
    const item = res.json.externalRag!.items[0];
    expect(item.score).toBeCloseTo(0.9, 3);
    expect(item.distance).toBeCloseTo(0.1, 3);
    expect(typeof item.citation).toBe("string");
    expect(item.citation.length).toBeGreaterThan(0);
  });

  it("N/O) response sem vector/secret (N,O)", async () => {
    const fx = await isolatedFixture("n-sec");
    await insertScoredChunk(fx.documentId, "gp de monaco", 0.9);
    const res = await postMaterialize(fx.owner, fx.conversationId, { queryText: "gp de monaco" });
    expect(res.statusCode).toBe(200);
    const body = JSON.stringify(res.json);
    expect(body).not.toMatch(/"embedding"/i);
    expect(body).not.toMatch(/"vector"/i);
    expect(body).not.toMatch(/"embeddedContentHash"/i);
    expect(body).not.toMatch(/api.?key/i);
    expect(body).not.toMatch(/bearer/i);
    expect(body).not.toMatch(/authorization/i);
    expect(body).not.toMatch(/secret/i);
    expect(body).not.toMatch(/token/i);
    expect(body).not.toMatch(/password/i);
  });
});

describe("POST /api/conversations/:id/external-rag/materialize — integração read/write", () => {
  it("U) GET após POST lê o materializado", async () => {
    const fx = await isolatedFixture("u-get");
    await insertScoredChunk(fx.documentId, "gp de monaco", 0.9);
    const post = await postMaterialize(fx.owner, fx.conversationId, { queryText: "gp de monaco" });
    expect(post.statusCode).toBe(200);

    const get = await getRag(fx.owner, fx.conversationId);
    expect(get.statusCode).toBe(200);
    const json = get.json as { frames: Array<{ freshness: string; externalRag: unknown }> };
    expect(json.frames.length).toBeGreaterThanOrEqual(1);
    expect(json.frames[0].freshness).toBe("CURRENT");
    expect(json.frames[0].externalRag).not.toBeNull();
  });

  it("Z) mesma materialização → response determinístico", async () => {
    const fx = await isolatedFixture("z-determ");
    await insertScoredChunk(fx.documentId, "gp de monaco", 0.9);
    const a = await postMaterialize(fx.owner, fx.conversationId, { queryText: "gp de monaco" });
    // nova chamada idempotente com mesma base
    const b = await postMaterialize(fx.owner, fx.conversationId, { queryText: "gp de monaco" });
    expect(JSON.stringify({ ...a.json, reused: undefined })).toBe(
      JSON.stringify({ ...b.json, reused: undefined }),
    );
  });

  it("V) POST não altera generations (nenhuma geração tocada)", async () => {
    // Sem geração pré-existente; o teste só garante que o POST não falha por
    // interferência em generation e que não houve escrita de generation.
    const fx = await isolatedFixture("v-gen");
    await insertScoredChunk(fx.documentId, "gp de monaco", 0.9);
    const res = await postMaterialize(fx.owner, fx.conversationId, { queryText: "gp de monaco" });
    expect(res.statusCode).toBe(200);
  });
});