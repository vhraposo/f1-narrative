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
import { assembleGenerationBundle } from "./generation.assembly.js";
import { OllamaProvider } from "./ollama-provider.js";

// ---------------------------------------------------------------------------
// Fase 14 STEP 31 — integração: assembleGenerationBundle → OllamaProvider →
// ProviderOutput generated. TRANSPORT MOCKADO. Nenhuma chamada real ao Ollama.
// ---------------------------------------------------------------------------

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

function ollamaFetchReturning(content: string | (() => string)): typeof fetch {
  return (async () => {
    const text = typeof content === "function" ? content() : content;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { role: "assistant", content: text } }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
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

async function newOwner(prefix: string): Promise<{ cookie: string; userId: string }> {
  counter += 1;
  const email = `${prefix}-${counter}-${Date.now()}-${Math.random()}@x.com`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: "O31", email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  createdUserIds.push(user.id);
  return { cookie, userId: user.id };
}

async function newConversation(
  ownerId: string,
): Promise<{ conversationId: string; speakerCharacterId: string }> {
  const character = await prisma.character.create({
    data: {
      name: "O31Char",
      nationality: "BR",
      birthDate: new Date("1995-01-01"),
      controlledBy: "USER",
      userId: ownerId,
    },
  });
  createdCharacterIds.push(character.id);
  const aiCharacter = await prisma.character.create({
    data: {
      name: "O31AI",
      nationality: "GB",
      birthDate: new Date("2000-01-01"),
      controlledBy: "AI",
    },
  });
  createdCharacterIds.push(aiCharacter.id);
  const conversation = await prisma.conversation.create({ data: { type: "DM" } });
  createdConversationIds.push(conversation.id);
  await prisma.conversationParticipant.create({
    data: { conversationId: conversation.id, characterId: character.id },
  });
  await prisma.conversationParticipant.create({
    data: { conversationId: conversation.id, characterId: aiCharacter.id },
  });
  return { conversationId: conversation.id, speakerCharacterId: aiCharacter.id };
}

describe("STEP31 - integração assembleGenerationBundle + OllamaProvider", () => {
  let owner: { cookie: string; userId: string };
  let conversationId: string;
  let speakerCharacterId: string;

  beforeAll(async () => {
    owner = await newOwner("o31a");
    const fx = await newConversation(owner.userId);
    conversationId = fx.conversationId;
    speakerCharacterId = fx.speakerCharacterId;
  });

  it("provider executado; mode=generated; text preservado; systemPrompt+userPrompt na request", async () => {
    let seenBody: Record<string, unknown> = {};
    const stubbed = (async (_input: unknown, init?: unknown) => {
      seenBody = JSON.parse((init as { body: string }).body) as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { role: "assistant", content: "texto respondido" } }],
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const provider = new OllamaProvider({ model: "test-model", timeoutMs: 5000, fetchImpl: stubbed });
    const input = "qual foi o resultado do gp?";
    const result = await assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, userPrompt: input, targetCharacterId: speakerCharacterId },
      provider,
    );

    expect(result.meta.provider).toBe("ollama");
    expect(result.meta.mode).toBe("generated");
    expect(result.text).toBe("texto respondido");
    // request: roles corretas, userPrompt + systemPrompt preservados
    const messages = seenBody.messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe("system");
    expect(messages[1]).toEqual({ role: "user", content: input });
    expect(messages[0].content).toBe(result.systemPrompt);
    expect(seenBody.stream).toBe(false);
  });

  it("generationKey determinística; text NÃO altera a key", async () => {
    const textA = "resposta A";
    const textB = "resposta B diferente";
    let call = 0;
    const stubbed = (async () => {
      call += 1;
      const content = call === 1 ? textA : textB;
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { role: "assistant", content } }] }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const providerA = new OllamaProvider({ model: "test-model", timeoutMs: 5000, fetchImpl: stubbed });
    const first = await assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, userPrompt: "mesma pergunta", targetCharacterId: speakerCharacterId },
      providerA,
    );
    const providerB = new OllamaProvider({ model: "test-model", timeoutMs: 5000, fetchImpl: stubbed });
    const second = await assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, userPrompt: "mesma pergunta", targetCharacterId: speakerCharacterId },
      providerB,
    );

    expect(first.text).toBe(textA);
    expect(second.text).toBe(textB);
    // mesmo contexto+input → mesma key, embora text difira (text não entra na key)
    expect(first.generationKey).toBe(second.generationKey);
    expect(first.generationKey).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("RAG permanece intacto e independente quando combinado com OllamaProvider", async () => {
    const source = await prisma.externalSource.create({
      data: {
        url: `https://o31.test/${Date.now()}/${Math.random()}`,
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
        content: "conteúdo rag",
        contentHash: computeDocumentContentHash("conteúdo rag"),
        status: "READY",
      },
    });
    createdDocumentIds.push(doc.id);
    const chunkCount = await prisma.externalChunk.count({ where: { documentId: doc.id } });
    const chunk = await prisma.externalChunk.create({
      data: {
        documentId: doc.id,
        text: "gp de monaco",
        orderOriginal: chunkCount,
        contentHash: computeChunkContentHash("gp de monaco"),
        embeddedContentHash: computeChunkContentHash("gp de monaco"),
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

    const stubbed = ollamaFetchReturning("sobre monaco");
    const provider = new OllamaProvider({ model: "test-model", timeoutMs: 5000, fetchImpl: stubbed });
    const result = await assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, ragFrameId: m.frameId, userPrompt: "fale de monaco", targetCharacterId: speakerCharacterId },
      provider,
    );
    // RAG intacto no resultado
    expect(result.context.externalRag).toBeTruthy();
    expect(result.context.externalRag?.items.length).toBe(1);
    // geração real ainda funciona
    expect(result.meta.mode).toBe("generated");
    expect(result.text).toBe("sobre monaco");
  });
});
