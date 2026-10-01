import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import { deleteKnowledgeSourcesForDrivers } from "../../test-utils/pilot-knowledge-cleanup.js";
import {
  enrichCharacterPersonaFromEvidence,
  mapCuratedClaimToTrait,
} from "./persona.enrichment.js";
import type { BiographyClaim } from "../pilot-knowledge/biography.claims.js";

const PREFIX = "persona-enrich";
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdDriverIds: string[] = [];

afterAll(async () => {
  await deleteKnowledgeSourcesForDrivers(prisma, createdDriverIds);
  if (createdCharacterIds.length > 0) {
    await prisma.personaTrait.deleteMany({
      where: { persona: { characterId: { in: createdCharacterIds } } },
    });
    await prisma.personaEvidence.deleteMany({
      where: { persona: { characterId: { in: createdCharacterIds } } },
    });
    await prisma.characterPersona.deleteMany({
      where: { characterId: { in: createdCharacterIds } },
    });
  }
  if (createdDriverIds.length > 0) {
    await prisma.externalDriverProfile.deleteMany({
      where: { externalDriverId: { in: createdDriverIds } },
    });
    await prisma.externalDriver.deleteMany({ where: { id: { in: createdDriverIds } } });
  }
  if (createdCharacterIds.length > 0) {
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

async function createBoundCharacter(name: string) {
  const user = await prisma.user.create({
    data: {
      email: `${PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@f1nw.test`,
      name: `Owner ${name}`,
    },
  });
  createdUserIds.push(user.id);
  const universe = await prisma.universe.create({ data: { userId: user.id } });
  createdUniverseIds.push(universe.id);
  const driver = await prisma.externalDriver.create({
    data: {
      source: "f1db",
      externalId: `${PREFIX}-${Date.now()}`,
      name,
      contentHash: `hash-${name}`,
    },
  });
  createdDriverIds.push(driver.id);
  const character = await prisma.character.create({
    data: {
      universeId: universe.id,
      controlledBy: "AI",
      name,
      nationality: "GBR",
      birthDate: new Date("1998-02-15T00:00:00.000Z"),
      driverProfile: { create: {} },
    },
  });
  createdCharacterIds.push(character.id);
  await prisma.externalBindingDriver.create({
    data: { universeId: universe.id, externalDriverId: driver.id, characterId: character.id },
  });
  return character;
}

describe("persona enrichment a partir de evidence curada", () => {
  it("1) mapeia claims para traits com contexto correto", () => {
    const personality = mapCuratedClaimToTrait({
      category: "PUBLIC_PERSONALITY",
      key: "SELF_COMPETITIVENESS",
    } as BiographyClaim);
    expect(personality).toEqual({ key: "competitiveness", context: "ON_TRACK" });

    const interests = mapCuratedClaimToTrait({
      category: "INTERESTS",
      key: "SIM_RACING",
    } as BiographyClaim);
    expect(interests).toEqual({ key: "interests", context: "OFF_TRACK" });

    const projects = mapCuratedClaimToTrait({
      category: "PROJECTS",
      key: "QUADRANT",
    } as BiographyClaim);
    expect(projects).toEqual({ key: "interests", context: "OFF_TRACK" });

    const unrelated = mapCuratedClaimToTrait({
      category: "KARTING",
      key: "START_AGE",
    } as BiographyClaim);
    expect(unrelated).toBeNull();
  });

  it("2) enriquece George Russell com traits ON_TRACK e OFF_TRACK com provenance", async () => {
    const character = await createBoundCharacter("George Russell");
    const result = await enrichCharacterPersonaFromEvidence(character.id);
    expect(result).not.toBeNull();
    expect(result?.traitsByContext.onTrack).toBeGreaterThanOrEqual(1);
    expect(result?.traitsByContext.offTrack).toBeGreaterThanOrEqual(1);

    const persona = await prisma.characterPersona.findUniqueOrThrow({
      where: { characterId: character.id },
      include: { traits: true, evidences: true },
    });
    expect(persona.origin).toBe("REAL_DRIVER");
    const evidenceTraits = persona.traits.filter((trait) => trait.sourceKind === "EVIDENCE");
    expect(evidenceTraits.length).toBeGreaterThanOrEqual(2);
    expect(evidenceTraits.every((trait) => trait.evidenceId !== null)).toBe(true);
    expect(persona.evidences.every((evidence) => evidence.status === "APPROVED")).toBe(true);
    expect(persona.evidences.every((evidence) => evidence.url?.startsWith("https://"))).toBe(true);
  });

  it("3) segunda execução é idempotente e preserva override manual", async () => {
    const character = await createBoundCharacter("George Russell");
    await enrichCharacterPersonaFromEvidence(character.id);
    const persona = await prisma.characterPersona.findUniqueOrThrow({
      where: { characterId: character.id },
      select: { id: true },
    });
    const evidenceBefore = await prisma.personaEvidence.count({
      where: { personaId: persona.id },
    });

    const manualKey = await prisma.personaTrait.findFirstOrThrow({
      where: { personaId: persona.id, context: "ON_TRACK" },
      select: { key: true },
    });
    await prisma.personaTrait.update({
      where: {
        personaId_key_context: {
          personaId: persona.id,
          key: manualKey.key,
          context: "ON_TRACK",
        },
      },
      data: { sourceKind: "MANUAL", value: "Override manual do Universe" },
    });

    const second = await enrichCharacterPersonaFromEvidence(character.id);
    expect(second?.manualPreserved).toBeGreaterThanOrEqual(1);

    const evidenceAfter = await prisma.personaEvidence.count({
      where: { personaId: persona.id },
    });
    expect(evidenceAfter).toBe(evidenceBefore);

    const traitAfter = await prisma.personaTrait.findUniqueOrThrow({
      where: {
        personaId_key_context: {
          personaId: persona.id,
          key: manualKey.key,
          context: "ON_TRACK",
        },
      },
    });
    expect(traitAfter.sourceKind).toBe("MANUAL");
    expect(traitAfter.value).toBe("Override manual do Universe");
  });

  it("4) character sem binding retorna null sem criar persona", async () => {
    const user = await prisma.user.create({
      data: { email: `${PREFIX}-no-binding-${Date.now()}@f1nw.test`, name: "Sem Binding" },
    });
    createdUserIds.push(user.id);
    const universe = await prisma.universe.create({ data: { userId: user.id } });
    createdUniverseIds.push(universe.id);
    const character = await prisma.character.create({
      data: {
        universeId: universe.id,
        controlledBy: "AI",
        name: "Sem Vínculo",
        nationality: "BRA",
        birthDate: new Date("2000-01-01T00:00:00.000Z"),
      },
    });
    createdCharacterIds.push(character.id);

    const result = await enrichCharacterPersonaFromEvidence(character.id);
    expect(result).toBeNull();
    expect(
      await prisma.characterPersona.count({ where: { characterId: character.id } }),
    ).toBe(0);
  });
});
