import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import {
  getExternalPersonaView,
  ingestPersonaEvidenceForDriver,
  resolveExternalPersonaTraits,
  type PersonaEvidenceInput,
} from "./pilot-knowledge.persona.js";
import { upsertDriverProfileFromProvider } from "./pilot-knowledge.profile.js";

const PREFIX = "pk-persona";
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdDriverIds: string[] = [];

afterAll(async () => {
  if (createdDriverIds.length > 0) {
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

async function createDriverWithCharacter(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `${PREFIX}-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@f1nw.test`,
      name: `Owner ${label}`,
    },
  });
  createdUserIds.push(user.id);
  const universe = await prisma.universe.create({ data: { userId: user.id } });
  createdUniverseIds.push(universe.id);
  const driver = await prisma.externalDriver.create({
    data: {
      source: "f1db",
      externalId: `${PREFIX}-${label}`,
      name: `Piloto ${label}`,
      contentHash: `hash-${label}`,
    },
  });
  createdDriverIds.push(driver.id);
  const character = await prisma.character.create({
    data: {
      universeId: universe.id,
      controlledBy: "AI",
      name: `Piloto ${label}`,
      nationality: "NED",
      birthDate: new Date("1997-09-30T00:00:00.000Z"),
      driverProfile: { create: {} },
    },
  });
  createdCharacterIds.push(character.id);
  await prisma.externalBindingDriver.create({
    data: { universeId: universe.id, externalDriverId: driver.id, characterId: character.id },
  });
  return { driver, character, user };
}

function claim(overrides: Partial<PersonaEvidenceInput> & { traitKey: string; proposedValue: string }): PersonaEvidenceInput {
  return {
    sourceKind: "OBSERVED_PUBLIC_BEHAVIOR",
    evidenceType: "TEAM_PROFILE",
    summary: "síntese original do claim",
    confidence: 0.6,
    source: {
      provider: "TEAM_OFFICIAL",
      sourceKind: "OFFICIAL_PROFILE",
      url: `https://team.example/${PREFIX}-${Math.random().toString(36).slice(2, 8)}`,
      title: "Perfil oficial",
      license: "PROPRIETARY_REFERENCE_ONLY",
    },
    ...overrides,
  };
}

describe("external persona resolution (pure)", () => {
  it("1) DIRECT_SELF_DESCRIPTION é SUPPORTED com uma evidência", () => {
    const traits = resolveExternalPersonaTraits([
      {
        id: "e1",
        traitKey: "communicationStyle",
        proposedValue: "direto e conciso",
        sourceKind: "DIRECT_SELF_DESCRIPTION",
        evidenceType: "SELF_DESCRIPTION",
        confidence: 0.9,
        sourceId: "s1",
        provider: "DRIVER_OFFICIAL",
      },
    ]);
    expect(traits).toHaveLength(1);
    expect(traits[0]?.status).toBe("SUPPORTED");
    expect(traits[0]?.sourceKind).toBe("DIRECT_SELF_DESCRIPTION");
  });

  it("2) INFERRED exige duas evidências independentes", () => {
    const single = resolveExternalPersonaTraits([
      {
        id: "e1",
        traitKey: "hobbies",
        proposedValue: "sim racing",
        sourceKind: "INFERRED",
        evidenceType: "STRUCTURED_DATA",
        confidence: 0.6,
        sourceId: "s1",
        provider: "F1DB",
      },
    ]);
    expect(single[0]?.status).toBe("UNCERTAIN");

    const double = resolveExternalPersonaTraits([
      {
        id: "e1",
        traitKey: "hobbies",
        proposedValue: "sim racing",
        sourceKind: "INFERRED",
        evidenceType: "STRUCTURED_DATA",
        confidence: 0.6,
        sourceId: "s1",
        provider: "F1DB",
      },
      {
        id: "e2",
        traitKey: "hobbies",
        proposedValue: "sim racing",
        sourceKind: "INFERRED",
        evidenceType: "REPUTABLE_NEWS",
        confidence: 0.5,
        sourceId: "s2",
        provider: "REPUTABLE_NEWS",
      },
    ]);
    expect(double[0]?.status).toBe("SUPPORTED");
  });

  it("3) conflito de mesma autoridade permanece CONFLICT", () => {
    const traits = resolveExternalPersonaTraits([
      {
        id: "e1",
        traitKey: "publicTone",
        proposedValue: "reservado",
        sourceKind: "OBSERVED_PUBLIC_BEHAVIOR",
        evidenceType: "STRUCTURED_DATA",
        confidence: 0.8,
        sourceId: "s1",
        provider: "F1DB",
      },
      {
        id: "e2",
        traitKey: "publicTone",
        proposedValue: "expansivo",
        sourceKind: "OBSERVED_PUBLIC_BEHAVIOR",
        evidenceType: "STRUCTURED_DATA",
        confidence: 0.8,
        sourceId: "s2",
        provider: "F1DB",
      },
    ]);
    expect(traits[0]?.status).toBe("CONFLICT");
    expect(traits[0]?.value).toBe("reservado");
  });

  it("4) primary official vence secondary", () => {
    const traits = resolveExternalPersonaTraits([
      {
        id: "e1",
        traitKey: "humorStyle",
        proposedValue: "irônico",
        sourceKind: "OBSERVED_PUBLIC_BEHAVIOR",
        evidenceType: "REPUTABLE_NEWS",
        confidence: 0.9,
        sourceId: "s1",
        provider: "REPUTABLE_NEWS",
      },
      {
        id: "e2",
        traitKey: "humorStyle",
        proposedValue: "seco",
        sourceKind: "OBSERVED_PUBLIC_BEHAVIOR",
        evidenceType: "F1_PROFILE",
        confidence: 0.4,
        sourceId: "s2",
        provider: "F1_OFFICIAL",
      },
    ]);
    expect(traits[0]?.value).toBe("seco");
    expect(traits[0]?.status).toBe("SUPPORTED");
  });
});

describe("external persona ingestion and view", () => {
  it("5) ingere evidência, cria trait e mantém evidência auditável", async () => {
    const { driver, character } = await createDriverWithCharacter("ingest");
    await upsertDriverProfileFromProvider(driver.id, { publicName: "Piloto Ingest" });
    const now = new Date("2026-09-30T15:00:00.000Z");
    const result = await ingestPersonaEvidenceForDriver(
      driver.id,
      [claim({ traitKey: "communicationStyle", proposedValue: "direto", sourceKind: "DIRECT_SELF_DESCRIPTION", evidenceType: "SELF_DESCRIPTION" })],
      now,
    );
    expect(result.traits).toHaveLength(1);

    const view = await getExternalPersonaView(character.id, now);
    expect(view.available).toBe(true);
    if (!view.available) throw new Error("unreachable");
    expect(view.traits[0]).toMatchObject({
      traitKey: "communicationStyle",
      label: "Estilo de comunicação",
      value: "direto",
      status: "SUPPORTED",
    });
    const keys = Object.keys(view.traits[0] as object);
    expect(keys).not.toContain("confidence");
    expect(keys).not.toContain("excerpt");
    expect(keys).not.toContain("url");
    expect(view.refresh.status).toBe("FRESH");

    const evidenceCount = await prisma.externalPersonaEvidence.count({
      where: { persona: { profile: { externalDriverId: driver.id } } },
    });
    expect(evidenceCount).toBe(1);
    const traitCount = await prisma.externalPersonaTrait.count({
      where: { persona: { profile: { externalDriverId: driver.id } } },
    });
    expect(traitCount).toBe(1);
  });

  it("6) traitKey não suportado é rejeitado sem persistir", async () => {
    const { driver } = await createDriverWithCharacter("unknown-trait");
    await upsertDriverProfileFromProvider(driver.id, { publicName: "Piloto X" });
    await expect(
      ingestPersonaEvidenceForDriver(driver.id, [
        claim({ traitKey: "psychologicalDiagnosis", proposedValue: "ansioso" }),
      ]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const count = await prisma.externalPersonaEvidence.count({
      where: { persona: { profile: { externalDriverId: driver.id } } },
    });
    expect(count).toBe(0);
  });

  it("7) caps de value e summary são aplicados", async () => {
    const { driver } = await createDriverWithCharacter("caps");
    await upsertDriverProfileFromProvider(driver.id, { publicName: "Piloto Caps" });
    const longValue = "v".repeat(500);
    const longSummary = "s".repeat(900);
    await ingestPersonaEvidenceForDriver(driver.id, [
      claim({ traitKey: "hobbies", proposedValue: longValue, summary: longSummary }),
    ]);
    const trait = await prisma.externalPersonaTrait.findFirstOrThrow({
      where: { persona: { profile: { externalDriverId: driver.id } } },
    });
    expect(trait.value.length).toBeLessThanOrEqual(201);
    const evidence = await prisma.externalPersonaEvidence.findFirstOrThrow({
      where: { persona: { profile: { externalDriverId: driver.id } } },
    });
    expect(evidence.summary.length).toBeLessThanOrEqual(501);
  });

  it("8) refresh externo atualiza trait e não toca CharacterPersona", async () => {
    const { driver, character } = await createDriverWithCharacter("refresh");
    await upsertDriverProfileFromProvider(driver.id, { publicName: "Piloto Refresh" });
    await ingestPersonaEvidenceForDriver(driver.id, [
      claim({ traitKey: "publicTone", proposedValue: "reservado", confidence: 0.5 }),
    ]);

    const manual = await prisma.characterPersona.create({
      data: {
        characterId: character.id,
        origin: "AI_CHARACTER",
        summary: "persona do universe",
        traits: {
          create: { key: "publicTone", value: "personalizado pelo universe", confidence: 1, sourceKind: "MANUAL" },
        },
      },
    });

    await ingestPersonaEvidenceForDriver(driver.id, [
      claim({ traitKey: "publicTone", proposedValue: "expansivo", confidence: 0.9 }),
    ]);

    const externalTrait = await prisma.externalPersonaTrait.findFirstOrThrow({
      where: { persona: { profile: { externalDriverId: driver.id } } },
    });
    expect(externalTrait.value).toBe("expansivo");
    const manualTrait = await prisma.personaTrait.findFirstOrThrow({
      where: { personaId: manual.id },
    });
    expect(manualTrait.value).toBe("personalizado pelo universe");
  });

  it("9) view explica indisponibilidade sem dados", async () => {
    expect((await getExternalPersonaView("00000000-0000-0000-0000-000000000000")).available).toBe(false);

    const user = await prisma.user.create({
      data: {
        email: `${PREFIX}-plain-${Date.now()}@f1nw.test`,
        name: "Plain",
      },
    });
    createdUserIds.push(user.id);
    const universe = await prisma.universe.create({ data: { userId: user.id } });
    createdUniverseIds.push(universe.id);
    const character = await prisma.character.create({
      data: {
        universeId: universe.id,
        controlledBy: "AI",
        name: "Sem Tudo",
        nationality: "BRA",
        birthDate: new Date("2000-01-01T00:00:00.000Z"),
      },
    });
    createdCharacterIds.push(character.id);
    const noBinding = await getExternalPersonaView(character.id);
    expect(noBinding).toMatchObject({ available: false, reason: "NO_EXTERNAL_BINDING" });
  });

  it("10) conflito agregado marca persona como CONFLICT", async () => {
    const { driver } = await createDriverWithCharacter("aggregate-conflict");
    await upsertDriverProfileFromProvider(driver.id, { publicName: "Piloto Conflito" });
    await ingestPersonaEvidenceForDriver(driver.id, [
      claim({ traitKey: "publicTone", proposedValue: "a", confidence: 0.5, source: { provider: "F1DB", sourceKind: "STRUCTURED_RELEASE", url: `https://f1db.example/${PREFIX}-c1`, license: "CC_BY_4_0" } }),
      claim({ traitKey: "publicTone", proposedValue: "b", confidence: 0.5, source: { provider: "F1DB", sourceKind: "STRUCTURED_RELEASE", url: `https://f1db.example/${PREFIX}-c2`, license: "CC_BY_4_0" } }),
    ]);
    const persona = await prisma.externalDriverPersona.findFirstOrThrow({
      where: { profile: { externalDriverId: driver.id } },
    });
    expect(persona.status).toBe("CONFLICT");
    const trait = await prisma.externalPersonaTrait.findFirstOrThrow({
      where: { personaId: persona.id },
    });
    expect(trait.status).toBe("CONFLICT");
  });
});
