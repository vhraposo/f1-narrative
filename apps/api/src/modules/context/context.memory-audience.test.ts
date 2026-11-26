import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { assembleGenerationBundle } from "../generation/generation.assembly.js";
import type { GenerationProvider } from "../generation/generation.assembly.js";
import { retrieveRelevantMemories } from "../memory/memory.retrieval.js";
import { buildDialogueKnowledgeContext } from "../conversation/conversation.dialogue-context.js";

// F7.2 — audiência de conhecimento (`MemoryCharacter`) em TEST DB.
// Garante que memória privada de A não chega ao contexto do speaker B no
// caminho legado, que F5 continua assimétrico e que as APIs de memória não
// vazam para fora do grant. Cleanup completo.

const PREFIX = "memory-audience";

let app: FastifyInstance;

type TestUser = { cookie: string; userId: string };

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];
const createdMemoryIds: string[] = [];

let owner: TestUser;
let outsider: TestUser;
let ownerUniverseId: string;
let outsiderUniverseId: string;
let characterAId: string;
let characterBId: string;
let outsiderCharacterId: string;
let conversationId: string;
let memoryAId: string;
let memoryBId: string;
let memorySharedId: string;
let memoryForeignId: string;

async function createUser(label: string): Promise<TestUser> {
  const email = `${PREFIX}-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@f1nw.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: label, email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  createdUserIds.push(user.id);
  return { cookie, userId: user.id };
}

async function ensureUniverse(userId: string): Promise<string> {
  const universe = await prisma.universe.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
  return universe.id;
}

async function createAiCharacter(
  userId: string,
  universeId: string,
  name: string,
): Promise<string> {
  const character = await prisma.character.create({
    data: {
      userId,
      universeId,
      controlledBy: "AI",
      name,
      nationality: "BR",
      birthDate: new Date("1995-01-01T00:00:00.000Z"),
    },
  });
  createdCharacterIds.push(character.id);
  return character.id;
}

async function createMemory(input: {
  content: string;
  summary: string;
  universeId: string | null;
  participantIds: string[];
}): Promise<string> {
  const memory = await prisma.memory.create({
    data: {
      universeId: input.universeId,
      importance: "HIGH",
      source: "GENERATED_EVENT",
      status: "ACTIVE",
      content: input.content,
      summary: input.summary,
      participants: {
        create: input.participantIds.map((characterId) => ({ characterId })),
      },
    },
  });
  createdMemoryIds.push(memory.id);
  return memory.id;
}

function stubProvider(): GenerationProvider {
  return {
    name: "stub-f7-memory",
    async run() {
      return {
        provider: "stub-f7-memory",
        mode: "generated" as const,
        text: "ok",
        tokenStats: { systemPromptChars: 0, contextBlocks: 0 },
      };
    },
  };
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  owner = await createUser("owner");
  outsider = await createUser("outsider");
  ownerUniverseId = await ensureUniverse(owner.userId);
  outsiderUniverseId = await ensureUniverse(outsider.userId);

  characterAId = await createAiCharacter(owner.userId, ownerUniverseId, `${PREFIX}-a`);
  characterBId = await createAiCharacter(owner.userId, ownerUniverseId, `${PREFIX}-b`);
  outsiderCharacterId = await createAiCharacter(
    outsider.userId,
    outsiderUniverseId,
    `${PREFIX}-outsider`,
  );

  const conversation = await prisma.conversation.create({
    data: {
      type: "GROUP",
      participants: { create: [{ characterId: characterAId }, { characterId: characterBId }] },
    },
  });
  createdConversationIds.push(conversation.id);
  conversationId = conversation.id;

  memoryAId = await createMemory({
    content: "segredo-de-A",
    summary: "topico-A",
    universeId: ownerUniverseId,
    participantIds: [characterAId],
  });
  memoryBId = await createMemory({
    content: "segredo-de-B",
    summary: "topico-B",
    universeId: ownerUniverseId,
    participantIds: [characterBId],
  });
  memorySharedId = await createMemory({
    content: "fato-compartilhado",
    summary: "topico-compartilhado",
    universeId: ownerUniverseId,
    participantIds: [characterAId, characterBId],
  });
  memoryForeignId = await createMemory({
    content: "segredo-de-outro-universe",
    summary: "topico-estrangeiro",
    universeId: outsiderUniverseId,
    participantIds: [characterAId],
  });
});

afterAll(async () => {
  if (createdConversationIds.length > 0) {
    await prisma.message.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
    await prisma.conversationParticipant.deleteMany({
      where: { conversationId: { in: createdConversationIds } },
    });
    await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  }
  if (createdMemoryIds.length > 0) {
    await prisma.memoryCharacter.deleteMany({ where: { memoryId: { in: createdMemoryIds } } });
    await prisma.memory.deleteMany({ where: { id: { in: createdMemoryIds } } });
  }
  if (createdCharacterIds.length > 0) {
    await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  }
  if (createdUserIds.length > 0) {
    await prisma.universe.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await app.close();
  await prisma.$disconnect();
});

describe("F7.2 — audiência de memória (MemoryCharacter)", () => {
  it("caminho legado: contexto de A tem A e não tem B; contexto de B é simétrico", async () => {
    const forA = await assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, targetCharacterId: characterAId },
      stubProvider(),
    );
    const memoriesA = forA.context.memories.map((memory) => memory.id);
    expect(memoriesA).toContain(memoryAId);
    expect(memoriesA).toContain(memorySharedId);
    expect(memoriesA).not.toContain(memoryBId);
    expect(memoriesA).not.toContain(memoryForeignId);
    expect(forA.systemPrompt).toContain("segredo-de-A");
    expect(forA.systemPrompt).not.toContain("segredo-de-B");
    expect(JSON.stringify(forA.context)).not.toContain("segredo-de-B");

    const forB = await assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, targetCharacterId: characterBId },
      stubProvider(),
    );
    const memoriesB = forB.context.memories.map((memory) => memory.id);
    expect(memoriesB).toContain(memoryBId);
    expect(memoriesB).toContain(memorySharedId);
    expect(memoriesB).not.toContain(memoryAId);
    expect(memoriesB).not.toContain(memoryForeignId);
    expect(forB.systemPrompt).toContain("segredo-de-B");
    expect(forB.systemPrompt).not.toContain("segredo-de-A");
    expect(JSON.stringify(forB.context)).not.toContain("segredo-de-A");
  });

  it("caminho legado é determinístico no replay com audiência", async () => {
    const first = await assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, targetCharacterId: characterAId },
      stubProvider(),
    );
    const second = await assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, targetCharacterId: characterAId },
      stubProvider(),
    );
    expect(second.context.memories.map((memory) => memory.id)).toEqual(
      first.context.memories.map((memory) => memory.id),
    );
    expect(second.systemPrompt).toBe(first.systemPrompt);
    expect(second.generationKey).toBe(first.generationKey);
  });

  it("F5: retrieval e knownFacts continuam assimétricos por speaker", async () => {
    const forA = await retrieveRelevantMemories({
      universeId: ownerUniverseId,
      characterId: characterAId,
      participantIds: [characterAId, characterBId],
      worldDate: new Date("2026-10-01T00:00:00.000Z"),
      now: new Date("2026-10-01T00:00:00.000Z"),
    });
    const idsA = forA.map((memory) => memory.id);
    expect(idsA).toContain(memoryAId);
    expect(idsA).not.toContain(memoryBId);
    expect(idsA).not.toContain(memoryForeignId);

    const forB = await retrieveRelevantMemories({
      universeId: ownerUniverseId,
      characterId: characterBId,
      participantIds: [characterAId, characterBId],
      worldDate: new Date("2026-10-01T00:00:00.000Z"),
      now: new Date("2026-10-01T00:00:00.000Z"),
    });
    const idsB = forB.map((memory) => memory.id);
    expect(idsB).toContain(memoryBId);
    expect(idsB).not.toContain(memoryAId);

    const knowledgeA = buildDialogueKnowledgeContext({
      universeId: ownerUniverseId,
      memories: forA.map((memory) => ({
        id: memory.id,
        summary: memory.summary,
        content: memory.content,
        importance: memory.importance,
        universeId: ownerUniverseId,
      })),
    });
    const factsA = knowledgeA.knownFacts.map((fact) => fact.factId);
    expect(factsA).toContain(memoryAId);
    expect(factsA).not.toContain(memoryBId);

    const knowledgeB = buildDialogueKnowledgeContext({
      universeId: ownerUniverseId,
      memories: forB.map((memory) => ({
        id: memory.id,
        summary: memory.summary,
        content: memory.content,
        importance: memory.importance,
        universeId: ownerUniverseId,
      })),
    });
    const factsB = knowledgeB.knownFacts.map((fact) => fact.factId);
    expect(factsB).toContain(memoryBId);
    expect(factsB).not.toContain(memoryAId);
  });

  it("GET /context com characterId filtra por audiência; sem characterId é a visão da conversa", async () => {
    const audienced = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}/context?characterId=${characterAId}`,
      headers: { cookie: owner.cookie },
    });
    expect(audienced.statusCode).toBe(200);
    const audiencedIds = (
      audienced.json() as { context: { memories: Array<{ id: string }> } }
    ).context.memories.map((memory) => memory.id);
    expect(audiencedIds).toContain(memoryAId);
    expect(audiencedIds).not.toContain(memoryBId);

    const pooled = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}/context`,
      headers: { cookie: owner.cookie },
    });
    expect(pooled.statusCode).toBe(200);
    const pooledIds = (pooled.json() as { context: { memories: Array<{ id: string }> } }).context.memories.map(
      (memory) => memory.id,
    );
    expect(pooledIds).toEqual(expect.arrayContaining([memoryAId, memoryBId]));

    const notParticipant = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}/context?characterId=${outsiderCharacterId}`,
      headers: { cookie: owner.cookie },
    });
    expect(notParticipant.statusCode).toBe(404);
  });

  it("APIs de memória respeitam MemoryCharacter e não vazam entre usuários", async () => {
    const ownerGet = await app.inject({
      method: "GET",
      url: `/api/memories/${memoryAId}`,
      headers: { cookie: owner.cookie },
    });
    expect(ownerGet.statusCode).toBe(200);

    const outsiderGet = await app.inject({
      method: "GET",
      url: `/api/memories/${memoryAId}`,
      headers: { cookie: outsider.cookie },
    });
    expect(outsiderGet.statusCode).toBe(404);

    const outsiderList = await app.inject({
      method: "GET",
      url: "/api/memories",
      headers: { cookie: outsider.cookie },
    });
    expect(outsiderList.statusCode).toBe(200);
    expect(
      (outsiderList.json() as { memories: Array<{ id: string }> }).memories.map(
        (memory) => memory.id,
      ),
    ).not.toContain(memoryAId);

    // Participar da conversa não concede a memória: outsider não participa; e
    // mesmo um personagem do mesmo usuário sem vínculo não aparece.
    const ownerList = await app.inject({
      method: "GET",
      url: "/api/memories",
      headers: { cookie: owner.cookie },
    });
    expect(ownerList.statusCode).toBe(200);
    const ownerIds = (ownerList.json() as { memories: Array<{ id: string }> }).memories.map(
      (memory) => memory.id,
    );
    expect(ownerIds).toContain(memoryAId);
    expect(ownerIds).toContain(memoryBId);
  });

  it("isolamento de Universe: memória de outro universe não entra no contexto nem no retrieval", async () => {
    const forA = await assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, targetCharacterId: characterAId },
      stubProvider(),
    );
    expect(forA.context.memories.map((memory) => memory.id)).not.toContain(memoryForeignId);
    expect(forA.systemPrompt).not.toContain("segredo-de-outro-universe");

    const forB = await assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, targetCharacterId: characterBId },
      stubProvider(),
    );
    expect(forB.context.memories.map((memory) => memory.id)).not.toContain(memoryForeignId);
  });
});
