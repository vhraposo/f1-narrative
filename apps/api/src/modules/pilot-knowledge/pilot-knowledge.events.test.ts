import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import { deleteKnowledgeSourcesForDrivers } from "../../test-utils/pilot-knowledge-cleanup.js";
import {
  deriveMilestonesFromExternalData,
  getPilotHistoryView,
  ingestCuratedDriverEvents,
  selectRelevantEvents,
} from "./pilot-knowledge.events.js";

const PREFIX = "pk-evt";
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

async function createFixture(label: string) {
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
  return { user, universe, driver, character };
}

async function seedCareer(
  driverId: string,
  entries: ReadonlyArray<{
    year: number;
    round: number;
    name: string;
    position: number | null;
    grid?: number | null;
    points?: number | null;
    date?: string;
  }>,
  options?: { readonly seasons?: ReadonlyArray<{ year: number; team: string }>; readonly titles?: readonly number[] },
) {
  for (const entry of entries) {
    const race = await prisma.externalRace.create({
      data: {
        source: "jolpica",
        seasonYear: entry.year,
        round: entry.round,
        name: entry.name,
        grandPrix: entry.name,
        date: entry.date ? new Date(entry.date) : null,
        contentHash: `race-${driverId}-${entry.year}-${entry.round}`,
      },
    });
    createdExternalRaceIds.push(race.id);
    await prisma.externalResult.create({
      data: {
        source: "jolpica",
        externalRaceId: race.id,
        externalDriverId: driverId,
        position: entry.position,
        grid: entry.grid ?? null,
        points: entry.points ?? null,
        status: "Finished",
        contentHash: `result-${driverId}-${entry.year}-${entry.round}`,
      },
    });
  }
  for (const season of options?.seasons ?? []) {
    const existing = await prisma.externalDriverSeason.findFirst({
      where: { externalDriverId: driverId, seasonYear: season.year },
    });
    if (existing) {
      await prisma.externalDriverSeason.update({
        where: { id: existing.id },
        data: { teamNameSnapshot: season.team },
      });
      continue;
    }
    await prisma.externalDriverSeason.create({
      data: {
        source: "jolpica",
        externalDriverId: driverId,
        seasonYear: season.year,
        teamNameSnapshot: season.team,
        contentHash: `season-${driverId}-${season.year}`,
      },
    });
  }
  for (const year of options?.titles ?? []) {
    await prisma.externalStanding.create({
      data: {
        source: "jolpica",
        seasonYear: year,
        externalDriverId: driverId,
        position: 1,
        points: 400,
        wins: 10,
        contentHash: `standing-${driverId}-${year}`,
      },
    });
  }
}

describe("pilot historical events", () => {
  it("1) deriva marcos determinísticos da carreira e é idempotente", async () => {
    const { driver } = await createFixture("derive");
    await seedCareer(
      driver.id,
      [
        { year: 2015, round: 1, name: "GP A", position: 12, grid: 8, points: 0, date: "2015-03-15" },
        { year: 2015, round: 5, name: "GP B", position: 8, grid: 6, points: 4, date: "2015-05-10" },
        { year: 2016, round: 2, name: "GP C", position: 3, grid: 1, points: 15, date: "2016-04-03" },
        { year: 2016, round: 8, name: "GP D", position: 1, grid: 2, points: 25, date: "2016-06-12" },
      ],
      { seasons: [{ year: 2015, team: "Toro Rosso" }, { year: 2016, team: "Red Bull" }], titles: [2021] },
    );

    const first = await deriveMilestonesFromExternalData(driver.id);
    const categories = first.map((event) => event.category).sort();
    expect(categories).toContain("F1_DEBUT");
    expect(categories).toContain("FIRST_POINT");
    expect(categories).toContain("FIRST_PODIUM");
    expect(categories).toContain("FIRST_POLE");
    expect(categories).toContain("FIRST_WIN");
    expect(categories).toContain("CHAMPIONSHIP");
    expect(categories).toContain("FIRST_CHAMPIONSHIP");
    expect(categories).toContain("TEAM_CHANGE");

    const debut = first.find((event) => event.category === "F1_DEBUT");
    expect(debut?.seasonYear).toBe(2015);
    expect(debut?.externalRaceId).not.toBeNull();
    expect(first.find((event) => event.category === "CHAMPIONSHIP")?.seasonYear).toBe(2021);

    const countAfterFirst = await prisma.externalDriverEvent.count({
      where: { externalDriverId: driver.id },
    });
    await deriveMilestonesFromExternalData(driver.id);
    const countAfterSecond = await prisma.externalDriverEvent.count({
      where: { externalDriverId: driver.id },
    });
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it("2) eventos não duplicam RaceResult do Universe", async () => {
    const { universe, driver } = await createFixture("nodup");
    await seedCareer(driver.id, [
      { year: 2020, round: 1, name: "GP X", position: 5, grid: 5, points: 10, date: "2020-03-01" },
    ]);
    await deriveMilestonesFromExternalData(driver.id);
    const raceResultCount = await prisma.raceResult.count({
      where: { driverProfile: { character: { universeId: universe.id } } },
    });
    const eventCount = await prisma.externalDriverEvent.count({ where: { externalDriverId: driver.id } });
    expect(raceResultCount).toBe(0);
    expect(eventCount).toBeGreaterThan(0);
  });

  it("3) eventos curados registram source e nível de importancia", async () => {
    const { driver } = await createFixture("curated");
    const saved = await ingestCuratedDriverEvents(driver.id, [
      {
        category: "MAJOR_CAREER_MILESTONE",
        title: "Lançou projeto social",
        seasonYear: 2024,
        summary: "Iniciativa pública divulgada pela equipe.",
        importance: 4,
        source: {
          provider: "TEAM_OFFICIAL",
          sourceKind: "OFFICIAL_PROFILE",
          url: `https://team.example/${PREFIX}-curated`,
          title: "Perfil oficial",
          license: "PROPRIETARY_REFERENCE_ONLY",
        },
      },
    ]);
    expect(saved).toHaveLength(1);
    const row = await prisma.externalDriverEvent.findUniqueOrThrow({ where: { id: saved[0]?.id as string } });
    expect(row.derivation).toBe("CURATED_SOURCE");
    expect(row.sourceId).not.toBeNull();
    expect(row.importance).toBe(4);
  });

  it("4) relevância prioriza ano e corrida mencionados", () => {
    const events = [
      {
        id: "a",
        category: "CHAMPIONSHIP" as const,
        title: "Campeão mundial em 2021",
        seasonYear: 2021,
        eventDate: null,
        importance: 5,
        externalRaceId: null,
        raceName: null,
      },
      {
        id: "b",
        category: "FIRST_WIN" as const,
        title: "Primeira vitória em 2025",
        seasonYear: 2025,
        eventDate: new Date("2025-05-25"),
        importance: 5,
        externalRaceId: "r-monaco",
        raceName: "GP de Mônaco",
      },
      {
        id: "c",
        category: "F1_DEBUT" as const,
        title: "Estreia em 2015",
        seasonYear: 2015,
        eventDate: new Date("2015-03-15"),
        importance: 5,
        externalRaceId: null,
        raceName: null,
      },
    ];
    expect(selectRelevantEvents(events, "o que aconteceu em 2025", 2)[0]?.id).toBe("b");
    expect(selectRelevantEvents(events, "como foi o GP de Mônaco?", 2)[0]?.id).toBe("b");
    expect(selectRelevantEvents(events, null, 1)[0]?.id).toBe("b");
    expect(selectRelevantEvents(events, "2009", 3).map((event) => event.id)).toContain("a");
  });

  it("5) view vincula season e race do Universe por binding", async () => {
    const { universe, driver, character } = await createFixture("link");
    await seedCareer(driver.id, [
      { year: 2024, round: 3, name: "GP Link", position: 1, grid: 1, points: 25, date: "2024-04-07" },
    ]);
    await deriveMilestonesFromExternalData(driver.id);

    const season = await prisma.season.create({
      data: { universeId: universe.id, year: 2024, name: "2024", status: "ACTIVE" },
    });
    const race = await prisma.race.create({
      data: {
        seasonId: season.id,
        round: 3,
        name: "GP Link",
        date: new Date("2024-04-07"),
        status: "FINISHED",
        provenance: "IMPORTED",
      },
    });
    const externalRace = await prisma.externalRace.findFirstOrThrow({
      where: { source: "jolpica", seasonYear: 2024, round: 3 },
    });
    await prisma.externalBindingRace.create({
      data: { universeId: universe.id, externalRaceId: externalRace.id, raceId: race.id },
    });

    const view = await getPilotHistoryView(character.id, { topic: "GP Link" });
    if (!view.available) throw new Error("unreachable");
    const win = view.events.find((event) => event.category === "FIRST_WIN");
    expect(win?.link.seasonId).toBe(season.id);
    expect(win?.link.raceId).toBe(race.id);
    expect(view.relevant.some((event) => event.id === win?.id)).toBe(true);
    expect(view.relevant.every((event) => event.seasonYear === 2024)).toBe(true);
  });

  it("6) view explica indisponibilidade e carreira sem fatos", async () => {
    const { character } = await createFixture("empty");
    const view = await getPilotHistoryView(character.id);
    if (!view.available) throw new Error("unreachable");
    expect(view.events).toEqual([]);
    expect(view.relevant).toEqual([]);
  });
});
