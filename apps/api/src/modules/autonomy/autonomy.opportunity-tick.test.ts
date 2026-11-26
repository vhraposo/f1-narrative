import { afterAll, describe, expect, it } from "vitest";
import type { EventImportance, MemoryImportance } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { createEventWithDerivations } from "../events/event-create.js";
import {
  readConversationOpportunityAudit,
  readConversationOpportunitySelectionAudit,
} from "./autonomy.opportunities.js";
import { runAutonomousTick } from "./autonomy.service.js";

const PREFIX = "autonomy-opp";
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
  readonly status?: "ACTIVE" | "PAUSED" | "STOPPED";
  readonly aiCharacters: number;
  readonly userCharacters?: number;
  readonly conversations: ReadonlyArray<readonly [number, number]>;
  readonly conversationCreatedAt?: Date;
  readonly worldDate?: Date;
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
  readonly relationshipChanges?: ReadonlyArray<{
    readonly pair: readonly [number, number];
    readonly delta?: number;
  }>;
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
  readonly characterIds: readonly string[];
  readonly conversationIds: readonly string[];
};

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
      autonomyStatus: options.status ?? "ACTIVE",
    },
  });
  createdUniverseIds.push(universe.id);

  await prisma.worldState.create({
    data: {
      universeId: universe.id,
      key: "default",
      currentDate: options.worldDate ?? WINDOW_START,
    },
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

  for (const availability of options.availability ?? []) {
    await prisma.characterAvailability.create({
      data: { characterId: characterIds[availability.character]!, status: availability.status },
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
      data: { characterAId, characterBId, dimensions: { rivalry: 0.4 } },
    });
  }

  let changeIndex = 0;
  for (const change of options.relationshipChanges ?? []) {
    const [characterAId, characterBId] = [
      characterIds[change.pair[0]]!,
      characterIds[change.pair[1]]!,
    ].sort();
    const relationship =
      (await prisma.relationship.findFirst({
        where: { characterAId, characterBId },
        select: { id: true },
      })) ??
      (await prisma.relationship.create({
        data: { characterAId, characterBId, dimensions: {} },
        select: { id: true },
      }));
    changeIndex += 1;
    await prisma.relationshipChange.create({
      data: {
        relationshipId: relationship.id,
        characterAId,
        characterBId,
        dimension: "rivalry",
        previousValue: 40,
        delta: change.delta ?? 10,
        resultingValue: 50,
        ruleCode: "test.rule.v1",
        sourceType: "TEST",
        worldDate: SIGNAL_AT,
        createdAt: SIGNAL_AT,
        fingerprint: `${tag}-change-${changeIndex}`,
      },
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

  return { universeId: universe.id, characterIds, conversationIds };
}

async function readDecisionAudits(universeId: string) {
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
    await prisma.message.deleteMany({
      where: { conversationId: { in: createdConversationIds } },
    });
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
    await prisma.pilotExperience.deleteMany({
      where: { characterId: { in: createdCharacterIds } },
    });
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

describe("F6.2 — oportunidades no runAutonomousTick", () => {
  it("GUIDED seleciona e audita oportunidades sem executar conversa", async () => {
    const fixture = await createFixture({
      label: "guided",
      mode: "GUIDED",
      aiCharacters: 3,
      conversations: [
        [0, 1],
        [0, 2],
      ],
      goals: [
        { character: 2, priority: 50 },
        { character: 1, priority: 40 },
      ],
      events: [{ participants: [0], importance: "HIGH" }],
      memories: [{ participants: [0], importance: "MEDIUM" }],
    });
    const messagesBefore = await prisma.message.count({
      where: { conversationId: { in: [...fixture.conversationIds] } },
    });

    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.status).toBe("EXECUTED");
    expect(result.mode).toBe("GUIDED");
    expect(result.actionsExecuted).toBe(0);

    const audits = (await readDecisionAudits(fixture.universeId)).filter((entry) => entry.audit);
    expect(audits).toHaveLength(2);
    expect(new Set(audits.map((entry) => entry.audit!.reason))).toEqual(
      new Set(["WORLD_EVENT", "GOAL_PRESSURE"]),
    );
    expect(new Set(audits.map((entry) => entry.audit!.conversationId)).size).toBe(2);
    for (const entry of audits) {
      expect(entry.audit!.windowStart).toBe(WINDOW_START.toISOString());
      expect(String(entry.audit!.fingerprint)).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.summary).toEqual({
        candidateCount: expect.any(Number),
        selectedCount: 2,
        budget: 2,
        budgetExhausted: false,
      });
      expect(entry.decision.conversationId).toBe(entry.audit!.conversationId);
    }
    expect(
      (await prisma.message.count({
        where: { conversationId: { in: [...fixture.conversationIds] } },
      })),
    ).toBe(messagesBefore);
  });

  it("cooldown por personagem/conversa evita repetição no tick seguinte", async () => {
    const fixture = await createFixture({
      label: "cooldown",
      mode: "GUIDED",
      aiCharacters: 2,
      conversations: [[0, 1]],
      goals: [
        { character: 0, priority: 60 },
        { character: 1, priority: 50 },
      ],
    });

    await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    const first = (await readDecisionAudits(fixture.universeId)).filter((entry) => entry.audit);
    expect(first).toHaveLength(1);

    const secondTick = await runAutonomousTick({
      universeId: fixture.universeId,
      toDate: TO_2,
    });
    expect(secondTick.status).toBe("EXECUTED");
    const second = (await readDecisionAudits(fixture.universeId)).filter(
      (entry) => entry.audit?.windowStart === TO_1.toISOString(),
    );
    expect(second).toHaveLength(0);
    const summaries = (await readDecisionAudits(fixture.universeId)).filter(
      (entry) => entry.summary?.selectedCount === 0,
    );
    expect(summaries.length).toBeGreaterThanOrEqual(1);

    const thirdTick = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_3 });
    expect(thirdTick.status).toBe("EXECUTED");
    const third = (await readDecisionAudits(fixture.universeId)).filter(
      (entry) => entry.audit?.windowStart === TO_2.toISOString(),
    );
    expect(third).toHaveLength(1);
  });

  it("replay determinístico: tick repetido é reutilizado sem nova auditoria", async () => {
    const fixture = await createFixture({
      label: "replay",
      mode: "GUIDED",
      aiCharacters: 2,
      conversations: [[0, 1]],
      goals: [{ character: 0, priority: 60 }],
    });
    await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    const decisionsBefore = await prisma.aiDecision.count({
      where: { universeId: fixture.universeId },
    });
    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.status).toBe("REUSED");
    expect(
      await prisma.aiDecision.count({ where: { universeId: fixture.universeId } }),
    ).toBe(decisionsBefore);
  });

  it("budget máximo de 2 oportunidades por tick", async () => {
    const fixture = await createFixture({
      label: "budget",
      mode: "GUIDED",
      aiCharacters: 3,
      userCharacters: 1,
      conversations: [
        [0, 3],
        [1, 3],
        [2, 3],
      ],
      goals: [
        { character: 0, priority: 50 },
        { character: 1, priority: 50 },
        { character: 2, priority: 50 },
      ],
    });
    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.status).toBe("EXECUTED");
    const audits = (await readDecisionAudits(fixture.universeId)).filter((entry) => entry.audit);
    expect(audits).toHaveLength(2);
    expect(new Set(audits.map((entry) => entry.audit!.conversationId)).size).toBe(2);
    expect(new Set(audits.map((entry) => entry.audit!.characterId)).size).toBe(2);
    expect(audits.every((entry) => entry.summary?.budgetExhausted === true)).toBe(true);
  });

  it("OBSERVER é audit-only", async () => {
    const fixture = await createFixture({
      label: "observer",
      mode: "OBSERVER",
      aiCharacters: 2,
      conversations: [[0, 1]],
      goals: [{ character: 0, priority: 60 }],
    });
    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.status).toBe("EXECUTED");
    expect(result.actionsExecuted).toBe(0);
    const audits = (await readDecisionAudits(fixture.universeId)).filter((entry) => entry.audit);
    expect(audits).toHaveLength(1);
    expect(await prisma.memory.count({ where: { universeId: fixture.universeId } })).toBe(0);
    expect(
      await prisma.message.count({
        where: { conversationId: { in: [...fixture.conversationIds] } },
      }),
    ).toBe(0);
  });

  it("OFF não executa nem audita", async () => {
    const fixture = await createFixture({
      label: "off",
      mode: "OFF",
      aiCharacters: 2,
      conversations: [[0, 1]],
      goals: [{ character: 0, priority: 60 }],
    });
    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.status).toBe("SKIPPED");
    expect(result.reasonCode).toBe("AUTONOMY_DISABLED");
    expect(await prisma.aiDecision.count({ where: { universeId: fixture.universeId } })).toBe(0);
  });

  it("FULL seleciona, audita e executa o envelope sem LLM (F6.3)", async () => {
    const fixture = await createFixture({
      label: "full",
      mode: "FULL",
      aiCharacters: 2,
      conversations: [[0, 1]],
      goals: [{ character: 0, priority: 60 }],
    });
    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.status).toBe("EXECUTED");
    expect(result.envelopes).toHaveLength(1);
    expect(result.envelopes[0]!.executed).toBe(true);
    expect(result.envelopes[0]!.depth).toBeGreaterThanOrEqual(1);
    expect(result.envelopes[0]!.messageIds.length).toBeGreaterThanOrEqual(1);
    const decisions = await prisma.aiDecision.findMany({
      where: { universeId: fixture.universeId },
      select: { metadata: true },
    });
    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(
      decisions.every((decision) => {
        const metadata = decision.metadata as Record<string, unknown>;
        return metadata.llmUsed === false;
      }),
    ).toBe(true);
    const audits = (await readDecisionAudits(fixture.universeId)).filter((entry) => entry.audit);
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0]!.audit)).not.toMatch(/provider|model|prompt/i);
    const messages = await prisma.message.findMany({
      where: { conversationId: { in: [...fixture.conversationIds] } },
      select: { id: true, senderType: true },
    });
    expect(messages.length).toBe(result.envelopes[0]!.messageIds.length);
    expect(messages.every((message) => message.senderType === "AI_CHARACTER")).toBe(true);
  });

  it("isolamento por universe: conversa mista e actions externas ficam fora", async () => {
    const home = await createFixture({
      label: "iso-home",
      mode: "GUIDED",
      aiCharacters: 1,
      userCharacters: 1,
      conversations: [[0, 1]],
      goals: [{ character: 0, priority: 60 }],
    });
    const foreign = await createFixture({
      label: "iso-foreign",
      mode: "GUIDED",
      aiCharacters: 1,
      userCharacters: 1,
      conversations: [[0, 1]],
      goals: [{ character: 0, priority: 90 }],
    });
    const mixed = await prisma.conversation.create({
      data: {
        title: "mixed-universe",
        participants: {
          create: [
            { characterId: home.characterIds[0]! },
            { characterId: foreign.characterIds[0]! },
          ],
        },
      },
    });
    createdConversationIds.push(mixed.id);

    const result = await runAutonomousTick({ universeId: home.universeId, toDate: TO_1 });
    expect(result.status).toBe("EXECUTED");
    const homeAudits = (await readDecisionAudits(home.universeId)).filter((entry) => entry.audit);
    expect(homeAudits).toHaveLength(1);
    expect(homeAudits[0]!.audit!.conversationId).toBe(home.conversationIds[0]);
    expect(homeAudits.every((entry) => entry.decision.conversationId !== mixed.id)).toBe(true);
    const foreignDecisions = await prisma.aiDecision.count({
      where: { universeId: foreign.universeId },
    });
    expect(foreignDecisions).toBe(0);
  });

  it("INACTIVITY deriva da conversa inativa vs TICK_WINDOW_HOURS", async () => {
    const fixture = await createFixture({
      label: "inactivity",
      mode: "GUIDED",
      aiCharacters: 2,
      conversations: [[0, 1]],
      conversationCreatedAt: new Date("2026-09-28T00:00:00.000Z"),
    });
    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.status).toBe("EXECUTED");
    const audits = (await readDecisionAudits(fixture.universeId)).filter((entry) => entry.audit);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.audit!.reason).toBe("INACTIVITY");
    expect(String(audits[0]!.audit!.evidenceId)).toMatch(/^inactivity:/);
  });

  it("RELATIONSHIP_CHANGE e MEMORY_TRIGGER entram como fontes", async () => {
    const fixture = await createFixture({
      label: "sources",
      mode: "GUIDED",
      aiCharacters: 2,
      conversations: [
        [0, 1],
        [0, 1],
      ],
      relationshipChanges: [{ pair: [0, 1], delta: 15 }],
      memories: [{ participants: [0, 1], importance: "HIGH" }],
    });
    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.status).toBe("EXECUTED");
    const audits = (await readDecisionAudits(fixture.universeId)).filter((entry) => entry.audit);
    expect(audits).toHaveLength(2);
    expect(new Set(audits.map((entry) => entry.audit!.reason))).toEqual(
      new Set(["RELATIONSHIP_CHANGE", "MEMORY_TRIGGER"]),
    );
    const evidence = audits.map((entry) => String(entry.audit!.evidenceId));
    expect(evidence.some((id) => id.startsWith("relationship-change:"))).toBe(true);
    expect(evidence.some((id) => id.startsWith("memory:"))).toBe(true);
    expect(new Set(audits.map((entry) => entry.audit!.conversationId)).size).toBe(2);
  });
});

describe("F6.3 — envelope de conversa a partir da oportunidade", () => {
  it("FULL executa envelope AI→AI pelo pipeline existente, sem LLM", async () => {
    const fixture = await createFixture({
      label: "env-full",
      mode: "FULL",
      aiCharacters: 2,
      conversations: [[0, 1]],
      goals: [{ character: 0, priority: 60 }],
      messages: [
        { conversation: 0, sender: 1, content: "bom dia, parceiro", createdAt: SIGNAL_AT },
      ],
    });
    const seed = await prisma.message.findFirstOrThrow({
      where: { conversationId: fixture.conversationIds[0]!, characterId: fixture.characterIds[1]! },
      select: { id: true },
    });

    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.status).toBe("EXECUTED");
    expect(result.envelopes).toHaveLength(1);
    const envelope = result.envelopes[0]!;
    expect(envelope.executed).toBe(true);
    expect(envelope.characterId).toBe(fixture.characterIds[0]);
    expect(envelope.conversationId).toBe(fixture.conversationIds[0]);
    expect(envelope.depth).toBeGreaterThanOrEqual(1);
    expect(envelope.messageIds.length).toBeGreaterThanOrEqual(1);

    const messages = await prisma.message.findMany({
      where: { id: { in: [...envelope.messageIds] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(messages).toHaveLength(envelope.messageIds.length);
    expect(messages[0]!.characterId).toBe(fixture.characterIds[0]);
    expect(messages[0]!.senderType).toBe("AI_CHARACTER");
    const contextJson = messages[0]!.contextJson as Record<string, unknown>;
    const dialogue = contextJson.dialogue as Record<string, unknown>;
    expect(dialogue.replyToMessageId).toBe(seed.id);
    const language = contextJson.language as Record<string, unknown>;
    expect(language.provider).toBe("dialogue-realizer");
    expect(language.fallback).toBe(false);

    const decisions = await prisma.aiDecision.findMany({
      where: { universeId: fixture.universeId, status: "EXECUTED" },
      select: { executedMessageId: true, metadata: true },
    });
    for (const messageId of envelope.messageIds) {
      expect(decisions.some((decision) => decision.executedMessageId === messageId)).toBe(true);
    }
    expect(
      messages.every((message) =>
        decisions.some((decision) => decision.executedMessageId === message.id),
      ),
    ).toBe(true);
    expect(
      decisions.every(
        (decision) => (decision.metadata as Record<string, unknown>).llmUsed === false,
      ),
    ).toBe(true);
    const turnDecision = await prisma.aiDecision.findFirstOrThrow({
      where: {
        universeId: fixture.universeId,
        characterId: fixture.characterIds[0]!,
        metadata: { path: ["trigger"], equals: "CONVERSATION_TURN_DUE" },
      },
      select: { metadata: true },
    });
    const turnMetadata = turnDecision.metadata as Record<string, unknown>;
    expect(turnMetadata.targetCharacterId).toBe(fixture.characterIds[1]);
    const audits = (await readDecisionAudits(fixture.universeId)).filter((entry) => entry.audit);
    expect(
      audits.some((entry) => entry.audit!.fingerprint === envelope.fingerprint),
    ).toBe(true);
  });

  it("OFF/OBSERVER/GUIDED não executam envelope nesta fase", async () => {
    for (const mode of ["OFF", "OBSERVER", "GUIDED"] as const) {
      const fixture = await createFixture({
        label: `env-mode-${mode}`,
        mode,
        aiCharacters: 2,
        conversations: [[0, 1]],
        goals: [{ character: 0, priority: 60 }],
        messages: [{ conversation: 0, sender: 1, content: "bom dia" }],
      });
      const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
      expect(result.envelopes).toHaveLength(0);
      expect(
        await prisma.message.count({ where: { conversationId: fixture.conversationIds[0]! } }),
      ).toBe(1);
    }
  });

  it("oportunidade inexistente não executa conversa", async () => {
    const fixture = await createFixture({
      label: "env-no-opportunity",
      mode: "FULL",
      aiCharacters: 2,
      conversations: [[0, 1]],
      messages: [{ conversation: 0, sender: 1, content: "bom dia" }],
    });
    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.status).toBe("EXECUTED");
    expect(result.envelopes).toHaveLength(0);
    expect(
      await prisma.message.count({ where: { conversationId: fixture.conversationIds[0]! } }),
    ).toBe(1);
  });

  it("idempotência: tick repetido não duplica envelope nem mensagem", async () => {
    const fixture = await createFixture({
      label: "env-replay",
      mode: "FULL",
      aiCharacters: 2,
      conversations: [[0, 1]],
      goals: [{ character: 0, priority: 60 }],
      messages: [{ conversation: 0, sender: 1, content: "bom dia" }],
    });
    await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    const messagesAfterFirst = await prisma.message.count({
      where: { conversationId: fixture.conversationIds[0]! },
    });
    const decisionsAfterFirst = await prisma.aiDecision.count({
      where: { universeId: fixture.universeId },
    });
    const replay = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(replay.status).toBe("REUSED");
    expect(replay.envelopes).toHaveLength(0);
    expect(
      await prisma.message.count({ where: { conversationId: fixture.conversationIds[0]! } }),
    ).toBe(messagesAfterFirst);
    expect(await prisma.aiDecision.count({ where: { universeId: fixture.universeId } })).toBe(
      decisionsAfterFirst,
    );
  });

  it("no máximo uma conversa por tick e budget de conversações", async () => {
    const fixture = await createFixture({
      label: "env-budget",
      mode: "FULL",
      aiCharacters: 3,
      userCharacters: 1,
      conversations: [
        [0, 3],
        [1, 3],
        [2, 3],
      ],
      goals: [
        { character: 0, priority: 60 },
        { character: 1, priority: 55 },
        { character: 2, priority: 50 },
      ],
      messages: [
        { conversation: 0, sender: 3, content: "bom dia" },
        { conversation: 1, sender: 3, content: "bom dia" },
        { conversation: 2, sender: 3, content: "bom dia" },
      ],
    });
    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.envelopes).toHaveLength(2);
    expect(new Set(result.envelopes.map((envelope) => envelope.conversationId)).size).toBe(2);
    expect(result.envelopes.every((envelope) => envelope.executed)).toBe(true);
  });

  it("AUTONOMY_MAX_CONVERSATIONS_PER_TICK limita envelopes", async () => {
    process.env.AUTONOMY_MAX_CONVERSATIONS_PER_TICK = "1";
    try {
      const fixture = await createFixture({
        label: "env-budget-1",
        mode: "FULL",
        aiCharacters: 2,
        userCharacters: 1,
        conversations: [
          [0, 2],
          [1, 2],
        ],
        goals: [
          { character: 0, priority: 60 },
          { character: 1, priority: 55 },
        ],
        messages: [
          { conversation: 0, sender: 2, content: "bom dia" },
          { conversation: 1, sender: 2, content: "bom dia" },
        ],
      });
      const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
      expect(result.envelopes).toHaveLength(1);
    } finally {
      delete process.env.AUTONOMY_MAX_CONVERSATIONS_PER_TICK;
    }
  });

  it("budget de mensagens limita envelopes seguintes", async () => {
    process.env.AUTONOMY_MAX_MESSAGES_PER_TICK = "1";
    try {
      const fixture = await createFixture({
        label: "env-budget-msg",
        mode: "FULL",
        aiCharacters: 2,
        userCharacters: 1,
        conversations: [
          [0, 2],
          [1, 2],
        ],
        goals: [
          { character: 0, priority: 60 },
          { character: 1, priority: 55 },
        ],
        messages: [
          { conversation: 0, sender: 2, content: "bom dia" },
          { conversation: 1, sender: 2, content: "bom dia" },
        ],
      });
      const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
      expect(result.envelopes).toHaveLength(2);
      const executed = result.envelopes.filter((envelope) => envelope.executed);
      const blocked = result.envelopes.filter((envelope) => !envelope.executed);
      expect(executed).toHaveLength(1);
      expect(blocked).toHaveLength(1);
      expect(blocked[0]!.stopReason).toBe("BUDGET_LIMIT");
      const created = await prisma.message.count({
        where: { conversationId: { in: [...fixture.conversationIds] } },
      });
      expect(created).toBe(3);
    } finally {
      delete process.env.AUTONOMY_MAX_MESSAGES_PER_TICK;
    }
  });

  it("planner pode produzir stop quando o speaker está indisponível", async () => {
    const fixture = await createFixture({
      label: "env-busy",
      mode: "FULL",
      aiCharacters: 2,
      conversations: [[0, 1]],
      goals: [{ character: 0, priority: 60 }],
      messages: [{ conversation: 0, sender: 1, content: "bom dia" }],
      availability: [{ character: 0, status: "BUSY" }],
    });
    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.envelopes).toHaveLength(1);
    expect(result.envelopes[0]!.executed).toBe(false);
    expect(result.envelopes[0]!.stopReason).toBe("NO_ELIGIBLE_SPEAKER");
    expect(result.envelopes[0]!.messageIds).toHaveLength(0);
    expect(
      await prisma.message.count({ where: { conversationId: fixture.conversationIds[0]! } }),
    ).toBe(1);
  });

  it("envelope termina naturalmente sem mensagem adicional", async () => {
    const fixture = await createFixture({
      label: "env-natural-end",
      mode: "FULL",
      aiCharacters: 1,
      userCharacters: 1,
      conversations: [[0, 1]],
      goals: [{ character: 0, priority: 60 }],
      messages: [{ conversation: 0, sender: 1, content: "bom dia" }],
    });
    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    const envelope = result.envelopes[0]!;
    expect(envelope.executed).toBe(true);
    expect(envelope.depth).toBe(1);
    expect(envelope.messageIds).toHaveLength(1);
    expect(["NO_OPPORTUNITY", "NATURAL_END"]).toContain(envelope.stopReason);
    expect(
      await prisma.message.count({ where: { conversationId: fixture.conversationIds[0]! } }),
    ).toBe(2);
  });

  it("isolamento entre universes também vale para envelopes", async () => {
    const home = await createFixture({
      label: "env-iso-home",
      mode: "FULL",
      aiCharacters: 2,
      conversations: [[0, 1]],
      goals: [{ character: 0, priority: 60 }],
      messages: [{ conversation: 0, sender: 1, content: "bom dia" }],
    });
    const foreign = await createFixture({
      label: "env-iso-foreign",
      mode: "FULL",
      aiCharacters: 2,
      conversations: [[0, 1]],
      goals: [{ character: 0, priority: 90 }],
      messages: [{ conversation: 0, sender: 1, content: "bom dia" }],
    });
    const result = await runAutonomousTick({ universeId: home.universeId, toDate: TO_1 });
    expect(result.envelopes).toHaveLength(1);
    expect(result.envelopes[0]!.conversationId).toBe(home.conversationIds[0]);
    expect(
      await prisma.message.count({ where: { conversationId: foreign.conversationIds[0]! } }),
    ).toBe(1);
    expect(await prisma.aiDecision.count({ where: { universeId: foreign.universeId } })).toBe(0);
  });
});

describe("F6.4 — ponte eventos→oportunidade", () => {
  it("evento e derivações convergem para uma única evidência canônica", async () => {
    const fixture = await createFixture({
      label: "bridge-dedupe",
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
          title: `${PREFIX}-bridge-event`,
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
    const audits = (await readDecisionAudits(fixture.universeId)).filter((entry) => entry.audit);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.audit!.evidenceId).toBe(`event:${event.id}`);
    expect(audits[0]!.audit!.reason).toBe("WORLD_EVENT");
    expect(audits[0]!.summary?.candidateCount).toBeGreaterThanOrEqual(4);
    expect(
      await prisma.message.count({ where: { conversationId: fixture.conversationIds[0]! } }),
    ).toBe(0);
  });

  it("evento de outro universe não vaza para a seleção", async () => {
    const home = await createFixture({
      label: "bridge-home",
      mode: "GUIDED",
      aiCharacters: 2,
      conversations: [[0, 1]],
      events: [{ participants: [0], importance: "HIGH" }],
    });
    const foreign = await createFixture({
      label: "bridge-foreign",
      mode: "GUIDED",
      aiCharacters: 2,
      conversations: [[0, 1]],
      events: [{ participants: [0], importance: "CRITICAL" }],
    });
    const homeEvent = await prisma.event.findFirstOrThrow({
      where: { participants: { some: { characterId: home.characterIds[0]! } } },
      select: { id: true },
    });

    const result = await runAutonomousTick({ universeId: home.universeId, toDate: TO_1 });
    expect(result.status).toBe("EXECUTED");
    const audits = (await readDecisionAudits(home.universeId)).filter((entry) => entry.audit);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.audit!.evidenceId).toBe(`event:${homeEvent.id}`);
    expect(await prisma.aiDecision.count({ where: { universeId: foreign.universeId } })).toBe(0);
  });

  it("evento sem conversa elegível não cria oportunidade", async () => {
    const fixture = await createFixture({
      label: "bridge-no-conversation",
      mode: "GUIDED",
      aiCharacters: 2,
      conversations: [],
      events: [{ participants: [0], importance: "HIGH" }],
    });
    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.status).toBe("EXECUTED");
    const audits = (await readDecisionAudits(fixture.universeId)).filter((entry) => entry.audit);
    expect(audits).toHaveLength(0);
    expect(result.envelopes).toHaveLength(0);
  });

  it("FULL: evento gera oportunidade e envelope via F6.3", async () => {
    const fixture = await createFixture({
      label: "bridge-full",
      mode: "FULL",
      aiCharacters: 2,
      conversations: [[0, 1]],
      messages: [{ conversation: 0, sender: 1, content: "bom dia" }],
      events: [{ participants: [0], importance: "HIGH" }],
    });
    const event = await prisma.event.findFirstOrThrow({
      where: { participants: { some: { characterId: fixture.characterIds[0]! } } },
      select: { id: true },
    });

    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.status).toBe("EXECUTED");
    expect(result.envelopes).toHaveLength(1);
    const envelope = result.envelopes[0]!;
    expect(envelope.evidenceId).toBe(`event:${event.id}`);
    expect(envelope.executed).toBe(true);
    const audits = (await readDecisionAudits(fixture.universeId)).filter((entry) => entry.audit);
    expect(audits.some((entry) => entry.audit!.evidenceId === `event:${event.id}`)).toBe(true);
  });
});
