import { prisma } from "../../infrastructure/database/prisma.js";
import { JOLPICA_SOURCE } from "../external-sync/jolpica.service.js";

export const INIT_YEAR = 2031;
export const SOURCE = JOLPICA_SOURCE;
export const TEAM_EXTERNAL_ID = "uni-init-mclaren";
export const DRIVER_LANDO = "uni-init-lando-norris";
export const DRIVER_OSCAR = "uni-init-oscar-piastri";
export const DRIVER_RESERVE = "uni-init-reserve-x";

export interface InitFixtureIds {
  userId: string;
  seasonId: string;
  extSeasonId: string;
  extTeamId: string;
  extLandoId: string;
  extOscarId: string;
  extReserveId: string;
  extDsLandoId: string;
  extDsOscarId: string;
  extDsReserveId: string;
  extRace1Id: string;
  extRace2Id: string;
  extResultLando1Id: string;
  extResultOscar1Id: string;
  extResultLando2Id: string;
  extResultOscar2Id: string;
  extStandingLandoId: string;
  extStandingOscarId: string;
}

export async function seedUniverseInitFixture(
  year = INIT_YEAR,
): Promise<{
  ids: InitFixtureIds;
  cleanup: (extraUserIds?: string[]) => Promise<void>;
}> {
  await prisma.externalResult.deleteMany({
    where: { source: SOURCE, externalRace: { seasonYear: year } },
  });
  await prisma.externalStanding.deleteMany({ where: { source: SOURCE, seasonYear: year } });
  await prisma.externalDriverSeason.deleteMany({ where: { source: SOURCE, seasonYear: year } });
  await prisma.externalRace.deleteMany({ where: { source: SOURCE, seasonYear: year } });
  await prisma.externalDriver.deleteMany({
    where: { source: SOURCE, externalId: { in: [DRIVER_LANDO, DRIVER_OSCAR, DRIVER_RESERVE] } },
  });
  await prisma.externalTeam.deleteMany({
    where: { source: SOURCE, externalId: TEAM_EXTERNAL_ID },
  });
  await prisma.externalSeason.deleteMany({ where: { source: SOURCE, year } });

  const user = await prisma.user.create({
    data: {
      name: "Init Admin",
      email: `init-admin-${Date.now()}@f1nw.test`,
      password: "x",
      role: "ADMIN",
    },
  });

  const season = await prisma.season.create({
    data: { year, name: String(year), status: "PRE_SEASON" },
  });

  const extSeason = await prisma.externalSeason.create({
    data: {
      source: SOURCE,
      year,
      name: String(year),
      status: "ACTIVE",
      contentHash: "init-ext-season",
    },
  });
  const extTeam = await prisma.externalTeam.create({
    data: {
      source: SOURCE,
      externalId: TEAM_EXTERNAL_ID,
      name: "McLaren",
      shortName: "MCL",
      color: "#ff8000",
      contentHash: "init-ext-team",
    },
  });
  const extLando = await prisma.externalDriver.create({
    data: {
      source: SOURCE,
      externalId: DRIVER_LANDO,
      name: "Lando Norris",
      fullName: "Lando Norris",
      nationality: "British",
      number: 2,
      contentHash: "init-ext-lando",
    },
  });
  const extOscar = await prisma.externalDriver.create({
    data: {
      source: SOURCE,
      externalId: DRIVER_OSCAR,
      name: "Oscar Piastri",
      fullName: "Oscar Piastri",
      nationality: "Australian",
      number: 4,
      contentHash: "init-ext-oscar",
    },
  });
  const extReserve = await prisma.externalDriver.create({
    data: {
      source: SOURCE,
      externalId: DRIVER_RESERVE,
      name: "Reserve X",
      fullName: "Reserve X",
      nationality: "Unknown",
      number: 88,
      contentHash: "init-ext-reserve",
    },
  });

  const extDsLando = await prisma.externalDriverSeason.create({
    data: {
      source: SOURCE,
      externalDriverId: extLando.id,
      seasonYear: year,
      teamExternalId: TEAM_EXTERNAL_ID,
      teamNameSnapshot: "McLaren",
      number: 2,
      role: null,
      contentHash: "init-ext-ds-lando",
    },
  });
  const extDsOscar = await prisma.externalDriverSeason.create({
    data: {
      source: SOURCE,
      externalDriverId: extOscar.id,
      seasonYear: year,
      teamExternalId: TEAM_EXTERNAL_ID,
      teamNameSnapshot: "McLaren",
      number: 4,
      role: null,
      contentHash: "init-ext-ds-oscar",
    },
  });
  const extDsReserve = await prisma.externalDriverSeason.create({
    data: {
      source: SOURCE,
      externalDriverId: extReserve.id,
      seasonYear: year,
      teamExternalId: TEAM_EXTERNAL_ID,
      teamNameSnapshot: "McLaren",
      number: 88,
      role: "RESERVE",
      contentHash: "init-ext-ds-reserve",
    },
  });

  const extRace1 = await prisma.externalRace.create({
    data: {
      source: SOURCE,
      seasonYear: year,
      round: 1,
      grandPrix: "Australian Grand Prix",
      name: "Australian Grand Prix",
      circuitName: "Albert Park",
      date: new Date(`${year}-03-08`),
      status: "Finished",
      contentHash: "init-ext-race1",
    },
  });
  const extRace2 = await prisma.externalRace.create({
    data: {
      source: SOURCE,
      seasonYear: year,
      round: 2,
      grandPrix: "Chinese Grand Prix",
      name: "Chinese Grand Prix",
      circuitName: "Shanghai International Circuit",
      date: new Date(`${year}-03-22`),
      status: "Finished",
      contentHash: "init-ext-race2",
    },
  });

  const extResultLando1 = await prisma.externalResult.create({
    data: {
      source: SOURCE,
      externalRaceId: extRace1.id,
      externalDriverId: extLando.id,
      position: 1,
      points: 25,
      grid: 1,
      fastestLap: true,
      status: "Finished",
      contentHash: "init-ext-r-l1",
    },
  });
  const extResultOscar1 = await prisma.externalResult.create({
    data: {
      source: SOURCE,
      externalRaceId: extRace1.id,
      externalDriverId: extOscar.id,
      position: 2,
      points: 18,
      grid: 2,
      fastestLap: false,
      status: "Finished",
      contentHash: "init-ext-r-o1",
    },
  });
  const extResultLando2 = await prisma.externalResult.create({
    data: {
      source: SOURCE,
      externalRaceId: extRace2.id,
      externalDriverId: extLando.id,
      position: 1,
      points: 25,
      grid: 2,
      fastestLap: false,
      status: "Finished",
      contentHash: "init-ext-r-l2",
    },
  });
  const extResultOscar2 = await prisma.externalResult.create({
    data: {
      source: SOURCE,
      externalRaceId: extRace2.id,
      externalDriverId: extOscar.id,
      position: 3,
      points: 15,
      grid: 1,
      fastestLap: true,
      status: "Finished",
      contentHash: "init-ext-r-o2",
    },
  });

  const extStandingLando = await prisma.externalStanding.create({
    data: {
      source: SOURCE,
      seasonYear: year,
      externalDriverId: extLando.id,
      position: 1,
      points: 50,
      wins: 2,
      podiums: 2,
      contentHash: "init-ext-s-lando",
    },
  });
  const extStandingOscar = await prisma.externalStanding.create({
    data: {
      source: SOURCE,
      seasonYear: year,
      externalDriverId: extOscar.id,
      position: 2,
      points: 33,
      wins: 0,
      podiums: 1,
      contentHash: "init-ext-s-oscar",
    },
  });

  const ids: InitFixtureIds = {
    userId: user.id,
    seasonId: season.id,
    extSeasonId: extSeason.id,
    extTeamId: extTeam.id,
    extLandoId: extLando.id,
    extOscarId: extOscar.id,
    extReserveId: extReserve.id,
    extDsLandoId: extDsLando.id,
    extDsOscarId: extDsOscar.id,
    extDsReserveId: extDsReserve.id,
    extRace1Id: extRace1.id,
    extRace2Id: extRace2.id,
    extResultLando1Id: extResultLando1.id,
    extResultOscar1Id: extResultOscar1.id,
    extResultLando2Id: extResultLando2.id,
    extResultOscar2Id: extResultOscar2.id,
    extStandingLandoId: extStandingLando.id,
    extStandingOscarId: extStandingOscar.id,
  };

  const cleanup = async (extraUserIds: string[] = []) => {
    const userIds = [user.id, ...extraUserIds];
    const extResultIds = [
      extResultLando1.id,
      extResultOscar1.id,
      extResultLando2.id,
      extResultOscar2.id,
    ];
    const extStandingIds = [extStandingLando.id, extStandingOscar.id];
    const extDsIds = [extDsLando.id, extDsOscar.id, extDsReserve.id];
    const extRaceIds = [extRace1.id, extRace2.id];
    const extDriverIds = [extLando.id, extOscar.id, extReserve.id];

    await prisma.externalResult.deleteMany({ where: { id: { in: extResultIds } } });
    await prisma.externalStanding.deleteMany({ where: { id: { in: extStandingIds } } });
    await prisma.externalDriverSeason.deleteMany({ where: { id: { in: extDsIds } } });
    await prisma.externalRace.deleteMany({ where: { id: { in: extRaceIds } } });
    await prisma.externalTeam.deleteMany({ where: { id: extTeam.id } });
    await prisma.externalDriver.deleteMany({ where: { id: { in: extDriverIds } } });
    await prisma.externalSeason.deleteMany({ where: { id: extSeason.id } });

    await prisma.seasonDriverEntry.deleteMany({ where: { seasonId: season.id } });
    await prisma.championshipStanding.deleteMany({ where: { seasonId: season.id } });
    await prisma.raceResult.deleteMany({ where: { race: { seasonId: season.id } } });
    await prisma.race.deleteMany({ where: { seasonId: season.id } });
    await prisma.season.deleteMany({ where: { id: season.id } });

    await prisma.team.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.character.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  };

  return { ids, cleanup };
}