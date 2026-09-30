import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import { deleteUniverseDataForUsers } from "../../test-utils/universe-cleanup.js";
import { previewCorrection } from "../timeline/correction.preview.js";
import { applyCorrection } from "../timeline/correction.apply.js";
import { reconcilePilotExperiences } from "./pilot-experience.reconcile.js";

const PREFIX = "px-rec";
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];

afterAll(async () => {
  await prisma.memory.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
  await prisma.pilotExperience.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
  await deleteUniverseDataForUsers(prisma, createdUserIds);
  await prisma.timelineEvent.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
  await prisma.worldSnapshot.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
  await prisma.worldState.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
  await prisma.universe.deleteMany({ where: { id: { in: createdUniverseIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
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
  const universe = await prisma.universe.create({ data: { userId: user.id, status: "READY" } });
  createdUniverseIds.push(universe.id);
  const team = await prisma.team.create({
    data: { universeId: universe.id, userId: user.id, name: `${PREFIX} Team ${label}` },
  });
  const season = await prisma.season.create({
    data: { universeId: universe.id, year: 2026, name: "2026", status: "FINISHED" },
  });
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
  const driverProfileId = (
    await prisma.driverProfile.findUniqueOrThrow({ where: { characterId: character.id }, select: { id: true } })
  ).id;
  await prisma.seasonDriverEntry.create({
    data: { seasonId: season.id, driverProfileId, teamId: team.id, number: 7, status: "ACTIVE" },
  });
  await prisma.championshipStanding.create({
    data: { seasonId: season.id, driverProfileId, position: 1, points: 250, wins: 8, podiums: 12 },
  });
  const race = await prisma.race.create({
    data: {
      seasonId: season.id,
      round: 1,
      name: `${PREFIX} GP ${label}`,
      date: new Date("2026-03-01T00:00:00.000Z"),
      status: "FINISHED",
    },
  });
  await prisma.raceResult.create({
    data: { raceId: race.id, driverProfileId, position: 1, points: 25, grid: 1, status: "Finished" },
  });
  const timelineEvent = await prisma.timelineEvent.create({
    data: {
      universeId: universe.id,
      sequence: 1,
      worldDate: new Date("2026-03-01T00:00:00.000Z"),
      kind: "RACE_RESULT_CORRECTED",
      payload: { raceId: race.id },
    },
  });
  await prisma.worldState.create({
    data: {
      universeId: universe.id,
      key: "default",
      currentDate: new Date("2026-12-31T00:00:00.000Z"),
      currentSeasonId: season.id,
      currentRaceId: race.id,
    },
  });
  return { user, universe, season, race, character, driverProfileId, timelineEvent };
}

describe("pilot experience reconciliation", () => {
  it("1) reconcilia e é idempotente (segunda execução é no-op)", async () => {
    const fixture = await createFixture("idem");
    const first = await reconcilePilotExperiences({
      universeId: fixture.universe.id,
      characterId: fixture.character.id,
    });
    expect(first.experiences.created).toBeGreaterThan(0);
    expect(first.memories.created).toBeGreaterThan(0);

    const experiences = await prisma.pilotExperience.findMany({
      where: { characterId: fixture.character.id },
    });
    const memories = await prisma.memory.findMany({
      where: { universeId: fixture.universe.id, derivation: { not: "MANUAL" } },
    });
    expect(experiences.every((experience) => experience.status === "ACTIVE")).toBe(true);

    const second = await reconcilePilotExperiences({
      universeId: fixture.universe.id,
      characterId: fixture.character.id,
    });
    expect(second.experiences.created).toBe(0);
    expect(second.experiences.invalidated).toBe(0);
    expect(second.memories.created).toBe(0);
    expect(second.memories.superseded).toBe(0);
    expect(second.memories.invalidated).toBe(0);
    expect(await prisma.pilotExperience.count({ where: { characterId: fixture.character.id } })).toBe(
      experiences.length,
    );
    expect(
      await prisma.memory.count({ where: { universeId: fixture.universe.id, derivation: { not: "MANUAL" } } }),
    ).toBe(memories.length);

    const championship = memories.find((memory) => memory.memoryType === "CHAMPIONSHIP");
    expect(championship?.importance).toBe("CRITICAL");
    expect(championship?.derivedKey).toContain(":champion:championship-memory");
    const firstWin = memories.find((memory) => memory.derivedKey?.includes(":first-win-memory"));
    expect(firstWin?.memoryType).toBe("SPORTING_VICTORY");
    const dnfMemories = memories.filter((memory) => memory.derivedKey?.includes(":dnf"));
    expect(dnfMemories).toHaveLength(0);
  });

  it("2) memória manual é preservada e nunca sobrescrita", async () => {
    const fixture = await createFixture("manual");
    const manual = await prisma.memory.create({
      data: {
        universeId: fixture.universe.id,
        derivation: "MANUAL",
        status: "ACTIVE",
        importance: "HIGH",
        source: "USER_DEFINED",
        content: "Memória manual do usuário",
        participants: { create: [{ characterId: fixture.character.id }] },
      },
    });
    const report = await reconcilePilotExperiences({
      universeId: fixture.universe.id,
      characterId: fixture.character.id,
    });
    expect(report.memories.manualPreserved).toBe(1);
    const stored = await prisma.memory.findUniqueOrThrow({ where: { id: manual.id } });
    expect(stored.status).toBe("ACTIVE");
    expect(stored.content).toBe("Memória manual do usuário");
    expect(stored.derivation).toBe("MANUAL");
    expect(stored.revision).toBe(1);
  });

  it("3) correção invalida experiência/memória na transação; chat não vê como atual", async () => {
    const fixture = await createFixture("correct");
    await reconcilePilotExperiences({
      universeId: fixture.universe.id,
      characterId: fixture.character.id,
    });
    const winExperience = await prisma.pilotExperience.findFirstOrThrow({
      where: { characterId: fixture.character.id, sourceKey: `race:${fixture.race.id}:win` },
    });
    const winMemory = await prisma.memory.findFirstOrThrow({
      where: { experienceId: winExperience.id, status: "ACTIVE" },
    });

    const command = {
      kind: "RACE_RESULT_CORRECTED" as const,
      worldDate: new Date("2026-03-02T00:00:00.000Z"),
      raceId: fixture.race.id,
      driverProfileId: fixture.driverProfileId,
      position: 5,
      supersedesId: null,
    };
    const preview = await previewCorrection(fixture.universe.id, command);
    await applyCorrection(fixture.universe.id, command, preview.previewToken);

    const winAfter = await prisma.pilotExperience.findUniqueOrThrow({ where: { id: winExperience.id } });
    expect(winAfter.status).toBe("INVALIDATED");
    const memoryAfter = await prisma.memory.findUniqueOrThrow({ where: { id: winMemory.id } });
    expect(memoryAfter.status).toBe("INVALIDATED");

    const report = await reconcilePilotExperiences({
      universeId: fixture.universe.id,
      characterId: fixture.character.id,
    });
    expect(report.experiences.invalidated).toBe(0);
    const stillInvalidated = await prisma.memory.findUniqueOrThrow({ where: { id: winMemory.id } });
    expect(stillInvalidated.status).toBe("INVALIDATED");
    const activeWinMemories = await prisma.memory.count({
      where: { experienceId: winExperience.id, status: "ACTIVE" },
    });
    expect(activeWinMemories).toBe(0);
  });

  it("4) correção de resultado que tira o título gera SPORTING_DEFEAT e invalidada a memória antiga", async () => {
    const fixture = await createFixture("title");
    const opponent = await prisma.character.create({
      data: {
        universeId: fixture.universe.id,
        controlledBy: "AI",
        name: `${PREFIX} Opponent`,
        nationality: "ITA",
        birthDate: new Date("2000-01-01T00:00:00.000Z"),
        driverProfile: { create: { number: 9 } },
      },
    });
    const opponentProfileId = (
      await prisma.driverProfile.findUniqueOrThrow({
        where: { characterId: opponent.id },
        select: { id: true },
      })
    ).id;
    await prisma.raceResult.create({
      data: {
        raceId: fixture.race.id,
        driverProfileId: opponentProfileId,
        position: 2,
        points: 18,
        grid: 2,
        status: "Finished",
      },
    });

    await reconcilePilotExperiences({
      universeId: fixture.universe.id,
      characterId: fixture.character.id,
    });
    const titleExperience = await prisma.pilotExperience.findFirstOrThrow({
      where: { characterId: fixture.character.id, sourceKey: `season:${fixture.season.id}:champion` },
    });
    const titleMemory = await prisma.memory.findFirstOrThrow({
      where: { experienceId: titleExperience.id, status: "ACTIVE" },
    });

    const command = {
      kind: "RACE_RESULT_CORRECTED" as const,
      worldDate: new Date("2026-04-01T00:00:00.000Z"),
      raceId: fixture.race.id,
      driverProfileId: fixture.driverProfileId,
      position: 5,
      supersedesId: null,
    };
    const preview = await previewCorrection(fixture.universe.id, command);
    await applyCorrection(fixture.universe.id, command, preview.previewToken);

    expect((await prisma.memory.findUniqueOrThrow({ where: { id: titleMemory.id } })).status).toBe(
      "INVALIDATED",
    );

    const report = await reconcilePilotExperiences({
      universeId: fixture.universe.id,
      characterId: fixture.character.id,
    });
    expect(report.experiences.created).toBeGreaterThan(0);
    const defeat = await prisma.pilotExperience.findFirst({
      where: {
        characterId: fixture.character.id,
        experienceType: "SPORTING_DEFEAT",
        status: "ACTIVE",
      },
    });
    expect(defeat).not.toBeNull();
    const defeatMemory = await prisma.memory.findFirst({
      where: { experienceId: defeat?.id, status: "ACTIVE" },
    });
    expect(defeatMemory?.memoryType).toBe("SPORTING_DEFEAT");
    expect(defeatMemory?.importance).toBe("HIGH");
    const activeChampionship = await prisma.memory.count({
      where: { experienceId: titleExperience.id, status: "ACTIVE" },
    });
    expect(activeChampionship).toBe(0);
    const championshipExperiences = await prisma.pilotExperience.count({
      where: {
        characterId: fixture.character.id,
        experienceType: "CHAMPIONSHIP",
        status: "ACTIVE",
      },
    });
    expect(championshipExperiences).toBe(0);
  });

  it("5) primeira vitória muda ⇒ memória antiga SUPERSEDED com revision nova", async () => {
    const fixture = await createFixture("supersede");
    await reconcilePilotExperiences({
      universeId: fixture.universe.id,
      characterId: fixture.character.id,
    });
    const oldMemory = await prisma.memory.findFirstOrThrow({
      where: { universeId: fixture.universe.id, derivedKey: { contains: ":first-win-memory" } },
    });
    expect(oldMemory.memoryType).toBe("SPORTING_VICTORY");

    const earlyRace = await prisma.race.create({
      data: {
        seasonId: fixture.season.id,
        round: 0,
        name: `${PREFIX} GP anterior`,
        date: new Date("2026-02-01T00:00:00.000Z"),
        status: "FINISHED",
      },
    });
    await prisma.raceResult.create({
      data: {
        raceId: earlyRace.id,
        driverProfileId: fixture.driverProfileId,
        position: 1,
        points: 25,
        grid: 1,
        status: "Finished",
      },
    });

    const report = await reconcilePilotExperiences({
      universeId: fixture.universe.id,
      characterId: fixture.character.id,
    });
    expect(report.memories.invalidated).toBeGreaterThanOrEqual(1);
    const oldAfter = await prisma.memory.findUniqueOrThrow({ where: { id: oldMemory.id } });
    expect(oldAfter.status).toBe("INVALIDATED");
    const replacement = await prisma.memory.findFirst({
      where: {
        universeId: fixture.universe.id,
        derivedKey: `race:${fixture.race.id}:win:win-memory`,
        status: "ACTIVE",
      },
    });
    expect(replacement?.memoryType).toBe("SIGNIFICANT_RACE");
    const newFirstWin = await prisma.memory.findFirst({
      where: {
        universeId: fixture.universe.id,
        derivedKey: { contains: ":first-win-memory" },
        status: "ACTIVE",
      },
    });
    expect(newFirstWin?.memoryType).toBe("SPORTING_VICTORY");
  });

  it("6) isolamento: outro Universe não é afetado pela reconciliação", async () => {
    const fixture = await createFixture("scope-a");
    const other = await createFixture("scope-b");
    await reconcilePilotExperiences({
      universeId: fixture.universe.id,
      characterId: fixture.character.id,
    });
    await reconcilePilotExperiences({
      universeId: other.universe.id,
      characterId: other.character.id,
    });
    expect(
      await prisma.memory.count({ where: { universeId: fixture.universe.id, derivation: { not: "MANUAL" } } }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.memory.count({ where: { universeId: other.universe.id, derivation: { not: "MANUAL" } } }),
    ).toBeGreaterThan(0);
    const crossUniverse = await prisma.memory.count({
      where: {
        universeId: fixture.universe.id,
        participants: { some: { characterId: other.character.id } },
      },
    });
    expect(crossUniverse).toBe(0);
  });
});
