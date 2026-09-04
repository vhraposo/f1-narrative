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
  EXTERNAL_CONTEXT_MARKER,
  assembleGenerationBundle,
  generateGeneration,
  nullProvider,
  type GenerationResult,
} from "./generation.assembly.js";
import { OllamaProvider, OllamaProviderError } from "./ollama-provider.js";

// ---------------------------------------------------------------------------
// Fase 14 STEP 32 — Orquestração interna segura do provider.
//
// Prova que o caminho de DI já existente (3º argumento opcional de
// generateGeneration/assembleGenerationBundle, default NullProvider) permite
// injetar OllamaProvider sem tocar o contrato HTTP. /craft público permanece
// NullProvider e NUNCA aceita seleção de provider via query/body/header.
// Transport do Ollama sempre mockado — sem rede real.
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

type SeenBody = {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream: boolean;
};

/** Stub de fetch que captura o request e retorna content (ou falha). */
function ollamaStub(
  outcomes: { content?: string; failWithStatus?: number }[],
  seen: { bodies: SeenBody[] },
): typeof fetch {
  let i = 0;
  return (async (_input: unknown, init?: unknown) => {
    seen.bodies.push(JSON.parse((init as { body: string }).body) as SeenBody);
    const outcome = outcomes[Math.min(i, outcomes.length - 1)];
    i += 1;
    if (outcome.failWithStatus !== undefined) {
      return {
        ok: false,
        status: outcome.failWithStatus,
        json: async () => ({ error: "boom" }),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { role: "assistant", content: outcome.content ?? "" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

function makeOllama(fetchImpl: typeof fetch, model = "test-model"): OllamaProvider {
  return new OllamaProvider({ model, timeoutMs: 5000, fetchImpl });
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
    payload: { name: "O32", email, password: "senha-segura-123" },
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
      name: "O32Char",
      nationality: "BR",
      birthDate: new Date("1995-01-01"),
      controlledBy: "USER",
      userId: ownerId,
    },
  });
  createdCharacterIds.push(character.id);
  const aiCharacter = await prisma.character.create({
    data: {
      name: "O32AI",
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

describe("STEP32 - DI NullProvider (default)", () => {
  let owner: { cookie: string; userId: string };
  let conversationId: string;

  beforeAll(async () => {
    owner = await newOwner("s32a");
    const fx = await newConversation(owner.userId);
    conversationId = fx.conversationId;
  });

  it("A) geração sem provider explícito usa NullProvider (assembly-only)", async () => {
    const result = await generateGeneration(prisma, { conversationId, userId: owner.userId });
    expect(result.meta.provider).toBe("null");
    expect(result.meta.mode).toBe("assembly-only");
    expect(result.text).toBeUndefined();
  });

  it("A2) explicitar nullProvider é o mesmo caminho default", async () => {
    const viaDefault = await generateGeneration(prisma, {
      conversationId,
      userId: owner.userId,
    });
    const viaExplicit = await generateGeneration(
      prisma,
      { conversationId, userId: owner.userId },
      nullProvider,
    );
    expect(viaExplicit.meta.provider).toBe("null");
    expect(viaExplicit.generationKey).toBe(viaDefault.generationKey);
    expect(viaExplicit.systemPrompt).toBe(viaDefault.systemPrompt);
  });
});

describe("STEP32 - DI OllamaProvider (stubbed transport)", () => {
  let owner: { cookie: string; userId: string };
  let conversationId: string;
  let speakerCharacterId: string;

  beforeAll(async () => {
    owner = await newOwner("s32b");
    const fx = await newConversation(owner.userId);
    conversationId = fx.conversationId;
    speakerCharacterId = fx.speakerCharacterId;
  });

  it("B/D) DI com OllamaProvider produz mode=generated e propaga text", async () => {
    const seen: { bodies: SeenBody[] } = { bodies: [] };
    const provider = makeOllama(ollamaStub([{ content: "resposta ollama" }], seen));
    const input = "quem venceu em monaco?";
    const result: GenerationResult = await assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, userPrompt: input, targetCharacterId: speakerCharacterId },
      provider,
    );
    expect(seen.bodies.length).toBe(1);
    expect(result.meta.provider).toBe("ollama");
    expect(result.meta.mode).toBe("generated");
    expect(result.text).toBe("resposta ollama");
    expect(typeof result.generationKey).toBe("string");
  });

  it("C) userPrompt preservado exatamente no request do Ollama (role user)", async () => {
    const seen: { bodies: SeenBody[] } = { bodies: [] };
    const provider = makeOllama(ollamaStub([{ content: "x" }], seen));
    const input = "  pergunta com espaços  ";
    const result = await assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, userPrompt: input, targetCharacterId: speakerCharacterId },
      provider,
    );
    expect(seen.bodies[0].messages[1]).toEqual({ role: "user", content: input });
    expect(seen.bodies[0].messages[0].role).toBe("system");
    expect(seen.bodies[0].messages[0].content).toBe(result.systemPrompt);
  });

  it("F) text NÃO entra na generationKey (duas respostas diferentes, mesma key)", async () => {
    const seen: { bodies: SeenBody[] } = { bodies: [] };
    // duas chamadas → duas respostas distintas (comandadas por outcomes distintas)
    const provider = makeOllama(ollamaStub([{ content: "AAAA" }, { content: "BBBB" }], seen));
    const input = "mesma pergunta";
    const first = await assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, userPrompt: input, targetCharacterId: speakerCharacterId },
      provider,
    );
    const second = await assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, userPrompt: input, targetCharacterId: speakerCharacterId },
      provider,
    );
    expect(first.text).toBe("AAAA");
    expect(second.text).toBe("BBBB");
    expect(first.generationKey).toBe(second.generationKey);
  });

  it("7) mesmo input canônico → mesmo systemPrompt via NullProvider e OllamaProvider; key difere só por mode (ruleApplied)", async () => {
    const seen: { bodies: SeenBody[] } = { bodies: [] };
    const ollama = makeOllama(ollamaStub([{ content: "resposta qualquer" }], seen));
    const input = "pergunta compartilhada";
    const baseReq = { conversationId, userId: owner.userId, userPrompt: input };

    const nullResult = await generateGeneration(prisma, baseReq);
    const ollamaResult = await assembleGenerationBundle(
      prisma,
      { ...baseReq, targetCharacterId: speakerCharacterId },
      ollama,
    );

    // canonical input (systemPrompt) semanticamente idêntico entre providers
    expect(nullResult.systemPrompt).toBe(ollamaResult.systemPrompt);
    // output textual existe somente no provider real
    expect(nullResult.text).toBeUndefined();
    expect(ollamaResult.text).toBe("resposta qualquer");
    // decisão (STEP 28): ruleApplied diferencia os modos
    expect(nullResult.meta.ruleApplied).toMatch(/assembly-only/);
    expect(ollamaResult.meta.ruleApplied).toMatch(/generated/);
    // logo status de mode participa da key explicitamente e deterministicamente
    expect(ollamaResult.generationKey).not.toBe(nullResult.generationKey);
    // a diferença vem do mode (ruleApplied), NUNCA do texto
    expect(seen.bodies[0].messages[0].content).toBe(ollamaResult.systemPrompt);
  });

  it("H) erro do provider propaga até o caller (sem fallback)", async () => {
    const seen: { bodies: SeenBody[] } = { bodies: [] };
    const provider = makeOllama(ollamaStub([{ failWithStatus: 500 }], seen));
    await expect(
      assembleGenerationBundle(
        prisma,
        { conversationId, userId: owner.userId, userPrompt: "pergunta" },
        provider,
      ),
    ).rejects.toBeInstanceOf(OllamaProviderError);
    // nenhuma resposta vazia/parcial é retornada; erro é explícito
  });

  it("J) provider real nunca cai em assembly-only em caso de falha", async () => {
    const failing = (async () =>
      Promise.reject(new TypeError("network down"))) as unknown as typeof fetch;
    const provider = new OllamaProvider({ model: "m", timeoutMs: 1000, fetchImpl: failing });
    try {
      await assembleGenerationBundle(
        prisma,
        { conversationId, userId: owner.userId, userPrompt: "pergunta" },
        provider,
      );
      throw new Error("esperava falha");
    } catch (err) {
      expect(err).toBeInstanceOf(OllamaProviderError);
    }
  });
});

describe("STEP32 - RAG intacto com OllamaProvider", () => {
  let owner: { cookie: string; userId: string };
  let conversationId: string;
  let speakerCharacterId: string;

  beforeAll(async () => {
    owner = await newOwner("s32c");
    const fx = await newConversation(owner.userId);
    conversationId = fx.conversationId;
    speakerCharacterId = fx.speakerCharacterId;

    const source = await prisma.externalSource.create({
      data: {
        url: `https://s32.test/${Date.now()}/${Math.random()}`,
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
  });

  it("E) Rag CURRENT → systemPrompt contém EXTERNAL_CONTEXT; Ollama recebe prompt já composto e não toca RAG", async () => {
    const seen: { bodies: SeenBody[] } = { bodies: [] };
    const provider = makeOllama(ollamaStub([{ content: "sobre monaco" }], seen));
    const frame = await prisma.conversationRagFrame.findFirstOrThrow({
      where: { conversationId },
    });
    const result = await assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, ragFrameId: frame.id, userPrompt: "fale de monaco", targetCharacterId: speakerCharacterId },
      provider,
    );
    // RAG preservado no contexto e no systemPrompt
    expect(result.context.externalRag?.items.length).toBe(1);
    expect(result.systemPrompt).toContain(EXTERNAL_CONTEXT_MARKER);
    // Ollama recebe o systemPrompt já composto (com EXTERNAL_CONTEXT)
    expect(seen.bodies[0].messages[0].content).toBe(result.systemPrompt);
    expect(seen.bodies[0].messages[0].content).toContain(EXTERNAL_CONTEXT_MARKER);
    // Ollama não consultou RAG: o request só contém system+user (sem ids/objetos RAG)
    expect(Object.keys(seen.bodies[0])).toEqual(["model", "messages", "stream"]);
    // geração real ainda funciona junto com RAG
    expect(result.meta.mode).toBe("generated");
    expect(result.text).toBe("sobre monaco");
  });
});

describe("STEP32 - /craft público permanece NullProvider sem seleção", () => {
  let owner: { cookie: string; userId: string };
  let conversationId: string;

  beforeAll(async () => {
    owner = await newOwner("s32d");
    const fx = await newConversation(owner.userId);
    conversationId = fx.conversationId;
  });

  it("G) /craft retorna provider null e sem text (NullProvider persistente)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}/craft`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.generation.meta.provider).toBe("null");
    expect(body.generation.meta.mode).toBe("assembly-only");
    expect(body.generation.text).toBeUndefined();
  });

  it("I) /craft ignora tentativa de seleção via query (?provider/?model/?baseUrl) e segue NullProvider", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}/craft?provider=ollama&model=llama3.2&baseUrl=http://evil`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.generation.meta.provider).toBe("null");
    expect(body.generation.meta.mode).toBe("assembly-only");
    // nenhuma chamada real a Ollama é disparada pelo cliente
  });
});
