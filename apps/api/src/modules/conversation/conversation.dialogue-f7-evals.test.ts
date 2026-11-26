import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { EventVisibility } from "@prisma/client";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { retrieveRelevantMemories } from "../memory/memory.retrieval.js";
import { buildDialogueKnowledgeContext } from "./conversation.dialogue-context.js";
import { assembleGenerationBundle, type GenerationProvider } from "../generation/generation.assembly.js";
import { buildAutonomyOpportunityPlan, readConversationOpportunityAudit } from "../autonomy/autonomy.opportunities.js";
import { runAutonomousTick } from "../autonomy/autonomy.service.js";
import { evaluateBehaviorDecision } from "../behavior/behavior.decision.js";
import { executeBehaviorDecision } from "../behavior/behavior.execution.js";

// F7.6 — evals F7-E01..E20 (TEST DB, determinístico, cleanup completo).

const PREFIX = "privacy-f7-evals";
const WINDOW_START = new Date("2026-10-01T00:00:00.000Z");
const SIGNAL_AT = new Date("2026-10-01T12:00:00.000Z");
const TO_1 = new Date("2026-10-02T00:00:00.000Z");

let app: FastifyInstance;

type TestUser = { cookie: string; userId: string };

const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];
const createdEventIds: string[] = [];
const createdMemoryIds: string[] = [];

let owner: TestUser;
let outsider: TestUser;
let ownerUniverseId: string;
let outsiderUniverseId: string;
let characterAId: string;
let characterBId: string;
let characterCId: string;
let outsiderCharacterId: string;
let conversationAbId: string;
let memoryAId: string;
let memoryForeignKeyId: string;
let publicEventId: string;
let restrictedEventId: string;

function stubProvider(): GenerationProvider {
  return {
    name: "stub-f7-evals",
    async run() {
      return {
        provider: "stub-f7-evals",
        mode: "generated" as const,
        text: "ok",
        tokenStats: { systemPromptChars: 0, contextBlocks: 0 },
      };
    },
  };
}

async function signUp(label: string): Promise<TestUser> {
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
  createdUniverseIds.push(universe.id);
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

async function createConversation(participantIds: string[], createdAt = SIGNAL_AT): Promise<string> {
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
  content: string;
  universeId: string | null;
  participantIds: string[];
  eventId?: string;
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
      participants: { create: input.participantIds.map((characterId) => ({ characterId })) },
    },
  });
  createdMemoryIds.push(memory.id);
  return memory.id;
}

async function createEvent(input: {
  title: string;
  visibility: EventVisibility;
  participantIds: string[];
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

type TickUniverse = {
  universeId: string;
  userId: string;
  characterIds: string[];
  conversationId: string;
  eventId: string;
  memoryId: string;
};

async function createTickUniverse(input: {
  label: string;
  eventVisibility: EventVisibility;
  eventParticipants: readonly number[];
  memoryParticipants?: readonly number[];
  withDerivedChange?: boolean;
  conversationPairs?: ReadonlyArray<readonly [number, number]>;
  characterCount?: number;
}): Promise<TickUniverse> {
  const user = await signUp(`tick-${input.label}`);
  const universe = await prisma.universe.upsert({
    where: { userId: user.userId },
    update: { autonomyMode: "GUIDED", autonomyStatus: "ACTIVE" },
    create: { userId: user.userId, autonomyMode: "GUIDED", autonomyStatus: "ACTIVE" },
  });
  createdUniverseIds.push(universe.id);
  await prisma.worldState.create({
    data: { universeId: universe.id, key: "default", currentDate: WINDOW_START },
  });
  const characterIds: string[] = [];
  for (let index = 0; index < (input.characterCount ?? 3); index += 1) {
    characterIds.push(await createAiCharacter(user.userId, universe.id, `${PREFIX}-${input.label}-${index}`));
  }
  const pairs = input.conversationPairs ?? [[0, 1] as const, [1, 2] as const];
  const conversationId = await createConversation(pairs[0]!.map((i) => characterIds[i]!));
  for (const pair of pairs.slice(1)) {
    await createConversation(pair.map((i) => characterIds[i]!));
  }
  const eventId = await createEvent({
    title: `${PREFIX}-${input.label}-event`,
    visibility: input.eventVisibility,
    participantIds: input.eventParticipants.map((i) => characterIds[i]!),
  });
  const memoryId = await createMemory({
    content: `${PREFIX}-${input.label}-memory`,
    universeId: universe.id,
    participantIds: (input.memoryParticipants ?? input.eventParticipants).map(
      (i) => characterIds[i]!,
    ),
    ...(input.eventVisibility === "RESTRICTED" ? { eventId } : {}),
  });
  if (input.withDerivedChange) {
    const [left, right] = input.eventParticipants;
    const [characterAId, characterBId] = [characterIds[left!]!, characterIds[right!]!].sort();
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
        ruleCode: "test.rule.v1",
        sourceType: "EVENT",
        sourceId: eventId,
        worldDate: SIGNAL_AT,
        createdAt: SIGNAL_AT,
        fingerprint: `${PREFIX}-${input.label}-change`,
      },
    });
  }
  return { universeId: universe.id, userId: user.userId, characterIds, conversationId, eventId, memoryId };
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  owner = await signUp("owner");
  outsider = await signUp("outsider");
  ownerUniverseId = await ensureUniverse(owner.userId);
  outsiderUniverseId = await ensureUniverse(outsider.userId);

  characterAId = await createAiCharacter(owner.userId, ownerUniverseId, `${PREFIX}-a`);
  characterBId = await createAiCharacter(owner.userId, ownerUniverseId, `${PREFIX}-b`);
  characterCId = await createAiCharacter(owner.userId, ownerUniverseId, `${PREFIX}-c`);
  outsiderCharacterId = await createAiCharacter(outsider.userId, outsiderUniverseId, `${PREFIX}-d`);
  conversationAbId = await createConversation([characterAId, characterBId]);

  memoryAId = await createMemory({
    content: "segredo-A",
    universeId: ownerUniverseId,
    participantIds: [characterAId],
  });
  await createMemory({
    content: "segredo-B",
    universeId: ownerUniverseId,
    participantIds: [characterBId],
  });
  memoryForeignKeyId = await createMemory({
    content: "segredo-foreign",
    universeId: outsiderUniverseId,
    participantIds: [characterAId],
  });
  publicEventId = await createEvent({
    title: `${PREFIX}-public`,
    visibility: "PUBLIC",
    participantIds: [characterAId],
  });
  restrictedEventId = await createEvent({
    title: `${PREFIX}-restricted`,
    visibility: "RESTRICTED",
    participantIds: [characterAId],
  });
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

describe("F7.6 — evals F7", () => {
  it("F7-E01 Conversation PRIVATE autorizada", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationAbId}`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it("F7-E02 Conversation PRIVATE não autorizada", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationAbId}`,
      headers: { cookie: outsider.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("F7-E03 cross-universe participant rejeitado", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/conversations",
      headers: { cookie: owner.cookie },
      payload: { type: "GROUP", participantIds: [characterAId, outsiderCharacterId] },
    });
    expect(res.statusCode).toBe(404);
  });

  it("F7-E04 UNIVERSE permanece fail-closed", async () => {
    await prisma.conversation.update({
      where: { id: conversationAbId },
      data: { visibility: "UNIVERSE" },
    });
    const outsiderRead = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationAbId}`,
      headers: { cookie: outsider.cookie },
    });
    expect(outsiderRead.statusCode).toBe(404);
    const ownerRead = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationAbId}`,
      headers: { cookie: owner.cookie },
    });
    expect(ownerRead.statusCode).toBe(200);
    await prisma.conversation.update({
      where: { id: conversationAbId },
      data: { visibility: "PRIVATE" },
    });
  });

  it("F7-E05 MemoryCharacter autoriza A", async () => {
    const memories = await retrieveRelevantMemories({
      universeId: ownerUniverseId,
      characterId: characterAId,
      participantIds: [characterAId, characterBId],
      worldDate: WINDOW_START,
      now: WINDOW_START,
    });
    expect(memories.map((memory) => memory.id)).toContain(memoryAId);
  });

  it("F7-E06 memória privada de A não aparece para B", async () => {
    const memories = await retrieveRelevantMemories({
      universeId: ownerUniverseId,
      characterId: characterBId,
      participantIds: [characterAId, characterBId],
      worldDate: WINDOW_START,
      now: WINDOW_START,
    });
    expect(memories.map((memory) => memory.id)).not.toContain(memoryAId);
  });

  it("F7-E07 contexto legado não vaza memória de A para B", async () => {
    const forB = await assembleGenerationBundle(
      prisma,
      { conversationId: conversationAbId, userId: owner.userId, targetCharacterId: characterBId },
      stubProvider(),
    );
    expect(forB.context.memories.map((memory) => memory.id)).not.toContain(memoryAId);
    expect(forB.systemPrompt).not.toContain("segredo-A");
  });

  it("F7-E08 knownFacts não vaza conhecimento privado", async () => {
    const forA = await retrieveRelevantMemories({
      universeId: ownerUniverseId,
      characterId: characterAId,
      participantIds: [characterAId, characterBId],
      worldDate: WINDOW_START,
      now: WINDOW_START,
    });
    const forB = await retrieveRelevantMemories({
      universeId: ownerUniverseId,
      characterId: characterBId,
      participantIds: [characterAId, characterBId],
      worldDate: WINDOW_START,
      now: WINDOW_START,
    });
    const facts = (memories: typeof forA) =>
      buildDialogueKnowledgeContext({
        universeId: ownerUniverseId,
        memories: memories.map((memory) => ({
          id: memory.id,
          summary: memory.summary,
          content: memory.content,
          importance: memory.importance,
          universeId: ownerUniverseId,
        })),
      }).knownFacts.map((fact) => fact.factId);
    expect(facts(forA)).toContain(memoryAId);
    expect(facts(forB)).not.toContain(memoryAId);
  });

  it("F7-E09 PUBLIC Event continua funcionando", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/events/${publicEventId}`,
      headers: { cookie: outsider.cookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it("F7-E10 RESTRICTED Event respeita EventCharacter", async () => {
    const ownerRead = await app.inject({
      method: "GET",
      url: `/api/events/${restrictedEventId}`,
      headers: { cookie: owner.cookie },
    });
    expect(ownerRead.statusCode).toBe(200);
    const outsiderRead = await app.inject({
      method: "GET",
      url: `/api/events/${restrictedEventId}`,
      headers: { cookie: outsider.cookie },
    });
    expect(outsiderRead.statusCode).toBe(404);
  });

  it("F7-E11 Restricted Event não aparece no contexto de speaker não autorizado", async () => {
    const forA = await assembleGenerationBundle(
      prisma,
      { conversationId: conversationAbId, userId: owner.userId, targetCharacterId: characterAId },
      stubProvider(),
    );
    const forB = await assembleGenerationBundle(
      prisma,
      { conversationId: conversationAbId, userId: owner.userId, targetCharacterId: characterBId },
      stubProvider(),
    );
    expect(forA.context.events.map((event) => event.id)).toContain(restrictedEventId);
    expect(forB.context.events.map((event) => event.id)).not.toContain(restrictedEventId);
    expect(forB.systemPrompt).not.toContain(`${PREFIX}-restricted`);
  });

  it("F7-E12 Restricted Event não gera opportunity para não autorizado", async () => {
    const universe = await createTickUniverse({
      label: "e12",
      eventVisibility: "RESTRICTED",
      eventParticipants: [0],
    });
    await runAutonomousTick({ universeId: universe.universeId, toDate: TO_1 });
    const decisions = await prisma.aiDecision.findMany({
      where: { universeId: universe.universeId },
      select: { characterId: true, metadata: true },
    });
    const audits = decisions
      .map((decision) => ({
        characterId: decision.characterId,
        audit: readConversationOpportunityAudit(decision.metadata),
      }))
      .filter((entry) => entry.audit !== null);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.characterId).toBe(universe.characterIds[0]);
  });

  it("F7-E13 memória derivada não contorna audiência", async () => {
    const universe = await createTickUniverse({
      label: "e13",
      eventVisibility: "RESTRICTED",
      eventParticipants: [0, 1],
      memoryParticipants: [0, 1],
    });
    await runAutonomousTick({ universeId: universe.universeId, toDate: TO_1 });
    const decisions = await prisma.aiDecision.findMany({
      where: { universeId: universe.universeId },
      select: { characterId: true, metadata: true },
    });
    const audits = decisions
      .map((decision) => ({
        characterId: decision.characterId,
        audit: readConversationOpportunityAudit(decision.metadata),
      }))
      .filter((entry) => entry.audit !== null);
    expect(audits).toHaveLength(1);
    expect([universe.characterIds[0], universe.characterIds[1]]).toContain(
      audits[0]!.characterId,
    );
    expect(audits[0]!.audit!.evidenceId).toBe(`event:${universe.eventId}`);
  });

  it("F7-E14 RelationshipChange derivado não contorna audiência", async () => {
    const universe = await createTickUniverse({
      label: "e14",
      eventVisibility: "RESTRICTED",
      eventParticipants: [0, 1],
      memoryParticipants: [0],
      withDerivedChange: true,
    });
    await runAutonomousTick({ universeId: universe.universeId, toDate: TO_1 });
    const decisions = await prisma.aiDecision.findMany({
      where: { universeId: universe.universeId },
      select: { metadata: true },
    });
    const evidence = decisions
      .map((decision) => readConversationOpportunityAudit(decision.metadata)?.evidenceId)
      .filter((value): value is string => typeof value === "string");
    expect(evidence).toContain(`event:${universe.eventId}`);
    expect(evidence.every((value) => value === `event:${universe.eventId}`)).toBe(true);
  });

  it("F7-E15 speaker autorizado recebe opportunity normalmente", async () => {
    const universe = await createTickUniverse({
      label: "e15",
      eventVisibility: "PUBLIC",
      eventParticipants: [0],
    });
    await runAutonomousTick({ universeId: universe.universeId, toDate: TO_1 });
    const audits = (
      await prisma.aiDecision.findMany({
        where: { universeId: universe.universeId },
        select: { characterId: true, metadata: true },
      })
    )
      .map((decision) => ({
        characterId: decision.characterId,
        audit: readConversationOpportunityAudit(decision.metadata),
      }))
      .filter((entry) => entry.audit !== null);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.characterId).toBe(universe.characterIds[0]);
  });

  it("F7-E16 Command Layer rejeita speaker inválido (API)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationAbId}/messages`,
      headers: { cookie: owner.cookie },
      payload: { senderType: "AI_CHARACTER", characterId: characterCId, content: "oi" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("F7-E17 Command Layer rejeita target inválido", async () => {
    const decision = await evaluateBehaviorDecision({
      universeId: ownerUniverseId,
      characterId: characterAId,
      trigger: "CONVERSATION_TURN_DUE",
      worldDate: SIGNAL_AT,
      conversationId: conversationAbId,
      userInitiated: false,
      metadata: { targetCharacterId: characterCId },
    });
    const execution = await executeBehaviorDecision(decision.decisionId);
    expect(execution.status).toBe("REJECTED");
    expect(execution.errorCode).toBe("TARGET_NOT_PARTICIPANT");
  });

  it("F7-E18 bypass direto não cria Message", async () => {
    const before = await prisma.message.count({ where: { conversationId: conversationAbId } });
    const target = randomUUID();
    const decision = await evaluateBehaviorDecision({
      universeId: ownerUniverseId,
      characterId: characterAId,
      trigger: "CONVERSATION_TURN_DUE",
      worldDate: SIGNAL_AT,
      conversationId: conversationAbId,
      userInitiated: false,
      metadata: { targetCharacterId: target },
    });
    const execution = await executeBehaviorDecision(decision.decisionId);
    expect(execution.status).toBe("REJECTED");
    expect(
      await prisma.message.count({ where: { conversationId: conversationAbId } }),
    ).toBe(before);
  });

  it("F7-E19 Universe A não vaza para B", async () => {
    const memories = await retrieveRelevantMemories({
      universeId: ownerUniverseId,
      characterId: characterAId,
      participantIds: [characterAId, characterBId],
      worldDate: WINDOW_START,
      now: WINDOW_START,
    });
    expect(memories.map((memory) => memory.id)).not.toContain(memoryForeignKeyId);
    const outsiderRead = await app.inject({
      method: "GET",
      url: `/api/memories/${memoryAId}`,
      headers: { cookie: outsider.cookie },
    });
    expect(outsiderRead.statusCode).toBe(404);
  });

  it("F7-E20 replay determinístico do plano", async () => {
    const universe = await createTickUniverse({
      label: "e20",
      eventVisibility: "RESTRICTED",
      eventParticipants: [0, 1],
      memoryParticipants: [0, 1],
    });
    const input = {
      universeId: universe.universeId,
      fromDate: WINDOW_START,
      toDate: TO_1,
      characterIds: universe.characterIds,
      maxConversations: 2,
      cooldownHours: 24,
    };
    const first = await buildAutonomyOpportunityPlan(input);
    const second = await buildAutonomyOpportunityPlan(input);
    expect(first.selection.selected).toHaveLength(1);
    expect(second.selection.selected.map((entry) => entry.opportunity.fingerprint)).toEqual(
      first.selection.selected.map((entry) => entry.opportunity.fingerprint),
    );
    expect(second.selection.selected.map((entry) => entry.evidenceId)).toEqual(
      first.selection.selected.map((entry) => entry.evidenceId),
    );
  });
});
