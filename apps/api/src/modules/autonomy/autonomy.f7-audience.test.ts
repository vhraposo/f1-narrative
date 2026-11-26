import { afterAll, describe, expect, it } from "vitest";
import type { EventImportance, EventVisibility } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import {
  buildAutonomyOpportunityPlan,
  readConversationOpportunityAudit,
} from "./autonomy.opportunities.js";
import { runAutonomousTick } from "./autonomy.service.js";

// F7.4 — audiência no F6 (oportunidades/envelopes) em TEST DB.
// Verifica que evidência restrita (Event/Memory/RelationshipChange derivados)
// só gera oportunidade para o speaker autorizado, sem alterar contratos F6.

const PREFIX = "autonomy-audience";
const WINDOW_START = new Date("2026-10-01T00:00:00.000Z");
const SIGNAL_AT = new Date("2026-10-01T12:00:00.000Z");
const TO_1 = new Date("2026-10-02T00:00:00.000Z");

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
  readonly conversations: ReadonlyArray<readonly [number, number]>;
  readonly messages?: ReadonlyArray<{
    readonly conversation: number;
    readonly sender: number;
    readonly content?: string;
  }>;
  readonly events?: ReadonlyArray<{
    readonly participants: readonly number[];
    readonly importance?: EventImportance;
    readonly visibility?: EventVisibility;
    readonly worldDate?: Date;
  }>;
  readonly memories?: ReadonlyArray<{
    readonly participants: readonly number[];
    readonly universeId?: string | null;
  }>;
  readonly relationshipChanges?: ReadonlyArray<{
    readonly pair: readonly [number, number];
    readonly sourceType?: string;
    readonly sourceId?: string;
    readonly delta?: number;
  }>;
};

type Fixture = {
  readonly universeId: string;
  readonly userId: string;
  readonly characterIds: readonly string[];
  readonly conversationIds: readonly string[];
  readonly eventIds: readonly string[];
  readonly memoryIds: readonly string[];
};

async function createFixture(options: FixtureOptions): Promise<Fixture> {
  counter += 1;
  const tag = `${PREFIX}-${options.label}-${counter}-${Date.now()}`;
  const user = await prisma.user.create({ data: { email: `${tag}@f1nw.test`, name: tag } });
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

  const conversationIds: string[] = [];
  for (const [left, right] of options.conversations) {
    const conversation = await prisma.conversation.create({
      data: {
        createdAt: SIGNAL_AT,
        participants: {
          create: [{ characterId: characterIds[left]! }, { characterId: characterIds[right]! }],
        },
      },
    });
    createdConversationIds.push(conversation.id);
    conversationIds.push(conversation.id);
  }

  for (const message of options.messages ?? []) {
    await prisma.message.create({
      data: {
        conversationId: conversationIds[message.conversation]!,
        senderType: "AI_CHARACTER",
        characterId: characterIds[message.sender]!,
        content: message.content ?? `${tag}-message`,
        createdAt: SIGNAL_AT,
      },
    });
  }

  const eventIds: string[] = [];
  for (const event of options.events ?? []) {
    const created = await prisma.event.create({
      data: {
        type: "SOCIAL",
        importance: event.importance ?? "HIGH",
        source: "GENERATED_EVENT",
        visibility: event.visibility ?? "PUBLIC",
        title: `${tag}-event`,
        worldDate: event.worldDate ?? SIGNAL_AT,
        participants: {
          create: event.participants.map((index) => ({ characterId: characterIds[index]! })),
        },
      },
    });
    createdEventIds.push(created.id);
    eventIds.push(created.id);
  }

  const memoryIds: string[] = [];
  for (const memory of options.memories ?? []) {
    const created = await prisma.memory.create({
      data: {
        universeId: memory.universeId === undefined ? universe.id : memory.universeId,
        importance: "HIGH",
        source: "GENERATED_EVENT",
        status: "ACTIVE",
        content: `${tag}-memory`,
        createdAt: SIGNAL_AT,
        participants: {
          create: memory.participants.map((index) => ({ characterId: characterIds[index]! })),
        },
      },
    });
    createdMemoryIds.push(created.id);
    memoryIds.push(created.id);
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
        sourceType: change.sourceType ?? "TEST",
        sourceId: change.sourceId ?? null,
        worldDate: SIGNAL_AT,
        createdAt: SIGNAL_AT,
        fingerprint: `${tag}-change-${changeIndex}`,
      },
    });
  }

  return { universeId: universe.id, userId: user.id, characterIds, conversationIds, eventIds, memoryIds };
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
  await prisma.$disconnect();
});

describe("F7.4 — F6 audience", () => {
  it("evento RESTRICTED gera oportunidade só para o participante autorizado", async () => {
    const fixture = await createFixture({
      label: "restricted-event",
      aiCharacters: 3,
      conversations: [
        [0, 1],
        [1, 2],
      ],
      events: [{ participants: [0], visibility: "RESTRICTED" }],
    });
    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.status).toBe("EXECUTED");
    const audits = await readAudits(fixture.universeId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.characterId).toBe(fixture.characterIds[0]);
    expect(audits[0]!.audit!.evidenceId).toBe(`event:${fixture.eventIds[0]}`);
  });

  it("memória privada (MemoryCharacter) gera oportunidade só para o dono", async () => {
    const fixture = await createFixture({
      label: "private-memory",
      aiCharacters: 3,
      conversations: [
        [0, 1],
        [1, 2],
      ],
      memories: [{ participants: [0] }],
    });
    await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    const audits = await readAudits(fixture.universeId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.characterId).toBe(fixture.characterIds[0]);
    expect(audits[0]!.audit!.evidenceId).toBe(`memory:${fixture.memoryIds[0]}`);
  });

  it("evento + memória/changes derivados não contornam a audiência", async () => {
    const fixture = await createFixture({
      label: "derived-evidence",
      aiCharacters: 3,
      conversations: [
        [0, 1],
        [1, 2],
      ],
      events: [{ participants: [0, 1], visibility: "RESTRICTED" }],
      memories: [{ participants: [0, 1] }],
      relationshipChanges: [{ pair: [0, 1], sourceType: "EVENT", sourceId: "placeholder" }],
    });
    // liga a memória derivada e o change ao evento restrito
    await prisma.memory.update({
      where: { id: fixture.memoryIds[0]! },
      data: { eventId: fixture.eventIds[0]! },
    });
    await prisma.relationshipChange.updateMany({
      where: {
        characterAId: { in: [fixture.characterIds[0]!, fixture.characterIds[1]!] },
        characterBId: { in: [fixture.characterIds[0]!, fixture.characterIds[1]!] },
      },
      data: { sourceId: fixture.eventIds[0]! },
    });

    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.status).toBe("EXECUTED");
    const audits = await readAudits(fixture.universeId);
    expect(audits).toHaveLength(1);
    expect([fixture.characterIds[0], fixture.characterIds[1]]).toContain(
      audits[0]!.characterId,
    );
    expect(audits.some((entry) => entry.characterId === fixture.characterIds[2])).toBe(false);
    expect(audits[0]!.audit!.evidenceId).toBe(`event:${fixture.eventIds[0]}`);
  });

  it("isolamento de Universe: memória de outro universe não gera oportunidade", async () => {
    const foreignUser = await prisma.user.create({
      data: { email: `${PREFIX}-foreign-${Date.now()}@f1nw.test`, name: `${PREFIX}-foreign` },
    });
    createdUserIds.push(foreignUser.id);
    const foreignUniverse = await prisma.universe.create({
      data: { userId: foreignUser.id },
    });
    createdUniverseIds.push(foreignUniverse.id);

    const fixture = await createFixture({
      label: "universe-isolation",
      aiCharacters: 2,
      conversations: [[0, 1]],
      memories: [{ participants: [0], universeId: foreignUniverse.id }],
    });
    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.status).toBe("EXECUTED");
    expect(await readAudits(fixture.universeId)).toHaveLength(0);
  });

  it("FULL executa envelope só do speaker autorizado", async () => {
    const fixture = await createFixture({
      label: "full-audience",
      mode: "FULL",
      aiCharacters: 3,
      conversations: [
        [0, 1],
        [1, 2],
      ],
      messages: [{ conversation: 0, sender: 1, content: "bom dia" }],
      events: [{ participants: [0], visibility: "RESTRICTED" }],
    });
    const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
    expect(result.envelopes).toHaveLength(1);
    expect(result.envelopes[0]!.characterId).toBe(fixture.characterIds[0]);
    expect(result.envelopes[0]!.conversationId).toBe(fixture.conversationIds[0]);
  });

  it("OFF/OBSERVER/GUIDED respeitam audiência sem executar envelope", async () => {
    for (const mode of ["OFF", "OBSERVER", "GUIDED"] as const) {
      const fixture = await createFixture({
        label: `mode-${mode}`,
        mode,
        aiCharacters: 2,
        conversations: [[0, 1]],
        memories: [{ participants: [0] }],
      });
      const result = await runAutonomousTick({ universeId: fixture.universeId, toDate: TO_1 });
      expect(result.envelopes).toHaveLength(0);
      const audits = await readAudits(fixture.universeId);
      if (mode === "OFF") {
        expect(result.status).toBe("SKIPPED");
        expect(audits).toHaveLength(0);
      } else {
        expect(audits).toHaveLength(1);
        expect(audits[0]!.characterId).toBe(fixture.characterIds[0]);
      }
    }
  });

  it("replay e dedupe continuam determinísticos com audiência", async () => {
    const fixture = await createFixture({
      label: "replay-dedupe",
      aiCharacters: 2,
      conversations: [[0, 1]],
      events: [{ participants: [0, 1], visibility: "RESTRICTED" }],
      memories: [{ participants: [0, 1] }],
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
    expect(first.selection.candidateCount).toBeGreaterThanOrEqual(4);
    expect(first.selection.selected).toHaveLength(1);
    expect(second.selection.selected.map((entry) => entry.evidenceId)).toEqual(
      first.selection.selected.map((entry) => entry.evidenceId),
    );
    expect(second.selection.selected.map((entry) => entry.opportunity.fingerprint)).toEqual(
      first.selection.selected.map((entry) => entry.opportunity.fingerprint),
    );
  });
});
