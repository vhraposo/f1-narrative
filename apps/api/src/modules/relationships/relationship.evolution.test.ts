import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import { applyEventEvolution, computeEventDelta } from "../events/event-evolution.js";
import {
  applyRelationshipDelta,
  relationshipChangeFingerprint,
  RelationshipEvolutionError,
} from "./relationship.evolution.js";
import { socialRuleForEvent } from "./relationship.rules.js";

const PREFIX = "relationship-evolution";
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdEventIds: string[] = [];

let universeId: string;
let characterAId: string;
let characterBId: string;
let otherUniverseCharacterId: string;

async function createCharacter(label: string, universe = universeId) {
  const character = await prisma.character.create({
    data: {
      universeId: universe,
      controlledBy: "AI",
      name: `${PREFIX}-${label}`,
      nationality: "BR",
      birthDate: new Date("1998-02-15T00:00:00.000Z"),
    },
  });
  createdCharacterIds.push(character.id);
  return character;
}

async function createEvent(input: {
  type: "SOCIAL" | "RACE_INCIDENT" | "RELATIONSHIP";
  importance: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  participantIds: string[];
  title: string;
}) {
  const event = await prisma.event.create({
    data: {
      type: input.type,
      importance: input.importance,
      title: input.title,
      source: "GENERATED_EVENT",
      worldDate: new Date("2026-10-01T00:00:00.000Z"),
      participants: { create: input.participantIds.map((characterId) => ({ characterId })) },
    },
  });
  createdEventIds.push(event.id);
  return event;
}

async function relationshipDimensions(characterA: string, characterB: string) {
  const [a, b] = [characterA, characterB].sort();
  const relationship = await prisma.relationship.findFirstOrThrow({
    where: { characterAId: a, characterBId: b },
    select: { id: true, dimensions: true },
  });
  return relationship;
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `${PREFIX}-${Date.now()}@f1nw.test`, name: "Relationship Owner" },
  });
  createdUserIds.push(user.id);
  const universe = await prisma.universe.create({ data: { userId: user.id, status: "READY" } });
  createdUniverseIds.push(universe.id);
  universeId = universe.id;

  const otherUser = await prisma.user.create({
    data: { email: `${PREFIX}-b-${Date.now()}@f1nw.test`, name: "Other Owner" },
  });
  createdUserIds.push(otherUser.id);
  const otherUniverse = await prisma.universe.create({
    data: { userId: otherUser.id, status: "READY" },
  });
  createdUniverseIds.push(otherUniverse.id);

  const a = await createCharacter("a");
  const b = await createCharacter("b");
  const other = await createCharacter("other", otherUniverse.id);
  characterAId = a.id;
  characterBId = b.id;
  otherUniverseCharacterId = other.id;
});

afterAll(async () => {
  if (createdEventIds.length > 0) {
    await prisma.relationshipChange.deleteMany({
      where: { sourceId: { in: createdEventIds } },
    });
    await prisma.memoryCharacter.deleteMany({
      where: { memory: { eventId: { in: createdEventIds } } },
    });
    await prisma.memory.deleteMany({ where: { eventId: { in: createdEventIds } } });
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
    await prisma.universe.deleteMany({ where: { id: { in: createdUniverseIds } } });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

describe("relationship social evolution (V4.3)", () => {
  it("1) regra versionada para evento SOCIAL é determinística", () => {
    const rule = socialRuleForEvent("SOCIAL", "HIGH");
    expect(rule.ruleCode).toBe("relationship-rule.support.v1");
    expect(rule.deltas).toEqual({ affinity: 15, trust: 8, rivalry: 0 });
    expect(computeEventDelta("SOCIAL", "HIGH")).toEqual(rule.deltas);
  });

  it("2) evento aplica deltas, grava histórico e é idempotente", async () => {
    const event = await createEvent({
      type: "SOCIAL",
      importance: "HIGH",
      participantIds: [characterAId, characterBId],
      title: "Apoio público",
    });

    await prisma.$transaction((tx) => applyEventEvolution(tx, event.id));
    const first = await relationshipDimensions(characterAId, characterBId);
    const firstChanges = await prisma.relationshipChange.count({
      where: { sourceType: "EVENT", sourceId: event.id },
    });
    expect(firstChanges).toBeGreaterThanOrEqual(2);
    expect((first.dimensions as Record<string, number>).affinity).toBe(15);
    expect((first.dimensions as Record<string, number>).trust).toBe(8);

    await prisma.$transaction((tx) => applyEventEvolution(tx, event.id));
    const second = await relationshipDimensions(characterAId, characterBId);
    const secondChanges = await prisma.relationshipChange.count({
      where: { sourceType: "EVENT", sourceId: event.id },
    });
    expect(second.dimensions).toEqual(first.dimensions);
    expect(secondChanges).toBe(firstChanges);
  });

  it("3) incidente reduz trust e aumenta rivalry", async () => {
    const event = await createEvent({
      type: "RACE_INCIDENT",
      importance: "MEDIUM",
      participantIds: [characterAId, characterBId],
      title: "Colisão",
    });
    await prisma.$transaction((tx) => applyEventEvolution(tx, event.id));
    const relationship = await relationshipDimensions(characterAId, characterBId);
    const dimensions = relationship.dimensions as Record<string, number>;
    expect(dimensions.trust).toBe(-2);
    expect(dimensions.rivalry).toBe(30);
  });

  it("4) clamping respeita os limites da dimensão", async () => {
    const [a, b] = [characterAId, characterBId].sort();
    await prisma.relationship.updateMany({
      where: { characterAId: a, characterBId: b },
      data: { dimensions: { affinity: 98, trust: -98, rivalry: 0 } },
    });
    const result = await applyRelationshipDelta({
      characterAId,
      characterBId,
      deltas: { affinity: 10, trust: -10 },
      ruleCode: "relationship-rule.test-clamp.v1",
      sourceType: "TEST",
      sourceId: "clamp-test",
      worldDate: new Date("2026-10-01T00:00:00.000Z"),
    });
    expect([...result.applied].sort()).toEqual(["affinity", "trust"]);
    const relationship = await relationshipDimensions(characterAId, characterBId);
    const dimensions = relationship.dimensions as Record<string, number>;
    expect(dimensions.affinity).toBe(100);
    expect(dimensions.trust).toBe(-100);
  });

  it("5) fingerprint idempotente impede aplicação duplicada", async () => {
    const fingerprint = relationshipChangeFingerprint({
      characterAId,
      characterBId,
      dimension: "trust",
      ruleCode: "relationship-rule.test-clamp.v1",
      sourceType: "TEST",
      sourceId: "clamp-test",
    });
    const existing = await prisma.relationshipChange.findUnique({
      where: { fingerprint },
      select: { id: true },
    });
    expect(existing).not.toBeNull();

    const second = await applyRelationshipDelta({
      characterAId,
      characterBId,
      deltas: { trust: -10 },
      ruleCode: "relationship-rule.test-clamp.v1",
      sourceType: "TEST",
      sourceId: "clamp-test",
    });
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(["trust"]);
  });

  it("6) par canônico é usado no histórico", async () => {
    const [a, b] = [characterAId, characterBId].sort();
    const changes = await prisma.relationshipChange.findMany({
      where: { sourceType: "EVENT" },
      select: { characterAId: true, characterBId: true },
      take: 5,
    });
    expect(changes.length).toBeGreaterThan(0);
    for (const change of changes) {
      expect(change.characterAId).toBe(a);
      expect(change.characterBId).toBe(b);
    }
  });

  it("7) cross-universe é rejeitado no writer", async () => {
    await expect(
      applyRelationshipDelta({
        characterAId,
        characterBId: otherUniverseCharacterId,
        deltas: { trust: 5 },
        ruleCode: "relationship-rule.test.v1",
        sourceType: "TEST",
        sourceId: "cross-universe",
      }),
    ).rejects.toBeInstanceOf(RelationshipEvolutionError);
  });

  it("8) ajuste manual não é sobrescrito por dimensões sem delta", async () => {
    const [a, b] = [characterAId, characterBId].sort();
    await prisma.relationship.updateMany({
      where: { characterAId: a, characterBId: b },
      data: { dimensions: { affinity: 10, trust: 10, rivalry: 10, manualNote: 1 } },
    });
    await applyRelationshipDelta({
      characterAId,
      characterBId,
      deltas: { trust: 5 },
      ruleCode: "relationship-rule.test-manual.v1",
      sourceType: "TEST",
      sourceId: "manual-preserve",
    });
    const relationship = await relationshipDimensions(characterAId, characterBId);
    const dimensions = relationship.dimensions as Record<string, number>;
    expect(dimensions.trust).toBe(15);
    expect(dimensions.affinity).toBe(10);
    expect(dimensions.rivalry).toBe(10);
    expect(dimensions.manualNote).toBe(1);
  });
});
