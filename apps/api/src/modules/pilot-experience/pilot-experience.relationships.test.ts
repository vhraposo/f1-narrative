import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import { deleteUniverseDataForUsers } from "../../test-utils/universe-cleanup.js";
import { reconcilePilotExperiences } from "./pilot-experience.reconcile.js";

const PREFIX = "px-rel";
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];

afterAll(async () => {
  await prisma.memory.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
  await prisma.pilotExperience.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
  await prisma.universeDriverRelationship.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
  await prisma.relationship.deleteMany({
    where: { characterA: { name: { startsWith: PREFIX } } },
  });
  await deleteUniverseDataForUsers(prisma, createdUserIds);
  await prisma.character.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.universe.deleteMany({ where: { id: { in: createdUniverseIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

const EMOTION_WORDS = /sentiu|traído|traida|devastado|devastada|sofreu|sofrimento|deprimid|ansied|trauma|emocionalmente destru/i;

async function createFixture(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `${PREFIX}-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@f1nw.test`,
      name: `Owner ${label}`,
    },
  });
  createdUserIds.push(user.id);
  const universe = await prisma.universe.create({ data: { userId: user.id, status: "READY" } });
  createdUniverseIds.push(universe.id);
  const character = await prisma.character.create({
    data: {
      universeId: universe.id,
      controlledBy: "AI",
      name: `${PREFIX} ${label}`,
      nationality: "BRA",
      birthDate: new Date("2000-01-01T00:00:00.000Z"),
      driverProfile: { create: { number: 7 } },
    },
  });
  const teammate = await prisma.character.create({
    data: {
      universeId: universe.id,
      controlledBy: "AI",
      name: `${PREFIX} ${label} teammate`,
      nationality: "ITA",
      birthDate: new Date("2001-01-01T00:00:00.000Z"),
      driverProfile: { create: { number: 8 } },
    },
  });
  return { user, universe, character, teammate };
}

describe("relationship experiences", () => {
  it("1) relação registrada gera experience e memory factual (sem emoção inferida)", async () => {
    const fixture = await createFixture("start");
    await prisma.universeDriverRelationship.create({
      data: {
        universeId: fixture.universe.id,
        characterId: fixture.character.id,
        kind: "TEAMMATE",
        targetType: "CHARACTER",
        targetCharacterId: fixture.teammate.id,
        displayName: fixture.teammate.name,
        state: "ACTIVE",
        validFrom: new Date("2026-01-01T00:00:00.000Z"),
        createdById: fixture.user.id,
      },
    });

    const report = await reconcilePilotExperiences({
      universeId: fixture.universe.id,
      characterId: fixture.character.id,
    });
    expect(report.experiences.created).toBeGreaterThanOrEqual(1);

    const experience = await prisma.pilotExperience.findFirstOrThrow({
      where: { characterId: fixture.character.id, experienceType: "RELATIONSHIP_EVENT" },
    });
    expect(experience.source).toBe("RELATIONSHIP");
    expect(experience.sourceKey).toContain(":started");
    const memory = await prisma.memory.findFirst({
      where: { experienceId: experience.id, status: "ACTIVE" },
    });
    expect(memory?.memoryType).toBe("RELATIONSHIP_EVENT");
    expect(memory?.importance).toBe("MEDIUM");
    expect(EMOTION_WORDS.test(memory?.content ?? "")).toBe(false);
  });

  it("2) relação encerrada gera evento de término e preserva o de início", async () => {
    const fixture = await createFixture("ended");
    const relationship = await prisma.universeDriverRelationship.create({
      data: {
        universeId: fixture.universe.id,
        characterId: fixture.character.id,
        kind: "TEAMMATE",
        targetType: "CHARACTER",
        targetCharacterId: fixture.teammate.id,
        displayName: fixture.teammate.name,
        state: "ACTIVE",
        validFrom: new Date("2025-01-01T00:00:00.000Z"),
        createdById: fixture.user.id,
      },
    });
    await reconcilePilotExperiences({
      universeId: fixture.universe.id,
      characterId: fixture.character.id,
    });

    await prisma.universeDriverRelationship.update({
      where: { id: relationship.id },
      data: { state: "ENDED", validTo: new Date("2026-06-01T00:00:00.000Z") },
    });
    const report = await reconcilePilotExperiences({
      universeId: fixture.universe.id,
      characterId: fixture.character.id,
    });
    expect(report.experiences.created).toBeGreaterThanOrEqual(1);
    const keys = (
      await prisma.pilotExperience.findMany({
        where: { characterId: fixture.character.id, experienceType: "RELATIONSHIP_EVENT" },
      })
    ).map((row) => row.sourceKey);
    expect(keys.some((key) => key.endsWith(":started"))).toBe(true);
    expect(keys.some((key) => key.endsWith(":ended"))).toBe(true);
  });

  it("3) remover a relação invalida (não deleta) experiences e memories", async () => {
    const fixture = await createFixture("removed");
    const relationship = await prisma.universeDriverRelationship.create({
      data: {
        universeId: fixture.universe.id,
        characterId: fixture.character.id,
        kind: "ROMANTIC_PARTNER",
        targetType: "PUBLIC_PERSON",
        displayName: "Pessoa Pública",
        state: "ACTIVE",
        validFrom: new Date("2024-01-01T00:00:00.000Z"),
        createdById: fixture.user.id,
      },
    });
    await reconcilePilotExperiences({
      universeId: fixture.universe.id,
      characterId: fixture.character.id,
    });
    const experience = await prisma.pilotExperience.findFirstOrThrow({
      where: { characterId: fixture.character.id, experienceType: "RELATIONSHIP_EVENT" },
    });
    const memory = await prisma.memory.findFirstOrThrow({
      where: { experienceId: experience.id, status: "ACTIVE" },
    });

    await prisma.universeDriverRelationship.delete({ where: { id: relationship.id } });
    const report = await reconcilePilotExperiences({
      universeId: fixture.universe.id,
      characterId: fixture.character.id,
    });
    expect(report.experiences.invalidated).toBeGreaterThanOrEqual(1);
    expect(report.memories.invalidated).toBeGreaterThanOrEqual(1);
    expect((await prisma.pilotExperience.findUniqueOrThrow({ where: { id: experience.id } })).status).toBe(
      "INVALIDATED",
    );
    expect((await prisma.memory.findUniqueOrThrow({ where: { id: memory.id } })).status).toBe("INVALIDATED");
  });

  it("4) reconcile não muta Relationship (dimensões) nem cria emoção", async () => {
    const fixture = await createFixture("dimensions");
    const dimensions = { affinity: 40, trust: 55, rivalry: 10 };
    const relationship = await prisma.relationship.create({
      data: {
        characterAId: fixture.character.id < fixture.teammate.id ? fixture.character.id : fixture.teammate.id,
        characterBId: fixture.character.id < fixture.teammate.id ? fixture.teammate.id : fixture.character.id,
        dimensions,
      },
    });
    await prisma.universeDriverRelationship.create({
      data: {
        universeId: fixture.universe.id,
        characterId: fixture.character.id,
        kind: "TEAMMATE",
        targetType: "CHARACTER",
        targetCharacterId: fixture.teammate.id,
        displayName: fixture.teammate.name,
        state: "ACTIVE",
        createdById: fixture.user.id,
      },
    });

    await reconcilePilotExperiences({
      universeId: fixture.universe.id,
      characterId: fixture.character.id,
    });
    const stored = await prisma.relationship.findUniqueOrThrow({ where: { id: relationship.id } });
    expect(stored.dimensions).toEqual(dimensions);
    const memories = await prisma.memory.findMany({
      where: { universeId: fixture.universe.id, derivation: { not: "MANUAL" } },
    });
    for (const memory of memories) {
      expect(EMOTION_WORDS.test(memory.content)).toBe(false);
    }
  });
});
