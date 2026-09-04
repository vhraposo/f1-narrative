import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { computeDocumentContentHash } from "../external-research/external-ingest.js";
import { computeChunkContentHash } from "../external-research/external-chunking.js";
import { COHERE_DIMENSIONS } from "../external-research/external-embedding-provider.js";
import { EXTERNAL_RETRIEVAL_RULE } from "../external-research/external-retrieval.js";
import type { EmbeddingProviderWithInputType } from "../external-research/external-embedding-store.js";
import { materializeConversationRag } from "../external-research/conversation-rag-materialization.js";
import {
  assembleGenerationBundle,
  GenerationUserInputError,
  type GenerationProvider,
  type ProviderInput,
} from "./generation.assembly.js";

// ---------------------------------------------------------------------------
// Fase 14 STEP 30 — User Input Contract for Generation.
//
// Prova a semântica EXPLÍCITA de "input atual do usuário": é um campo passado
// pelo caller no request de generation; NUNCA derivado de context.recentMessages
// nem de histórico. Resolvido ANTES do provider; o provider NÃO consulta DB nem
// interpreta histórico. Ownership/isolação permanecem gateadas no route
// (accessibleConversationId). RAG permanece independente.
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

function chunkVectorForScore(score: number): number[] {
  const v = new Array(COHERE_DIMENSIONS).fill(0);
  v[0] = score;
  v[1] = Math.sqrt(Math.max(0, 1 - score * score));
  return v;
}

function vectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

function mockEmbeddingProvider(): EmbeddingProviderWithInputType {
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

type Capture = { input?: ProviderInput; calls?: number };

function capturedProvider(capture: Capture) {
  const provider: GenerationProvider = {
    name: "capture",
    async run(input) {
      capture.calls = (capture.calls ?? 0) + 1;
      capture.input = input;
      return {
        provider: "capture",
        mode: "assembly-only",
        tokenStats: {
          systemPromptChars: input.systemPrompt.length,
          contextBlocks: input.systemPrompt.split(/<BEGIN \d+:/g).length - 1,
        },
      };
    },
  };
  return provider;
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
  await prisma.message.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
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

async function newOwner(prefix: string): Promise<TestUser> {
  counter += 1;
  const email = `${prefix}-${counter}-${Date.now()}-${Math.random()}@x.com`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: "S30", email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  createdUserIds.push(user.id);
  return { cookie, userId: user.id };
}

async function newConversation(ownerId: string): Promise<string> {
  const character = await prisma.character.create({
    data: {
      name: "S30Char",
      nationality: "BR",
      birthDate: new Date("1995-01-01"),
      controlledBy: "USER",
      userId: ownerId,
    },
  });
  createdCharacterIds.push(character.id);
  const conversation = await prisma.conversation.create({ data: { type: "DM" } });
  createdConversationIds.push(conversation.id);
  await prisma.conversationParticipant.create({
    data: { conversationId: conversation.id, characterId: character.id },
  });
  return conversation.id;
}

describe("STEP30 - contrato de input do usuário (service)", () => {
  let owner: TestUser;
  let conversationId: string;

  beforeAll(async () => {
    owner = await newOwner("s30a");
    conversationId = await newConversation(owner.userId);
    // histórico com mensagens (prova que recentMessages NÃO vira userPrompt)
    await prisma.message.create({
      data: {
        conversationId,
        senderType: "USER_CHARACTER",
        characterId: await prisma.character.findFirstOrThrow({
          where: { userId: owner.userId },
        }).then((c) => c.id),
        content: "mensagem histórica do usuário",
        createdAt: new Date("2026-01-01T10:00:00Z"),
      },
    });
    await prisma.message.create({
      data: {
        conversationId,
        senderType: "SYSTEM",
        characterId: null,
        content: "system histórico",
        createdAt: new Date("2026-01-01T10:00:01Z"),
      },
    });
  });

  it("A) input fornecido é resolvido e chega ao ProviderInput intacto", async () => {
    const capture: Capture = {};
    const provider = capturedProvider(capture);
    const input = "  que horas é o gp de monaco?  ";
    await assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, userPrompt: input },
      provider,
    );
    expect(capture.calls).toBe(1);
    expect(capture.input?.userPrompt).toBe(input);
  });

  it("F) input é preservado byte-a-byte (sem trim no valor entregue)", async () => {
    const capture: Capture = {};
    const provider = capturedProvider(capture);
    const input = "  espaços   e\tácentos\nno fim  ";
    await assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, userPrompt: input },
      provider,
    );
    expect(capture.input?.userPrompt).toBe(input);
  });

  it("G) ProviderInput.userPrompt recebe exatamente o input resolvido; systemPrompt chega igual", async () => {
    const capture: Capture = {};
    const provider = capturedProvider(capture);
    const input = "msg exata";
    const gen = await assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, userPrompt: input },
      provider,
    );
    expect(capture.input?.userPrompt).toBe(input);
    expect(capture.input?.systemPrompt).toBe(gen.systemPrompt);
  });

  it("H) ausência de userPrompt: recentMessages NÃO é usado implicitamente como input", async () => {
    const capture: Capture = {};
    const provider = capturedProvider(capture);
    await assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId },
      provider,
    );
    // embora haja mensagens USER_CHARACTER no histórico, o provider recebe undefined
    expect(capture.input?.userPrompt).toBeUndefined();
    expect(capture.input?.context.recentMessages.length).toBeGreaterThan(0);
  });

  it("D) ausência de current input é tratada de forma explícita (assembly-only funciona)", async () => {
    const gen = await assembleGenerationBundle(prisma, { conversationId, userId: owner.userId });
    expect(gen.meta.mode).toBe("assembly-only");
    expect(gen.text).toBeUndefined();
  });

  it("E) input vazio/whitespace é rejeitado (GenerationUserInputError)", async () => {
    await expect(
      assembleGenerationBundle(
        prisma,
        { conversationId, userId: owner.userId, userPrompt: "   \n\t " },
        capturedProvider({}),
      ),
    ).rejects.toBeInstanceOf(GenerationUserInputError);
    await expect(
      assembleGenerationBundle(
        prisma,
        { conversationId, userId: owner.userId, userPrompt: "" },
        capturedProvider({}),
      ),
    ).rejects.toBeInstanceOf(GenerationUserInputError);
  });

  it("L) mesmo input + mesmo contexto -> mesma generationKey (determinístico)", async () => {
    const a = await assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, userPrompt: "mesma msg" },
    );
    const b = await assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, userPrompt: "mesma msg" },
    );
    expect(a.generationKey).toBe(b.generationKey);
    expect(a.generationKey).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("J) NullProvider continua funcionando com e sem userPrompt", async () => {
    const base = await assembleGenerationBundle(prisma, { conversationId, userId: owner.userId });
    const withInput = await assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, userPrompt: "ola" },
    );
    expect(base.meta.provider).toBe("null");
    expect(withInput.meta.provider).toBe("null");
    expect(base.generationKey).toMatch(/^sha256:/);
  });
});

describe("STEP30 - RAG independente do user input", () => {
  let owner: TestUser;
  let conversationId: string;

  beforeAll(async () => {
    owner = await newOwner("s30b");
    conversationId = await newConversation(owner.userId);

    const source = await prisma.externalSource.create({
      data: {
        url: `https://s30.test/${Date.now()}/${Math.random()}`,
        title: "src",
        visibility: "PRIVATE",
        ownerId: owner.userId,
      },
    });
    createdSourceIds.push(source.id);
    const doc = await prisma.externalDocument.create({
      data: {
        sourceId: source.id,
        title: "doc",
        content: "conteúdo",
        contentHash: computeDocumentContentHash("conteúdo"),
        status: "READY",
      },
    });
    createdDocumentIds.push(doc.id);
    const chunkCount = await prisma.externalChunk.count({ where: { documentId: doc.id } });
    const contentHash = computeChunkContentHash("gp de monaco");
    const chunk = await prisma.externalChunk.create({
      data: {
        documentId: doc.id,
        text: "gp de monaco",
        orderOriginal: chunkCount,
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
      vectorLiteral(chunkVectorForScore(0.9)),
      chunk.id,
    );
  });

  it("I) ragFrameId + userPrompt fluem de forma independente e simultânea", async () => {
    const m = await materializeConversationRag(prisma, mockEmbeddingProvider(), {
      conversationId,
      ownerId: owner.userId,
      frame: {
        query: "gp de monaco",
        topK: 5,
        threshold: 0.5,
        provider: "cohere",
        model: "embed-multilingual-v3.0",
        version: "v3.0",
        dimensions: COHERE_DIMENSIONS,
        ruleApplied: EXTERNAL_RETRIEVAL_RULE,
      },
    });
    expect(m.itemCount).toBe(1);

    const capture: Capture = {};
    const provider = capturedProvider(capture);
    const input = "conte sobre monaco";
    const gen = await assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, ragFrameId: m.frameId, userPrompt: input },
      provider,
    );
    // input e RAG chegam juntos, sem mistura
    expect(capture.input?.userPrompt).toBe(input);
    expect(capture.input?.context.externalRag).toBeTruthy();
    expect(gen.context.externalRag).toBeTruthy();
    expect(gen.context.externalRag?.items.length).toBe(1);
  });
});

describe("STEP30 - ownership e isolamento (HTTP route)", () => {
  let owner: TestUser;
  let intruder: TestUser;
  let conversationId: string;

  beforeAll(async () => {
    owner = await newOwner("s30o");
    intruder = await newOwner("s30i");
    conversationId = await newConversation(owner.userId);
  });

  it("B/C) intruder não alcança a conversation (404) — isolamento preservado", async () => {
    // O /craft é GET e não recebe userPrompt neste STEP; a isolação de
    // conversation é o gate (accessibleConversationId). O input do usuário é um
    // campo do request para uma conversation que o caller JÁ acessa.
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}/craft`,
      headers: { cookie: intruder.cookie },
    });
    expect(res.statusCode).toBe(404);

    const resOwner = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}/craft`,
      headers: { cookie: owner.cookie },
    });
    expect(resOwner.statusCode).toBe(200);
  });
});
