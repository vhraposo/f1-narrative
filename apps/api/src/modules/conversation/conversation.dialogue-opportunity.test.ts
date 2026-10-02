import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import type { DialogueRealizerContext } from "./conversation.dialogue-realizer.js";
import { getSimulationPlan, simulateConversationTurn } from "./conversation.simulation.js";

const PREFIX = "dialogue-opportunity";
const WORLD_DATE = new Date("2026-10-01T12:00:00.000Z");

const capturedContexts = vi.hoisted(() => [] as DialogueRealizerContext[]);

vi.mock("./conversation.dialogue-realizer.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./conversation.dialogue-realizer.js")>();
  const deterministic = new original.DeterministicDialogueRealizer();
  return {
    ...original,
    createDialogueRealizer: (...args: Parameters<typeof original.createDialogueRealizer>) => ({
      kind: original.createDialogueRealizer(...args).kind,
      realize: async (context: DialogueRealizerContext) => {
        capturedContexts.push(context);
        return deterministic.realize(context);
      },
    }),
  };
});

const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];
const createdMemoryIds: string[] = [];

let userId: string;
let universeId: string;
let characterAId: string;
let characterBId: string;
let characterCId: string;
let characterDId: string;
let userCharacterId: string;
let conversationOpenId: string;
let conversationContinueId: string;
let conversationReplayId: string;
let conversationBusyId: string;
let conversationContextId: string;

async function createCharacter(label: string, controller: "AI" | "USER") {
  const character = await prisma.character.create({
    data: {
      universeId,
      userId,
      controlledBy: controller,
      name: `${PREFIX}-${label}`,
      nationality: "BR",
      birthDate: new Date("1998-02-15T00:00:00.000Z"),
    },
  });
  createdCharacterIds.push(character.id);
  return character;
}

async function createConversation(
  characterIds: string[],
  options: { message?: { senderId: string; content: string }; createdAt?: Date } = {},
) {
  const conversation = await prisma.conversation.create({
    data: {
      status: "ACTIVE",
      createdAt: options.createdAt ?? new Date(WORLD_DATE.getTime() - 60 * 60 * 1000),
      participants: { create: characterIds.map((characterId) => ({ characterId })) },
      ...(options.message
        ? {
            messages: {
              create: {
                senderType:
                  options.message.senderId === userCharacterId ? "USER_CHARACTER" : "AI_CHARACTER",
                characterId: options.message.senderId,
                content: options.message.content,
                createdAt: new Date(WORLD_DATE.getTime() + 60_000),
              },
            },
          }
        : {}),
    },
  });
  createdConversationIds.push(conversation.id);
  return conversation;
}

function seed(conversationId: string, characterId: string, targetCharacterId: string | null) {
  return {
    conversationId,
    characterId,
    targetCharacterId,
    fingerprint: "a".repeat(64),
    windowStart: WORLD_DATE.toISOString(),
  };
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { name: "F63 Owner", email: `${PREFIX}-${Date.now()}@f1nw.test` },
  });
  userId = user.id;
  createdUserIds.push(user.id);
  const universe = await prisma.universe.create({ data: { userId, status: "READY" } });
  universeId = universe.id;
  createdUniverseIds.push(universe.id);
  await prisma.worldState.create({
    data: { universeId, key: "default", currentDate: WORLD_DATE },
  });

  const a = await createCharacter("a", "AI");
  const b = await createCharacter("b", "AI");
  const c = await createCharacter("c", "AI");
  const d = await createCharacter("d", "AI");
  const u = await createCharacter("user", "USER");
  characterAId = a.id;
  characterBId = b.id;
  characterCId = c.id;
  characterDId = d.id;
  userCharacterId = u.id;

  await prisma.characterAvailability.create({
    data: { characterId: characterCId, status: "BUSY" },
  });

  const [relationshipA, relationshipB] = [characterAId, characterBId].sort();
  await prisma.relationship.create({
    data: { characterAId: relationshipA!, characterBId: relationshipB!, dimensions: { affinity: 80, trust: 80 } },
  });

  const memoryA = await prisma.memory.create({
    data: {
      universeId,
      importance: "HIGH",
      source: "GENERATED_EVENT",
      status: "ACTIVE",
      content: "segredo-de-A",
      createdAt: new Date(WORLD_DATE.getTime() - 60_000),
      participants: { create: [{ characterId: characterAId }] },
    },
  });
  createdMemoryIds.push(memoryA.id);
  const memoryB = await prisma.memory.create({
    data: {
      universeId,
      importance: "HIGH",
      source: "GENERATED_EVENT",
      status: "ACTIVE",
      content: "segredo-de-B",
      createdAt: new Date(WORLD_DATE.getTime() - 60_000),
      participants: { create: [{ characterId: characterBId }] },
    },
  });
  createdMemoryIds.push(memoryB.id);

  conversationOpenId = (
    await createConversation([characterAId, characterBId])
  ).id;
  conversationContinueId = (
    await createConversation([characterAId, characterBId], {
      message: { senderId: characterBId, content: "bom dia, parceiro" },
    })
  ).id;
  conversationReplayId = (
    await createConversation([characterAId, characterBId], {
      message: { senderId: characterBId, content: "bom dia" },
    })
  ).id;
  conversationBusyId = (
    await createConversation([characterCId, characterDId], {
      message: { senderId: characterDId, content: "bom dia" },
    })
  ).id;
  conversationContextId = (
    await createConversation([characterAId, characterBId, userCharacterId], {
      message: { senderId: userCharacterId, content: "bom dia pessoal" },
    })
  ).id;
});

afterAll(async () => {
  await prisma.aiDecision.deleteMany({ where: { universeId } });
  await prisma.characterGoal.deleteMany({ where: { universeId } });
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
  await prisma.relationship.deleteMany({
    where: {
      OR: [
        { characterAId: { in: createdCharacterIds } },
        { characterBId: { in: createdCharacterIds } },
      ],
    },
  });
  if (createdCharacterIds.length > 0) {
    await prisma.characterAvailability.deleteMany({
      where: { characterId: { in: createdCharacterIds } },
    });
    await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  }
  if (createdUniverseIds.length > 0) {
    await prisma.worldState.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
    await prisma.universe.deleteMany({ where: { id: { in: createdUniverseIds } } });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

describe("F6.3 — envelope de conversa a partir da oportunidade (pipeline F3–F5)", () => {
  it("abre conversa vazia com o primeiro speaker e target da oportunidade", async () => {
    const before = await prisma.message.count({ where: { conversationId: conversationOpenId } });
    const result = await simulateConversationTurn(conversationOpenId, {
      userId,
      worldDate: new Date(WORLD_DATE.getTime() + 60_000),
      opportunity: seed(conversationOpenId, characterAId, characterBId),
    });
    expect(result.executed).toBe(true);
    expect(result.steps[0]?.characterId).toBe(characterAId);
    const message = await prisma.message.findUniqueOrThrow({
      where: { id: result.steps[0]!.messageId },
    });
    expect(message.senderType).toBe("AI_CHARACTER");
    expect(message.characterId).toBe(characterAId);
    expect(await prisma.message.count({ where: { conversationId: conversationOpenId } })).toBe(
      before + result.steps.length,
    );
    const decision = await prisma.aiDecision.findFirstOrThrow({
      where: {
        characterId: characterAId,
        conversationId: conversationOpenId,
        metadata: { path: ["trigger"], equals: "CONVERSATION_TURN_DUE" },
      },
      select: { metadata: true },
    });
    expect((decision.metadata as Record<string, unknown>).targetCharacterId).toBe(characterBId);
  });

  it("continuação preserva o primeiro speaker e o replyTo do pipeline", async () => {
    const seedMessage = await prisma.message.findFirstOrThrow({
      where: { conversationId: conversationContinueId, characterId: characterBId },
      select: { id: true },
    });
    const result = await simulateConversationTurn(conversationContinueId, {
      userId,
      worldDate: new Date(WORLD_DATE.getTime() + 120_000),
      opportunity: seed(conversationContinueId, characterAId, characterBId),
    });
    expect(result.executed).toBe(true);
    expect(result.steps[0]?.characterId).toBe(characterAId);
    const message = await prisma.message.findUniqueOrThrow({
      where: { id: result.steps[0]!.messageId },
    });
    const dialogue = (message.contextJson as Record<string, unknown>).dialogue as Record<
      string,
      unknown
    >;
    expect(dialogue.replyToMessageId).toBe(seedMessage.id);
  });

  it("speaker indisponível produz stop sem mensagem", async () => {
    const before = await prisma.message.count({ where: { conversationId: conversationBusyId } });
    const result = await simulateConversationTurn(conversationBusyId, {
      userId,
      worldDate: new Date(WORLD_DATE.getTime() + 60_000),
      opportunity: seed(conversationBusyId, characterCId, characterDId),
    });
    expect(result.executed).toBe(false);
    expect(result.steps).toHaveLength(0);
    expect(result.stopReason).toBe("NO_ELIGIBLE_SPEAKER");
    expect(await prisma.message.count({ where: { conversationId: conversationBusyId } })).toBe(
      before,
    );
  });

  it("plano com oportunidade é determinístico (replay)", async () => {
    const options = {
      userId,
      worldDate: new Date(WORLD_DATE.getTime() + 60_000),
      opportunity: seed(conversationReplayId, characterAId, characterBId),
    };
    const first = await getSimulationPlan(conversationReplayId, options);
    const second = await getSimulationPlan(conversationReplayId, options);
    expect(second.dialogue).toEqual(first.dialogue);
    expect(second.planned).toEqual(first.planned);
  });

  it("contexto F5 por speaker: memória privada e knowledge asymmetry", async () => {
    capturedContexts.length = 0;
    const result = await simulateConversationTurn(conversationContextId, {
      userId,
      worldDate: new Date(WORLD_DATE.getTime() + 120_000),
      opportunity: seed(conversationContextId, characterAId, characterBId),
    });
    expect(result.executed).toBe(true);
    const contextA = capturedContexts.find((context) => context.speakerCharacterId === characterAId);
    const contextB = capturedContexts.find((context) => context.speakerCharacterId === characterBId);
    expect(contextA).toBeDefined();
    expect(contextB).toBeDefined();

    const memoryA = await prisma.memory.findFirstOrThrow({
      where: { universeId, content: "segredo-de-A" },
      select: { id: true },
    });
    const memoryB = await prisma.memory.findFirstOrThrow({
      where: { universeId, content: "segredo-de-B" },
      select: { id: true },
    });

    const knowledgeA = contextA!.knowledgeContext?.knownFacts.map((fact) => fact.factId) ?? [];
    const knowledgeB = contextB!.knowledgeContext?.knownFacts.map((fact) => fact.factId) ?? [];
    expect(knowledgeA).toContain(memoryA.id);
    expect(knowledgeA).not.toContain(memoryB.id);
    expect(knowledgeB).toContain(memoryB.id);
    expect(knowledgeB).not.toContain(memoryA.id);

    const memoriesA = contextA!.memoryContext?.items.map((item) => item.memoryId) ?? [];
    const memoriesB = contextB!.memoryContext?.items.map((item) => item.memoryId) ?? [];
    expect(memoriesA).toContain(memoryA.id);
    expect(memoriesA).not.toContain(memoryB.id);
    expect(memoriesB).toContain(memoryB.id);
    expect(memoriesB).not.toContain(memoryA.id);
  });
});
