import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import { deleteKnowledgeSourcesForDrivers } from "../../test-utils/pilot-knowledge-cleanup.js";
import {
  enrichCharacterPersonaFromEvidence,
  mapCuratedClaimToTrait,
} from "./persona.enrichment.js";
import { getCuratedEvidenceDataset } from "../pilot-knowledge/biography.evidence.js";
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

async function createBoundCharacter(name: string, universe?: { id: string }) {
  let universeId = universe?.id;
  if (!universeId) {
    const user = await prisma.user.create({
      data: {
        email: `${PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@f1nw.test`,
        name: `Owner ${name}`,
      },
    });
    createdUserIds.push(user.id);
    const createdUniverse = await prisma.universe.create({ data: { userId: user.id } });
    createdUniverseIds.push(createdUniverse.id);
    universeId = createdUniverse.id;
  }
  const driver = await prisma.externalDriver.create({
    data: {
      source: "f1db",
      externalId: `${PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      contentHash: `hash-${name}`,
    },
  });
  createdDriverIds.push(driver.id);
  const character = await prisma.character.create({
    data: {
      universeId,
      controlledBy: "AI",
      name,
      nationality: "GBR",
      birthDate: new Date("1998-02-15T00:00:00.000Z"),
      driverProfile: { create: {} },
    },
  });
  createdCharacterIds.push(character.id);
  await prisma.externalBindingDriver.create({
    data: { universeId, externalDriverId: driver.id, characterId: character.id },
  });
  return { character, driver };
}

function claimFrom(
  category: string,
  key: string,
  context: "ON_TRACK" | "OFF_TRACK" | null,
): BiographyClaim {
  return { category, key, context } as BiographyClaim;
}

function georgeInterestDisplays(): string[] {
  const bundle = getCuratedEvidenceDataset()?.drivers.get("george-russell");
  return (bundle?.claims ?? [])
    .filter((claim) => claim.category === "INTERESTS" || claim.category === "PROJECTS")
    .map((claim) => claim.display);
}

describe("mapeamento de claims para traits", () => {
  it("1) PUBLIC_PERSONALITY com contexto mapeia para trait", () => {
    expect(mapCuratedClaimToTrait(claimFrom("PUBLIC_PERSONALITY", "COMPETITIVE_STANCE", "ON_TRACK")))
      .toEqual({ key: "competitiveness", context: "ON_TRACK" });
    expect(mapCuratedClaimToTrait(claimFrom("PUBLIC_PERSONALITY", "FINNISH_MENTALITY", "OFF_TRACK")))
      .toEqual({ key: "emotionalExpression", context: "OFF_TRACK" });
    expect(mapCuratedClaimToTrait(claimFrom("PUBLIC_PERSONALITY", "CALM", "ON_TRACK")))
      .toEqual({ key: "emotionalExpression", context: "ON_TRACK" });
  });

  it("2) INTERESTS e PROJECTS nunca viram trait", () => {
    expect(mapCuratedClaimToTrait(claimFrom("INTERESTS", "GOLF", null))).toBeNull();
    expect(mapCuratedClaimToTrait(claimFrom("PROJECTS", "QUADRANT", null))).toBeNull();
  });

  it("3) PUBLIC_PERSONALITY sem contexto não vira trait", () => {
    expect(mapCuratedClaimToTrait(claimFrom("PUBLIC_PERSONALITY", "NICKNAME", null))).toBeNull();
  });
});

describe("enrichment semântico", () => {
  it("4) só traits PUBLIC_PERSONALITY, sem interests/projects, com provenance", async () => {
    const { character } = await createBoundCharacter("George Russell");
    const result = await enrichCharacterPersonaFromEvidence(character.id);
    expect(result).not.toBeNull();
    expect(result?.traitsByContext.onTrack).toBeGreaterThanOrEqual(1);
    expect(result?.traitsByContext.offTrack).toBe(0);

    const persona = await prisma.characterPersona.findUniqueOrThrow({
      where: { characterId: character.id },
      include: { traits: true, evidences: true },
    });
    expect(persona.origin).toBe("REAL_DRIVER");
    expect(persona.traits.every((trait) => trait.key !== "interests")).toBe(true);
    expect(persona.traits.every((trait) => trait.sourceKind === "EVIDENCE")).toBe(true);
    expect(persona.traits.every((trait) => trait.evidenceId !== null)).toBe(true);
    expect(persona.evidences.every((evidence) => evidence.status === "APPROVED")).toBe(true);
    expect(persona.evidences.every((evidence) => evidence.url?.startsWith("https://"))).toBe(true);
  });

  it("5) idempotente: duas execuções produzem o mesmo estado", async () => {
    const { character } = await createBoundCharacter("George Russell");
    await enrichCharacterPersonaFromEvidence(character.id);
    const persona = await prisma.characterPersona.findUniqueOrThrow({
      where: { characterId: character.id },
      select: { id: true },
    });
    const before = {
      traits: await prisma.personaTrait.count({ where: { personaId: persona.id } }),
      evidences: await prisma.personaEvidence.count({ where: { personaId: persona.id } }),
    };
    const second = await enrichCharacterPersonaFromEvidence(character.id);
    expect(second?.traitsCreated).toBe(0);
    expect(second?.evidenceCreated).toBe(0);
    const after = {
      traits: await prisma.personaTrait.count({ where: { personaId: persona.id } }),
      evidences: await prisma.personaEvidence.count({ where: { personaId: persona.id } }),
    };
    expect(after).toEqual(before);
  });

  it("6) remove traits EVIDENCE derivados de INTERESTS e preserva MANUAL", async () => {
    const { character } = await createBoundCharacter("George Russell");
    await enrichCharacterPersonaFromEvidence(character.id);
    const persona = await prisma.characterPersona.findUniqueOrThrow({
      where: { characterId: character.id },
      select: { id: true },
    });

    const displays = georgeInterestDisplays();
    expect(displays.length).toBeGreaterThan(0);
    const interestEvidence = await prisma.personaEvidence.create({
      data: {
        personaId: persona.id,
        traitKey: "interests",
        proposedValue: "golf",
        sourceType: "OFFICIAL_PROFILE",
        title: "Perfil oficial",
        url: "https://www.formula1.com/en/drivers/george-russell",
        excerpt: displays[0] as string,
        confidence: 0.6,
        status: "APPROVED",
      },
      select: { id: true },
    });
    await prisma.personaTrait.create({
      data: {
        personaId: persona.id,
        key: "interests",
        value: displays[0] as string,
        confidence: 0.6,
        sourceKind: "EVIDENCE",
        context: "OFF_TRACK",
        evidenceId: interestEvidence.id,
      },
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
      data: { sourceKind: "MANUAL", value: "Override manual" },
    });

    const result = await enrichCharacterPersonaFromEvidence(character.id);
    expect(result?.traitsRemoved).toBeGreaterThanOrEqual(1);
    expect(result?.evidenceRemoved).toBeGreaterThanOrEqual(1);
    expect(result?.manualPreserved).toBeGreaterThanOrEqual(1);

    const remaining = await prisma.personaTrait.findMany({ where: { personaId: persona.id } });
    expect(remaining.some((trait) => trait.key === "interests")).toBe(false);
    const manual = remaining.find((trait) => trait.key === manualKey.key);
    expect(manual?.sourceKind).toBe("MANUAL");
    expect(manual?.value).toBe("Override manual");
    expect(
      await prisma.personaEvidence.count({ where: { id: interestEvidence.id } }),
    ).toBe(0);
  });

  it("7) trait EVIDENCE sem claim PUBLIC_PERSONALITY correspondente é removido", async () => {
    const { character } = await createBoundCharacter("George Russell");
    await enrichCharacterPersonaFromEvidence(character.id);
    const persona = await prisma.characterPersona.findUniqueOrThrow({
      where: { characterId: character.id },
      select: { id: true },
    });
    const staleEvidence = await prisma.personaEvidence.create({
      data: {
        personaId: persona.id,
        traitKey: "humor",
        proposedValue: "sarcastico",
        sourceType: "INTERVIEW",
        title: "Entrevista",
        url: "https://example.com/entrevista",
        excerpt: "frase que não corresponde a nenhum claim curado atual",
        confidence: 0.6,
        status: "APPROVED",
      },
      select: { id: true },
    });
    await prisma.personaTrait.create({
      data: {
        personaId: persona.id,
        key: "humor",
        value: "sarcastico",
        confidence: 0.6,
        sourceKind: "EVIDENCE",
        context: "ON_TRACK",
        evidenceId: staleEvidence.id,
      },
    });

    const result = await enrichCharacterPersonaFromEvidence(character.id);
    expect(result?.traitsRemoved).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.personaTrait.count({
        where: { personaId: persona.id, key: "humor", context: "ON_TRACK" },
      }),
    ).toBe(0);
  });

  it("8) cross-universe: mesmo piloto externo mantém personas independentes por universo", async () => {
    const { character: charA, driver } = await createBoundCharacter("George Russell");
    await enrichCharacterPersonaFromEvidence(charA.id);
    const personaA = await prisma.characterPersona.findUniqueOrThrow({
      where: { characterId: charA.id },
      select: { id: true },
    });

    const user = await prisma.user.create({
      data: { email: `${PREFIX}-other-${Date.now()}@f1nw.test`, name: "Outro Owner" },
    });
    createdUserIds.push(user.id);
    const otherUniverse = await prisma.universe.create({ data: { userId: user.id } });
    createdUniverseIds.push(otherUniverse.id);
    const charB = await prisma.character.create({
      data: {
        universeId: otherUniverse.id,
        controlledBy: "AI",
        name: "George Russell",
        nationality: "GBR",
        birthDate: new Date("1998-02-15T00:00:00.000Z"),
        driverProfile: { create: {} },
      },
    });
    createdCharacterIds.push(charB.id);
    await prisma.externalBindingDriver.create({
      data: { universeId: otherUniverse.id, externalDriverId: driver.id, characterId: charB.id },
    });

    expect(
      await prisma.characterPersona.count({ where: { characterId: charB.id } }),
    ).toBe(0);

    await enrichCharacterPersonaFromEvidence(charB.id);
    const personaB = await prisma.characterPersona.findUniqueOrThrow({
      where: { characterId: charB.id },
      select: { id: true },
    });
    expect(personaB.id).not.toBe(personaA.id);

    await prisma.personaTrait.updateMany({
      where: { personaId: personaA.id },
      data: { value: "alterado no universo A" },
    });
    const traitB = await prisma.personaTrait.findFirstOrThrow({
      where: { personaId: personaB.id },
      select: { value: true },
    });
    expect(traitB.value).not.toBe("alterado no universo A");
  });

  it("9) character sem binding retorna null sem criar persona", async () => {
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
