import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import { deleteKnowledgeSourcesForDrivers } from "../../test-utils/pilot-knowledge-cleanup.js";
import { deleteUniverseDataForUsers } from "../../test-utils/universe-cleanup.js";
import { deriveMilestonesFromExternalData } from "../pilot-knowledge/pilot-knowledge.events.js";
import { ingestPersonaEvidenceForDriver } from "../pilot-knowledge/pilot-knowledge.persona.js";
import { upsertDriverProfileFromProvider } from "../pilot-knowledge/pilot-knowledge.profile.js";
import { createUniverseDriverRelationship, ingestExternalRelationships } from "../pilot-knowledge/pilot-knowledge.relationships.js";
import { composePilotContextPromptBlock } from "./pilot-context.prompt.js";
import { loadSpeakerPilotContext, resolvePilotContext } from "./pilot-context.resolver.js";

const PREFIX = "pk-ctx";
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
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
  if (createdUniverseIds.length > 0) {
    await deleteUniverseDataForUsers(prisma, createdUserIds);
    await prisma.worldState.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
    await prisma.universe.deleteMany({ where: { id: { in: createdUniverseIds } } });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture(label: string, options?: { readonly withProfile?: boolean }) {
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
      nationality: "NED",
      number: 33,
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
      driverProfile: { create: { number: 33 } },
    },
  });
  createdCharacterIds.push(character.id);
  await prisma.externalBindingDriver.create({
    data: { universeId: universe.id, externalDriverId: driver.id, characterId: character.id },
  });
  if (options?.withProfile !== false) {
    await upsertDriverProfileFromProvider(driver.id, {
      publicName: `Piloto ${label}`,
      representedCountry: "Países Baixos",
      currentTeamName: "Equipe Base",
      biographyFacts: { publicName: `Piloto ${label}`, nationality: "Países Baixos" },
    });
  }
  return { user, universe, driver, character };
}

async function addPersonaTrait(fixture: Fixture, traitKey: string, value: string, confidence = 0.8) {
  await ingestPersonaEvidenceForDriver(fixture.driver.id, [
    {
      traitKey,
      proposedValue: value,
      sourceKind: "OBSERVED_PUBLIC_BEHAVIOR",
      evidenceType: "TEAM_PROFILE",
      summary: "síntese original",
      confidence,
      source: {
        provider: "TEAM_OFFICIAL",
        sourceKind: "OFFICIAL_PROFILE",
        url: `https://team.example/${PREFIX}-${traitKey}-${Math.random().toString(36).slice(2, 7)}`,
        license: "PROPRIETARY_REFERENCE_ONLY",
      },
    },
  ]);
}

async function seedSeasonState(fixture: Fixture) {
  const season = await prisma.season.create({
    data: { universeId: fixture.universe.id, year: 2026, name: "2026", status: "ACTIVE" },
  });
  const team = await prisma.team.create({
    data: { universeId: fixture.universe.id, userId: fixture.user.id, name: "Equipe Atual", color: "#111111" },
  });
  const driverProfile = await prisma.driverProfile.findUniqueOrThrow({
    where: { characterId: fixture.character.id },
    select: { id: true },
  });
  await prisma.seasonDriverEntry.create({
    data: { seasonId: season.id, driverProfileId: driverProfile.id, teamId: team.id, number: 1, status: "ACTIVE" },
  });
  await prisma.championshipStanding.create({
    data: { seasonId: season.id, driverProfileId: driverProfile.id, position: 1, points: 250, wins: 8, podiums: 12 },
  });
  const race = await prisma.race.create({
    data: { seasonId: season.id, round: 5, name: "GP Atual", date: new Date("2026-05-01"), status: "FINISHED" },
  });
  await prisma.raceResult.create({
    data: { raceId: race.id, driverProfileId: driverProfile.id, position: 2, points: 18, grid: 3, status: "Finished" },
  });
  await prisma.worldState.create({
    data: { universeId: fixture.universe.id, key: "default", currentSeasonId: season.id },
  });
  return { season, race, driverProfileId: driverProfile.id };
}

async function seedHistory(fixture: Fixture) {
  const entries = [
    { year: 2021, round: 1, name: "GP 2021", position: 1, grid: 1, points: 25, date: "2021-03-28" },
    { year: 2025, round: 5, name: "GP de Mônaco", position: 1, grid: 1, points: 25, date: "2025-05-25" },
  ];
  for (const entry of entries) {
    const race = await prisma.externalRace.create({
      data: {
        source: "jolpica",
        seasonYear: entry.year,
        round: entry.round,
        name: entry.name,
        grandPrix: entry.name,
        date: new Date(entry.date),
        contentHash: `race-${fixture.driver.id}-${entry.year}-${entry.round}`,
      },
    });
    createdExternalRaceIds.push(race.id);
    await prisma.externalResult.create({
      data: {
        source: "jolpica",
        externalRaceId: race.id,
        externalDriverId: fixture.driver.id,
        position: entry.position,
        grid: entry.grid,
        points: entry.points,
        status: "Finished",
        contentHash: `res-${fixture.driver.id}-${entry.year}`,
      },
    });
  }
  await deriveMilestonesFromExternalData(fixture.driver.id);
}

async function addMemory(fixture: Fixture, content: string, importance: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL") {
  const memory = await prisma.memory.create({
    data: {
      content,
      importance,
      source: "USER_DEFINED",
      participants: { create: [{ characterId: fixture.character.id }] },
    },
  });
  return memory;
}

describe("pilot context resolver", () => {
  it("1) external only: identidade, biografia e persona com origem EXTERNAL", async () => {
    const fixture = await createFixture("external");
    await addPersonaTrait(fixture, "communicationStyle", "direto e conciso");

    const view = await resolvePilotContext({ speakerCharacterId: fixture.character.id });
    expect(view).not.toBeNull();
    if (!view) throw new Error("unreachable");
    expect(view.identity?.publicName).toBe("Piloto external");
    expect(view.identity?.teamName).toBe("Equipe Base");
    expect(view.biography?.origin).toBe("EXTERNAL");
    expect(view.effectivePersona[0]?.origin).toBe("EXTERNAL");
    expect(view.effectivePersona[0]?.value).toBe("direto e conciso");
    expect(view.refresh.profile).toBe("FRESH");
  });

  it("2) overrides do Universe vencem por chave (biografia e persona)", async () => {
    const fixture = await createFixture("override");
    await addPersonaTrait(fixture, "communicationStyle", "externo");
    await addPersonaTrait(fixture, "hobbies", "sim racing");
    await prisma.character.update({
      where: { id: fixture.character.id },
      data: { biography: "Biografia personalizada do Universe." },
    });
    await prisma.characterPersona.create({
      data: {
        characterId: fixture.character.id,
        origin: "AI_CHARACTER",
        traits: {
          create: {
            key: "communicationStyle",
            value: "personalizado",
            confidence: 1,
            sourceKind: "MANUAL",
          },
        },
      },
    });

    const view = await resolvePilotContext({ speakerCharacterId: fixture.character.id });
    if (!view) throw new Error("unreachable");
    expect(view.biography?.origin).toBe("UNIVERSE");
    expect(view.biography?.text).toBe("Biografia personalizada do Universe.");
    const byKey = new Map(view.effectivePersona.map((trait) => [trait.key, trait]));
    expect(byKey.get("communicationStyle")?.origin).toBe("UNIVERSE");
    expect(byKey.get("communicationStyle")?.value).toBe("personalizado");
    expect(byKey.get("hobbies")?.origin).toBe("EXTERNAL");
  });

  it("3) estado atual do Universe é resolvido (temporada, entrada, standing, resultados)", async () => {
    const fixture = await createFixture("state");
    await seedSeasonState(fixture);
    const view = await resolvePilotContext({ speakerCharacterId: fixture.character.id });
    if (!view) throw new Error("unreachable");
    expect(view.currentUniverseState.seasonYear).toBe(2026);
    expect(view.currentUniverseState.teamName).toBe("Equipe Atual");
    expect(view.currentUniverseState.number).toBe(1);
    expect(view.currentUniverseState.standingPosition).toBe(1);
    expect(view.currentUniverseState.standingPoints).toBe(250);
    expect(view.currentUniverseState.recentResults[0]).toMatchObject({ raceName: "GP Atual", round: 5, position: 2 });
  });

  it("4) override de relacionamento vence e classifica DIVERGENT", async () => {
    const fixture = await createFixture("relationship");
    await ingestExternalRelationships(fixture.driver.id, [
      {
        kind: "ROMANTIC_PARTNER",
        targetType: "PUBLIC_PERSON",
        displayName: "Pessoa Externa",
        state: "ACTIVE",
        validFrom: new Date("2023-01-01T00:00:00.000Z"),
        source: {
          provider: "WIKIDATA",
          sourceKind: "DATABASE_EXPORT",
          url: `https://wikidata.example/${PREFIX}-rel`,
          license: "CC0",
        },
      },
    ]);
    await createUniverseDriverRelationship(fixture.user.id, fixture.character.id, {
      kind: "ROMANTIC_PARTNER",
      targetType: "PUBLIC_PERSON",
      displayName: "Pessoa do Universe",
      state: "ACTIVE",
      validFrom: new Date("2025-01-01T00:00:00.000Z"),
    });

    const view = await resolvePilotContext({ speakerCharacterId: fixture.character.id });
    if (!view) throw new Error("unreachable");
    const partner = view.relationships.find((relationship) => relationship.kind === "ROMANTIC_PARTNER");
    expect(partner?.displayName).toBe("Pessoa do Universe");
    expect(partner?.origin).toBe("UNIVERSE");
    expect(partner?.classification).toBe("DIVERGENT");
  });

  it("5) memórias entram por importância e relevância de tópico", async () => {
    const fixture = await createFixture("memories");
    await addMemory(fixture, "Vitória em Mônaco", "HIGH");
    await addMemory(fixture, "Treino de simulador", "LOW");
    const view = await resolvePilotContext({
      speakerCharacterId: fixture.character.id,
      topic: "Mônaco",
    });
    if (!view) throw new Error("unreachable");
    expect(view.memories[0]?.content).toBe("Vitória em Mônaco");
    expect(view.memories.length).toBeGreaterThanOrEqual(1);
  });

  it("6) histórico seleciona eventos pelo tópico (ano/corrida)", async () => {
    const fixture = await createFixture("history");
    await seedHistory(fixture);
    const view = await resolvePilotContext({
      speakerCharacterId: fixture.character.id,
      topic: "o que aconteceu em 2021",
    });
    if (!view) throw new Error("unreachable");
    expect(view.historicalContext[0]?.seasonYear).toBe(2021);
  });

  it("7) ausência de dados permanece ausência (vista vazia, sem invenção)", async () => {
    const fixture = await createFixture("missing", { withProfile: false });
    const view = await resolvePilotContext({ speakerCharacterId: fixture.character.id });
    if (!view) throw new Error("unreachable");
    expect(view.identity).toBeNull();
    expect(view.biography).toBeNull();
    expect(view.effectivePersona).toEqual([]);
    expect(view.relationships).toEqual([]);
    const block = composePilotContextPromptBlock(view);
    expect(block.text).not.toContain("Identidade");
    expect(block.text).not.toContain("Biografia");
    expect(block.text).not.toContain("Perfil público");
  });

  it("8) fonte stale é sinalizada sem afirmar atualidade", async () => {
    const fixture = await createFixture("stale");
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    await upsertDriverProfileFromProvider(
      fixture.driver.id,
      { publicName: "Piloto stale", biographyFacts: { publicName: "Piloto stale" } },
      old,
    );
    const view = await resolvePilotContext({ speakerCharacterId: fixture.character.id });
    if (!view) throw new Error("unreachable");
    expect(view.refresh.profile).toBe("STALE");
    const block = composePilotContextPromptBlock(view);
    expect(block.text).not.toContain("atualizado");
  });

  it("9) conflito externo é exposto como status, não como certeza", async () => {
    const fixture = await createFixture("conflict");
    await ingestPersonaEvidenceForDriver(fixture.driver.id, [
      {
        traitKey: "publicTone",
        proposedValue: "reservado",
        sourceKind: "OBSERVED_PUBLIC_BEHAVIOR",
        evidenceType: "STRUCTURED_DATA",
        summary: "s1",
        confidence: 0.8,
        source: {
          provider: "F1DB",
          sourceKind: "STRUCTURED_RELEASE",
          url: `https://f1db.example/${PREFIX}-c1`,
          license: "CC_BY_4_0",
        },
      },
      {
        traitKey: "publicTone",
        proposedValue: "expansivo",
        sourceKind: "OBSERVED_PUBLIC_BEHAVIOR",
        evidenceType: "STRUCTURED_DATA",
        summary: "s2",
        confidence: 0.8,
        source: {
          provider: "F1DB",
          sourceKind: "STRUCTURED_RELEASE",
          url: `https://f1db.example/${PREFIX}-c2`,
          license: "CC_BY_4_0",
        },
      },
    ]);
    const view = await resolvePilotContext({ speakerCharacterId: fixture.character.id });
    if (!view) throw new Error("unreachable");
    const tone = view.effectivePersona.find((trait) => trait.key === "publicTone");
    expect(tone?.status).toBe("CONFLICT");
    const block = composePilotContextPromptBlock(view);
    expect(block.text).toContain("publico".length > 0 ? "Tom público" : "");
    expect(block.text).not.toContain("conflito");
  });

  it("10) resolver é speaker-only", async () => {
    const speaker = await createFixture("speaker");
    const other = await createFixture("other");
    await addPersonaTrait(other, "communicationStyle", "trait do outro piloto");
    await addPersonaTrait(speaker, "communicationStyle", "trait do speaker");

    const view = await resolvePilotContext({ speakerCharacterId: speaker.character.id });
    if (!view) throw new Error("unreachable");
    expect(view.effectivePersona).toHaveLength(1);
    expect(view.effectivePersona[0]?.value).toBe("trait do speaker");
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(other.character.id);
    expect(serialized).not.toContain("trait do outro piloto");
  });

  it("11) fingerprint é determinístico e muda com o contexto", async () => {
    const fixture = await createFixture("fingerprint");
    await addPersonaTrait(fixture, "communicationStyle", "estilo");
    const first = await resolvePilotContext({ speakerCharacterId: fixture.character.id, now: new Date("2026-09-30T00:00:00.000Z") });
    const second = await resolvePilotContext({ speakerCharacterId: fixture.character.id, now: new Date("2026-09-30T00:00:00.000Z") });
    if (!first || !second) throw new Error("unreachable");
    expect(first.fingerprint).toBe(second.fingerprint);

    await addMemory(fixture, "Nova memória relevante", "CRITICAL");
    const third = await resolvePilotContext({ speakerCharacterId: fixture.character.id });
    if (!third) throw new Error("unreachable");
    expect(third.fingerprint).not.toBe(first.fingerprint);
  });

  it("12) prompt block não vaza confidence, URLs, ids ou evidence raw", async () => {
    const fixture = await createFixture("prompt");
    await addPersonaTrait(fixture, "humorStyle", "humor seco");
    await ingestExternalRelationships(fixture.driver.id, [
      {
        kind: "SPOUSE",
        targetType: "PUBLIC_PERSON",
        displayName: "Pessoa Pública",
        state: "ACTIVE",
        validFrom: new Date("2020-01-01T00:00:00.000Z"),
        source: {
          provider: "WIKIDATA",
          sourceKind: "DATABASE_EXPORT",
          url: `https://wikidata.example/${PREFIX}-prompt`,
          license: "CC0",
        },
      },
    ]);
    await addMemory(fixture, "Memória no Universe", "HIGH");
    await seedSeasonState(fixture);

    const view = await resolvePilotContext({ speakerCharacterId: fixture.character.id });
    if (!view) throw new Error("unreachable");
    const block = composePilotContextPromptBlock(view);
    expect(block.text.length).toBeLessThanOrEqual(2001);
    expect(block.text).not.toContain("confidence");
    expect(block.text).not.toContain("http");
    expect(block.text).not.toContain(fixture.driver.id);
    expect(block.text).not.toContain("evidence");
    expect(block.text).toContain("Humor");
    expect(block.text).toContain("Cônjuge");
    expect(block.text).toContain("Memórias no Universe");
    expect(block.text).toContain("Estado atual no Universe");
  });

  it("13) loadSpeakerPilotContext degrada para null sem speaker ou com schema ausente", async () => {
    expect(await loadSpeakerPilotContext(undefined)).toBeNull();
    const missing = await loadSpeakerPilotContext("00000000-0000-0000-0000-000000000000");
    expect(missing).toBeNull();
  });
});
