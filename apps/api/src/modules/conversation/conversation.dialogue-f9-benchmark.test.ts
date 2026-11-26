import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { EventVisibility } from "@prisma/client";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  buildAutonomyOpportunityPlan,
  readConversationOpportunityAudit,
} from "../autonomy/autonomy.opportunities.js";
import { runAutonomousTick } from "../autonomy/autonomy.service.js";
import { autonomyBudgets } from "../autonomy/autonomy.policy.js";
import { retrieveRelevantMemories } from "../memory/memory.retrieval.js";
import { buildDialogueKnowledgeContext } from "../conversation/conversation.dialogue-context.js";
import {
  assembleGenerationBundle,
  type GenerationProvider,
} from "../generation/generation.assembly.js";
import { getSimulationPlan } from "../conversation/conversation.simulation.js";
import { evaluateBehaviorDecision } from "../behavior/behavior.decision.js";
import { executeBehaviorDecision } from "../behavior/behavior.execution.js";

// F9 — Benchmark Gate determinístico (TEST DB). Renova as invariantes F5–F8
// por cenários B01..B10, com métricas hard e relatório PASS/FAIL.

const PREFIX = "f9-benchmark";
const WINDOW_START = new Date("2026-10-01T00:00:00.000Z");
const SIGNAL_AT = new Date("2026-10-01T12:00:00.000Z");
const TO_1 = new Date("2026-10-02T00:00:00.000Z");
const TO_2 = new Date("2026-10-03T00:00:00.000Z");
const TO_3 = new Date("2026-10-04T00:00:00.000Z");

const SCENARIOS: ReadonlyArray<{ id: string; title: string }> = [
  { id: "B01", title: "Deterministic replay" },
  { id: "B02", title: "Private knowledge isolation" },
  { id: "B03", title: "Restricted event isolation" },
  { id: "B04", title: "Conversation ACL" },
  { id: "B05", title: "Opportunity dedupe" },
  { id: "B06", title: "Cooldown" },
  { id: "B07", title: "Budget enforcement" },
  { id: "B08", title: "AI↔AI" },
  { id: "B09", title: "Universe isolation" },
  { id: "B10", title: "Command Layer guard" },
];

const results = new Map<string, boolean>();
const metrics = {
  privacyLeakage: 0,
  unauthorizedWrites: 0,
  crossUniverse: 0,
  duplicateCanonical: 0,
  cooldownViolations: 0,
  budgetViolations: 0,
  replayDivergence: 0,
  postStopMessages: 0,
  llmCalls: 0,
};

export function countLeaks(input: {
  readonly forbidden: Iterable<string>;
  readonly actual: Iterable<string>;
}): number {
  const forbidden = new Set(input.forbidden);
  let leaks = 0;
  for (const id of input.actual) if (forbidden.has(id)) leaks += 1;
  return leaks;
}

export function countCrossUniverse(
  actualUniverseIds: Iterable<string>,
  expectedUniverseId: string,
): number {
  let violations = 0;
  for (const id of actualUniverseIds) if (id !== expectedUniverseId) violations += 1;
  return violations;
}

export function countDuplicateEvidence(
  selected: ReadonlyArray<{ readonly evidenceId: string }>,
): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const entry of selected) {
    if (seen.has(entry.evidenceId)) duplicates += 1;
    seen.add(entry.evidenceId);
  }
  return duplicates;
}

export function countBudgetViolations(actual: number, limit: number): number {
  return Math.max(0, actual - limit);
}

function record(id: string, ok: boolean): void {
  results.set(id, ok);
}

const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];
const createdEventIds: string[] = [];
const createdMemoryIds: string[] = [];

let counter = 0;
let app: FastifyInstance;

function stubProvider(): GenerationProvider {
  return {
    name: "f9-stub",
    async run() {
      return {
        provider: "f9-stub",
        mode: "generated" as const,
        text: "ok",
        tokenStats: { systemPromptChars: 0, contextBlocks: 0 },
      };
    },
  };
}

async function createUniverse(input: {
  readonly label: string;
  readonly mode?: "OFF" | "OBSERVER" | "GUIDED" | "FULL";
  readonly userId?: string;
  readonly characters?: number;
}): Promise<{ universeId: string; userId: string; characterIds: string[] }> {
  counter += 1;
  const tag = `${PREFIX}-${input.label}-${counter}`;
  let userId = input.userId;
  if (!userId) {
    const user = await prisma.user.create({ data: { email: `${tag}@f1nw.test`, name: tag } });
    createdUserIds.push(user.id);
    userId = user.id;
  }
  const universe = await prisma.universe.upsert({
    where: { userId },
    update: {
      status: "READY",
      autonomyMode: input.mode ?? "GUIDED",
      autonomyStatus: "ACTIVE",
    },
    create: {
      userId,
      status: "READY",
      autonomyMode: input.mode ?? "GUIDED",
      autonomyStatus: "ACTIVE",
    },
  });
  createdUniverseIds.push(universe.id);
  await prisma.worldState.create({
    data: { universeId: universe.id, key: "default", currentDate: WINDOW_START },
  });
  const characterIds: string[] = [];
  for (let index = 0; index < (input.characters ?? 2); index += 1) {
    const character = await prisma.character.create({
      data: {
        universeId: universe.id,
        userId,
        controlledBy: "AI",
        name: `${tag}-ai-${index}`,
        nationality: "BR",
        birthDate: new Date("1998-01-01T00:00:00.000Z"),
      },
    });
    createdCharacterIds.push(character.id);
    characterIds.push(character.id);
  }
  return { universeId: universe.id, userId, characterIds };
}

async function createConversation(
  participantIds: readonly string[],
  createdAt = SIGNAL_AT,
): Promise<string> {
  const conversation = await prisma.conversation.create({
    data: {
      type: "GROUP",
      createdAt,
      participants: { create: participantIds.map((characterId) => ({ characterId })) },
    },
  });
  createdConversationIds.push(conversation.id);
  return conversation.id;
}

async function createMemory(input: {
  readonly content: string;
  readonly universeId: string | null;
  readonly participantIds: readonly string[];
  readonly eventId?: string;
}): Promise<string> {
  const memory = await prisma.memory.create({
    data: {
      universeId: input.universeId,
      eventId: input.eventId ?? null,
      importance: "HIGH",
      source: "GENERATED_EVENT",
      status: "ACTIVE",
      content: input.content,
      summary: input.content,
      participants: {
        create: input.participantIds.map((characterId) => ({ characterId })),
      },
    },
  });
  createdMemoryIds.push(memory.id);
  return memory.id;
}

async function createEvent(input: {
  readonly title: string;
  readonly visibility: EventVisibility;
  readonly participantIds: readonly string[];
}): Promise<string> {
  const event = await prisma.event.create({
    data: {
      type: "SOCIAL",
      importance: "HIGH",
      source: "GENERATED_EVENT",
      visibility: input.visibility,
      title: input.title,
      worldDate: SIGNAL_AT,
      participants: { create: input.participantIds.map((characterId) => ({ characterId })) },
    },
  });
  createdEventIds.push(event.id);
  return event.id;
}

async function createGoal(universeId: string, characterId: string, priority: number): Promise<void> {
  await prisma.characterGoal.create({
    data: {
      universeId,
      characterId,
      kind: "RESTORE_CONFIDENCE",
      priority,
      status: "ACTIVE",
      source: "SYSTEM",
    },
  });
}

async function readAudits(universeId: string) {
  const decisions = await prisma.aiDecision.findMany({
    where: { universeId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { characterId: true, metadata: true },
  });
  return decisions
    .map((decision) => ({
      characterId: decision.characterId,
      audit: readConversationOpportunityAudit(decision.metadata),
    }))
    .filter((entry) => entry.audit !== null);
}

function planInput(universeId: string, characterIds: readonly string[], toDate = TO_1) {
  return {
    universeId,
    fromDate: WINDOW_START,
    toDate,
    characterIds,
    maxConversations: autonomyBudgets().maxConversationsPerTick,
    cooldownHours: autonomyBudgets().tickWindowHours,
  };
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

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
    await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  }
  if (createdUniverseIds.length > 0) {
    await prisma.worldState.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
    await prisma.universe.deleteMany({ where: { id: { in: createdUniverseIds } } });
  }
  if (createdUserIds.length > 0) {
    await prisma.universe.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await app.close();
  await prisma.$disconnect();
});

describe("F9 — Benchmark Gate", () => {
  it("B01 deterministic replay (plano, tick REUSED e simulação)", async () => {
    const fixture = await createUniverse({ label: "b01" });
    const [a, b] = fixture.characterIds;
    const conversationId = await createConversation([a!, b!]);
    await createGoal(fixture.universeId, a!, 60);

    const input = planInput(fixture.universeId, fixture.characterIds);
    const first = await buildAutonomyOpportunityPlan(input);
    const second = await buildAutonomyOpportunityPlan(input);
    const sameSelection =
      first.selection.selected.length === second.selection.selected.length &&
      first.selection.selected.every(
        (entry, index) =>
          entry.opportunity.fingerprint ===
            second.selection.selected[index]?.opportunity.fingerprint &&
          entry.evidenceId === second.selection.selected[index]?.evidenceId,
      );
    if (!sameSelection || first.selection.selected.length === 0) {
      metrics.replayDivergence += 1;
    }

    const planA = await getSimulationPlan(conversationId, {
      userId: fixture.userId,
      worldDate: TO_1,
    });
    const planB = await getSimulationPlan(conversationId, {
      userId: fixture.userId,
      worldDate: TO_1,
    });
    if (JSON.stringify(planA.dialogue) !== JSON.stringify(planB.dialogue)) {
      metrics.replayDivergence += 1;
    }

    const tick1 = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    const decisionsAfterFirst = await prisma.aiDecision.count({
      where: { universeId: fixture.universeId },
    });
    const tick2 = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    const decisionsAfterReplay = await prisma.aiDecision.count({
      where: { universeId: fixture.universeId },
    });
    if (tick1.status !== "EXECUTED" || tick2.status !== "REUSED") metrics.replayDivergence += 1;
    if (decisionsAfterFirst !== decisionsAfterReplay) metrics.replayDivergence += 1;

    record("B01", metrics.replayDivergence === 0);
    expect(metrics.replayDivergence).toBe(0);
  });

  it("B02 private knowledge isolation (A vê, B não vê)", async () => {
    const fixture = await createUniverse({ label: "b02" });
    const [a, b] = fixture.characterIds;
    const conversationId = await createConversation([a!, b!]);
    const memoryX = await createMemory({
      content: `${PREFIX}-segredo-A`,
      universeId: fixture.universeId,
      participantIds: [a!],
    });
    await createMemory({
      content: `${PREFIX}-segredo-B`,
      universeId: fixture.universeId,
      participantIds: [b!],
    });

    const forA = await retrieveRelevantMemories({
      universeId: fixture.universeId,
      characterId: a!,
      participantIds: [a!, b!],
      worldDate: WINDOW_START,
      now: WINDOW_START,
    });
    const forB = await retrieveRelevantMemories({
      universeId: fixture.universeId,
      characterId: b!,
      participantIds: [a!, b!],
      worldDate: WINDOW_START,
      now: WINDOW_START,
    });
    metrics.privacyLeakage += countLeaks({
      forbidden: [memoryX],
      actual: forB.map((memory) => memory.id),
    });

    const knowledgeB = buildDialogueKnowledgeContext({
      universeId: fixture.universeId,
      memories: forB.map((memory) => ({
        id: memory.id,
        summary: memory.summary,
        content: memory.content,
        importance: memory.importance,
        universeId: fixture.universeId,
      })),
    });
    metrics.privacyLeakage += countLeaks({
      forbidden: [memoryX],
      actual: knowledgeB.knownFacts.map((fact) => fact.factId),
    });

    const contextB = await assembleGenerationBundle(
      prisma,
      { conversationId, userId: fixture.userId, targetCharacterId: b! },
      stubProvider(),
    );
    metrics.privacyLeakage += countLeaks({
      forbidden: [memoryX],
      actual: contextB.context.memories.map((memory) => memory.id),
    });
    if (contextB.systemPrompt.includes(`${PREFIX}-segredo-A`)) metrics.privacyLeakage += 1;
    if (forA.map((memory) => memory.id).includes(memoryX) === false) metrics.privacyLeakage += 1;

    record("B02", metrics.privacyLeakage === 0);
    expect(metrics.privacyLeakage).toBe(0);
  });

  it("B03 restricted event isolation (contexto e oportunidade)", async () => {
    const fixture = await createUniverse({ label: "b03" });
    const [a, b] = fixture.characterIds;
    const conversationId = await createConversation([a!, b!]);
    const restrictedEvent = await createEvent({
      title: `${PREFIX}-evento-restrito`,
      visibility: "RESTRICTED",
      participantIds: [a!],
    });

    const forA = await assembleGenerationBundle(
      prisma,
      { conversationId, userId: fixture.userId, targetCharacterId: a! },
      stubProvider(),
    );
    const forB = await assembleGenerationBundle(
      prisma,
      { conversationId, userId: fixture.userId, targetCharacterId: b! },
      stubProvider(),
    );
    metrics.privacyLeakage += countLeaks({
      forbidden: [restrictedEvent],
      actual: forB.context.events.map((event) => event.id),
    });
    if (!forA.context.events.map((event) => event.id).includes(restrictedEvent)) {
      metrics.privacyLeakage += 1;
    }

    await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    const audits = await readAudits(fixture.universeId);
    const unauthorized = audits.filter((entry) => entry.characterId !== a);
    metrics.privacyLeakage += unauthorized.length;
    if (audits.length !== 1 || audits[0]?.audit?.evidenceId !== `event:${restrictedEvent}`) {
      metrics.privacyLeakage += 1;
    }

    record("B03", metrics.privacyLeakage === 0);
    expect(metrics.privacyLeakage).toBe(0);
  });

  it("B04 conversation ACL (fora da conversa não acessa)", async () => {
    const suffix = `${PREFIX}-b04-${Date.now()}`;
    const ownerEmail = `${suffix}-owner@f1nw.test`;
    const outsiderEmail = `${suffix}-outsider@f1nw.test`;
    const ownerSignUp = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { name: "F9 Owner", email: ownerEmail, password: "senha-segura-123" },
    });
    const outsiderSignUp = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { name: "F9 Outsider", email: outsiderEmail, password: "senha-segura-123" },
    });
    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const outsiderUser = await prisma.user.findUniqueOrThrow({ where: { email: outsiderEmail } });
    createdUserIds.push(ownerUser.id, outsiderUser.id);

    const ownerUniverse = await createUniverse({
      label: "b04-owner",
      userId: ownerUser.id,
      characters: 1,
    });
    const outsiderUniverse = await createUniverse({
      label: "b04-outsider",
      userId: outsiderUser.id,
      characters: 1,
    });
    const ownerChar = ownerUniverse.characterIds[0]!;
    const outsiderChar = outsiderUniverse.characterIds[0]!;
    const conversationId = await createConversation([ownerChar]);

    const ownerCookie = (ownerSignUp.cookies ?? [])
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    const outsiderCookie = (outsiderSignUp.cookies ?? [])
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");

    const ownerRead = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}`,
      headers: { cookie: ownerCookie },
    });
    const outsiderRead = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}`,
      headers: { cookie: outsiderCookie },
    });
    const outsiderWrite = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/messages`,
      headers: { cookie: outsiderCookie },
      payload: { senderType: "USER_CHARACTER", characterId: outsiderChar, content: "x" },
    });
    const crossUniverseAdd = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/participants`,
      headers: { cookie: ownerCookie },
      payload: { characterId: outsiderChar },
    });
    if (ownerSignUp.statusCode !== 200 || outsiderSignUp.statusCode !== 200) {
      metrics.privacyLeakage += 1;
    }
    if (ownerRead.statusCode !== 200) metrics.privacyLeakage += 1;
    if (outsiderRead.statusCode !== 404) metrics.privacyLeakage += 1;
    if (outsiderWrite.statusCode < 400) metrics.unauthorizedWrites += 1;
    if (crossUniverseAdd.statusCode < 400) metrics.crossUniverse += 1;

    record("B04", metrics.privacyLeakage === 0 && metrics.unauthorizedWrites === 0);
    expect(metrics.privacyLeakage).toBe(0);
    expect(metrics.unauthorizedWrites).toBe(0);
  });

  it("B05 opportunity dedupe por evidência canônica", async () => {
    const fixture = await createUniverse({ label: "b05" });
    const [a, b] = fixture.characterIds;
    await createConversation([a!, b!]);
    const eventId = await createEvent({
      title: `${PREFIX}-dedupe`,
      visibility: "RESTRICTED",
      participantIds: [a!, b!],
    });
    await createMemory({
      content: `${PREFIX}-derived`,
      universeId: fixture.universeId,
      participantIds: [a!, b!],
      eventId,
    });
    const [characterAId, characterBId] = [a!, b!].sort();
    const relationship = await prisma.relationship.create({
      data: { characterAId, characterBId, dimensions: {} },
    });
    await prisma.relationshipChange.create({
      data: {
        relationshipId: relationship.id,
        characterAId,
        characterBId,
        dimension: "rivalry",
        previousValue: 40,
        delta: 10,
        resultingValue: 50,
        ruleCode: "f9.rule.v1",
        sourceType: "EVENT",
        sourceId: eventId,
        worldDate: SIGNAL_AT,
        createdAt: SIGNAL_AT,
        fingerprint: `${PREFIX}-b05-change`,
      },
    });

    const plan = await buildAutonomyOpportunityPlan(
      planInput(fixture.universeId, fixture.characterIds),
    );
    metrics.duplicateCanonical += countDuplicateEvidence(plan.selection.selected);
    if (plan.selection.candidateCount < 4) metrics.duplicateCanonical += 1;
    if (plan.selection.selected.length !== 1) metrics.duplicateCanonical += 1;
    if (plan.selection.selected[0]?.evidenceId !== `event:${eventId}`) {
      metrics.duplicateCanonical += 1;
    }

    record("B05", metrics.duplicateCanonical === 0);
    expect(metrics.duplicateCanonical).toBe(0);
  });

  it("B06 cooldown bloqueia e libera após horizonte", async () => {
    const fixture = await createUniverse({ label: "b06" });
    const [a] = fixture.characterIds;
    await createConversation([a!, fixture.characterIds[1]!]);
    await createGoal(fixture.universeId, a!, 60);

    await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    const firstWindow = (await readAudits(fixture.universeId)).filter(
      (entry) => entry.audit?.windowStart === WINDOW_START.toISOString(),
    );
    if (firstWindow.length !== 1) metrics.cooldownViolations += 1;

    await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_2 });
    const blocked = (await readAudits(fixture.universeId)).filter(
      (entry) => entry.audit?.windowStart === TO_1.toISOString(),
    );
    if (blocked.length !== 0) metrics.cooldownViolations += 1;

    await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_3 });
    const released = (await readAudits(fixture.universeId)).filter(
      (entry) => entry.audit?.windowStart === TO_2.toISOString(),
    );
    if (released.length !== 1) metrics.cooldownViolations += 1;

    record("B06", metrics.cooldownViolations === 0);
    expect(metrics.cooldownViolations).toBe(0);
  });

  it("B07 budget enforcement (conversas, mensagens e ações)", async () => {
    const budgets = autonomyBudgets();
    const fixture = await createUniverse({ label: "b07", mode: "FULL", characters: 4 });
    const [a, b, c, d] = fixture.characterIds;
    const firstConversation = await createConversation([a!, d!]);
    await createConversation([b!, d!]);
    await createConversation([c!, d!]);
    await prisma.message.createMany({
      data: [firstConversation].map((conversationId) => ({
        conversationId,
        senderType: "AI_CHARACTER" as const,
        characterId: d!,
        content: `${PREFIX}-seed`,
        createdAt: SIGNAL_AT,
      })),
    });
    await createGoal(fixture.universeId, a!, 60);
    await createGoal(fixture.universeId, b!, 55);
    await createGoal(fixture.universeId, c!, 50);

    const plan = await buildAutonomyOpportunityPlan(
      planInput(fixture.universeId, fixture.characterIds),
    );
    metrics.budgetViolations += countBudgetViolations(
      plan.selection.selected.length,
      budgets.maxConversationsPerTick,
    );
    const distinctConversations = new Set(
      plan.selection.selected.map((entry) => entry.opportunity.conversationId),
    );
    if (distinctConversations.size !== plan.selection.selected.length) {
      metrics.budgetViolations += 1;
    }

    const tick = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    metrics.budgetViolations += countBudgetViolations(
      tick.envelopes.length,
      budgets.maxConversationsPerTick,
    );
    metrics.budgetViolations += countBudgetViolations(
      tick.actionsExecuted,
      budgets.maxActionsPerTick,
    );
    const envelopeMessages = tick.envelopes.reduce(
      (total, envelope) => total + envelope.messageIds.length,
      0,
    );
    metrics.budgetViolations += countBudgetViolations(envelopeMessages, budgets.maxMessagesPerTick);
    metrics.postStopMessages += tick.envelopes
      .filter((envelope) => !envelope.executed)
      .reduce((total, envelope) => total + envelope.messageIds.length, 0);

    record("B07", metrics.budgetViolations === 0 && metrics.postStopMessages === 0);
    expect(metrics.budgetViolations).toBe(0);
    expect(metrics.postStopMessages).toBe(0);
  });

  it("B08 AI↔AI inicia, respeita stop e não estoura profundidade", async () => {
    const budgets = autonomyBudgets();
    const fixture = await createUniverse({ label: "b08", mode: "FULL" });
    const [a, b] = fixture.characterIds;
    const conversationId = await createConversation([a!, b!]);
    await createGoal(fixture.universeId, a!, 70);

    const tick = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    const envelope = tick.envelopes[0];
    if (!envelope || !envelope.executed) {
      metrics.postStopMessages += 1;
    } else {
      metrics.budgetViolations += countBudgetViolations(envelope.depth, budgets.maxMessagesPerTick);
      if (envelope.stopReason.length === 0) metrics.postStopMessages += 1;
    }
    const messages = await prisma.message.findMany({
      where: { conversationId },
      select: { senderType: true, characterId: true },
    });
    if (messages.some((message) => message.senderType !== "AI_CHARACTER")) {
      metrics.privacyLeakage += 1;
    }
    if (new Set(messages.map((message) => message.characterId)).size > fixture.characterIds.length) {
      metrics.unauthorizedWrites += 1;
    }

    record("B08", metrics.postStopMessages === 0 && metrics.unauthorizedWrites === 0);
    expect(metrics.postStopMessages).toBe(0);
    expect(metrics.unauthorizedWrites).toBe(0);
  });

  it("B09 universe isolation (evidência de A nunca em B)", async () => {
    const home = await createUniverse({ label: "b09-home" });
    const foreign = await createUniverse({ label: "b09-foreign" });
    const [a] = home.characterIds;
    await createConversation([a!, home.characterIds[1]!]);
    await createGoal(home.universeId, a!, 60);
    const foreignMemory = await createMemory({
      content: `${PREFIX}-foreign-memory`,
      universeId: foreign.universeId,
      participantIds: [a!],
    });
    const foreignEvent = await createEvent({
      title: `${PREFIX}-foreign-event`,
      visibility: "PUBLIC",
      participantIds: [foreign.characterIds[0]!],
    });

    const memories = await retrieveRelevantMemories({
      universeId: home.universeId,
      characterId: a!,
      participantIds: home.characterIds,
      worldDate: WINDOW_START,
      now: WINDOW_START,
    });
    metrics.crossUniverse += countLeaks({
      forbidden: [foreignMemory],
      actual: memories.map((memory) => memory.id),
    });

    const plan = await buildAutonomyOpportunityPlan(
      planInput(home.universeId, home.characterIds),
    );
    metrics.crossUniverse += countLeaks({
      forbidden: [`event:${foreignEvent}`],
      actual: plan.selection.selected.map((entry) => entry.evidenceId),
    });
    metrics.crossUniverse += countCrossUniverse(
      plan.selection.selected.map((entry) => entry.opportunity.universeId),
      home.universeId,
    );

    await runAutonomousTick({ universeId: home.universeId, toDate: TO_1 });
    const foreignDecisions = await prisma.aiDecision.count({
      where: { universeId: foreign.universeId },
    });
    if (foreignDecisions !== 0) metrics.crossUniverse += 1;

    record("B09", metrics.crossUniverse === 0);
    expect(metrics.crossUniverse).toBe(0);
  });

  it("B10 command layer guard (target fora da conversa)", async () => {
    const fixture = await createUniverse({ label: "b10", characters: 3 });
    const [a, b, c] = fixture.characterIds;
    const conversationId = await createConversation([a!, b!]);

    const decision = await evaluateBehaviorDecision({
      universeId: fixture.universeId,
      characterId: a!,
      trigger: "CONVERSATION_TURN_DUE",
      worldDate: SIGNAL_AT,
      conversationId,
      userInitiated: false,
      metadata: { targetCharacterId: c! },
    });
    const messagesBefore = await prisma.message.count({ where: { conversationId } });
    const execution = await executeBehaviorDecision(decision.decisionId);
    const messagesAfter = await prisma.message.count({ where: { conversationId } });
    if (execution.status === "EXECUTED") metrics.unauthorizedWrites += 1;
    if (messagesAfter !== messagesBefore) metrics.unauthorizedWrites += 1;
    if (execution.errorCode !== "TARGET_NOT_PARTICIPANT") metrics.unauthorizedWrites += 1;

    record("B10", metrics.unauthorizedWrites === 0);
    expect(metrics.unauthorizedWrites).toBe(0);
  });

  it("F9.6 regression proof: checkers detectam violações semeadas", () => {
    const seededLeak = countLeaks({ forbidden: ["mem-x"], actual: ["mem-x"] });
    const cleanLeak = countLeaks({ forbidden: ["mem-x"], actual: ["mem-y"] });
    const seededCross = countCrossUniverse(["universe-b"], "universe-a");
    const seededDuplicate = countDuplicateEvidence([
      { evidenceId: "event:1" },
      { evidenceId: "event:1" },
    ]);
    const seededBudget = countBudgetViolations(3, 2);
    expect(seededLeak).toBeGreaterThan(0);
    expect(cleanLeak).toBe(0);
    expect(seededCross).toBeGreaterThan(0);
    expect(seededDuplicate).toBeGreaterThan(0);
    expect(seededBudget).toBeGreaterThan(0);
  });

  it("F9 aggregate report", async () => {
    const decisions = await prisma.aiDecision.findMany({
      where: { universeId: { in: createdUniverseIds } },
      select: { metadata: true },
    });
    for (const decision of decisions) {
      const metadata = (decision.metadata ?? {}) as Record<string, unknown>;
      if (metadata.llmUsed !== false) metrics.llmCalls += 1;
    }

    const lines: string[] = ["", "Dialogue Engine F9 Benchmark Gate", ""];
    for (const scenario of SCENARIOS) {
      const ok = results.get(scenario.id) === true;
      lines.push(
        `${scenario.id} ${scenario.title.padEnd(32, " ")} ${ok ? "PASS" : "FAIL"}`,
      );
    }
    lines.push("");
    lines.push(`Determinism:                    ${metrics.replayDivergence === 0 ? "PASS" : "FAIL"}`);
    lines.push(`Privacy leakage:                ${metrics.privacyLeakage}`);
    lines.push(`Unauthorized writes:            ${metrics.unauthorizedWrites}`);
    lines.push(`Cross-universe violations:      ${metrics.crossUniverse}`);
    lines.push(`Duplicate canonical evidence:   ${metrics.duplicateCanonical}`);
    lines.push(`Cooldown violations:            ${metrics.cooldownViolations}`);
    lines.push(`Budget violations:              ${metrics.budgetViolations}`);
    lines.push(`Messages after stop:            ${metrics.postStopMessages}`);
    lines.push(`LLM calls (deterministic path): ${metrics.llmCalls}`);
    lines.push("");
    const allPassed =
      SCENARIOS.every((scenario) => results.get(scenario.id) === true) &&
      metrics.replayDivergence === 0 &&
      metrics.privacyLeakage === 0 &&
      metrics.unauthorizedWrites === 0 &&
      metrics.crossUniverse === 0 &&
      metrics.duplicateCanonical === 0 &&
      metrics.cooldownViolations === 0 &&
      metrics.budgetViolations === 0 &&
      metrics.postStopMessages === 0 &&
      metrics.llmCalls === 0;
    lines.push(`F9 BENCHMARK GATE: ${allPassed ? "PASS" : "FAIL"}`);
    lines.push("");
    console.log(lines.join("\n"));

    expect(allPassed).toBe(true);
  });
});
