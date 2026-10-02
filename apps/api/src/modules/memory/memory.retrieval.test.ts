import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import { buildBehaviorContext } from "../behavior/behavior.context.js";
import { decideMemoryRule, projectMemories } from "../pilot-experience/pilot-experience.memory-rules.js";
import { MEMORY_POLICY_VERSION, rankMemories } from "./memory.policy.js";
import { retrieveRelevantMemories } from "./memory.retrieval.js";

const PREFIX = "memory-retrieval";
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdMemoryIds: string[] = [];
const createdConversationIds: string[] = [];

let universeId: string;
let characterId: string;
let allyId: string;
let conversationId: string;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `${PREFIX}-${Date.now()}@f1nw.test`, name: "Memory Owner" },
  });
  createdUserIds.push(user.id);
  const universe = await prisma.universe.create({ data: { userId: user.id, status: "READY" } });
  createdUniverseIds.push(universe.id);
  universeId = universe.id;

  const character = await prisma.character.create({
    data: {
      universeId,
      controlledBy: "AI",
      name: `${PREFIX}-hero`,
      nationality: "BR",
      birthDate: new Date("1998-02-15T00:00:00.000Z"),
    },
  });
  createdCharacterIds.push(character.id);
  characterId = character.id;
  const ally = await prisma.character.create({
    data: {
      universeId,
      controlledBy: "AI",
      name: `${PREFIX}-ally`,
      nationality: "BR",
      birthDate: new Date("1998-02-15T00:00:00.000Z"),
    },
  });
  createdCharacterIds.push(ally.id);
  allyId = ally.id;

  const conversation = await prisma.conversation.create({
    data: {
      type: "DM",
      participants: { create: [{ characterId }, { characterId: allyId }] },
      messages: {
        create: [{ senderType: "AI_CHARACTER", characterId: allyId, content: "Vamos treinar." }],
      },
    },
  });
  createdConversationIds.push(conversation.id);
  conversationId = conversation.id;
});

async function createMemory(input: {
  content: string;
  importance: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  memoryType?: "SPORTING_VICTORY" | "SPORTING_DEFEAT" | "CHAMPIONSHIP" | null;
  participantIds: string[];
  universe?: string | null;
  createdAt?: Date;
  status?: "ACTIVE" | "INVALIDATED";
}) {
  const memory = await prisma.memory.create({
    data: {
      universeId: input.universe === undefined ? universeId : input.universe,
      content: input.content,
      summary: input.content.slice(0, 40),
      importance: input.importance,
      memoryType: input.memoryType ?? null,
      status: input.status ?? "ACTIVE",
      source: "GENERATED_EVENT",
      participants: { create: input.participantIds.map((id) => ({ characterId: id })) },
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });
  createdMemoryIds.push(memory.id);
  return memory;
}

afterAll(async () => {
  if (createdMemoryIds.length > 0) {
    await prisma.memoryCharacter.deleteMany({ where: { memoryId: { in: createdMemoryIds } } });
    await prisma.memory.deleteMany({ where: { id: { in: createdMemoryIds } } });
  }
  if (createdConversationIds.length > 0) {
    await prisma.message.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
    await prisma.conversationParticipant.deleteMany({
      where: { conversationId: { in: createdConversationIds } },
    });
    await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  }
  if (createdCharacterIds.length > 0) {
    await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  }
  if (createdUniverseIds.length > 0) {
    await prisma.universe.deleteMany({ where: { id: { in: createdUniverseIds } } });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

const NOW = new Date("2026-10-01T12:00:00.000Z");

describe("memory policy and retrieval (V4.4)", () => {
  it("1) política de memória é determinística e versionada", () => {
    expect(MEMORY_POLICY_VERSION).toBe("memory-policy.v1");
    const high = decideMemoryRule(
      { experienceType: "SPORTING_DEFEAT", salience: "HIGH" },
      { firstWinExperienceId: null },
    );
    const low = decideMemoryRule(
      { experienceType: "SPORTING_DEFEAT", salience: "LOW" },
      { firstWinExperienceId: null },
    );
    expect(high).toEqual({
      derive: true,
      ruleCode: "defeat-memory",
      memoryType: "SPORTING_DEFEAT",
      importance: "HIGH",
    });
    expect(low.derive).toBe(false);
  });

  it("2) projeção usa derivedKey estável (dedup por causa)", () => {
    const experience = {
      experienceType: "SPORTING_VICTORY" as const,
      salience: "HIGH" as const,
      source: "RACE_RESULT" as const,
      sourceKey: "race:2026:1:driver",
      title: "Vitória",
      summary: null,
      occurredAt: NOW,
      seasonYear: 2026,
      seasonId: null,
      raceId: null,
      eventId: null,
    };
    const first = projectMemories([experience]);
    const second = projectMemories([experience]);
    expect(first.map((memory) => memory.derivedKey)).toEqual(
      second.map((memory) => memory.derivedKey),
    );
    expect(first[0]?.derivedKey).toBe("race:2026:1:driver:first-win-memory");
  });

  it("3) ranking prioriza relevância de participante e meta", () => {
    const ranked = rankMemories(
      [
        {
          id: "a",
          importance: "MEDIUM",
          createdAt: NOW,
          memoryType: "SPORTING_DEFEAT",
          participantIds: [characterId, allyId],
        },
        {
          id: "b",
          importance: "CRITICAL",
          createdAt: new Date("2020-01-01T00:00:00.000Z"),
          memoryType: "TEAM_CHANGE",
          participantIds: ["someone-else"],
        },
      ],
      {
        characterId,
        participantIds: [allyId],
        goalKinds: ["RECOVER_AFTER_SETBACK"],
        worldDate: NOW,
        now: NOW,
      },
    );
    expect(ranked[0]?.id).toBe("a");
    expect(ranked[0]?.score).toBeGreaterThanOrEqual(ranked[1]?.score ?? 0);
  });

  it("4) ranking é determinístico em execuções repetidas", () => {
    const candidates = [
      { id: "x", importance: "HIGH" as const, createdAt: NOW, memoryType: null, participantIds: [characterId] },
      { id: "y", importance: "HIGH" as const, createdAt: NOW, memoryType: null, participantIds: [characterId] },
    ];
    const first = rankMemories(candidates, { characterId, worldDate: NOW, now: NOW });
    const second = rankMemories(candidates, { characterId, worldDate: NOW, now: NOW });
    expect(first.map((entry) => entry.id)).toEqual(second.map((entry) => entry.id));
    expect(first.map((entry) => entry.id)).toEqual(["x", "y"]);
  });

  it("5) retrieval exclui outro Universe e memórias inativas", async () => {
    await createMemory({
      content: "Memória relevante da conversa.",
      importance: "HIGH",
      memoryType: "SPORTING_DEFEAT",
      participantIds: [characterId, allyId],
    });
    await createMemory({
      content: "Memória inativa.",
      importance: "CRITICAL",
      participantIds: [characterId],
      status: "INVALIDATED",
    });
    const otherUser = await prisma.user.create({
      data: { email: `${PREFIX}-other-${Date.now()}@f1nw.test`, name: "Other" },
    });
    createdUserIds.push(otherUser.id);
    const otherUniverse = await prisma.universe.create({
      data: { userId: otherUser.id, status: "READY" },
    });
    createdUniverseIds.push(otherUniverse.id);
    await createMemory({
      content: "Memória de outro universo.",
      importance: "CRITICAL",
      participantIds: [characterId],
      universe: otherUniverse.id,
    });

    const retrieved = await retrieveRelevantMemories({
      universeId,
      characterId,
      participantIds: [allyId],
      relationshipCharacterIds: [allyId],
      goalKinds: ["RECOVER_AFTER_SETBACK"],
      worldDate: NOW,
      now: NOW,
      limit: 10,
    });
    const contents = retrieved.map((memory) => memory.content);
    expect(contents).toContain("Memória relevante da conversa.");
    expect(contents).not.toContain("Memória inativa.");
    expect(contents).not.toContain("Memória de outro universo.");
  });

  it("6) BehaviorContext usa retrieval e inclui a memória relevante", async () => {
    const context = await buildBehaviorContext({
      universeId,
      characterId,
      trigger: "MESSAGE_RECEIVED",
      worldDate: NOW,
      conversationId,
      userInitiated: true,
    });
    expect(context.memory.recent.map((memory) => memory.content)).toContain(
      "Memória relevante da conversa.",
    );
  });
});
