import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  countEmittedSections,
  type GenerationProvider,
  type ProviderInput,
} from "../generation/generation.assembly.js";
import { type EmbeddingProviderWithInputType } from "../external-research/external-embedding-store.js";
import { COHERE_DIMENSIONS } from "../external-research/external-embedding-provider.js";
import { computeDocumentContentHash } from "../external-research/external-ingest.js";
import { computeChunkContentHash } from "../external-research/external-chunking.js";

// ---------------------------------------------------------------------------
// STEP 109D — pesquisa externa contextualmente acionada no turno.
// Behavior esperado (end-to-end, HTTP + DB):
//   W) userPrompt com conceito externo + definição → pesquisa AUTO materializada
//      (frame em /external-rag) e EXTERNAL_CONTEXT chega à geração (rag.used).
//   X) sem gatilho ("Bom dia") → NENHUM frame é criado para a conversa.
//   Y) internal-first: conceito já presente na biography do participante →
//      NENHUM frame é criado.
//   Z) gatilho ativo + retrieval zero (vetor MOCK ortogonal) → frame é
//      materializado VAZIO, mas o turno NÃO consome RAG: rag.used = false
//      (gate itemCount > 0 no orquestrador).
//
// Provider SEMPRE mock (embedding + geração); NUNCA Cohere/HTTP real.
// Vetores são MOCK determinísticos (1024 dims), NUNCA saída real de Cohere.
// ---------------------------------------------------------------------------

const QUERY_VECTOR: number[] = (() => {
  const v = new Array(COHERE_DIMENSIONS).fill(0);
  v[0] = 1;
  return v;
})();

const TURN_TEXT = "resposta turn rag";

function mockRagProvider(): EmbeddingProviderWithInputType {
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

function spyGenerationProvider(): GenerationProvider {
  return {
    name: "spy",
    async run(input) {
      return {
        provider: "spy",
        mode: "generated",
        text: TURN_TEXT,
        tokenStats: {
          systemPromptChars: input.systemPrompt.length,
          contextBlocks: countEmittedSections(input.systemPrompt),
        },
      };
    },
  };
}

type TestUser = { cookie: string; userId: string };

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];
const createdSourceIds: string[] = [];
const createdDocumentIds: string[] = [];

let counter = 0;
let app: FastifyInstance;

async function signUp(name: string): Promise<TestUser> {
  counter += 1;
  const email = `r109-${counter}-${Date.now()}-${Math.random()}@x.com`;
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

async function newUserCharacter(user: TestUser, name: string): Promise<string> {
  const character = await prisma.character.create({
    data: {
      name,
      nationality: "BR",
      birthDate: new Date("1994-01-01"),
      controlledBy: "USER",
      userId: user.userId,
    },
  });
  createdCharacterIds.push(character.id);
  return character.id;
}

async function newAICharacter(name: string, biography?: string): Promise<string> {
  const character = await prisma.character.create({
    data: {
      name,
      nationality: "GB",
      birthDate: new Date("2000-01-01"),
      controlledBy: "AI",
      biography: biography ?? null,
    },
  });
  createdCharacterIds.push(character.id);
  return character.id;
}

async function newConversation(participantIds: string[]): Promise<string> {
  const conversation = await prisma.conversation.create({ data: { type: "DM" } });
  createdConversationIds.push(conversation.id);
  await prisma.conversationParticipant.createMany({
    data: participantIds.map((characterId) => ({ conversationId: conversation.id, characterId })),
  });
  return conversation.id;
}

async function newPrivateSource(ownerId: string): Promise<string> {
  return await prisma.externalSource.create({
    data: {
      url: `https://rag-turn.test/${counter}/${Date.now()}/${Math.random()}`,
      title: "src",
      visibility: "PRIVATE",
      ownerId,
    },
  }).then((s) => {
    createdSourceIds.push(s.id);
    return s.id;
  });
}

async function newDocument(sourceId: string): Promise<string> {
  const content = "origem externa para o turno";
  return await prisma.externalDocument.create({
    data: {
      sourceId,
      title: "doc",
      content,
      contentHash: computeDocumentContentHash(content),
      status: "READY",
    },
  }).then((d) => {
    createdDocumentIds.push(d.id);
    return d.id;
  });
}

async function insertChunk(documentId: string, text: string, score: number): Promise<string> {
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
  const v = new Array(COHERE_DIMENSIONS).fill(0);
  v[0] = score;
  v[1] = Math.sqrt(Math.max(0, 1 - score * score));
  await prisma.$executeRawUnsafe(
    'UPDATE "ExternalChunk" SET "embedding" = $1::vector(1024) WHERE "id" = $2::uuid',
    `[${v.join(",")}]`,
    chunk.id,
  );
  return chunk.id;
}

type Fixture = {
  user: TestUser;
  userCharacterId: string;
  aiCharacterId: string;
  conversationId: string;
};

async function turnFixture(aiBiography?: string): Promise<Fixture> {
  const user = await signUp("RagTurn");
  const userCharacterId = await newUserCharacter(user, "Patrusopher");
  const aiCharacterId = await newAICharacter("Valente", aiBiography);
  const conversationId = await newConversation([userCharacterId, aiCharacterId]);
  return { user, userCharacterId, aiCharacterId, conversationId };
}

async function turn(
  user: TestUser,
  conversationId: string,
  payload: Record<string, unknown>,
) {
  const res = await app.inject({
    method: "POST",
    url: `/api/conversations/${conversationId}/turn`,
    headers: { cookie: user.cookie },
    payload,
  });
  return { statusCode: res.statusCode, json: () => res.json() };
}

async function readRagFrames(user: TestUser, conversationId: string) {
  const res = await app.inject({
    method: "GET",
    url: `/api/conversations/${conversationId}/external-rag`,
    headers: { cookie: user.cookie },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { frames: Array<Record<string, unknown>> }).frames;
}

beforeAll(async () => {
  app = buildApp(mockRagProvider(), spyGenerationProvider());
  await app.ready();
});

afterAll(async () => {
  await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  await prisma.externalDocument.deleteMany({ where: { id: { in: createdDocumentIds } } });
  await prisma.externalSource.deleteMany({ where: { id: { in: createdSourceIds } } });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
  await app.close();
});

describe("conversation-turn auto external research (109D)", () => {
  it("W) conceito externo + definição → pesquisa AUTO materializada e usada na geração", async () => {
    const fx = await turnFixture();
    const sourceId = await newPrivateSource(fx.user.userId);
    const documentId = await newDocument(sourceId);
    const chunkId = await insertChunk(documentId, "síndrome de protagonista na narrativa", 0.9);

    const res = await turn(fx.user, fx.conversationId, {
      userPrompt: "Valente, o que significa síndrome de protagonista?",
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(Object.keys(json).sort()).toEqual(
      ["failedSpeakers", "messages", "userMessage"].sort(),
    );
    expect(json.messages).toHaveLength(1);
    expect(json.messages[0].contextJson.rag.used).toBe(true);

    const frames = await readRagFrames(fx.user, fx.conversationId);
    expect(frames).toHaveLength(1);
    expect(frames[0].freshness).toBe("CURRENT");
    const rag = frames[0].externalRag as { items: Array<{ chunkId: string }> };
    expect(rag.items.length).toBeGreaterThanOrEqual(1);
    expect(rag.items[0].chunkId).toBe(chunkId);

    const storedFrame = await prisma.conversationRagFrame.findFirst({
      where: { conversationId: fx.conversationId },
      select: { queryText: true },
    });
    expect(storedFrame?.queryText).toBe("síndrome de protagonista");
  });

  it("X) sem gatilho ('Bom dia') → turno normal, NENHUM frame criado", async () => {
    const fx = await turnFixture();

    const res = await turn(fx.user, fx.conversationId, {
      userPrompt: "Valente, bom dia!",
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(Object.keys(json).sort()).toEqual(
      ["failedSpeakers", "messages", "userMessage"].sort(),
    );
    expect(json.messages[0].contextJson.rag.used).toBe(false);

    const frames = await readRagFrames(fx.user, fx.conversationId);
    expect(frames).toEqual([]);
  });

  it("Y) internal-first: conceito já na biography → NENHUM frame criado", async () => {
    const fx = await turnFixture("desenvolveu a síndrome de protagonista após o GP.");

    const res = await turn(fx.user, fx.conversationId, {
      userPrompt: "Valente, o que significa síndrome de protagonista?",
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.messages[0].contextJson.rag.used).toBe(false);

    const frames = await readRagFrames(fx.user, fx.conversationId);
    expect(frames).toEqual([]);
  });

  it("Z) gatilho ativo + retrieval zero (vetor MOCK ortogonal) → frame vazio materializado; rag.used = false", async () => {
    const fx = await turnFixture();
    const sourceId = await newPrivateSource(fx.user.userId);
    const documentId = await newDocument(sourceId);
    // Vetor MOCK ortogonal a QUERY_VECTOR (score 0, cosseno 0 < threshold 0.5):
    // o retrieval (embedding mock → QUERY_VECTOR) retorna ZERO itens.
    const chunkId = await insertChunk(documentId, "síndrome de protagonista na narrativa", 0);
    expect(chunkId.length).toBeGreaterThan(0);

    const res = await turn(fx.user, fx.conversationId, {
      userPrompt: "Valente, o que significa síndrome de protagonista?",
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    // Contrato: zero itens recuperados ⇒ NENHUM RAG alimenta a geração.
    expect(json.messages[0].contextJson.rag.used).toBe(false);
    expect(json.messages[0].contextJson.rag.items).toBe(0);

    // Materialização aconteceu mesmo assim: frame READY com snapshot VAZIO.
    const frames = await readRagFrames(fx.user, fx.conversationId);
    expect(frames).toHaveLength(1);
    expect(frames[0].freshness).toBe("CURRENT");
    const rag = frames[0].externalRag as { items: Array<{ chunkId: string }> };
    expect(rag.items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// STEP 109Q-15 — regressão: research trigger e RAG usam o ORIGINAL, nunca a
// projeção. O prompt projetado ("responda somente como ...") NÃO pode ativar
// pesquisa externa nem derivar query/conceito de fala que não é do usuário.
//   R1 gatilho roda sobre userPrompt original (SUPPORTED + definição);
//   R2 queryText do frame deriva do ORIGINAL (contém o conceito do usuário).
// ---------------------------------------------------------------------------

describe("STEP 109Q-15 — research trigger & RAG usam o original", () => {
  it("R1) gatilho roda sobre o ORIGINAL mesmo em SUPPORTED (projeção não dispara pesquisa)", async () => {
    const capture = { inputs: [] as ProviderInput[] };
    const genProvider: GenerationProvider = {
      name: "spy-project",
      async run(input) {
        capture.inputs.push(input);
        return {
          provider: "spy-project",
          mode: "generated",
          text: TURN_TEXT,
          tokenStats: { systemPromptChars: input.systemPrompt.length, contextBlocks: countEmittedSections(input.systemPrompt) },
        };
      },
    };
    const appR = buildApp(mockRagProvider(), genProvider);
    await appR.ready();
    try {
      const user = await signUp("RagProj");
      const userCharacterId = await newUserCharacter(user, "Patrusopher2");
      const ai1 = await newAICharacter("Luca Probe");
      const ai2 = await newAICharacter("Mia Probe");
      const conversationId = await newConversation([userCharacterId, ai1, ai2]);
      const sourceId = await newPrivateSource(user.userId);
      const documentId = await newDocument(sourceId);
      await insertChunk(documentId, "síndrome de protagonista na narrativa", 0.9);

      const original =
        "Luca Probe e Mia Probe, quem venceu a corrida de Mônaco? E o que significa síndrome de protagonista?";
      const res = await appR.inject({
        method: "POST",
        url: `/api/conversations/${conversationId}/turn`,
        headers: { cookie: user.cookie },
        payload: { userPrompt: original },
      });
      expect(res.statusCode).toBe(201);

      // SUPPORTED: o provider recebeu a projeção, nunca o original, e cada
      // speaker recebe a SUA projeção (ordem dos inputs segue characterId).
      expect(capture.inputs).toHaveLength(2);
      const projected = new Set(capture.inputs.map((i) => i.userPrompt));
      expect(projected.has(`O usuário pediu uma resposta sobre quem venceu a corrida de Mônaco. Nesta execução, responda somente como Luca Probe.`)).toBe(true);
      expect(projected.has(`O usuário pediu uma resposta sobre quem venceu a corrida de Mônaco. Nesta execução, responda somente como Mia Probe.`)).toBe(true);
      for (const i of capture.inputs) {
        expect(i.userPrompt).not.toContain("síndrome de protagonista");
        expect(i.userPrompt).not.toBe(original);
      }

      // O gatilho disparou porque o ORIGINAL contém a definição: frame criado.
      const frames = await readRagFrames(user, conversationId);
      expect(frames).toHaveLength(1);
      expect(frames[0].freshness).toBe("CURRENT");

      // A query do frame é o conceito extraído do ORIGINAL (não poderia vir da
      // projeção, que não menciona o conceito).
      const storedFrame = await prisma.conversationRagFrame.findFirst({
        where: { conversationId },
        select: { queryText: true },
      });
      expect(storedFrame?.queryText).toContain("síndrome de protagonista");

      // A geração consumiu o RAG normalmente (contrato preservado).
      const json = res.json() as { messages: Array<{ contextJson: { rag: { used: boolean } } }> };
      expect(json.messages[0].contextJson.rag.used).toBe(true);
    } finally {
      await appR.close();
    }
  });

  it("R2) queryText do frame é derivado do ORIGINAL, não da projeção", async () => {
    const user = await signUp("RagProj2");
    const userCharacterId = await newUserCharacter(user, "Patrusopher3");
    const ai1 = await newAICharacter("Noah Probe");
    const conversationId = await newConversation([userCharacterId, ai1]);
    const sourceId = await newPrivateSource(user.userId);
    const documentId = await newDocument(sourceId);
    await insertChunk(documentId, "aerodinâmica de monopostos de Fórmula 1", 0.9);

    // direct mention (destinatário nomeado) mas NÚCLEO não suportado → UNSUPPORTED.
    const original = "Noah Probe, o que significa aerodinâmica de monopostos?";
    const res = await turn(user, conversationId, { userPrompt: original });
    expect(res.statusCode).toBe(201);

    const frames = await readRagFrames(user, conversationId);
    expect(frames).toHaveLength(1);
    const storedFrame = await prisma.conversationRagFrame.findFirst({
      where: { conversationId },
      select: { queryText: true },
    });
    // Derivada do ORIGINAL, sem qualquer resíduo de projeção.
    expect(storedFrame?.queryText).toContain("aerodinâmica");
    expect(storedFrame?.queryText).not.toContain("responda somente como");
  });
});