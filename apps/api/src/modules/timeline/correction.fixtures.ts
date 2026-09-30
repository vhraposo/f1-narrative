import { prisma } from "../../infrastructure/database/prisma.js";

export type CorrectionFixture = {
  universeId: string;
  seasonId: string;
  nextSeasonId: string;
  raceId: string;
  driver1Id: string;
  driver2Id: string;
  worldDate: Date;
  cleanup: () => Promise<void>;
};

export async function seedCorrectionFixture(
  label: string,
  year: number,
  attached?: { userId: string; universeId: string },
): Promise<CorrectionFixture> {
  const user = attached
    ? null
    : await prisma.user.create({
        data: {
          name: `corr-fixture-${label}`,
          email: `corr-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@f1nw.test`,
          password: null,
          emailVerified: true,
        },
      });
  const universe = attached
    ? { id: attached.universeId }
    : await prisma.universe.create({
        data: { userId: user!.id, status: "READY" },
      });
  const season = await prisma.season.create({
    data: { universeId: universe.id, year, name: String(year), status: "ACTIVE" },
  });
  const nextSeason = await prisma.season.create({
    data: {
      universeId: universe.id,
      year: year + 1,
      name: String(year + 1),
      status: "PRE_SEASON",
    },
  });

  async function createDriver(driverLabel: string) {
    const character = await prisma.character.create({
      data: {
        name: `corr-${label}-${driverLabel}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        nationality: "BR",
        birthDate: new Date("1995-01-01"),
        controlledBy: "AI",
        universeId: universe.id,
      },
    });
    const profile = await prisma.driverProfile.create({
      data: { characterId: character.id },
    });
    return profile.id;
  }

  const driver1Id = await createDriver("d1");
  const driver2Id = await createDriver("d2");

  await prisma.seasonDriverEntry.create({
    data: {
      seasonId: season.id,
      driverProfileId: driver1Id,
      number: 7,
      role: "RACE_SEAT",
      status: "ACTIVE",
    },
  });
  await prisma.seasonDriverEntry.create({
    data: {
      seasonId: season.id,
      driverProfileId: driver2Id,
      number: 1,
      role: "RACE_SEAT",
      status: "ACTIVE",
    },
  });
  await prisma.seasonDriverEntry.create({
    data: {
      seasonId: nextSeason.id,
      driverProfileId: driver2Id,
      number: 1,
      role: "RACE_SEAT",
      status: "ACTIVE",
    },
  });

  const race = await prisma.race.create({
    data: {
      seasonId: season.id,
      name: `GP Correção ${year}`,
      round: 1,
      date: new Date(`${year}-03-01T00:00:00.000Z`),
      status: "FINISHED",
    },
  });

  await prisma.raceResult.create({
    data: {
      raceId: race.id,
      driverProfileId: driver2Id,
      position: 1,
      grid: 1,
      points: 25,
      status: "Finished",
    },
  });
  await prisma.raceResult.create({
    data: {
      raceId: race.id,
      driverProfileId: driver1Id,
      position: 2,
      grid: 2,
      points: 18,
      status: "Finished",
    },
  });
  await prisma.championshipStanding.create({
    data: {
      seasonId: season.id,
      driverProfileId: driver2Id,
      points: 25,
      wins: 1,
      podiums: 1,
      position: 1,
    },
  });
  await prisma.championshipStanding.create({
    data: {
      seasonId: season.id,
      driverProfileId: driver1Id,
      points: 18,
      wins: 0,
      podiums: 1,
      position: 2,
    },
  });

  const worldDate = new Date(`${year}-12-01T00:00:00.000Z`);
  await prisma.worldState.create({
    data: {
      universeId: universe.id,
      key: "default",
      currentDate: worldDate,
      currentSeasonId: season.id,
    },
  });
  await prisma.timelineEvent.create({
    data: {
      universeId: universe.id,
      sequence: 1,
      worldDate,
      kind: "WORLD_ADVANCED",
      payload: {
        currentDate: worldDate.toISOString(),
        currentSeasonId: season.id,
        currentRaceId: null,
        currentSession: null,
      },
      causedBy: "USER",
    },
  });

  return {
    universeId: universe.id,
    seasonId: season.id,
    nextSeasonId: nextSeason.id,
    raceId: race.id,
    driver1Id,
    driver2Id,
    worldDate,
    cleanup: async () => {
      await prisma.timelineEvent.deleteMany({
        where: { universeId: universe.id },
      });
      await prisma.worldSnapshot.deleteMany({
        where: { universeId: universe.id },
      });
      await prisma.eventCharacter.deleteMany({
        where: { character: { universeId: universe.id } },
      });
      await prisma.championshipStanding.deleteMany({
        where: { seasonId: { in: [season.id, nextSeason.id] } },
      });
      await prisma.raceSessionResult.deleteMany({
        where: { race: { seasonId: season.id } },
      });
      await prisma.raceResult.deleteMany({
        where: { race: { seasonId: season.id } },
      });
      await prisma.seasonDriverEntry.deleteMany({
        where: { seasonId: { in: [season.id, nextSeason.id] } },
      });
      await prisma.race.deleteMany({ where: { seasonId: season.id } });
      await prisma.character.deleteMany({
        where: { universeId: universe.id },
      });
      await prisma.season.deleteMany({
        where: { id: { in: [season.id, nextSeason.id] } },
      });
      if (!attached) {
        await prisma.universe.delete({ where: { id: universe.id } });
        await prisma.user.delete({ where: { id: user!.id } });
      }
    },
  };
}
