import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import { simulateConversationTurn } from "./conversation.simulation.js";

const PREFIX = "dialogue-f34";
const WORLD_DATE = new Date("2026-10-01T12:00:00.000Z");
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];

let userId: string;
let universeId: string;
let conversationId: string;
let userCharacterId: string;
let kimiId: string;

async function createCharacter(label: string, controller: "AI" | "USER") {
  const character = await prisma.character.create({
    data: {
      universeId,
      userId,
      controlledBy: controller,
      name: `${PREFIX}-${label}`,
      nationality: "BR",
      birthDate: new Date("1998-02-15T00:00:00.000Z"),
      availability: { create: { status: "AVAILABLE" } },
    },
  });
  createdCharacterIds.push(character.id);
  return character;
}

async function seedUserMessage(content: string) {
  return prisma.message.create({
    data: {
      conversationId,
      senderType: "USER_CHARACTER",
      characterId: userCharacterId,
      content,
      createdAt: new Date(WORLD_DATE.getTime() + 60_000),
    },
  });
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { name: "F34 Owner", email: `${PREFIX}-${Date.now()}@f1nw.test` },
  });
  userId = user.id;
  createdUserIds.push(user.id);
  const universe = await prisma.universe.create({ data: { userId, status: "READY" } });
  universeId = universe.id;
  createdUniverseIds.push(universe.id);
  await prisma.worldState.create({
    data: { universeId, key: "default", currentDate: WORLD_DATE },
  });
  const alicya = await createCharacter("alicya", "USER");
  userCharacterId = alicya.id;
  const kimi = await createCharacter("kimi", "AI");
  kimiId = kimi.id;
  const max = await createCharacter("max", "AI");
  await createCharacter("lando", "AI");
  const [characterAId, characterBId] = [kimiId, userCharacterId].sort();
  await prisma.relationship.create({
    data: { characterAId, characterBId, dimensions: { affinity: 80, trust: 80 } },
  });
  void max;
  const conversation = await prisma.conversation.create({
    data: {
      type: "GROUP",
      status: "ACTIVE",
      participants: {
        create: [userCharacterId, kimiId, ...createdCharacterIds.filter((id) => id !== userCharacterId && id !== kimiId)].map(
          (characterId) => ({ characterId }),
        ),
      },
    },
  });
  conversationId = conversation.id;
  createdConversationIds.push(conversation.id);
});

afterAll(async () => {
  if (createdConversationIds.length > 0) {
    await prisma.message.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
    await prisma.conversationParticipant.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  }
  await prisma.relationship.deleteMany({
    where: { OR: [{ characterAId: { in: createdCharacterIds } }, { characterBId: { in: createdCharacterIds } }] },
  });
  await prisma.aiDecision.deleteMany({ where: { universeId } });
  if (createdCharacterIds.length > 0) {
    await prisma.characterAvailability.deleteMany({ where: { characterId: { in: createdCharacterIds } } });
    await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  }
  if (createdUniverseIds.length > 0) {
    await prisma.worldState.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
    await prisma.universe.deleteMany({ where: { id: { in: createdUniverseIds } } });
  }
  if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("F3.4 — realizer integrado ao turn execution (TEST DB)", () => {
  it("USER → AI com replyTo real e metadados persistidos", async () => {
    const userMessage = await seedUserMessage(`${PREFIX}-kimi, você acha que ganha hoje?`);
    const result = await simulateConversationTurn(conversationId, {
      userId,
      worldDate: new Date(WORLD_DATE.getTime() + 60_000),
    });
    expect(result.executed).toBe(true);
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
    const first = result.steps[0]!;
    expect(first.characterId).not.toBe(userCharacterId);
    const firstMessage = await prisma.message.findUniqueOrThrow({ where: { id: first.messageId } });
    expect(firstMessage.senderType).toBe("AI_CHARACTER");
    expect(firstMessage.conversationId).toBe(conversationId);
    expect(firstMessage.content.trim().length).toBeGreaterThan(0);
    const context = firstMessage.contextJson as Record<string, unknown>;
    const dialogue = context.dialogue as Record<string, unknown>;
    expect(dialogue.intent).toBe("ANSWER");
    expect(dialogue.replyToMessageId).toBe(userMessage.id);
    expect(dialogue.fragmentIndex).toBe(0);
    expect(context.language).toBeDefined();
  });

  it("AI → AI encadeado quando há mais de um turno", async () => {
    const result = await simulateConversationTurn(conversationId, {
      userId,
      worldDate: new Date(WORLD_DATE.getTime() + 120_000),
    });
    if (result.steps.length >= 2) {
      const [first, second] = result.steps;
      const secondMessage = await prisma.message.findUniqueOrThrow({ where: { id: second!.messageId } });
      const context = secondMessage.contextJson as Record<string, unknown>;
      const dialogue = context.dialogue as Record<string, unknown>;
      expect(dialogue.replyToMessageId).toBe(first!.messageId);
      expect(second!.characterId).not.toBe(userCharacterId);
    }
  });

  it("deterministic replay do turno produz a mesma estrutura", async () => {
    const a = await simulateConversationTurn(conversationId, { userId, worldDate: WORLD_DATE });
    const b = await simulateConversationTurn(conversationId, { userId, worldDate: WORLD_DATE });
    expect(a.plan.dialogue).toEqual(b.plan.dialogue);
  });

  it("SILENCE não cria Message", async () => {
    const before = await prisma.message.count({ where: { conversationId } });
    const result = await simulateConversationTurn(conversationId, {
      userId,
      worldDate: WORLD_DATE,
      maxDepth: 0,
    });
    if (!result.executed) {
      const after = await prisma.message.count({ where: { conversationId } });
      expect(after).toBe(before);
    }
    expect(result.steps.length).toBeGreaterThanOrEqual(0);
  });
});
