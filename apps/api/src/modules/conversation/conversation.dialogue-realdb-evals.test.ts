import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { prisma } from "../../infrastructure/database/prisma.js";
import {
  buildDialogueCandidateSet,
  DeterministicDialoguePlanner,
  validateDialoguePlan,
} from "./conversation.dialogue.js";
import { evaluateConversationEnergy, planResponseWindow } from "./conversation.energy.js";
import { getSimulationPlan } from "./conversation.simulation.js";
import { selectResponseCandidates, type ResponseEngineParticipant } from "./conversation.response-engine.js";

const PREFIX = "dialogue-f2";
const WORLD_DATE = new Date("2026-10-01T12:00:00.000Z");
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];
const createdMemoryIds: string[] = [];

let userId: string;
let universeId: string;
let conversationId: string;
let userCharacterId: string;
const aiCharacterIds: Record<string, string> = {};

type Comparison = {
  scenario: string;
  currentSpeakers: string[];
  plannerSpeakers: string[];
  plannerIntents: string[];
  replyTo: string[];
  stopReason: string;
  candidateCount: number;
  turnCount: number;
  valid: boolean;
  plannerMs: number;
};

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

async function seedRelationship(aId: string, bId: string, affinity: number, trust: number) {
  const [characterAId, characterBId] = [aId, bId].sort();
  await prisma.relationship.create({
    data: { characterAId, characterBId, dimensions: { affinity, trust } },
  });
}

async function seedMessage(content: string, senderType: "USER_CHARACTER" | "AI_CHARACTER", characterId: string, offsetMs: number) {
  const message = await prisma.message.create({
    data: {
      conversationId,
      senderType,
      characterId,
      content,
      createdAt: new Date(WORLD_DATE.getTime() + offsetMs),
    },
  });
  return message;
}

async function currentSpeakersFor(lastMessageId: string, content: string, offsetMs: number) {
  const participants: ResponseEngineParticipant[] = Object.entries(aiCharacterIds).map(
    ([label, characterId]) => ({
      characterId,
      name: `${PREFIX}-${label}`,
      controller: "AI",
      available: true,
    }),
  );
  participants.push({
    characterId: userCharacterId,
    name: `${PREFIX}-alicya`,
    controller: "USER",
    available: true,
  });
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, senderType: true, characterId: true, content: true, createdAt: true },
  });
  const relationships = await prisma.relationship.findMany({
    where: { OR: [{ characterAId: { in: [...Object.values(aiCharacterIds), userCharacterId] } }] },
    select: { characterAId: true, characterBId: true, dimensions: true },
  });
  const affinity: Record<string, number> = {};
  for (const relationship of relationships) {
    const dimensions = (relationship.dimensions ?? {}) as Record<string, unknown>;
    const value = Math.max(0, Math.min(1, (((Number(dimensions.affinity) || 0) + (Number(dimensions.trust) || 0)) / 200) * 0.5 + 0.5));
    for (const id of [relationship.characterAId, relationship.characterBId]) affinity[id] = Math.max(affinity[id] ?? 0, value);
  }
  const energy = evaluateConversationEnergy({ message: content, participantCount: participants.length, recentAiMessages: 0 });
  const window = planResponseWindow(energy, { budgetRemaining: 4 });
  const selection = selectResponseCandidates({
    participants,
    messages,
    relationshipAffinity: affinity,
    depth: 0,
    alreadyResponded: [],
    recentAiMessages: [],
    seed: { universeId, conversationId, lastMessageId, worldDate: new Date(WORLD_DATE.getTime() + offsetMs) },
    limits: { maxResponders: window.maxInitialResponders, minScore: window.stopThresholds.initial },
  });
  const candidateSet = buildDialogueCandidateSet({
    conversationId,
    universeId,
    lastMessageId,
    lastMessageContent: content,
    depth: 0,
    energy,
    window,
    selection,
  });
  const planner = new DeterministicDialoguePlanner();
  const plan = await planner.plan({ candidateSet });
  const validation = validateDialoguePlan(plan, {
    participantIds: new Set(participants.map((p) => p.characterId)),
    aiParticipantIds: new Set(Object.values(aiCharacterIds)),
    eligibleCandidateIds: new Set(selection.selected.map((c) => c.characterId)),
    availablePutativeIds: new Set(participants.map((p) => p.characterId)),
    messageIds: new Set(messages.map((m) => m.id)),
    maxTurns: window.maxInitialResponders + window.maxReactions,
    remainingBudget: 4,
  });
  return { selection, plan, validation, candidateSet };
}

const comparisons: Comparison[] = [];

async function runScenario(name: string, content: string, offsetMs: number): Promise<Comparison> {
  const message = await seedMessage(content, "USER_CHARACTER", userCharacterId, offsetMs);
  const current = await currentSpeakersFor(message.id, content, offsetMs);
  const started = performance.now();
  const integrated = await getSimulationPlan(conversationId, { userId, worldDate: new Date(WORLD_DATE.getTime() + offsetMs) });
  const plannerMs = Math.round(performance.now() - started);
  const comparison: Comparison = {
    scenario: name,
    currentSpeakers: current.selection.selected.map((c) => c.characterId),
    plannerSpeakers: integrated.planned.map((c) => c.characterId),
    plannerIntents: integrated.dialogue.turns.map((t) => t.intent),
    replyTo: integrated.dialogue.turns.map((t) => t.replyToMessageId ?? "null"),
    stopReason: integrated.dialogue.stopReason,
    candidateCount: integrated.candidates.length,
    turnCount: integrated.dialogue.turns.length,
    valid: current.validation.valid,
    plannerMs,
  };
  comparisons.push(comparison);
  console.log(`EVAL ${JSON.stringify(comparison)}`);
  return comparison;
}

beforeAll(async () => {
  const email = `${PREFIX}-${Date.now()}@f1nw.test`;
  const user = await prisma.user.create({
    data: { name: "F2 Owner", email, emailVerified: false },
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
  for (const label of ["kimi", "max", "lando", "charles", "george", "oscar"]) {
    const character = await createCharacter(label, "AI");
    aiCharacterIds[label] = character.id;
  }
  const conversation = await prisma.conversation.create({
    data: {
      type: "GROUP",
      status: "ACTIVE",
      participants: { create: [userCharacterId, ...Object.values(aiCharacterIds)].map((characterId) => ({ characterId })) },
    },
  });
  conversationId = conversation.id;
  createdConversationIds.push(conversation.id);
  await seedRelationship(aiCharacterIds.kimi!, userCharacterId, 80, 80);
  await seedRelationship(aiCharacterIds.max!, userCharacterId, 60, 55);
  await seedRelationship(aiCharacterIds.lando!, userCharacterId, 55, 45);
  await seedRelationship(aiCharacterIds.charles!, userCharacterId, 20, 20);
  const memory = await prisma.memory.create({
    data: {
      universeId,
      content: "George e Alicya tiveram uma piada recorrente sobre uma bomba d'água.",
      importance: "MEDIUM",
      source: "USER_DEFINED",
      participants: { create: [{ characterId: aiCharacterIds.george! }, { characterId: userCharacterId }] },
    },
  });
  createdMemoryIds.push(memory.id);
});

afterAll(async () => {
  if (createdMemoryIds.length > 0) await prisma.memoryCharacter.deleteMany({ where: { memoryId: { in: createdMemoryIds } } });
  await prisma.memory.deleteMany({ where: { universeId } });
  if (createdConversationIds.length > 0) {
    await prisma.message.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
    await prisma.conversationParticipant.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  }
  await prisma.relationship.deleteMany({ where: { OR: [{ characterAId: { in: createdCharacterIds } }, { characterBId: { in: createdCharacterIds } }] } });
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

describe("F2A — CURRENT vs DETERMINISTIC em banco TEST", () => {
  it("S01 greeting: oportunidade social sem forçar todos", async () => {
    const result = await runScenario("S01_greeting", "bom dia amigos", 60_000);
    expect(result.plannerSpeakers.length).toBeGreaterThanOrEqual(0);
    expect(result.plannerSpeakers.length).toBeLessThanOrEqual(2);
    expect(result.plannerSpeakers).not.toContain(userCharacterId);
    expect(result.turnCount).toBeLessThan(Object.keys(aiCharacterIds).length);
  });

  it("S02 direct mention: Kimi priorizado", async () => {
    const result = await runScenario("S02_mention", `${PREFIX}-kimi, você acha que ganha hoje?`, 120_000);
    expect(result.plannerSpeakers[0]).toBe(aiCharacterIds.kimi);
    expect(["ANSWER", "FOLLOW_UP"]).toContain(result.plannerIntents[0]);
  });

  it("S03 group question: múltiplos candidatos e tópico F1", async () => {
    const result = await runScenario("S03_group", "vocês viram a classificação?", 180_000);
    expect(result.candidateCount).toBeGreaterThanOrEqual(2);
    expect(result.plannerSpeakers.length).toBeGreaterThanOrEqual(1);
  });

  it("S04 emotional: relação próxima com prioridade", async () => {
    const result = await runScenario("S04_emotional", "gente, tô muito nervosa", 240_000);
    if (result.plannerSpeakers.length > 0) {
      expect(result.plannerSpeakers).toContain(aiCharacterIds.kimi);
    }
    expect(result.plannerSpeakers).not.toContain(userCharacterId);
  });

  it("S05 joke: intenção de reação, não exposição", async () => {
    const result = await runScenario("S05_joke", "KKKK vocês são impossíveis", 300_000);
    for (const intent of result.plannerIntents) {
      expect(["JOKE", "REACTION", "FOLLOW_UP", "TEASE"]).toContain(intent);
    }
  });

  it("S06 callback: George priorizado por menção", async () => {
    const result = await runScenario("S06_callback", `${PREFIX}-george, e a bomba?`, 360_000);
    expect(result.plannerSpeakers[0]).toBe(aiCharacterIds.george);
  });

  it("S07 topic shift: assunto novo não mantém tópico de corrida", async () => {
    const result = await runScenario("S07_topic_shift", "aliás, alguém viu minha chave?", 420_000);
    expect(result.plannerSpeakers).not.toContain(userCharacterId);
  });

  it("S09 support: mensagem difícil gera plano válido", async () => {
    const result = await runScenario("S09_support", "cara eu fiz merda", 480_000);
    expect(result.valid).toBe(true);
    expect(result.plannerSpeakers.length).toBeLessThanOrEqual(3);
  });

  it("S10 six AIs: 'oi' não escala com participant count", async () => {
    const result = await runScenario("S10_many", "oi", 540_000);
    expect(Object.keys(aiCharacterIds).length).toBe(6);
    expect(result.plannerSpeakers.length).toBeLessThanOrEqual(2);
  });

  it("S14 replay determinístico: mesmo input, mesmo plano", async () => {
    const first = await getSimulationPlan(conversationId, { userId, worldDate: WORLD_DATE });
    const second = await getSimulationPlan(conversationId, { userId, worldDate: WORLD_DATE });
    expect(first.dialogue).toEqual(second.dialogue);
    expect(first.planned).toEqual(second.planned);
  });

  it("agrega comparação CURRENT vs PLANNER para o relatório", () => {
    const summary = {
      scenarios: comparisons.length,
      currentTotalSpeakers: comparisons.reduce((sum, item) => sum + item.currentSpeakers.length, 0),
      plannerTotalSpeakers: comparisons.reduce((sum, item) => sum + item.plannerSpeakers.length, 0),
      currentAllParticipantCases: comparisons.filter((item) => item.currentSpeakers.length >= 6).length,
      plannerAllParticipantCases: comparisons.filter((item) => item.plannerSpeakers.length >= 6).length,
      invalidPlans: comparisons.filter((item) => !item.valid).length,
      avgPlannerMs: Math.round(comparisons.reduce((sum, item) => sum + item.plannerMs, 0) / Math.max(1, comparisons.length)),
    };
    console.log(`EVAL_SUMMARY ${JSON.stringify(summary)}`);
    writeFileSync(
      join(process.env.TEMP ?? ".", "opencode", "f2-eval-summary.json"),
      JSON.stringify({ summary, comparisons }, null, 2),
      "utf8",
    );
    expect(summary.invalidPlans).toBe(0);
  });
});
