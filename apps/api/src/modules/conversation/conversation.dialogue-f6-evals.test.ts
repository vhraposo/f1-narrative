import { afterAll, describe, expect, it } from "vitest";
import type { EventImportance, MemoryImportance } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { createEventWithDerivations } from "../events/event-create.js";
import {
  buildAutonomyOpportunityPlan,
  readConversationOpportunityAudit,
  readConversationOpportunitySelectionAudit,
} from "../autonomy/autonomy.opportunities.js";
import { runAutonomousTick } from "../autonomy/autonomy.service.js";
import { getSimulationPlan } from "./conversation.simulation.js";

const PREFIX = "dialogue-f6";
const WINDOW_START = new Date("2026-10-01T00:00:00.000Z");
const SIGNAL_AT = new Date("2026-10-01T12:00:00.000Z");
const TO_1 = new Date("2026-10-02T00:00:00.000Z");
const TO_2 = new Date("2026-10-03T00:00:00.000Z");
const TO_3 = new Date("2026-10-04T00:00:00.000Z");

const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];
const createdEventIds: string[] = [];
const createdMemoryIds: string[] = [];

let counter = 0;

type FixtureOptions = {
  readonly label: string;
  readonly mode?: "OFF" | "OBSERVER" | "GUIDED" | "FULL";
  readonly aiCharacters: number;
  readonly userCharacters?: number;
  readonly conversations: ReadonlyArray<readonly [number, number]>;
  readonly conversationCreatedAt?: Date;
  readonly goals?: ReadonlyArray<{ readonly character: number; readonly priority: number }>;
  readonly events?: ReadonlyArray<{
    readonly participants: readonly number[];
    readonly importance?: EventImportance;
    readonly worldDate?: Date;
  }>;
  readonly memories?: ReadonlyArray<{
    readonly participants: readonly number[];
    readonly importance?: MemoryImportance;
    readonly createdAt?: Date;
  }>;
  readonly relationships?: ReadonlyArray<readonly [number, number]>;
  readonly messages?: ReadonlyArray<{
    readonly conversation: number;
    readonly sender: number;
    readonly content?: string;
    readonly createdAt?: Date;
  }>;
  readonly availability?: ReadonlyArray<{
    readonly character: number;
    readonly status: "AVAILABLE" | "BUSY" | "OFFLINE";
  }>;
};

type Fixture = {
  readonly universeId: string;
  readonly userId: string;
  readonly characterIds: readonly string[];
  readonly conversationIds: readonly string[];
};

type EvalMetric = {
  readonly id: string;
  readonly candidates: number;
  readonly selected: number;
  readonly envelopes: number;
  readonly messages: number;
};

const metrics: EvalMetric[] = [];

function pushMetric(id: string, metric: Omit<EvalMetric, "id">): void {
  metrics.push({ id, ...metric });
}

async function createFixture(options: FixtureOptions): Promise<Fixture> {
  counter += 1;
  const tag = `${PREFIX}-${options.label}-${counter}-${Date.now()}`;
  const user = await prisma.user.create({
    data: { email: `${tag}@f1nw.test`, name: tag },
  });
  createdUserIds.push(user.id);

  const universe = await prisma.universe.create({
    data: {
      userId: user.id,
      status: "READY",
      autonomyMode: options.mode ?? "GUIDED",
      autonomyStatus: "ACTIVE",
    },
  });
  createdUniverseIds.push(universe.id);

  await prisma.worldState.create({
    data: { universeId: universe.id, key: "default", currentDate: WINDOW_START },
  });

  const characterIds: string[] = [];
  for (let index = 0; index < options.aiCharacters; index += 1) {
    const character = await prisma.character.create({
      data: {
        universeId: universe.id,
        userId: user.id,
        controlledBy: "AI",
        name: `${tag}-ai-${index}`,
        nationality: "BR",
        birthDate: new Date("1998-01-01T00:00:00.000Z"),
      },
    });
    createdCharacterIds.push(character.id);
    characterIds.push(character.id);
  }
  for (let index = 0; index < (options.userCharacters ?? 0); index += 1) {
    const character = await prisma.character.create({
      data: {
        universeId: universe.id,
        userId: user.id,
        controlledBy: "USER",
        name: `${tag}-user-${index}`,
        nationality: "BR",
        birthDate: new Date("1998-01-01T00:00:00.000Z"),
      },
    });
    createdCharacterIds.push(character.id);
    characterIds.push(character.id);
  }

  const conversationIds: string[] = [];
  for (const [left, right] of options.conversations) {
    const conversation = await prisma.conversation.create({
      data: {
        title: `${tag}-conv`,
        createdAt: options.conversationCreatedAt ?? SIGNAL_AT,
        participants: {
          create: [{ characterId: characterIds[left]! }, { characterId: characterIds[right]! }],
        },
      },
    });
    createdConversationIds.push(conversation.id);
    conversationIds.push(conversation.id);
  }

  for (const message of options.messages ?? []) {
    const isUser =
      message.sender >= options.aiCharacters &&
      message.sender < options.aiCharacters + (options.userCharacters ?? 0);
    await prisma.message.create({
      data: {
        conversationId: conversationIds[message.conversation]!,
        senderType: isUser ? "USER_CHARACTER" : "AI_CHARACTER",
        characterId: characterIds[message.sender]!,
        content: message.content ?? `${tag}-message`,
        createdAt: message.createdAt ?? SIGNAL_AT,
      },
    });
  }

  for (const goal of options.goals ?? []) {
    await prisma.characterGoal.create({
      data: {
        universeId: universe.id,
        characterId: characterIds[goal.character]!,
        kind: "RESTORE_CONFIDENCE",
        priority: goal.priority,
        status: "ACTIVE",
        source: "SYSTEM",
      },
    });
  }

  for (const [left, right] of options.relationships ?? []) {
    const [characterAId, characterBId] = [characterIds[left]!, characterIds[right]!].sort();
    await prisma.relationship.create({
      data: { characterAId, characterBId, dimensions: { affinity: 80, trust: 80 } },
    });
  }

  let eventIndex = 0;
  for (const event of options.events ?? []) {
    eventIndex += 1;
    const created = await prisma.event.create({
      data: {
        type: "SOCIAL",
        importance: event.importance ?? "MEDIUM",
        source: "GENERATED_EVENT",
        title: `${tag}-event-${eventIndex}`,
        worldDate: event.worldDate ?? SIGNAL_AT,
        participants: {
          create: event.participants.map((index) => ({ characterId: characterIds[index]! })),
        },
      },
    });
    createdEventIds.push(created.id);
  }

  let memoryIndex = 0;
  for (const memory of options.memories ?? []) {
    memoryIndex += 1;
    const created = await prisma.memory.create({
      data: {
        universeId: universe.id,
        importance: memory.importance ?? "MEDIUM",
        source: "GENERATED_EVENT",
        status: "ACTIVE",
        content: `${tag}-memory-${memoryIndex}`,
        createdAt: memory.createdAt ?? SIGNAL_AT,
        participants: {
          create: memory.participants.map((index) => ({ characterId: characterIds[index]! })),
        },
      },
    });
    createdMemoryIds.push(created.id);
  }

  for (const availability of options.availability ?? []) {
    await prisma.characterAvailability.create({
      data: { characterId: characterIds[availability.character]!, status: availability.status },
    });
  }

  return { universeId: universe.id, userId: user.id, characterIds, conversationIds };
}

async function readAudits(universeId: string) {
  const decisions = await prisma.aiDecision.findMany({
    where: { universeId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { characterId: true, conversationId: true, metadata: true },
  });
  return decisions.map((decision) => ({
    decision,
    audit: readConversationOpportunityAudit(decision.metadata),
    summary: readConversationOpportunitySelectionAudit(decision.metadata),
  }));
}

afterAll(async () => {
  await prisma.simulationTick.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
  await prisma.aiDecision.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
  await prisma.characterGoal.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
  if (createdConversationIds.length > 0) {
    await prisma.message.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  }
  if (createdMemoryIds.length > 0) {
    await prisma.memoryCharacter.deleteMany({ where: { memoryId: { in: createdMemoryIds } } });
    await prisma.memory.deleteMany({ where: { id: { in: createdMemoryIds } } });
  }
  if (createdEventIds.length > 0) {
    await prisma.newsItem.deleteMany({ where: { eventId: { in: createdEventIds } } });
    await prisma.eventCharacter.deleteMany({ where: { eventId: { in: createdEventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
  }
  if (createdCharacterIds.length > 0) {
    await prisma.relationshipChange.deleteMany({
      where: {
        OR: [
          { characterAId: { in: createdCharacterIds } },
          { characterBId: { in: createdCharacterIds } },
        ],
      },
    });
    await prisma.relationship.deleteMany({
      where: {
        OR: [
          { characterAId: { in: createdCharacterIds } },
          { characterBId: { in: createdCharacterIds } },
        ],
      },
    });
    await prisma.pilotExperience.deleteMany({ where: { characterId: { in: createdCharacterIds } } });
    await prisma.characterAvailability.deleteMany({
      where: { characterId: { in: createdCharacterIds } },
    });
    await prisma.characterSchedule.deleteMany({
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

describe("F6.5 — evals F6-E01..E10 (TEST DB, determinístico)", () => {
  it("E01 — evento gera oportunidade auditada", async () => {
    const fixture = await createFixture({
      label: "e01",
      mode: "GUIDED",
      aiCharacters: 2,
      conversations: [[0, 1]],
      events: [{ participants: [0, 1], importance: "HIGH" }],
    });
    const event = await prisma.event.findFirstOrThrow({
      where: { participants: { some: { characterId: fixture.characterIds[0]! } } },
      select: { id: true },
    });
    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.status).toBe("EXECUTED");
    const audits = (await readAudits(fixture.universeId)).filter((entry) => entry.audit);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.audit!.reason).toBe("WORLD_EVENT");
    expect(audits[0]!.audit!.evidenceId).toBe(`event:${event.id}`);
    expect(String(audits[0]!.audit!.fingerprint)).toMatch(/^[a-f0-9]{64}$/);
    expect(audits[0]!.audit!.windowStart).toBe(WINDOW_START.toISOString());
    pushMetric("E01", {
      candidates: Number(audits[0]!.summary?.candidateCount ?? 0),
      selected: Number(audits[0]!.summary?.selectedCount ?? 0),
      envelopes: result.envelopes.length,
      messages: 0,
    });
  });

  it("E02 — personagem irrelevante é excluído da conversa", async () => {
    const fixture = await createFixture({
      label: "e02",
      mode: "GUIDED",
      aiCharacters: 3,
      conversations: [[0, 2]],
      events: [{ participants: [0, 1], importance: "HIGH" }],
    });
    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.status).toBe("EXECUTED");
    const audits = (await readAudits(fixture.universeId)).filter((entry) => entry.audit);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.audit!.characterId).toBe(fixture.characterIds[0]);
    expect(audits.every((entry) => entry.audit!.characterId !== fixture.characterIds[1])).toBe(true);
    pushMetric("E02", {
      candidates: Number(audits[0]!.summary?.candidateCount ?? 0),
      selected: Number(audits[0]!.summary?.selectedCount ?? 0),
      envelopes: result.envelopes.length,
      messages: 0,
    });
  });

  it("E03 — personagem relevante inicia o envelope", async () => {
    const fixture = await createFixture({
      label: "e03",
      mode: "FULL",
      aiCharacters: 2,
      conversations: [[0, 1]],
      messages: [{ conversation: 0, sender: 1, content: "bom dia" }],
      events: [{ participants: [0], importance: "HIGH" }],
    });
    const seed = await prisma.message.findFirstOrThrow({
      where: { conversationId: fixture.conversationIds[0]!, characterId: fixture.characterIds[1]! },
      select: { id: true },
    });
    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.status).toBe("EXECUTED");
    expect(result.envelopes).toHaveLength(1);
    expect(result.envelopes[0]!.executed).toBe(true);
    const first = await prisma.message.findFirstOrThrow({
      where: { id: result.envelopes[0]!.messageIds[0]! },
      select: { characterId: true, senderType: true, contextJson: true },
    });
    expect(first.characterId).toBe(fixture.characterIds[0]);
    expect(first.senderType).toBe("AI_CHARACTER");
    const dialogue = (first.contextJson as Record<string, unknown>).dialogue as Record<string, unknown>;
    expect(dialogue.replyToMessageId).toBe(seed.id);
    pushMetric("E03", {
      candidates: 1,
      selected: 1,
      envelopes: result.envelopes.length,
      messages: result.envelopes[0]!.messageIds.length,
    });
  });

  it("E04 — AI→AI espontâneo abre conversa sem USER", async () => {
    const fixture = await createFixture({
      label: "e04",
      mode: "FULL",
      aiCharacters: 2,
      conversations: [[0, 1]],
      goals: [{ character: 0, priority: 70 }],
    });
    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.status).toBe("EXECUTED");
    expect(result.envelopes).toHaveLength(1);
    expect(result.envelopes[0]!.executed).toBe(true);
    expect(result.envelopes[0]!.depth).toBeGreaterThanOrEqual(1);
    const messages = await prisma.message.findMany({
      where: { conversationId: fixture.conversationIds[0]! },
      select: { characterId: true, senderType: true },
    });
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages.every((message) => message.senderType === "AI_CHARACTER")).toBe(true);
    expect(messages[0]!.characterId).toBe(fixture.characterIds[0]);
    pushMetric("E04", {
      candidates: 1,
      selected: 1,
      envelopes: result.envelopes.length,
      messages: messages.length,
    });
  });

  it("E05 — reação relationship-aware com target preservado", async () => {
    const fixture = await createFixture({
      label: "e05",
      mode: "FULL",
      aiCharacters: 2,
      conversations: [[0, 1]],
      messages: [{ conversation: 0, sender: 1, content: "bom dia" }],
      relationships: [[0, 1]],
    });
    await prisma.characterGoal.create({
      data: {
        universeId: fixture.universeId,
        characterId: fixture.characterIds[0]!,
        kind: "PROTECT_RELATIONSHIP",
        priority: 70,
        status: "ACTIVE",
        source: "SYSTEM",
        targetCharacterId: fixture.characterIds[1]!,
      },
    });
    const seed = await prisma.message.findFirstOrThrow({
      where: { conversationId: fixture.conversationIds[0]!, characterId: fixture.characterIds[1]! },
      select: { id: true },
    });
    const plan = await getSimulationPlan(fixture.conversationIds[0]!, {
      userId: fixture.userId,
      worldDate: TO_1,
      opportunity: {
        conversationId: fixture.conversationIds[0]!,
        characterId: fixture.characterIds[0]!,
        targetCharacterId: fixture.characterIds[1]!,
        fingerprint: "f".repeat(64),
        windowStart: WINDOW_START.toISOString(),
      },
    });
    expect(plan.planned[0]?.characterId).toBe(fixture.characterIds[0]);
    expect(plan.planned[0]?.reasons).toContain("RELATIONSHIP_SIGNAL");

    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.envelopes).toHaveLength(1);
    const first = await prisma.message.findFirstOrThrow({
      where: { id: result.envelopes[0]!.messageIds[0]! },
      select: { contextJson: true },
    });
    const dialogue = (first.contextJson as Record<string, unknown>).dialogue as Record<string, unknown>;
    expect(dialogue.replyToMessageId).toBe(seed.id);
    const decision = await prisma.aiDecision.findFirstOrThrow({
      where: {
        universeId: fixture.universeId,
        characterId: fixture.characterIds[0]!,
        metadata: { path: ["trigger"], equals: "CONVERSATION_TURN_DUE" },
      },
      select: { metadata: true },
    });
    expect((decision.metadata as Record<string, unknown>).targetCharacterId).toBe(
      fixture.characterIds[1],
    );
    pushMetric("E05", {
      candidates: 1,
      selected: 1,
      envelopes: result.envelopes.length,
      messages: result.envelopes[0]!.messageIds.length,
    });
  });

  it("E06 — oportunidade duplicada bloqueada pela raiz canônica", async () => {
    const fixture = await createFixture({
      label: "e06",
      mode: "GUIDED",
      aiCharacters: 2,
      conversations: [[0, 1]],
    });
    const event = await prisma.$transaction((tx) =>
      createEventWithDerivations(
        tx,
        {
          type: "SOCIAL",
          importance: "HIGH",
          source: "GENERATED_EVENT",
          title: `${PREFIX}-e06-event`,
          description: null,
          worldDate: SIGNAL_AT,
        },
        [fixture.characterIds[0]!, fixture.characterIds[1]!],
      ),
    );
    createdEventIds.push(event.id);
    const derivedMemories = await prisma.memory.findMany({
      where: { eventId: event.id },
      select: { id: true },
    });
    for (const memory of derivedMemories) createdMemoryIds.push(memory.id);
    await prisma.memory.updateMany({
      where: { eventId: event.id },
      data: { createdAt: SIGNAL_AT },
    });
    await prisma.relationshipChange.updateMany({
      where: { sourceType: "EVENT", sourceId: event.id },
      data: { createdAt: SIGNAL_AT },
    });

    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.status).toBe("EXECUTED");
    expect(result.envelopes).toHaveLength(0);
    const audits = (await readAudits(fixture.universeId)).filter((entry) => entry.audit);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.audit!.evidenceId).toBe(`event:${event.id}`);
    expect(audits[0]!.audit!.reason).toBe("WORLD_EVENT");
    const candidates = Number(audits[0]!.summary?.candidateCount ?? 0);
    expect(candidates).toBeGreaterThanOrEqual(4);
    expect(Number(audits[0]!.summary?.selectedCount ?? 0)).toBe(1);
    pushMetric("E06", {
      candidates,
      selected: 1,
      envelopes: result.envelopes.length,
      messages: 0,
    });
  });

  it("E07 — cooldown bloqueia spam e libera após o horizonte", async () => {
    const fixture = await createFixture({
      label: "e07",
      mode: "GUIDED",
      aiCharacters: 2,
      conversations: [[0, 1]],
      goals: [{ character: 0, priority: 60 }],
    });
    await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    const first = (await readAudits(fixture.universeId)).filter(
      (entry) => entry.audit?.windowStart === WINDOW_START.toISOString(),
    );
    expect(first).toHaveLength(1);

    await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_2 });
    const blocked = (await readAudits(fixture.universeId)).filter(
      (entry) => entry.audit?.windowStart === TO_1.toISOString(),
    );
    expect(blocked).toHaveLength(0);

    await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_3 });
    const released = (await readAudits(fixture.universeId)).filter(
      (entry) => entry.audit?.windowStart === TO_2.toISOString(),
    );
    expect(released).toHaveLength(1);
    pushMetric("E07", { candidates: 1, selected: 1, envelopes: 0, messages: 0 });
  });

  it("E08 — envelope termina naturalmente (stop do pipeline)", async () => {
    const fixture = await createFixture({
      label: "e08",
      mode: "FULL",
      aiCharacters: 1,
      userCharacters: 1,
      conversations: [[0, 1]],
      messages: [{ conversation: 0, sender: 1, content: "bom dia" }],
      goals: [{ character: 0, priority: 60 }],
    });
    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.envelopes).toHaveLength(1);
    const envelope = result.envelopes[0]!;
    expect(envelope.executed).toBe(true);
    expect(envelope.depth).toBe(1);
    expect(envelope.messageIds).toHaveLength(1);
    expect(["NO_OPPORTUNITY", "NATURAL_END"]).toContain(envelope.stopReason);
    const messages = await prisma.message.count({
      where: { conversationId: fixture.conversationIds[0]! },
    });
    expect(messages).toBe(2);
    pushMetric("E08", {
      candidates: 1,
      selected: 1,
      envelopes: result.envelopes.length,
      messages: envelope.messageIds.length,
    });
  });

  it("E09 — isolamento de Universe nas oportunidades e envelopes", async () => {
    const home = await createFixture({
      label: "e09-home",
      mode: "GUIDED",
      aiCharacters: 2,
      conversations: [[0, 1]],
      messages: [{ conversation: 0, sender: 1, content: "bom dia" }],
      events: [{ participants: [0], importance: "HIGH" }],
    });
    const foreign = await createFixture({
      label: "e09-foreign",
      mode: "GUIDED",
      aiCharacters: 2,
      conversations: [[0, 1]],
      messages: [{ conversation: 0, sender: 1, content: "bom dia" }],
      events: [{ participants: [0], importance: "CRITICAL" }],
    });
    const homeEvent = await prisma.event.findFirstOrThrow({
      where: { participants: { some: { characterId: home.characterIds[0]! } } },
      select: { id: true },
    });
    const result = await runAutonomousTick({ universeId: home.universeId, toDate: TO_1 });
    expect(result.status).toBe("EXECUTED");
    const audits = (await readAudits(home.universeId)).filter((entry) => entry.audit);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.audit!.evidenceId).toBe(`event:${homeEvent.id}`);
    expect(await prisma.aiDecision.count({ where: { universeId: foreign.universeId } })).toBe(0);
    expect(
      await prisma.message.count({ where: { conversationId: foreign.conversationIds[0]! } }),
    ).toBe(1);
    pushMetric("E09", {
      candidates: Number(audits[0]!.summary?.candidateCount ?? 0),
      selected: 1,
      envelopes: result.envelopes.length,
      messages: 0,
    });
  });

  it("E10 — replay determinístico do plano e do tick", async () => {
    const fixture = await createFixture({
      label: "e10",
      mode: "GUIDED",
      aiCharacters: 2,
      conversations: [[0, 1]],
      goals: [{ character: 0, priority: 60 }],
    });
    const planInput = {
      universeId: fixture.universeId,
      fromDate: WINDOW_START,
      toDate: TO_1,
      characterIds: fixture.characterIds,
      maxConversations: 2,
      cooldownHours: 24,
    };
    const first = await buildAutonomyOpportunityPlan(planInput);
    const second = await buildAutonomyOpportunityPlan(planInput);
    expect(second.selection.selected.map((entry) => entry.opportunity.fingerprint)).toEqual(
      first.selection.selected.map((entry) => entry.opportunity.fingerprint),
    );
    expect(second.selection.selected.map((entry) => entry.evidenceId)).toEqual(
      first.selection.selected.map((entry) => entry.evidenceId),
    );

    await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    const decisions = await prisma.aiDecision.count({ where: { universeId: fixture.universeId } });
    const replay = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(replay.status).toBe("REUSED");
    expect(replay.envelopes).toHaveLength(0);
    expect(await prisma.aiDecision.count({ where: { universeId: fixture.universeId } })).toBe(
      decisions,
    );
    pushMetric("E10", {
      candidates: first.selection.candidateCount,
      selected: first.selection.selected.length,
      envelopes: 0,
      messages: 0,
    });
  });

  it("métricas agregadas F6-E01..E10 são coerentes", () => {
    expect(metrics).toHaveLength(10);
    expect(new Set(metrics.map((metric) => metric.id)).size).toBe(10);
    for (const metric of metrics) {
      expect(metric.selected).toBeLessThanOrEqual(metric.candidates);
      expect(metric.envelopes).toBeLessThanOrEqual(2);
    }
    expect(metrics.reduce((total, metric) => total + metric.messages, 0)).toBeGreaterThanOrEqual(1);
  });
});
