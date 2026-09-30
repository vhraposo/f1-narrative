import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import { deleteKnowledgeSourcesForDrivers } from "../../test-utils/pilot-knowledge-cleanup.js";
import { deleteUniverseDataForUsers } from "../../test-utils/universe-cleanup.js";
import { ensurePilotKnowledgeProvisioned } from "./pilot-knowledge.provision.js";
import { recordKnowledgeSource } from "./pilot-knowledge.sources.js";

const PREFIX = "pk-prov";
const createdUserIds: string[] = [];
const createdDriverIds: string[] = [];
const createdExternalRaceIds: string[] = [];

afterAll(async () => {
  await deleteKnowledgeSourcesForDrivers(prisma, createdDriverIds);
  if (createdDriverIds.length > 0) {
    await prisma.externalResult.deleteMany({ where: { externalDriverId: { in: createdDriverIds } } });
    await prisma.externalStanding.deleteMany({ where: { externalDriverId: { in: createdDriverIds } } });
    await prisma.externalDriverSeason.deleteMany({ where: { externalDriverId: { in: createdDriverIds } } });
    await prisma.externalDriverEvent.deleteMany({ where: { externalDriverId: { in: createdDriverIds } } });
    await prisma.externalDriver.deleteMany({ where: { id: { in: createdDriverIds } } });
  }
  if (createdExternalRaceIds.length > 0) {
    await prisma.externalRace.deleteMany({ where: { id: { in: createdExternalRaceIds } } });
  }
  await prisma.memory.deleteMany({ where: { participants: { some: { character: { name: { startsWith: PREFIX } } } } } });
  await deleteUniverseDataForUsers(prisma, createdUserIds);
  await prisma.character.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.universe.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

async function createFixture(
  label: string,
  options?: {
    readonly bind?: boolean;
    readonly withData?: boolean;
    readonly withIdentity?: boolean;
    readonly round?: number;
  },
) {
  const user = await prisma.user.create({
    data: {
      email: `${PREFIX}-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@f1nw.test`,
      name: `Owner ${label}`,
    },
  });
  createdUserIds.push(user.id);
  const universe = await prisma.universe.create({ data: { userId: user.id, status: "READY" } });
  const driver = await prisma.externalDriver.create({
    data: {
      source: "jolpica",
      externalId: `${PREFIX}-${label}-${Date.now()}`,
      name: `Piloto ${label}`,
      fullName: `Piloto ${label} Completo`,
      nationality: "NED",
      number: 33,
      contentHash: `hash-${label}`,
      ...(options?.withIdentity
        ? { sourceRecord: { code: "TST", dateOfBirth: "1997-09-30", permanentNumber: "33" } }
        : {}),
    },
  });
  createdDriverIds.push(driver.id);
  const character = await prisma.character.create({
    data: {
      universeId: universe.id,
      controlledBy: "AI",
      name: `${PREFIX} ${label}`,
      nationality: "NED",
      birthDate: new Date("1997-09-30T00:00:00.000Z"),
      driverProfile: { create: { number: 33 } },
    },
  });
  if (options?.bind !== false) {
    await prisma.externalBindingDriver.create({
      data: { universeId: universe.id, externalDriverId: driver.id, characterId: character.id },
    });
  }
  if (options?.withData) {
    await prisma.externalDriverSeason.create({
      data: { source: "jolpica", externalDriverId: driver.id, seasonYear: 2015, teamNameSnapshot: "Equipe A", number: 33, contentHash: `s1-${label}` },
    });
    await prisma.externalDriverSeason.create({
      data: { source: "jolpica", externalDriverId: driver.id, seasonYear: 2016, teamNameSnapshot: "Equipe B", number: 1, contentHash: `s2-${label}` },
    });
    await prisma.externalStanding.create({
      data: { source: "jolpica", externalDriverId: driver.id, seasonYear: 2016, position: 1, points: 300, wins: 8, contentHash: `st-${label}` },
    });
    const race = await prisma.externalRace.create({
      data: {
        source: "jolpica",
        seasonYear: 2016,
        round: options?.round ?? 1,
        name: `GP ${label}`,
        date: new Date("2016-03-15T00:00:00.000Z"),
        contentHash: `race-${label}`,
      },
    });
    createdExternalRaceIds.push(race.id);
    await prisma.externalResult.create({
      data: {
        source: "jolpica",
        externalRaceId: race.id,
        externalDriverId: driver.id,
        position: 1,
        grid: 1,
        points: 25,
        status: "Finished",
        contentHash: `res-${label}`,
      },
    });
  }
  return { user, universe, driver, character };
}

describe("pilot knowledge provisioning", () => {
  it("1) provisiona perfil/biografia/marcos do espelho de forma idempotente", async () => {
    const fixture = await createFixture("basic", { withData: true, withIdentity: true });
    const first = await ensurePilotKnowledgeProvisioned(fixture.character.id);
    expect(first.outcome).toBe("PROVISIONED");

    const profile = await prisma.externalDriverProfile.findUniqueOrThrow({
      where: { externalDriverId: fixture.driver.id },
    });
    expect(profile.publicName).toBe("Piloto basic");
    expect(profile.currentTeamName).toBe("Equipe B");
    expect(profile.driverNumber).toBe(1);
    expect(profile.driverCode).toBe("TST");
    expect(profile.dateOfBirth).not.toBeNull();
    expect(profile.biographyDisplay).toContain("Equipe A e Equipe B");
    expect(profile.biographyDisplay).toContain("campeonato mundial em 2016");
    expect(profile.biographyDisplay).toContain("Tem registros na Fórmula 1 desde 2015");
    expect(profile.biographyDisplay).toContain("nacionalidade neerlandesa");
    expect(profile.biographyDisplay).toContain("Primeira vitória");
    expect(profile.biographyContext).toContain("2016");
    expect(profile.biographySourceId).not.toBeNull();

    const milestones = await prisma.externalDriverEvent.findMany({
      where: { externalDriverId: fixture.driver.id },
    });
    expect(milestones.some((event) => event.category === "F1_DEBUT")).toBe(true);
    expect(milestones.some((event) => event.category === "FIRST_WIN")).toBe(true);

    const experiencesBefore = await prisma.pilotExperience.count({
      where: { characterId: fixture.character.id },
    });
    const second = await ensurePilotKnowledgeProvisioned(fixture.character.id);
    expect(second.outcome).toBe("ALREADY_PROVISIONED");
    expect(
      await prisma.externalDriverProfile.count({ where: { externalDriverId: fixture.driver.id } }),
    ).toBe(1);
    const milestonesAfter = await prisma.externalDriverEvent.count({
      where: { externalDriverId: fixture.driver.id },
    });
    expect(milestonesAfter).toBe(milestones.length);
    expect(
      await prisma.pilotExperience.count({ where: { characterId: fixture.character.id } }),
    ).toBe(experiencesBefore);
  });

  it("2) sem binding (ou binding removido em cascata) retorna NO_EXTERNAL_BINDING", async () => {
    const unbound = await createFixture("unbound", { bind: false });
    const outcome = await ensurePilotKnowledgeProvisioned(unbound.character.id);
    expect(outcome.outcome).toBe("NO_EXTERNAL_BINDING");

    const fixture = await createFixture("missing-driver");
    await prisma.externalDriver.delete({ where: { id: fixture.driver.id } });
    createdDriverIds.splice(createdDriverIds.indexOf(fixture.driver.id), 1);
    const missing = await ensurePilotKnowledgeProvisioned(fixture.character.id);
    expect(missing.outcome).toBe("NO_EXTERNAL_BINDING");
  });

  it("3) piloto sem dados estruturados ainda provisiona identidade sem inventar carreira", async () => {
    const fixture = await createFixture("plain");
    const result = await ensurePilotKnowledgeProvisioned(fixture.character.id);
    expect(result.outcome).toBe("PROVISIONED");
    const profile = await prisma.externalDriverProfile.findUniqueOrThrow({
      where: { externalDriverId: fixture.driver.id },
    });
    expect(profile.publicName).toBe("Piloto plain");
    expect(profile.biographyDisplay).toContain("nacionalidade neerlandesa");
    expect(profile.biographyDisplay).not.toContain("nasceu");
    expect(profile.biographyDisplay).not.toContain("Fórmula 1");
    expect(profile.biographyContext).toContain("Piloto plain");
    const milestones = await prisma.externalDriverEvent.count({
      where: { externalDriverId: fixture.driver.id },
    });
    expect(milestones).toBe(0);
  });

  it("4) reabertura atualiza biografia vinda do espelho sem duplicar sources", async () => {
    const fixture = await createFixture("upgrade", { withData: true, withIdentity: true, round: 11 });
    await ensurePilotKnowledgeProvisioned(fixture.character.id);
    const profileBefore = await prisma.externalDriverProfile.findUniqueOrThrow({
      where: { externalDriverId: fixture.driver.id },
    });
    await prisma.externalDriverProfile.update({
      where: { externalDriverId: fixture.driver.id },
      data: { biographyDisplay: "Biografia antiga do espelho." },
    });
    const sourcesBefore = await prisma.externalKnowledgeSource.count({
      where: { driverProfiles: { some: { externalDriverId: fixture.driver.id } } },
    });

    const second = await ensurePilotKnowledgeProvisioned(fixture.character.id);
    expect(second.outcome).toBe("ALREADY_PROVISIONED");

    const profileAfter = await prisma.externalDriverProfile.findUniqueOrThrow({
      where: { externalDriverId: fixture.driver.id },
    });
    expect(profileAfter.biographyDisplay).toContain("Tem registros na Fórmula 1 desde 2015");
    expect(profileAfter.biographyDisplay).not.toBe("Biografia antiga do espelho.");
    expect(profileAfter.biographySourceId).toBe(profileBefore.biographySourceId);
    const sourcesAfter = await prisma.externalKnowledgeSource.count({
      where: { driverProfiles: { some: { externalDriverId: fixture.driver.id } } },
    });
    expect(sourcesAfter).toBe(sourcesBefore);
  });

  it("5) biografia escrita por provider externo é preservada na reabertura", async () => {
    const fixture = await createFixture("provider-bio", { withData: true, round: 12 });
    await ensurePilotKnowledgeProvisioned(fixture.character.id);
    const providerSource = await recordKnowledgeSource({
      provider: "F1DB",
      sourceKind: "STRUCTURED_RELEASE",
      url: `https://f1db.example/${PREFIX}-provider-bio`,
      license: "CC_BY_4_0",
    });
    await prisma.externalDriverProfile.update({
      where: { externalDriverId: fixture.driver.id },
      data: {
        biographyDisplay: "Biografia do provider.",
        biographyContext: "Biografia do provider.",
        biographySourceId: providerSource.id,
      },
    });

    const second = await ensurePilotKnowledgeProvisioned(fixture.character.id);
    expect(second.outcome).toBe("ALREADY_PROVISIONED");
    const profile = await prisma.externalDriverProfile.findUniqueOrThrow({
      where: { externalDriverId: fixture.driver.id },
    });
    expect(profile.biographyDisplay).toBe("Biografia do provider.");
    expect(profile.biographySourceId).toBe(providerSource.id);
  });

  it("6) atualização da temporada corrente não reescreve temporadas históricas", async () => {
    const fixture = await createFixture("temporal", { withData: true, withIdentity: true, round: 13 });
    await ensurePilotKnowledgeProvisioned(fixture.character.id);
    const seasonsBefore = await prisma.externalDriverSeason.findMany({
      where: { externalDriverId: fixture.driver.id },
      orderBy: { seasonYear: "asc" },
    });
    expect(seasonsBefore.map((season) => season.teamNameSnapshot)).toEqual([
      "Equipe A",
      "Equipe B",
    ]);

    await prisma.externalDriverSeason.create({
      data: {
        source: "jolpica",
        externalDriverId: fixture.driver.id,
        seasonYear: 2017,
        teamNameSnapshot: "Equipe C",
        number: 44,
        contentHash: "s3-temporal",
      },
    });
    const second = await ensurePilotKnowledgeProvisioned(fixture.character.id);
    expect(second.outcome).toBe("ALREADY_PROVISIONED");

    const profile = await prisma.externalDriverProfile.findUniqueOrThrow({
      where: { externalDriverId: fixture.driver.id },
    });
    expect(profile.currentTeamName).toBe("Equipe C");
    expect(profile.driverNumber).toBe(44);
    expect(profile.biographyDisplay).toContain("Equipe C");
    expect(profile.biographyDisplay).toContain("Equipe A");

    const seasonsAfter = await prisma.externalDriverSeason.findMany({
      where: { externalDriverId: fixture.driver.id, seasonYear: { in: [2015, 2016] } },
      orderBy: { seasonYear: "asc" },
    });
    expect(seasonsAfter.map((season) => season.teamNameSnapshot)).toEqual([
      "Equipe A",
      "Equipe B",
    ]);
  });

  it("7) provisiona fatos F1DB (nascimento/local/código/carreira) com espelho parcial", async () => {
    const fixture = await createFixture("f1db-land", { withData: true, round: 14 });
    await prisma.externalDriver.update({
      where: { id: fixture.driver.id },
      data: { name: "Lando Norris", fullName: "Lando Norris", nationality: "British" },
    });
    const result = await ensurePilotKnowledgeProvisioned(fixture.character.id);
    expect(result.outcome).toBe("PROVISIONED");

    const profile = await prisma.externalDriverProfile.findUniqueOrThrow({
      where: { externalDriverId: fixture.driver.id },
    });
    expect(profile.dateOfBirth?.toISOString()).toBe("1999-11-13T00:00:00.000Z");
    expect(profile.placeOfBirth).toBe("Bristol");
    expect(profile.driverCode).toBe("NOR");
    expect(profile.biographyDisplay).toContain("Bristol");
    expect(profile.biographyDisplay).toContain("13 de novembro de 1999");
    expect(profile.biographyDisplay).toContain("campeonato mundial em 2016 e 2025");
    expect(profile.biographyDisplay).toContain("vitórias");
    expect(profile.biographyDisplay).toContain("nacionalidade britânica");
  });

  it("8) composer LLM gera biografia com provenance e não é re-gerado na reabertura", async () => {
    const fixture = await createFixture("llm-bio", { withData: true, round: 15 });
    let calls = 0;
    const composed =
      "Biografia ampliada e original produzida a partir de claims verificados do espelho e do F1DB, cobrindo origem, kart, categorias de base e trajetória até a Fórmula 1.";
    const first = await ensurePilotKnowledgeProvisioned(fixture.character.id, new Date(), {
      biographyComposer: async () => {
        calls += 1;
        return composed;
      },
    });
    expect(first.outcome).toBe("PROVISIONED");
    const profile = await prisma.externalDriverProfile.findUniqueOrThrow({
      where: { externalDriverId: fixture.driver.id },
    });
    expect(profile.biographyDisplay).toBe(composed);
    expect(profile.biographySourceId).not.toBeNull();
    const source = await prisma.externalKnowledgeSource.findUniqueOrThrow({
      where: { id: profile.biographySourceId as string },
    });
    expect(source.sourceKind).toBe("BIOGRAPHY_PAGE");
    expect(source.provider).toBe("CURATED");
    expect((source.metadata as { generator?: string }).generator).toBe("biography-composer");

    const second = await ensurePilotKnowledgeProvisioned(fixture.character.id, new Date(), {
      biographyComposer: async () => {
        calls += 1;
        return composed;
      },
    });
    expect(second.outcome).toBe("ALREADY_PROVISIONED");
    expect(calls).toBe(1);
    const after = await prisma.externalDriverProfile.findUniqueOrThrow({
      where: { externalDriverId: fixture.driver.id },
    });
    expect(after.biographyDisplay).toBe(composed);
  });

  it("9) composer sem saída válida cai no fallback determinístico", async () => {
    const fixture = await createFixture("llm-fallback", { withData: true, round: 16 });
    await ensurePilotKnowledgeProvisioned(fixture.character.id, new Date(), {
      biographyComposer: async () => null,
    });
    const profile = await prisma.externalDriverProfile.findUniqueOrThrow({
      where: { externalDriverId: fixture.driver.id },
    });
    expect(profile.biographyDisplay).toContain("campeonato mundial em 2016");
    const source = await prisma.externalKnowledgeSource.findUniqueOrThrow({
      where: { id: profile.biographySourceId as string },
    });
    expect(source.sourceKind).toBe("DATABASE_EXPORT");
  });
});


