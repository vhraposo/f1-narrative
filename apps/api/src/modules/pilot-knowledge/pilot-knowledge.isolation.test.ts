import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import { deleteKnowledgeSourcesForDrivers } from "../../test-utils/pilot-knowledge-cleanup.js";
import { deleteUniverseDataForUsers } from "../../test-utils/universe-cleanup.js";
import { upsertDriverProfileFromProvider } from "./pilot-knowledge.profile.js";
import { ingestPersonaEvidenceForDriver } from "./pilot-knowledge.persona.js";
import { createUniverseDriverRelationship, ingestExternalRelationships } from "./pilot-knowledge.relationships.js";
import { getDriverProfileView } from "./pilot-knowledge.profile.js";
import { resolvePilotContext } from "../pilot-context/pilot-context.resolver.js";

const PREFIX = "pk-iso";
const createdUserIds: string[] = [];
const createdDriverIds: string[] = [];

afterAll(async () => {
  await deleteKnowledgeSourcesForDrivers(prisma, createdDriverIds);
  if (createdDriverIds.length > 0) {
    await prisma.externalDriver.deleteMany({ where: { id: { in: createdDriverIds } } });
  }
  await deleteUniverseDataForUsers(prisma, createdUserIds);
  await prisma.character.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.universe.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

async function createUniverseFixture(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `${PREFIX}-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@f1nw.test`,
      name: `Owner ${label}`,
    },
  });
  createdUserIds.push(user.id);
  const universe = await prisma.universe.create({ data: { userId: user.id } });
  return { user, universe };
}

describe("pilot knowledge isolation", () => {
  it("1) Universes A e B refletem o external sem contaminar overrides entre si", async () => {
    const driver = await prisma.externalDriver.create({
      data: {
        source: "f1db",
        externalId: `${PREFIX}-driver`,
        name: "Piloto Compartilhado",
        nationality: "NED",
        number: 33,
        contentHash: "iso-hash",
      },
    });
    createdDriverIds.push(driver.id);
    await upsertDriverProfileFromProvider(driver.id, {
      publicName: "Piloto Compartilhado",
      biographyFacts: { publicName: "Piloto Compartilhado", nationality: "Países Baixos" },
    });
    await ingestPersonaEvidenceForDriver(driver.id, [
      {
        traitKey: "communicationStyle",
        proposedValue: "baseline externa",
        sourceKind: "OBSERVED_PUBLIC_BEHAVIOR",
        evidenceType: "TEAM_PROFILE",
        summary: "base",
        confidence: 0.7,
        source: {
          provider: "TEAM_OFFICIAL",
          sourceKind: "OFFICIAL_PROFILE",
          url: `https://team.example/${PREFIX}-base`,
          license: "PROPRIETARY_REFERENCE_ONLY",
        },
      },
    ]);
    await ingestExternalRelationships(driver.id, [
      {
        kind: "ROMANTIC_PARTNER",
        targetType: "PUBLIC_PERSON",
        displayName: "Pessoa Externa A",
        state: "ACTIVE",
        validFrom: new Date("2022-01-01T00:00:00.000Z"),
        source: {
          provider: "WIKIDATA",
          sourceKind: "DATABASE_EXPORT",
          url: `https://wikidata.example/${PREFIX}-baseline`,
          license: "CC0",
        },
      },
    ]);

    const a = await createUniverseFixture("a");
    const b = await createUniverseFixture("b");
    const characterA = await prisma.character.create({
      data: {
        universeId: a.universe.id,
        controlledBy: "AI",
        name: `${PREFIX}-A`,
        nationality: "NED",
        birthDate: new Date("1997-09-30T00:00:00.000Z"),
        driverProfile: { create: {} },
      },
    });
    const characterB = await prisma.character.create({
      data: {
        universeId: b.universe.id,
        controlledBy: "AI",
        name: `${PREFIX}-B`,
        nationality: "NED",
        birthDate: new Date("1997-09-30T00:00:00.000Z"),
        driverProfile: { create: {} },
      },
    });
    await prisma.externalBindingDriver.createMany({
      data: [
        { universeId: a.universe.id, externalDriverId: driver.id, characterId: characterA.id },
        { universeId: b.universe.id, externalDriverId: driver.id, characterId: characterB.id },
      ],
    });

    await prisma.character.update({
      where: { id: characterA.id },
      data: { biography: "Biografia exclusiva do Universe A." },
    });
    await prisma.characterPersona.create({
      data: {
        characterId: characterA.id,
        origin: "AI_CHARACTER",
        traits: {
          create: { key: "communicationStyle", value: "override do A", confidence: 1, sourceKind: "MANUAL" },
        },
      },
    });
    await createUniverseDriverRelationship(a.user.id, characterA.id, {
      kind: "ROMANTIC_PARTNER",
      targetType: "PUBLIC_PERSON",
      displayName: "Parceira do A",
      state: "ACTIVE",
      validFrom: new Date("2024-01-01T00:00:00.000Z"),
    });
    const memory = await prisma.memory.create({
      data: {
        content: "Memória do Universe A",
        importance: "HIGH",
        source: "USER_DEFINED",
        participants: { create: [{ characterId: characterA.id }] },
      },
    });

    const contextA = await resolvePilotContext({ speakerCharacterId: characterA.id });
    const contextB = await resolvePilotContext({ speakerCharacterId: characterB.id });
    if (!contextA || !contextB) throw new Error("unreachable");

    expect(contextA.biography?.text).toBe("Biografia exclusiva do Universe A.");
    expect(contextB.biography?.origin).toBe("EXTERNAL");
    expect(contextA.effectivePersona[0]?.value).toBe("override do A");
    expect(contextB.effectivePersona[0]?.value).toBe("baseline externa");
    expect(contextA.relationships[0]?.displayName).toBe("Parceira do A");
    expect(contextB.relationships[0]?.displayName).toBe("Pessoa Externa A");
    expect(contextA.memories.map((entry) => entry.content)).toContain("Memória do Universe A");
    expect(contextB.memories).toEqual([]);

    await upsertDriverProfileFromProvider(driver.id, {
      publicName: "Piloto Compartilhado",
      biographyFacts: { publicName: "Piloto Compartilhado", placeOfBirth: "Hasselt" },
    });
    await ingestExternalRelationships(driver.id, [
      {
        kind: "ROMANTIC_PARTNER",
        targetType: "PUBLIC_PERSON",
        displayName: "Pessoa Externa C",
        state: "ACTIVE",
        validFrom: new Date("2026-06-01T00:00:00.000Z"),
        source: {
          provider: "WIKIDATA",
          sourceKind: "DATABASE_EXPORT",
          url: `https://wikidata.example/${PREFIX}-updated`,
          license: "CC0",
        },
      },
    ]);

    const contextAAfter = await resolvePilotContext({ speakerCharacterId: characterA.id });
    const contextBAfter = await resolvePilotContext({ speakerCharacterId: characterB.id });
    if (!contextAAfter || !contextBAfter) throw new Error("unreachable");

    expect(contextAAfter.biography?.text).toBe("Biografia exclusiva do Universe A.");
    expect(contextAAfter.relationships[0]?.displayName).toBe("Parceira do A");
    expect(contextAAfter.effectivePersona[0]?.value).toBe("override do A");
    expect(contextBAfter.relationships[0]?.displayName).toBe("Pessoa Externa C");
    expect(contextBAfter.biography?.origin).toBe("EXTERNAL");
    expect(contextBAfter.effectivePersona[0]?.value).toBe("baseline externa");

    const viewB = await getDriverProfileView(characterB.id);
    expect(viewB.available).toBe(true);
    await prisma.memory.delete({ where: { id: memory.id } });
    await prisma.characterPersona.deleteMany({ where: { characterId: characterA.id } });
  });

  it("2) mudança em B nunca aparece em A", async () => {
    const driver = await prisma.externalDriver.create({
      data: {
        source: "f1db",
        externalId: `${PREFIX}-driver-2`,
        name: "Piloto Isolado",
        contentHash: "iso-hash-2",
      },
    });
    createdDriverIds.push(driver.id);
    await upsertDriverProfileFromProvider(driver.id, {
      publicName: "Piloto Isolado",
      biographyFacts: { publicName: "Piloto Isolado", nationality: "Brasil" },
    });

    const a = await createUniverseFixture("c");
    const b = await createUniverseFixture("d");
    const characterA = await prisma.character.create({
      data: {
        universeId: a.universe.id,
        controlledBy: "AI",
        name: `${PREFIX}-C`,
        nationality: "BRA",
        birthDate: new Date("2000-01-01T00:00:00.000Z"),
        driverProfile: { create: {} },
      },
    });
    const characterB = await prisma.character.create({
      data: {
        universeId: b.universe.id,
        controlledBy: "AI",
        name: `${PREFIX}-D`,
        nationality: "BRA",
        birthDate: new Date("2000-01-01T00:00:00.000Z"),
        driverProfile: { create: {} },
      },
    });
    await prisma.externalBindingDriver.createMany({
      data: [
        { universeId: a.universe.id, externalDriverId: driver.id, characterId: characterA.id },
        { universeId: b.universe.id, externalDriverId: driver.id, characterId: characterB.id },
      ],
    });

    await prisma.character.update({
      where: { id: characterB.id },
      data: { biography: "Biografia do B somente." },
    });
    await createUniverseDriverRelationship(b.user.id, characterB.id, {
      kind: "SPOUSE",
      targetType: "PUBLIC_PERSON",
      displayName: "Parceira do B",
      state: "ACTIVE",
    });

    const contextA = await resolvePilotContext({ speakerCharacterId: characterA.id });
    if (!contextA) throw new Error("unreachable");
    expect(JSON.stringify(contextA)).not.toContain("Biografia do B somente.");
    expect(JSON.stringify(contextA)).not.toContain("Parceira do B");
    expect(contextA.biography?.origin).toBe("EXTERNAL");
  });
});
