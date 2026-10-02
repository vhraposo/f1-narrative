import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { prisma } from "../../infrastructure/database/prisma.js";
import { getSimulationPlan, simulateConversationTurn } from "./conversation.simulation.js";

const PREFIX = "dialogue-f35";
const WORLD_DATE = new Date("2026-10-01T12:00:00.000Z");
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];

let userId: string;
let universeId: string;
let userCharacterId: string;
const aiIds: string[] = [];

type ScenarioMetric = {
  scenarioId: string;
  candidateCount: number;
  selectedCount: number;
  turnCount: number;
  messageCount: number;
  fragmentCount: number;
  speakers: string[];
  replyToCount: number;
  validReplyToCount: number;
  aiToAiReplyCount: number;
  userToAiReplyCount: number;
  avgChars: number;
  maxChars: number;
  emptyMessageCount: number;
  fallbackCount: number;
  stopReason: string;
  continuation: string;
};

const metrics: ScenarioMetric[] = [];

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

async function createConversation(aiCharacterIds: string[]) {
  const conversation = await prisma.conversation.create({
    data: {
      type: "GROUP",
      status: "ACTIVE",
      participants: {
        create: [userCharacterId, ...aiCharacterIds].map((characterId) => ({ characterId })),
      },
    },
  });
  createdConversationIds.push(conversation.id);
  return conversation;
}

async function seedUserMessage(conversationId: string, content: string, offsetMs: number) {
  return prisma.message.create({
    data: {
      conversationId,
      senderType: "USER_CHARACTER",
      characterId: userCharacterId,
      content,
      createdAt: new Date(WORLD_DATE.getTime() + offsetMs),
    },
  });
}

async function collectMetrics(scenarioId: string, conversationId: string, offsetMs: number): Promise<ScenarioMetric> {
  const result = await simulateConversationTurn(conversationId, {
    userId,
    worldDate: new Date(WORLD_DATE.getTime() + offsetMs),
  });
  const messages = await prisma.message.findMany({
    where: { conversationId, senderType: "AI_CHARACTER" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const byId = new Map(messages.map((message) => [message.id, message]));
  let validReplyToCount = 0;
  let aiToAiReplyCount = 0;
  let userToAiReplyCount = 0;
  let fragmentCount = 0;
  let fallbackCount = 0;
  const lengths: number[] = [];
  for (const message of messages) {
    lengths.push(message.content.length);
    if (message.content.trim().length === 0) {
      throw new Error(`empty message in ${scenarioId}`);
    }
    const context = (message.contextJson ?? {}) as Record<string, unknown>;
    const dialogue = (context.dialogue ?? {}) as Record<string, unknown>;
    if (typeof dialogue.fragmentIndex === "number" && dialogue.fragmentIndex > 0) fragmentCount += 1;
    const language = (context.language ?? {}) as Record<string, unknown>;
    if (language.provider !== "dialogue-realizer") fallbackCount += 1;
    const replyTo = dialogue.replyToMessageId;
    if (typeof replyTo === "string") {
      const target = byId.get(replyTo) ?? (await prisma.message.findUnique({ where: { id: replyTo } }));
      if (target && target.conversationId === conversationId) {
        validReplyToCount += 1;
        if (target.senderType === "AI_CHARACTER") aiToAiReplyCount += 1;
        if (target.senderType === "USER_CHARACTER") userToAiReplyCount += 1;
      }
    }
  }
  const metric: ScenarioMetric = {
    scenarioId,
    candidateCount: result.plan.candidates.length,
    selectedCount: result.plan.planned.length,
    turnCount: result.plan.dialogue.turns.length,
    messageCount: messages.length,
    fragmentCount,
    speakers: result.steps.map((step) => step.characterId),
    replyToCount: messages.filter((message) => {
      const context = (message.contextJson ?? {}) as Record<string, unknown>;
      const dialogue = (context.dialogue ?? {}) as Record<string, unknown>;
      return typeof dialogue.replyToMessageId === "string";
    }).length,
    validReplyToCount,
    aiToAiReplyCount,
    userToAiReplyCount,
    avgChars: lengths.length > 0 ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 0,
    maxChars: lengths.length > 0 ? Math.max(...lengths) : 0,
    emptyMessageCount: 0,
    fallbackCount,
    stopReason: result.stopReason,
    continuation: result.plan.dialogue.continuation,
  };
  metrics.push(metric);
  return metric;
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { name: "F35 Owner", email: `${PREFIX}-${Date.now()}@f1nw.test` },
  });
  userId = user.id;
  createdUserIds.push(user.id);
  const universe = await prisma.universe.create({ data: { userId, status: "READY" } });
  universeId = universe.id;
  createdUniverseIds.push(universe.id);
  await prisma.worldState.create({ data: { universeId, key: "default", currentDate: WORLD_DATE } });
  const alicya = await createCharacter("alicya", "USER");
  userCharacterId = alicya.id;
  for (const label of ["kimi", "max", "lando", "charles", "george", "oscar"]) {
    const character = await createCharacter(label, "AI");
    aiIds.push(character.id);
  }
  const [characterAId, characterBId] = [aiIds[0]!, userCharacterId].sort();
  await prisma.relationship.create({
    data: { characterAId, characterBId, dimensions: { affinity: 80, trust: 80 } },
  });
});

afterAll(async () => {
  writeFileSync(
    join(process.env.TEMP ?? ".", "opencode", "f3-evals.json"),
    JSON.stringify({ metrics }, null, 2),
    "utf8",
  );
  await prisma.aiDecision.deleteMany({ where: { universeId } });
  if (createdConversationIds.length > 0) {
    await prisma.message.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
    await prisma.conversationParticipant.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  }
  await prisma.relationship.deleteMany({
    where: { OR: [{ characterAId: { in: createdCharacterIds } }, { characterBId: { in: createdCharacterIds } }] },
  });
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

describe("F3.5 — evals end-to-end em TEST DB", () => {
  it("S01 greeting com cadeia e possível AI→AI", async () => {
    const conversation = await createConversation(aiIds.slice(0, 3));
    const userMessage = await seedUserMessage(conversation.id, "bom dia amigos", 60_000);
    const metric = await collectMetrics("S01_greeting", conversation.id, 60_000);
    expect(metric.messageCount).toBeLessThan(6);
    const first = await prisma.message.findFirstOrThrow({
      where: { conversationId: conversation.id, senderType: "AI_CHARACTER" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const context = first.contextJson as Record<string, unknown>;
    const dialogue = context.dialogue as Record<string, unknown>;
    expect(dialogue.replyToMessageId).toBe(userMessage.id);
    if (metric.messageCount >= 2) {
      expect(metric.aiToAiReplyCount).toBeGreaterThanOrEqual(1);
    }
  });

  it("S02 direct mention responde à mensagem do usuário", async () => {
    const conversation = await createConversation(aiIds.slice(0, 3));
    const userMessage = await seedUserMessage(conversation.id, `${PREFIX}-kimi, você acha que ganha hoje?`, 120_000);
    const metric = await collectMetrics("S02_mention", conversation.id, 120_000);
    expect(metric.messageCount).toBeGreaterThanOrEqual(1);
    const first = await prisma.message.findFirstOrThrow({
      where: { conversationId: conversation.id, senderType: "AI_CHARACTER" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const context = first.contextJson as Record<string, unknown>;
    const dialogue = context.dialogue as Record<string, unknown>;
    expect(dialogue.replyToMessageId).toBe(userMessage.id);
    expect(dialogue.intent).toBe("ANSWER");
  });

  it("S03 group question e S05 joke com respostas curtas", async () => {
    const group = await createConversation(aiIds.slice(0, 4));
    await seedUserMessage(group.id, "vocês viram a classificação?", 180_000);
    const groupMetric = await collectMetrics("S03_group", group.id, 180_000);
    expect(groupMetric.messageCount).toBeLessThan(6);
    const joke = await createConversation(aiIds.slice(0, 4));
    await seedUserMessage(joke.id, "KKKK vocês são impossíveis", 240_000);
    const jokeMetric = await collectMetrics("S05_joke", joke.id, 240_000);
    expect(jokeMetric.maxChars).toBeLessThanOrEqual(120);
  });

  it("S10 seis IAs: 'oi' não escala com participant count", async () => {
    const conversation = await createConversation(aiIds);
    await seedUserMessage(conversation.id, "oi", 300_000);
    const metric = await collectMetrics("S10_many", conversation.id, 300_000);
    expect(metric.messageCount).toBeLessThanOrEqual(2);
  });

  it("F3-AI: segundo envelope sem nova mensagem do usuário gera AI→AI", async () => {
    const conversation = await createConversation(aiIds.slice(0, 3));
    await seedUserMessage(conversation.id, "bom dia amigos", 360_000);
    const first = await collectMetrics("F3_AI01_first", conversation.id, 360_000);
    const second = await collectMetrics("F3_AI02_chain", conversation.id, 420_000);
    const totalMessages = first.messageCount + second.messageCount;
    const totalAiToAi = first.aiToAiReplyCount + second.aiToAiReplyCount;
    if (totalMessages >= 2) {
      expect(totalAiToAi).toBeGreaterThanOrEqual(1);
    }
  });

  it("S14 deterministic replay: mesmo estado, mesmo plano", async () => {
    const conversation = await createConversation(aiIds.slice(0, 3));
    await seedUserMessage(conversation.id, "vocês viram a corrida?", 480_000);
    const a = await getSimulationPlan(conversation.id, { userId, worldDate: new Date(WORLD_DATE.getTime() + 480_000) });
    const b = await getSimulationPlan(conversation.id, { userId, worldDate: new Date(WORLD_DATE.getTime() + 480_000) });
    expect(a.dialogue).toEqual(b.dialogue);
    metrics.push({
      scenarioId: "S14_replay",
      candidateCount: a.candidates.length,
      selectedCount: a.planned.length,
      turnCount: a.dialogue.turns.length,
      messageCount: 0,
      fragmentCount: 0,
      speakers: [],
      replyToCount: 0,
      validReplyToCount: 0,
      aiToAiReplyCount: 0,
      userToAiReplyCount: 0,
      avgChars: 0,
      maxChars: 0,
      emptyMessageCount: 0,
      fallbackCount: 0,
      stopReason: a.stopReason,
      continuation: a.dialogue.continuation,
    });
  });

  it("métricas agregadas são coerentes e sem replyTo inválido", () => {
    const totals = metrics.reduce(
      (acc, metric) => ({
        messages: acc.messages + metric.messageCount,
        fragments: acc.fragments + metric.fragmentCount,
        replyTo: acc.replyTo + metric.replyToCount,
        validReplyTo: acc.validReplyTo + metric.validReplyToCount,
        aiToAi: acc.aiToAi + metric.aiToAiReplyCount,
        userToAi: acc.userToAi + metric.userToAiReplyCount,
        fallbacks: acc.fallbacks + metric.fallbackCount,
      }),
      { messages: 0, fragments: 0, replyTo: 0, validReplyTo: 0, aiToAi: 0, userToAi: 0, fallbacks: 0 },
    );
    expect(totals.validReplyTo).toBe(totals.replyTo);
    expect(totals.fallbacks).toBe(0);
    expect(totals.messages).toBeGreaterThan(0);
  });
});
