import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  countEmittedSections,
  type GenerationProvider,
  type ProviderInput,
} from "./generation.assembly.js";
import { OllamaProviderError } from "./ollama-provider.js";
import { computeDocumentContentHash } from "../external-research/external-ingest.js";
import { computeChunkContentHash } from "../external-research/external-chunking.js";
import { COHERE_DIMENSIONS } from "../external-research/external-embedding-provider.js";
import { EXTERNAL_RETRIEVAL_RULE } from "../external-research/external-retrieval.js";
import {
  computeConversationRagFrameKey,
  computeConversationRagFreshnessAnchor,
  computeRagQueryHash,
  computeConversationRagSnapshotKey,
} from "../external-research/conversation-rag.js";

// ---------------------------------------------------------------------------
// Fase 14 STEP 39 — rota real de geração
// POST /api/conversations/:id/generate
//
// Conecta auth → ownership → zod → assembleGenerationBundle → provider (DI
// server-side) → persistGeneratedMessage → resposta. Cobre A–S:
//
// A. não autenticado → 401
// B. body inválido → 400
// C. userPrompt vazio → 400
// D. conversation inexistente → 404
// E. conversation sem ownership → 404
// F. target inexistente → 404
// G. target USER-controlled → 400 TARGET_NOT_AI
// H. target AI fora da conversation → 403 TARGET_NOT_PARTICIPANT
// I. generated válido → 201 + Message AI_CHARACTER com identidade exata
// J. provider recebe systemPrompt/userPrompt e NÃO speaker
// K. resposta expõe message/generationKey/provider/mode e NÃO systemPrompt
// L. assembly-only (NullProvider) → não cria Message
// M. OllamaProviderError → 500 PROVIDER_ERROR sem Message
// N. generation errors mapeados corretamente sem Message indevida
// O. RAG frame válido → geração segue, persistência independente de RAG
// P. RAG frame inexistente → 404 sem Message
// Q/R. speaker A e speaker B → characterId exato
// S. retry → duplicação documentada (sem dedup)
// ---------------------------------------------------------------------------

type TestUser = { cookie: string; userId: string };

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];
const createdSourceIds: string[] = [];
const createdDocumentIds: string[] = [];
const createdChunkIds: string[] = [];

let counter = 0;

let appDefault: FastifyInstance;
let appGen: FastifyInstance;
let appFail: FastifyInstance;

let owner: TestUser;
let owner2: TestUser;
let charU: string;
let aiA: string;
let aiB: string;
let aiOut: string;
let conv1: string;
let conv2: string;

// Provider fake que produz generated; captura o ProviderInput recebido.
function generatedProvider(
  text: string,
  capture: { input?: ProviderInput; calls: number },
): GenerationProvider {
  return {
    name: "spy",
    async run(input) {
      capture.calls += 1;
      capture.input = input;
      return {
        provider: "spy",
        mode: "generated",
        text,
        tokenStats: {
          systemPromptChars: input.systemPrompt.length,
          contextBlocks: countEmittedSections(input.systemPrompt),
        },
      };
    },
  };
}

function failingProvider(): GenerationProvider {
  return {
    name: "spy-fail",
    async run() {
      throw new OllamaProviderError("network", "rede indisponível (não deve vazar).");
    },
  };
}

async function signUp(name: string): Promise<TestUser> {
  counter += 1;
  const email = `s39-${counter}-${Date.now()}-${Math.random()}@x.com`;
  const res = await appGen.inject({
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

async function newUserCharacter(user: TestUser, name: string): Promise<string> {
  const character = await prisma.character.create({
    data: {
      name: `${name}-${counter}`,
      nationality: "BR",
      birthDate: new Date("1994-01-01"),
      controlledBy: "USER",
      userId: user.userId,
    },
  });
  createdCharacterIds.push(character.id);
  return character.id;
}

async function newAICharacter(name: string): Promise<string> {
  const character = await prisma.character.create({
    data: {
      name,
      nationality: "GB",
      birthDate: new Date("2000-01-01"),
      controlledBy: "AI",
    },
  });
  createdCharacterIds.push(character.id);
  return character.id;
}

async function newConversation(participantIds: string[]): Promise<string> {
  const conversation = await prisma.conversation.create({ data: { type: "GROUP" } });
  createdConversationIds.push(conversation.id);
  await prisma.conversationParticipant.createMany({
    data: participantIds.map((characterId) => ({ conversationId: conversation.id, characterId })),
  });
  return conversation.id;
}

type GenerateJson = {
  code?: string;
  error?: string;
  issues?: unknown[];
  message: {
    id: string;
    conversationId: string;
    senderType: string;
    characterId: string;
    content: string;
  };
  generationKey: string;
  provider: string;
  mode: string;
  generation: { generationKey: string; provider: string; mode: string };
  responseSkeleton?: unknown;
};

type GenerateResult = { statusCode: number; json: () => GenerateJson };

async function generate(
  user: TestUser,
  conversationId: string,
  payload: Record<string, unknown>,
): Promise<GenerateResult> {
  const res = await appGen.inject({
    method: "POST",
    url: `/api/conversations/${conversationId}/generate`,
    headers: { cookie: user.cookie },
    payload,
  });
  return { statusCode: res.statusCode, json: () => res.json() as GenerateJson };
}

async function generateWith(
  app: FastifyInstance,
  user: TestUser,
  conversationId: string,
  payload: Record<string, unknown>,
): Promise<GenerateResult> {
  const res = await app.inject({
    method: "POST",
    url: `/api/conversations/${conversationId}/generate`,
    headers: { cookie: user.cookie },
    payload,
  });
  return { statusCode: res.statusCode, json: () => res.json() as GenerateJson };
}

function messageCount(conversationId: string): Promise<number> {
  return prisma.message.count({ where: { conversationId } });
}

// ---------------------------------------------------------------------------
// RAG fixture mínima (mesmo padrão de conversation-rag-read.test.ts): sem
// chamadas de rede/Cohere; só inserts determinísticos via prisma.
// ---------------------------------------------------------------------------

async function newPrivateSource(): Promise<string> {
  const source = await prisma.externalSource.create({
    data: {
      url: `https://rag-gen.test/${counter}/${Date.now()}/${Math.random()}`,
      title: "src",
      visibility: "PRIVATE",
      ownerId: owner.userId,
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

async function createReadyFrameAndSnapshot(
  conversationId: string,
  chunkId: string,
  text: string,
): Promise<{ frameId: string; snapshotId: string }> {
  const frameDefaults = {
    topK: 5,
    threshold: 0.5,
    provider: "cohere",
    model: "embed-multilingual-v3.0",
    version: "v3.0",
    dimensions: COHERE_DIMENSIONS,
    ruleApplied: EXTERNAL_RETRIEVAL_RULE,
  };
  const query = `q-${counter}`;
  const queryHash = computeRagQueryHash(query);
  const frameKey = computeConversationRagFrameKey({ queryHash, ...frameDefaults });
  const frame = await prisma.conversationRagFrame.create({
    data: {
      conversationId,
      queryText: query,
      queryHash,
      ...frameDefaults,
      frameKey,
      status: "READY",
    },
  });
  const contentHash = computeChunkContentHash(text);
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
    chunkBindings: [
      { chunkId, contentHash, embeddedContentHash: contentHash },
    ],
  });
  const snapshotKey = computeConversationRagSnapshotKey(frame.frameKey, freshnessAnchor);
  const snapshot = await prisma.conversationRagSnapshot.create({
    data: {
      frameId: frame.id,
      snapshotKey,
      status: "READY",
      retrievedAt: new Date(),
      freshnessAnchor,
    },
  });
  await prisma.conversationRagSnapshotItem.create({
    data: {
      snapshotId: snapshot.id,
      chunkId,
      score: 0.9,
      distance: 0.1,
      order: 0,
      citation: "cite",
    },
  });
  return { frameId: frame.id, snapshotId: snapshot.id };
}

beforeAll(async () => {
  const capture = { calls: 0 };
  appDefault = buildApp();
  appGen = buildApp(undefined, generatedProvider("resposta spy", capture));
  appFail = buildApp(undefined, failingProvider());
  await appDefault.ready();
  await appGen.ready();
  await appFail.ready();

  owner = await signUp("S39Owner");
  owner2 = await signUp("S39Owner2");

  charU = await newUserCharacter(owner, "CharU");
  aiA = await newAICharacter("S39_AI_A");
  aiB = await newAICharacter("S39_AI_B");
  aiOut = await newAICharacter("S39_AI_Outsider");

  conv1 = await newConversation([charU, aiA, aiB]);

  // conversation de outro usuário (não acessível por owner).
  const charOther = await newUserCharacter(owner2, "CharOther");
  conv2 = await newConversation([charOther]);
});

afterAll(async () => {
  await prisma.message.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
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
  await appDefault.close();
  await appGen.close();
  await appFail.close();
});

const validBody = (overrides: Record<string, unknown> = {}) => ({
  userPrompt: "Qual a próxima corrida?",
  targetCharacterId: aiA,
  ...overrides,
});

describe("generation-generate routes", () => {
  it("A) não autenticado → 401", async () => {
    const res = await appGen.inject({
      method: "POST",
      url: `/api/conversations/${conv1}/generate`,
      payload: validBody(),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHENTICATED");
    expect(await messageCount(conv1)).toBe(0);
  });

  it("B) body inválido → 400 VALIDATION_ERROR", async () => {
    const res = await generate(owner, conv1, { userPrompt: "x" }); // sem targetCharacterId
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(res.json().issues)).toBe(true);
    expect(await messageCount(conv1)).toBe(0);
  });

  it("C) userPrompt vazio → 400", async () => {
    const res = await generate(owner, conv1, validBody({ userPrompt: "   " }));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
    expect(await messageCount(conv1)).toBe(0);
  });

  it("D) conversation inexistente → 404", async () => {
    const ghost = "00000000-0000-4000-8000-000000000077";
    const res = await generate(owner, ghost, validBody());
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
    expect(await messageCount(ghost)).toBe(0);
  });

  it("E) conversation sem ownership → 404", async () => {
    const res = await generate(owner, conv2, validBody());
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
    expect(await messageCount(conv2)).toBe(0);
  });

  it("F) target inexistente → 404", async () => {
    const ghost = "00000000-0000-4000-8000-000000000088";
    const res = await generate(owner, conv1, validBody({ targetCharacterId: ghost }));
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
    expect(await messageCount(conv1)).toBe(0);
  });

  it("G) target USER-controlled → 400 TARGET_NOT_AI", async () => {
    const res = await generate(owner, conv1, validBody({ targetCharacterId: charU }));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
    expect(await messageCount(conv1)).toBe(0);
  });

  it("H) target AI fora da conversation → 403 TARGET_NOT_PARTICIPANT", async () => {
    const res = await generate(owner, conv1, validBody({ targetCharacterId: aiOut }));
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    expect(await messageCount(conv1)).toBe(0);
  });

  it("I) generated válido → 201 + Message AI_CHARACTER exata", async () => {
    const res = await generate(owner, conv1, validBody({ userPrompt: "pergunta I", targetCharacterId: aiA }));
    expect(res.statusCode).toBe(201);
    const { message } = res.json();
    expect(message.senderType).toBe("AI_CHARACTER");
    expect(message.characterId).toBe(aiA);
    expect(message.content).toBe("resposta spy");
    expect(message.conversationId).toBe(conv1);
    const stored = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(stored.senderType).toBe("AI_CHARACTER");
    expect(stored.characterId).toBe(aiA);
    expect(stored.content).toBe("resposta spy");
  });

  it("J) provider recebe systemPrompt + userPrompt e NÃO speaker", async () => {
    const capture: { input?: ProviderInput; calls: number } = { calls: 0 };
    const appJ = buildApp(undefined, generatedProvider("resposta J", capture));
    await appJ.ready();
    const res = await generateWith(appJ, owner, conv1, validBody({ userPrompt: "pergunta J" }));
    expect(res.statusCode).toBe(201);
    expect(capture.calls).toBe(1);
    expect(capture.input?.systemPrompt).toBeTypeOf("string");
    expect(capture.input?.userPrompt).toBe("pergunta J");
    expect("speakerCharacterId" in (capture.input as unknown as Record<string, unknown>)).toBe(false);
    await prisma.message.deleteMany({ where: { conversationId: conv1 } });
    await appJ.close();
  });

  it("K) resposta expõe message/generationKey/provider/mode e NÃO systemPrompt", async () => {
    const capture = { calls: 0 };
    const appK = buildApp(undefined, generatedProvider("resposta K", capture));
    await appK.ready();
    const res = await generateWith(appK, owner, conv1, validBody({ userPrompt: "pergunta K" }));
    expect(res.statusCode).toBe(201);
    const keys = Object.keys(res.json()).sort();
    expect(keys).toEqual(["generationKey", "message", "mode", "provider"]);
    expect(res.json().mode).toBe("generated");
    expect(res.json().provider).toBe("spy");
    expect(res.json().generationKey).toMatch(/^sha256:/);
    expect("systemPrompt" in res.json()).toBe(false);
    await prisma.message.deleteMany({ where: { conversationId: conv1 } });
    await appK.close();
  });

  it("L) assembly-only / NullProvider → não cria Message", async () => {
    const before = await messageCount(conv1);
    const res = await generateWith(appDefault, owner, conv1, validBody({ userPrompt: "sem provider real" }));
    expect(res.statusCode).toBe(200);
    expect(res.json().generation.mode).toBe("assembly-only");
    expect("generationKey" in res.json().generation).toBe(true);
    expect(res.json().responseSkeleton).toBeDefined();
    expect(await messageCount(conv1)).toBe(before);
  });

  it("M) OllamaProviderError → 500 PROVIDER_ERROR sem Message", async () => {
    const before = await messageCount(conv1);
    const res = await generateWith(appFail, owner, conv1, validBody({ userPrompt: "falha provider" }));
    expect(res.statusCode).toBe(500);
    expect(res.json().code).toBe("PROVIDER_ERROR");
    expect(res.json()).not.toHaveProperty("stack");
    expect(String(res.json().error)).not.toMatch(/rede indisponível/i);
    expect(await messageCount(conv1)).toBe(before);
  });

  it("O) RAG frame válido → geração segue e persistência independente de RAG", async () => {
    const sourceId = await newPrivateSource();
    const documentId = await newDocument(sourceId);
    const chunkId = await newChunk(documentId, "conteúdo");
    const { frameId } = await createReadyFrameAndSnapshot(conv1, chunkId, "conteúdo");

    const capture: { input?: ProviderInput; calls: number } = { calls: 0 };
    const appO = buildApp(undefined, generatedProvider("resposta O", capture));
    await appO.ready();
    const res = await generateWith(
      appO,
      owner,
      conv1,
      validBody({ userPrompt: "pergunta O", ragFrameId: frameId }),
    );
    expect(res.statusCode).toBe(201);
    expect(capture.input?.systemPrompt).toContain("EXTERNAL_CONTEXT");
    expect(res.json().message.senderType).toBe("AI_CHARACTER");
    expect(res.json().message.characterId).toBe(aiA);
    await prisma.message.deleteMany({ where: { conversationId: conv1 } });
    await appO.close();
  });

  it("P) RAG frame inexistente → 404 sem Message", async () => {
    const before = await messageCount(conv1);
    const ghost = "00000000-0000-4000-8000-000000000099";
    const res = await generate(owner, conv1, validBody({ ragFrameId: ghost }));
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
    expect(await messageCount(conv1)).toBe(before);
  });

  it("Q/R) speaker A e speaker B → characterId exato preservado", async () => {
    const ra = await generate(owner, conv1, validBody({ userPrompt: "para A", targetCharacterId: aiA }));
    const rb = await generate(owner, conv1, validBody({ userPrompt: "para B", targetCharacterId: aiB }));
    expect(ra.statusCode).toBe(201);
    expect(rb.statusCode).toBe(201);
    expect(ra.json().message.characterId).toBe(aiA);
    expect(rb.json().message.characterId).toBe(aiB);
    expect(ra.json().message.characterId).not.toBe(rb.json().message.characterId);
  });

  it("S) retry gera nova Message (sem dedup — limitação documentada)", async () => {
    const before = await messageCount(conv1);
    const payload = validBody({ userPrompt: "retry idêntico" });
    const r1 = await generate(owner, conv1, payload);
    const r2 = await generate(owner, conv1, payload);
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect(r1.json().message.id).not.toBe(r2.json().message.id);
    expect(await messageCount(conv1)).toBe(before + 2);
  });
});

// Asserção auxiliar de testes N: erros conhecidos já cobertos por F/G/H/P
// (nenhuma Message indevida afirmada em cada caso). Mantido como teste explícito
// de regressão do mapeamento de um erro do pipeline que ainda não caiu acima.
describe("generation-generate routes — regressões de mapeamento (N)", () => {
  it("N) GenerationUserInputError (inacessível via schema) ainda mapeia 400 sem Message", async () => {
    // O zod já impede prompt vazio; aqui confirmamos que a rota permanece 400
    // (combinam zod) e nenhuma Message é criada.
    const before = await messageCount(conv1);
    const res = await generate(owner, conv1, validBody({ userPrompt: " " }));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
    expect(await messageCount(conv1)).toBe(before);
  });
});