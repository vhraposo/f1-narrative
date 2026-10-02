import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import { retrieveRelevantMemories } from "../memory/memory.retrieval.js";
import {
  buildDialogueMemoryContext,
  DIALOGUE_MEMORY_MAX_ITEMS,
  DialogueMemoryContextSchema,
} from "./conversation.dialogue-memory.js";

const WORLD_DATE = new Date("2026-10-01T12:00:00.000Z");

function memory(id: string, score: number, summary: string | null, content: string) {
  return {
    id,
    summary,
    content,
    importance: "MEDIUM" as const,
    memoryType: null,
    createdAt: WORLD_DATE,
    score,
  };
}

describe("F5.3 — DialogueMemoryContext (unit)", () => {
  it("limita a 3 itens e mantém a ordem recebida", () => {
    const context = buildDialogueMemoryContext({
      characterId: "ai-kimi",
      conversationParticipantIds: ["ai-kimi", "user-a", "ai-max"],
      memories: [
        memory("m1", 90, "resumo 1", "conteudo"),
        memory("m2", 80, "resumo 2", "conteudo"),
        memory("m3", 70, "resumo 3", "conteudo"),
        memory("m4", 60, "resumo 4", "conteudo"),
      ],
    });
    expect(context.items.length).toBe(DIALOGUE_MEMORY_MAX_ITEMS);
    expect(context.items.map((item) => item.memoryId)).toEqual(["m1", "m2", "m3"]);
  });

  it("usa content como fallback de summary e ignora memória vazia", () => {
    const context = buildDialogueMemoryContext({
      characterId: "ai-kimi",
      conversationParticipantIds: ["ai-kimi", "user-a"],
      memories: [
        memory("m1", 50, null, "conteudo relevante"),
        memory("m2", 50, "   ", "   "),
      ],
    });
    expect(context.items.length).toBe(1);
    expect(context.items[0]?.summary).toBe("conteudo relevante");
  });

  it("relevância relativa fica em 0..1 e summary é limitado a 120 chars", () => {
    const context = buildDialogueMemoryContext({
      characterId: "ai-kimi",
      conversationParticipantIds: ["ai-kimi", "user-a"],
      memories: [memory("m1", 100, "x".repeat(200), "conteudo"), memory("m2", 50, "menor", "c")],
    });
    expect(context.items[0]?.relevance).toBe(1);
    expect(context.items[1]?.relevance).toBe(0.5);
    expect(context.items[0]?.summary.length).toBeLessThanOrEqual(120);
  });

  it("scope é SHARED em grupo e CHARACTER em conversa de dois", () => {
    const group = buildDialogueMemoryContext({
      characterId: "ai-kimi",
      conversationParticipantIds: ["ai-kimi", "user-a", "ai-max"],
      memories: [memory("m1", 10, "s", "c")],
    });
    const direct = buildDialogueMemoryContext({
      characterId: "ai-kimi",
      conversationParticipantIds: ["ai-kimi", "user-a"],
      memories: [memory("m1", 10, "s", "c")],
    });
    expect(group.items[0]?.scope).toBe("SHARED");
    expect(direct.items[0]?.scope).toBe("CHARACTER");
  });

  it("deterministic replay e contrato pequeno sem campos extras", () => {
    const input = {
      characterId: "ai-kimi",
      conversationParticipantIds: ["ai-kimi", "user-a"],
      memories: [memory("m1", 42, "resumo", "conteudo")],
    };
    const a = buildDialogueMemoryContext(input);
    const b = buildDialogueMemoryContext(input);
    expect(a).toEqual(b);
    expect(Object.keys(a.items[0]!).sort()).toEqual(["memoryId", "relevance", "scope", "summary"]);
    expect(DialogueMemoryContextSchema.safeParse(a).success).toBe(true);
  });
});

describe("F5.3 — isolamento real em TEST DB", () => {
  const createdUserIds: string[] = [];
  const createdUniverseIds: string[] = [];
  const createdCharacterIds: string[] = [];
  const createdMemoryIds: string[] = [];
  let universeAId: string;
  let universeBId: string;
  let characterAId: string;
  let characterBId: string;

  beforeAll(async () => {
    const userA = await prisma.user.create({
      data: { name: "Mem A", email: `f53-a-${Date.now()}@f1nw.test` },
    });
    const userB = await prisma.user.create({
      data: { name: "Mem B", email: `f53-b-${Date.now()}@f1nw.test` },
    });
    createdUserIds.push(userA.id, userB.id);
    const universeA = await prisma.universe.create({ data: { userId: userA.id, status: "READY" } });
    const universeB = await prisma.universe.create({ data: { userId: userB.id, status: "READY" } });
    universeAId = universeA.id;
    universeBId = universeB.id;
    createdUniverseIds.push(universeA.id, universeB.id);
    const charA = await prisma.character.create({
      data: {
        universeId: universeAId,
        userId: userA.id,
        controlledBy: "AI",
        name: "f53-kimi",
        nationality: "BR",
        birthDate: WORLD_DATE,
      },
    });
    const charB = await prisma.character.create({
      data: {
        universeId: universeAId,
        userId: userA.id,
        controlledBy: "AI",
        name: "f53-max",
        nationality: "BR",
        birthDate: WORLD_DATE,
      },
    });
    characterAId = charA.id;
    characterBId = charB.id;
    createdCharacterIds.push(charA.id, charB.id);
    const memoryA = await prisma.memory.create({
      data: {
        universeId: universeAId,
        content: "Alicya contou um segredo para Kimi.",
        importance: "HIGH",
        source: "USER_DEFINED",
        participants: { create: [{ characterId: characterAId }] },
      },
    });
    const memoryB = await prisma.memory.create({
      data: {
        universeId: universeAId,
        content: "Max tem uma memória privada.",
        importance: "HIGH",
        source: "USER_DEFINED",
        participants: { create: [{ characterId: characterBId }] },
      },
    });
    const crossUniverse = await prisma.memory.create({
      data: {
        universeId: universeBId,
        content: "Memória de outro universo.",
        importance: "HIGH",
        source: "USER_DEFINED",
        participants: { create: [{ characterId: characterAId }] },
      },
    });
    createdMemoryIds.push(memoryA.id, memoryB.id, crossUniverse.id);
  });

  afterAll(async () => {
    await prisma.memoryCharacter.deleteMany({ where: { memoryId: { in: createdMemoryIds } } });
    await prisma.memory.deleteMany({ where: { id: { in: createdMemoryIds } } });
    if (createdCharacterIds.length > 0) {
      await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
    }
    if (createdUniverseIds.length > 0) {
      await prisma.universe.deleteMany({ where: { id: { in: createdUniverseIds } } });
    }
    if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it("Kimi recebe apenas a própria memória; a de Max e a de outro Universe ficam fora", async () => {
    const memories = await retrieveRelevantMemories({
      universeId: universeAId,
      characterId: characterAId,
      participantIds: [characterAId, characterBId],
      worldDate: WORLD_DATE,
      now: WORLD_DATE,
      limit: 5,
    });
    const contents = memories.map((entry) => entry.content);
    expect(contents.some((content) => content.includes("segredo"))).toBe(true);
    expect(contents.some((content) => content.includes("Max tem uma memória privada"))).toBe(false);
    expect(contents.some((content) => content.includes("outro universo"))).toBe(false);
  });

  it("Max não recebe a memória privada de Kimi", async () => {
    const memories = await retrieveRelevantMemories({
      universeId: universeAId,
      characterId: characterBId,
      participantIds: [characterAId, characterBId],
      worldDate: WORLD_DATE,
      now: WORLD_DATE,
      limit: 5,
    });
    const contents = memories.map((entry) => entry.content);
    expect(contents.some((content) => content.includes("segredo"))).toBe(false);
    expect(contents.some((content) => content.includes("Max tem uma memória privada"))).toBe(true);
  });
});
