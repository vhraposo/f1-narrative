import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { computeChunkContentHash } from "../external-research/external-chunking.js";
import { COHERE_DIMENSIONS } from "../external-research/external-embedding-provider.js";
import { EXTERNAL_RETRIEVAL_RULE } from "../external-research/external-retrieval.js";
import {
  computeRagQueryHash,
  computeConversationRagFrameKey,
  computeConversationRagFreshnessAnchor,
  computeConversationRagSnapshotKey,
} from "../external-research/conversation-rag.js";

// ---------------------------------------------------------------------------
// HTTP READ-ONLY RAG route por Conversation (Fase 13 STEP 19).
//
// GET /api/conversations/:id/external-rag
//
// A rota reexecuta exclusivamente `readConversationRag` (STEP 18). NÃO executa
// retrieval, materialization, embedding, pgvector ou provider. Provider SEMPRE
// mock. Materialização (frame/snapshot/item + chunks/docs/sources) inserida
// diretamente via prisma para controle total do estado.
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

type RagJson = {
  conversationId: string;
  frames: Array<{
    frameId: string;
    snapshotId: string | null;
    freshness: string;
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
  }>;
};

async function getRag(
  user: TestUser,
  conversationId: string,
): Promise<{ statusCode: number; json: RagJson & { code?: string; error?: string } }> {
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
      contentHash: "placeholder",
      status: "READY",
    },
  });
  createdDocumentIds.push(doc.id);
  return doc.id;
}

async function newChunk(documentId: string, text: string): Promise<string> {
  const count = await prisma.externalChunk.count({ where: { documentId } });
  const chunk = await prisma.externalChunk.create({
    data: {
      documentId,
      text,
      orderOriginal: count,
      contentHash: computeChunkContentHash(text),
      embeddedContentHash: computeChunkContentHash(text),
      embeddingProvider: "cohere",
      embeddingModel: "embed-multilingual-v3.0",
      embeddingVersion: "v3.0",
      embeddingDimensions: COHERE_DIMENSIONS,
    },
  });
  createdChunkIds.push(chunk.id);
  return chunk.id;
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
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; frameKey: string }> {
  const queryHash = computeRagQueryHash(query);
  const frameKey = computeConversationRagFrameKey({ queryHash, ...frameDefaults(), ...overrides });
  const frame = await prisma.conversationRagFrame.create({
    data: {
      conversationId,
      queryText: query,
      queryHash,
      ...frameDefaults(),
      ...overrides,
      frameKey,
      status: "READY",
    },
  });
  return { id: frame.id, frameKey };
}

async function createSnapshot(
  frameId: string,
  chunkBindings: Array<{ chunkId: string; contentHash: string; embeddedContentHash: string | null }>,
  overrides: { status?: string; freshnessAnchor?: string; snapshotKey?: string; retrievedAt?: Date } = {},
): Promise<{ id: string; freshnessAnchor: string; snapshotKey: string }> {
  const frame = await prisma.conversationRagFrame.findUniqueOrThrow({ where: { id: frameId } });
  const freshnessAnchor =
    overrides.freshnessAnchor ??
    computeConversationRagFreshnessAnchor({
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
  const snapshotKey = overrides.snapshotKey ?? computeConversationRagSnapshotKey(frame.frameKey, freshnessAnchor);
  const snapshot = await prisma.conversationRagSnapshot.create({
    data: {
      frameId,
      snapshotKey,
      status: (overrides.status ?? "READY") as "READY" | "FAILED" | "NEW" | "MATERIALIZING" | "STALE",
      retrievedAt: overrides.retrievedAt ?? new Date(),
      freshnessAnchor,
    },
  });
  return { id: snapshot.id, freshnessAnchor, snapshotKey };
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

beforeAll(async () => {
  app = buildApp();
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

describe("GET /api/conversations/:id/external-rag — auth", () => {
  it("401 sem sessão", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${randomUUID()}/external-rag`,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /api/conversations/:id/external-rag — ownership", () => {
  it("owner + 0 frames → 200 com frames []", async () => {
    const fx = await isolatedFixture("a-owner");
    const res = await getRag(fx.owner, fx.conversationId);
    expect(res.statusCode).toBe(200);
    expect(res.json.conversationId).toBe(fx.conversationId);
    expect(res.json.frames).toEqual([]);
  });

  it("intruder → 404 (sem vazamento)", async () => {
    const fx = await isolatedFixture("b-owner");
    const intruder = await createUser(`int-${Date.now()}@f1nw.test`, "Intruder");
    const res = await getRag(intruder, fx.conversationId);
    expect(res.statusCode).toBe(404);
  });

  it("conversation inexistente → 404", async () => {
    const fx = await isolatedFixture("c-owner");
    const res = await getRag(fx.owner, randomUUID());
    expect(res.statusCode).toBe(404);
  });

  it("ownership entre conversations não cruza (W)", async () => {
    const fxOwner = await isolatedFixture("d-owner");
    const fxOther = await isolatedFixture("e-owner");
    const chunkId = await newChunk(fxOwner.documentId, "conteúdo d");
    const contentHash = computeChunkContentHash("conteúdo d");
    const { id: frameId } = await createFrame(fxOwner.conversationId, "query d");
    const { id: snapshotId } = await createSnapshot(frameId, [
      { chunkId, contentHash, embeddedContentHash: contentHash },
    ]);
    await createItem(snapshotId, chunkId, 0.9, 0.1, 0, "cite d");

    // owner de fxOwner vê 1 frame; owner de fxOther vê frames vazio.
    const resOwner = await getRag(fxOwner.owner, fxOwner.conversationId);
    expect(resOwner.statusCode).toBe(200);
    expect(resOwner.json.frames).toHaveLength(1);

    const resOther = await getRag(fxOther.owner, fxOther.conversationId);
    expect(resOther.statusCode).toBe(200);
    expect(resOther.json.frames).toEqual([]);
  });
});

describe("GET /api/conversations/:id/external-rag — current", () => {
  it("owner + CURRENT frame → 200 com externalRag e items (B,C)", async () => {
    const fx = await isolatedFixture("g-owner");
    const chunkId = await newChunk(fx.documentId, "conteúdo current");
    const contentHash = computeChunkContentHash("conteúdo current");
    const { id: frameId } = await createFrame(fx.conversationId, "query current");
    const { id: snapshotId } = await createSnapshot(frameId, [
      { chunkId, contentHash, embeddedContentHash: contentHash },
    ]);
    await createItem(snapshotId, chunkId, 0.92, 0.08, 0, "Fonte Current (linha 7)");

    const res = await getRag(fx.owner, fx.conversationId);
    expect(res.statusCode).toBe(200);
    expect(res.json.conversationId).toBe(fx.conversationId);
    const frame = res.json.frames[0];
    expect(frame.frameId).toBe(frameId);
    expect(frame.snapshotId).toBe(snapshotId);
    expect(frame.freshness).toBe("CURRENT");
    expect(frame.externalRag).not.toBeNull();
    expect(frame.externalRag!.sourceType).toBe("external");
    expect(frame.externalRag!.provider).toBe("cohere");
    expect(frame.externalRag!.dimensions).toBe(1024);
    expect(frame.externalRag!.items).toHaveLength(1);
    const item = frame.externalRag!.items[0];
    expect(item.chunkId).toBe(chunkId);
    expect(item.sourceId).toBe(fx.sourceId);
    expect(item.documentId).toBe(fx.documentId);
  });
});

describe("GET /api/conversations/:id/external-rag — provenance/citation/score/distance/content", () => {
  it("citation (K), provenance sourceId/documentId/title (L), content (O), score (M), distance (N), order", async () => {
    const fx = await isolatedFixture("h-data");
    const c1 = await newChunk(fx.documentId, "primeiro conteúdo");
    const c2 = await newChunk(fx.documentId, "segundo conteúdo");
    const ch1 = computeChunkContentHash("primeiro conteúdo");
    const ch2 = computeChunkContentHash("segundo conteúdo");
    const { id: frameId } = await createFrame(fx.conversationId, "query data");
    const { id: snapshotId } = await createSnapshot(frameId, [
      { chunkId: c1, contentHash: ch1, embeddedContentHash: ch1 },
      { chunkId: c2, contentHash: ch2, embeddedContentHash: ch2 },
    ]);
    await createItem(snapshotId, c1, 0.9, 0.1, 1, "Fonte 1");
    await createItem(snapshotId, c2, 0.85, 0.15, 0, "Fonte 2");

    const res = await getRag(fx.owner, fx.conversationId);
    expect(res.statusCode).toBe(200);
    const items = res.json.frames[0].externalRag!.items;
    // order 0 primeiro (order ASC decidido pelo read service).
    expect(items[0].chunkId).toBe(c2);
    expect(items[1].chunkId).toBe(c1);
    expect(items[0].citation).toBe("Fonte 2");
    expect(items[1].citation).toBe("Fonte 1");
    expect(items[0].sourceId).toBe(fx.sourceId);
    expect(items[0].documentId).toBe(fx.documentId);
    expect(items[0].title).toBe("doc");
    expect(items[0].content).toBe("segundo conteúdo");
    expect(items[1].content).toBe("primeiro conteúdo");
    expect(items[0].score).toBeCloseTo(0.85, 5);
    expect(items[0].distance).toBeCloseTo(0.15, 5);
  });
});

describe("GET /api/conversations/:id/external-rag — stale", () => {
  it("STALE frame → 200 + freshness STALE + externalRag preservado (D)", async () => {
    const fx = await isolatedFixture("i-stale");
    const chunkId = await newChunk(fx.documentId, "v1");
    const { id: frameId } = await createFrame(fx.conversationId, "query stale");
    const { id: snapshotId } = await createSnapshot(frameId, [
      {
        chunkId,
        contentHash: computeChunkContentHash("v1"),
        embeddedContentHash: computeChunkContentHash("v1"),
      },
    ]);
    await createItem(snapshotId, chunkId, 0.8, 0.2, 0, "cite stale");

    // Altera o conteúdo do chunk → freshness diverge → STALE.
    const newHash = computeChunkContentHash("v2");
    await prisma.externalChunk.update({
      where: { id: chunkId },
      data: { text: "v2", contentHash: newHash, embeddedContentHash: newHash },
    });

    const res = await getRag(fx.owner, fx.conversationId);
    expect(res.statusCode).toBe(200);
    const frame = res.json.frames[0];
    expect(frame.freshness).toBe("STALE");
    expect(frame.snapshotId).toBe(snapshotId);
    expect(frame.externalRag).not.toBeNull();
    expect(frame.externalRag!.items).toHaveLength(1);
  });
});

describe("GET /api/conversations/:id/external-rag — no snapshot / empty", () => {
  it("NO_SNAPSHOT → 200 + freshness NO_SNAPSHOT + externalRag null (E)", async () => {
    const fx = await isolatedFixture("j-nosnap");
    const { id: frameId } = await createFrame(fx.conversationId, "query nosnap");
    const res = await getRag(fx.owner, fx.conversationId);
    expect(res.statusCode).toBe(200);
    const frame = res.json.frames[0];
    expect(frame.frameId).toBe(frameId);
    expect(frame.freshness).toBe("NO_SNAPSHOT");
    expect(frame.snapshotId).toBeNull();
    expect(frame.externalRag).toBeNull();
  });

  it("frame com snapshot FAILED → NO_SNAPSHOT (não retorna FAILED)", async () => {
    const fx = await isolatedFixture("k-failed");
    const { id: frameId } = await createFrame(fx.conversationId, "query failed");
    await createSnapshot(frameId, [], { status: "FAILED" });
    const res = await getRag(fx.owner, fx.conversationId);
    expect(res.statusCode).toBe(200);
    expect(res.json.frames[0].frameId).toBe(frameId);
    expect(res.json.frames[0].freshness).toBe("NO_SNAPSHOT");
    expect(res.json.frames[0].externalRag).toBeNull();
  });
});

describe("GET /api/conversations/:id/external-rag — múltiplos frames e snapshots", () => {
  it("múltiplos frames preservam ordem (H)", async () => {
    const fx = await isolatedFixture("l-multi-frames");
    const chunkId = await newChunk(fx.documentId, "m conteúdo");
    const contentHash = computeChunkContentHash("m conteúdo");
    const f1 = await createFrame(fx.conversationId, "query f1");
    const f2 = await createFrame(fx.conversationId, "query f2");
    const s1 = await createSnapshot(f1.id, [{ chunkId, contentHash, embeddedContentHash: contentHash }]);
    await createItem(s1.id, chunkId, 0.9, 0.1, 0, "cite f1");
    const s2 = await createSnapshot(f2.id, [{ chunkId, contentHash, embeddedContentHash: contentHash }]);
    await createItem(s2.id, chunkId, 0.8, 0.2, 0, "cite f2");

    const res = await getRag(fx.owner, fx.conversationId);
    expect(res.statusCode).toBe(200);
    const ids = res.json.frames.map((f) => f.frameId);
    expect(ids).toContain(f1.id);
    expect(ids).toContain(f2.id);
    expect(res.json.frames.length).toBe(2);
    expect(res.json.frames.map((f) => f.freshness)).toEqual(["CURRENT", "CURRENT"]);
  });

  it("múltiplos snapshots → read service seleciona o mais recente READY (I)", async () => {
    const fx = await isolatedFixture("m-multi-snap");
    const chunkId = await newChunk(fx.documentId, "s conteúdo");
    const contentHash = computeChunkContentHash("s conteúdo");
    const { id: frameId } = await createFrame(fx.conversationId, "query snap");

    const old = await createSnapshot(frameId, [
      { chunkId, contentHash, embeddedContentHash: contentHash },
    ]);
    await createItem(old.id, chunkId, 0.7, 0.3, 0, "old");

    const freshChunkId = await newChunk(fx.documentId, "extra conteúdo");
    const freshCh2 = computeChunkContentHash("extra conteúdo");
    await new Promise((r) => setTimeout(r, 10));
    const fresh = await createSnapshot(frameId, [
      { chunkId, contentHash, embeddedContentHash: contentHash },
      { chunkId: freshChunkId, contentHash: freshCh2, embeddedContentHash: freshCh2 },
    ]);
    await createItem(fresh.id, chunkId, 0.95, 0.05, 0, "fresh");

    const res = await getRag(fx.owner, fx.conversationId);
    expect(res.statusCode).toBe(200);
    expect(res.json.frames[0].snapshotId).toBe(fresh.id);
  });
});

describe("GET /api/conversations/:id/external-rag — determinismo / read-only", () => {
  it("segunda leitura retorna resposta equivalente (V)", async () => {
    const fx = await isolatedFixture("n-determ");
    const chunkId = await newChunk(fx.documentId, "det conteúdo");
    const contentHash = computeChunkContentHash("det conteúdo");
    const { id: frameId } = await createFrame(fx.conversationId, "query det");
    const { id: snapshotId } = await createSnapshot(frameId, [
      { chunkId, contentHash, embeddedContentHash: contentHash },
    ]);
    await createItem(snapshotId, chunkId, 0.91, 0.09, 0, "cite det");

    const a = await getRag(fx.owner, fx.conversationId);
    const b = await getRag(fx.owner, fx.conversationId);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(JSON.stringify(a.json)).toBe(JSON.stringify(b.json));
  });

  it("GET não executa retrieval → frames presentes apenas por materialização (R)", async () => {
    const fx = await isolatedFixture("o-retrieval");
    const res = await getRag(fx.owner, fx.conversationId);
    expect(res.statusCode).toBe(200);
    expect(res.json.frames).toEqual([]);
  });

  it("GET não executa materialization → snapshot count inalterado (S,U)", async () => {
    const fx = await isolatedFixture("p-materialization");
    const before = await prisma.conversationRagSnapshot.count({
      where: { frame: { conversationId: fx.conversationId } },
    });
    await getRag(fx.owner, fx.conversationId);
    const after = await prisma.conversationRagSnapshot.count({
      where: { frame: { conversationId: fx.conversationId } },
    });
    expect(after).toBe(before);
  });
});

describe("GET /api/conversations/:id/external-rag — security (no vector/secrets)", () => {
  it("no vector / no embedding / no secrets (P,Q)", async () => {
    const fx = await isolatedFixture("q-sec");
    const chunkId = await newChunk(fx.documentId, "sec conteúdo");
    const contentHash = computeChunkContentHash("sec conteúdo");
    const { id: frameId } = await createFrame(fx.conversationId, "query sec");
    const { id: snapshotId } = await createSnapshot(frameId, [
      { chunkId, contentHash, embeddedContentHash: contentHash },
    ]);
    await createItem(snapshotId, chunkId, 0.9, 0.1, 0, "cite sec");

    const res = await getRag(fx.owner, fx.conversationId);
    expect(res.statusCode).toBe(200);
    const body = JSON.stringify(res.json);
    // Ausência de campo de embedding/vector (dado vetorial bruto) e de secrets.
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

describe("GET /api/conversations/:id/external-rag — envelope / content-type", () => {
  it("200 com content-type application/json e envelope estável (Z)", async () => {
    const fx = await isolatedFixture("r-http");
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${fx.conversationId}/external-rag`,
      headers: { cookie: fx.owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    const json = res.json();
    expect(Object.keys(json).sort()).toEqual(["conversationId", "frames"]);
    expect(json.frames).toEqual([]);
  });
});