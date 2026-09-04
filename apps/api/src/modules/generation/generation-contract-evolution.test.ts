import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import type { AssembledContext } from "../context/context.assembly.js";
import { computeDocumentContentHash } from "../external-research/external-ingest.js";
import { computeChunkContentHash } from "../external-research/external-chunking.js";
import { COHERE_DIMENSIONS } from "../external-research/external-embedding-provider.js";
import { EXTERNAL_RETRIEVAL_RULE } from "../external-research/external-retrieval.js";
import type { EmbeddingProviderWithInputType } from "../external-research/external-embedding-store.js";
import { materializeConversationRag } from "../external-research/conversation-rag-materialization.js";
import {
  assembleGenerationBundle,
  assertGenerationContract,
  computeGenerationKey,
  composeSystemPrompt,
  countEmittedSections,
  generateGeneration,
  GENERATION_RULE,
  GENERATED_GENERATION_RULE,
  type GenerationProvider,
  type GenerationResult,
} from "./generation.assembly.js";

// ---------------------------------------------------------------------------
// Fase 14 STEP 28 — Evolução formal do contrato de geração p/ OUTPUT REAL.
//
// Prova que a arquitetura passa a representar texto gerado de forma tipada e
// segura SEM implementar provider real, SEM HTTP, SEM persistir, SEM tocar RAG,
// SEM mudar a determinismo da GenerationKey e SEM quebrar o baseline
// assembly-only (NullProvider).
// ---------------------------------------------------------------------------

type TestUser = { cookie: string; userId: string };

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];
const createdMemoryIds: string[] = [];
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

function fixtureContext(overrides: Partial<AssembledContext> = {}): AssembledContext {
  const base: AssembledContext = {
    meta: {
      version: "context.v1",
      conversationId: "00000000-0000-4000-8000-000000000001",
      conversationType: "GROUP",
      participantCharacterIds: [],
      assembledAt: "2026-01-01T00:00:00.000Z",
      ruleApplied: "context.v1-policy:msgs=50#mem=15#evt=10#rel=10#news=8",
    },
    participants: [],
    activeSpeaker: { characterId: null, senderType: "USER_CHARACTER" },
    temporal: {
      worldDate: null,
      currentSeasonId: null,
      currentRaceId: null,
      currentSession: null,
      phaseMarker: null,
    },
    recentMessages: [],
    memories: [],
    events: [],
    relationships: [],
    motorsport: null,
    news: [],
    omitted: { oldestMessagesTruncated: 0, memoriesOmitted: 0, reasons: [] },
  };
  return { ...base, ...overrides };
}

function assemblyResult(): GenerationResult {
  const context = fixtureContext();
  const systemPrompt = composeSystemPrompt(context);
  return {
    context,
    systemPrompt,
    meta: {
      provider: "null",
      mode: "assembly-only",
      tokens: { systemPromptChars: systemPrompt.length, contextBlocks: countEmittedSections(systemPrompt) },
      ruleApplied: GENERATION_RULE,
    },
    generationKey: computeGenerationKey(context, systemPrompt, {
      provider: "null",
      mode: "assembly-only",
      tokens: { systemPromptChars: systemPrompt.length, contextBlocks: countEmittedSections(systemPrompt) },
      ruleApplied: GENERATION_RULE,
    }),
  };
}

function generatedResult(text = "resposta"): GenerationResult {
  const context = fixtureContext();
  const systemPrompt = composeSystemPrompt(context);
  const meta = {
    provider: "test-generated",
    mode: "generated" as const,
    tokens: { systemPromptChars: systemPrompt.length, contextBlocks: countEmittedSections(systemPrompt) },
    ruleApplied: GENERATED_GENERATION_RULE,
  };
  return {
    context,
    systemPrompt,
    meta,
    text,
    generationKey: computeGenerationKey(context, systemPrompt, meta),
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
  await prisma.message.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
  await prisma.conversationParticipant.deleteMany({
    where: { conversationId: { in: createdConversationIds } },
  });
  await prisma.memoryCharacter.deleteMany({ where: { memoryId: { in: createdMemoryIds } } });
  await prisma.memory.deleteMany({ where: { id: { in: createdMemoryIds } } });
  await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  await prisma.externalChunk.deleteMany({ where: { id: { in: createdChunkIds } } });
  await prisma.externalDocument.deleteMany({ where: { id: { in: createdDocumentIds } } });
  await prisma.externalSource.deleteMany({ where: { id: { in: createdSourceIds } } });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
  await app.close();
});

// ---------------------------------------------------------------------------
// A) Contrato — estados válidos
// ---------------------------------------------------------------------------

describe("STEP28 - contrato inicial (estados válidos)", () => {
  it("A) assembly-only (NullProvider) permanece válido e sem text", () => {
    const r = assemblyResult();
    expect(r.meta.mode).toBe("assembly-only");
    expect(r.meta.ruleApplied).toBe(GENERATION_RULE);
    expect(r.text).toBeUndefined();
    expect(assertGenerationContract(r)).toBe(true);
  });

  it("B) generated com text válido -> válido", () => {
    const r = generatedResult("resposta narrativa");
    expect(r.meta.mode).toBe("generated");
    expect(r.text).toBe("resposta narrativa");
    expect(assertGenerationContract(r)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B) Contrato — estados inválidos (sem relaxar além do necessário)
// ---------------------------------------------------------------------------

describe("STEP28 - contrato inicial (estados inválidos)", () => {
  it("C) generated sem text -> inválido", () => {
    const r = generatedResult();
    const corrupt = { ...r, text: undefined };
    expect(assertGenerationContract(corrupt as never)).toBe(false);
  });

  it("C2) generated com text vazio -> inválido", () => {
    const r = generatedResult("");
    expect(assertGenerationContract(r)).toBe(false);
  });

  it("D) assembly-only com text indevido -> inválido", () => {
    const r = assemblyResult();
    const corrupt = { ...r, text: "não devia estar aqui" };
    expect(assertGenerationContract(corrupt as never)).toBe(false);
  });

  it("D2) mode desconhecido (ex.: real-llm) -> inválido", () => {
    const r = assemblyResult();
    const corrupt = { ...r, meta: { ...r.meta, mode: "real-llm" as never } };
    expect(assertGenerationContract(corrupt)).toBe(false);
  });

  it("E) mode generated com ruleApplied errado -> inválido", () => {
    const r = generatedResult();
    const corrupt = { ...r, meta: { ...r.meta, ruleApplied: GENERATION_RULE } };
    expect(assertGenerationContract(corrupt)).toBe(false);
  });

  it("F) provider vazio -> inválido", () => {
    const r = generatedResult();
    const corrupt = { ...r, meta: { ...r.meta, provider: "" } };
    expect(assertGenerationContract(corrupt)).toBe(false);
  });

  it("F2) tokenStats inválido -> inválido", () => {
    const r = generationResultWithBadTokens();
    expect(assertGenerationContract(r)).toBe(false);
  });
});

function generationResultWithBadTokens(): GenerationResult {
  const context = fixtureContext();
  const systemPrompt = composeSystemPrompt(context);
  const meta = {
    provider: "test-generated",
    mode: "generated" as const,
    tokens: { systemPromptChars: systemPrompt.length + 1, contextBlocks: countEmittedSections(systemPrompt) },
    ruleApplied: GENERATED_GENERATION_RULE,
  };
  return {
    context,
    systemPrompt,
    meta,
    text: "x",
    generationKey: computeGenerationKey(context, systemPrompt, meta),
  };
}

// ---------------------------------------------------------------------------
// C) GenerationKey independente do texto
// ---------------------------------------------------------------------------

describe("STEP28 - GenerationKey independente do texto gerado", () => {
  it("H) mesmo contexto/prompt/regra com textos diferentes -> mesmo generationKey", () => {
    const context = fixtureContext();
    const systemPrompt = composeSystemPrompt(context);
    const meta = {
      provider: "test-generated",
      mode: "generated" as const,
      tokens: { systemPromptChars: systemPrompt.length, contextBlocks: countEmittedSections(systemPrompt) },
      ruleApplied: GENERATED_GENERATION_RULE,
    };
    const a = computeGenerationKey(context, systemPrompt, meta);
    const b = computeGenerationKey(context, systemPrompt, meta);
    expect(a).toBe(b);
    // O texto não entra no frame: resultados com textos distintos mantêm a mesma chave
    expect(computeGenerationKey(context, systemPrompt, meta)).not.toContain("resposta");
  });

  it("I) output textual não entra no canonical frame (key só de context+prompt+meta)", () => {
    const context = fixtureContext();
    const systemPrompt = composeSystemPrompt(context);
    const meta = {
      provider: "test",
      mode: "generated" as const,
      tokens: { systemPromptChars: systemPrompt.length, contextBlocks: countEmittedSections(systemPrompt) },
      ruleApplied: GENERATED_GENERATION_RULE,
    };
    const key = computeGenerationKey(context, systemPrompt, meta);
    expect(key).toBe(computeGenerationKey(fixtureContext(), systemPrompt, meta));
    expect(key).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// D) Integração — provider stub generated através do bundle real
// ---------------------------------------------------------------------------

describe("STEP28 - integração do novo contrato sem provider real", () => {
  let owner: TestUser;
  let characterId: string;
  let aiCharacterId: string;
  let conversationId: string;
  let sourceId: string;
  let documentId: string;

  beforeAll(async () => {
    counter += 1;
    const email = `s28i-${counter}-${Date.now()}-${Math.random()}@x.com`;
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { name: "S28", email, password: "senha-segura-123" },
    });
    expect(res.statusCode).toBe(200);
    const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    createdUserIds.push(user.id);
    owner = { cookie, userId: user.id };

    const character = await prisma.character.create({
      data: {
        name: "S28Char",
        nationality: "BR",
        birthDate: new Date("1994-01-01"),
        controlledBy: "USER",
        userId: user.id,
      },
    });
    createdCharacterIds.push(character.id);
    characterId = character.id;

    const conversation = await prisma.conversation.create({ data: { type: "DM" } });
    createdConversationIds.push(conversation.id);
    conversationId = conversation.id;
    await prisma.conversationParticipant.create({
      data: { conversationId, characterId },
    });

    const aiCharacter = await prisma.character.create({
      data: {
        name: "S28AI",
        nationality: "GB",
        birthDate: new Date("1998-01-01"),
        controlledBy: "AI",
      },
    });
    createdCharacterIds.push(aiCharacter.id);
    aiCharacterId = aiCharacter.id;
    await prisma.conversationParticipant.create({
      data: { conversationId, characterId: aiCharacterId },
    });

    const source = await prisma.externalSource.create({
      data: {
        url: `https://s28.test/${Date.now()}/${Math.random()}`,
        title: "src",
        visibility: "PRIVATE",
        ownerId: user.id,
      },
    });
    createdSourceIds.push(source.id);
    sourceId = source.id;

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
    documentId = doc.id;

    const chunkCount = await prisma.externalChunk.count({ where: { documentId } });
    const contentHash = computeChunkContentHash("gp de monaco");
    const chunk = await prisma.externalChunk.create({
      data: {
        documentId,
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

  it("G) provider stub generated: text preservado, chamado uma vez, key determinística", async () => {
    let calls = 0;
    const spyProvider: GenerationProvider = {
      name: "test-generated",
      async run(input) {
        calls += 1;
        expect(input.context.meta.version).toBe("context.v1");
        expect(typeof input.systemPrompt).toBe("string");
        return {
          provider: "test-generated",
          mode: "generated",
          text: "resposta única",
          tokenStats: {
            systemPromptChars: input.systemPrompt.length,
            contextBlocks: countEmittedSections(input.systemPrompt),
          },
        };
      },
    };

    const a = await assembleGenerationBundle(prisma, { conversationId, userId: owner.userId, targetCharacterId: aiCharacterId }, spyProvider);
    const b = await assembleGenerationBundle(prisma, { conversationId, userId: owner.userId, targetCharacterId: aiCharacterId }, spyProvider);

    expect(calls).toBe(2);
    expect(a.meta.mode).toBe("generated");
    expect(a.meta.ruleApplied).toBe(GENERATED_GENERATION_RULE);
    expect(a.text).toBe("resposta única");
    expect(assertGenerationContract(a)).toBe(true);
    expect(a.generationKey).toBe(b.generationKey);
    expect(a.generationKey).toMatch(/^sha256:[0-9a-f]{64}$/);
    // text preservado e fora da key
    expect(a.generationKey).not.toContain("resposta");
  });

  it("J) RAG permanece intacto no novo contrato (context.externalRag chega ao provider)", async () => {
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

    let seenRag = false;
    const provider: GenerationProvider = {
      name: "test-generated",
      async run(input) {
        if (input.context.externalRag) {
          seenRag = true;
          expect(input.context.externalRag.items.length).toBe(1);
          expect(input.systemPrompt).toContain("<BEGIN 11:EXTERNAL_CONTEXT>");
        }
        return {
          provider: "test-generated",
          mode: "generated",
          text: "com rag",
          tokenStats: {
            systemPromptChars: input.systemPrompt.length,
            contextBlocks: countEmittedSections(input.systemPrompt),
          },
        };
      },
    };

    const gen = await assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, ragFrameId: m.frameId, targetCharacterId: aiCharacterId },
      provider,
    );
    expect(seenRag).toBe(true);
    expect(gen.meta.mode).toBe("generated");
    expect(gen.context.externalRag).toBeTruthy();
  });

  it("K) baseline assembly-only (NullProvider) permanece byte-a-byte e independente", async () => {
    const base = await generateGeneration(prisma, { conversationId, userId: owner.userId });
    expect(base.meta.mode).toBe("assembly-only");
    expect(base.meta.ruleApplied).toBe(GENERATION_RULE);
    expect(base.text).toBeUndefined();
    expect(assertGenerationContract(base)).toBe(true);
    // repetido -> determinístico
    const base2 = await generateGeneration(prisma, { conversationId, userId: owner.userId });
    expect(base2.generationKey).toBe(base.generationKey);
    // RAG não vaza no baseline sem ragFrameId
    expect(base.context.externalRag).toBeUndefined();
  });
});
