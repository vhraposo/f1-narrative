import { prisma } from "../../infrastructure/database/prisma.js";
import { JOLPICA_SOURCE } from "../external-sync/jolpica.service.js";

export const RECON_YEAR = 2026;

export interface ReconFixtureIds {
  userId: string;
  characterLandoId: string;
  characterAlicyaId: string;
  characterReserveXId: string;
  characterOscarId: string;
  driverLandoId: string;
  driverAlicyaId: string;
  driverReserveXId: string;
  driverOscarId: string;
  teamId: string;
  seasonId: string;
  raceId: string;
  entryLandoId: string;
  entryAlicyaId: string;
  entryReserveXId: string;
  resultLandoId: string;
  resultAlicyaId: string;
  standingLandoId: string;
  standingAlicyaId: string;
  extSeasonId: string;
  extTeamId: string;
  extLandoId: string;
  extOscarId: string;
  extReserveXId: string;
  extDsLandoId: string;
  extDsOscarId: string;
  extDsReserveXId: string;
  extRaceId: string;
  extResultLandoId: string;
  extResultOscarId: string;
  extStandingLandoId: string;
  extStandingOscarId: string;
  all: string[];
}

export async function seedReconciliationFixture(
  year = RECON_YEAR,
): Promise<{
  ids: ReconFixtureIds;
  cleanup: () => Promise<void>;
}> {
  const user = await prisma.user.create({
    data: { name: "Recon Admin", email: `recon-admin-${Date.now()}@f1nw.test`, password: "x" },
  });

  const characterLando = await prisma.character.create({
    data: { name: "Lando Norris", nationality: "British", birthDate: new Date("1999-11-13"), userId: user.id },
  });
  const characterAlicya = await prisma.character.create({
    data: { name: "Alicya Piastri", nationality: "Australian", birthDate: new Date("2001-04-06"), userId: user.id },
  });
  const characterReserveX = await prisma.character.create({
    data: { name: "Reserve X", nationality: "Unknown", birthDate: new Date("2000-01-01"), userId: user.id },
  });
  const characterOscar = await prisma.character.create({
    data: { name: "Oscar Piastri", nationality: "Australian", birthDate: new Date("2001-04-06"), userId: user.id },
  });

  const driverLando = await prisma.driverProfile.create({
    data: { characterId: characterLando.id, number: 2 },
  });
  const driverAlicya = await prisma.driverProfile.create({
    data: { characterId: characterAlicya.id, number: 2 },
  });
  const driverReserveX = await prisma.driverProfile.create({
    data: { characterId: characterReserveX.id, number: 88 },
  });
  const driverOscar = await prisma.driverProfile.create({
    data: { characterId: characterOscar.id, number: 4 },
  });

  const team = await prisma.team.create({
    data: { name: "McLaren", shortName: "MCL", color: "#ff8000", userId: user.id },
  });

  const season = await prisma.season.create({
    data: { year: year, name: String(year), status: "PRE_SEASON" },
  });

  const entryLando = await prisma.seasonDriverEntry.create({
    data: {
      seasonId: season.id,
      driverProfileId: driverLando.id,
      teamId: team.id,
      role: "RACE_SEAT",
      seat: 1,
      number: 2,
      status: "ACTIVE",
    },
  });
  const entryAlicya = await prisma.seasonDriverEntry.create({
    data: {
      seasonId: season.id,
      driverProfileId: driverAlicya.id,
      teamId: team.id,
      role: "RACE_SEAT",
      seat: 2,
      number: 2,
      status: "ACTIVE",
    },
  });
  const entryReserveX = await prisma.seasonDriverEntry.create({
    data: {
      seasonId: season.id,
      driverProfileId: driverReserveX.id,
      teamId: team.id,
      role: "RESERVE",
      seat: null,
      number: 88,
      status: "ACTIVE",
    },
  });

  const race = await prisma.race.create({
    data: {
      seasonId: season.id,
      name: "Australian Grand Prix",
      circuit: "Albert Park",
      country: "Australia",
      date: new Date("2026-03-08"),
      round: 1,
      status: "FINISHED",
    },
  });

  const resultLando = await prisma.raceResult.create({
    data: { raceId: race.id, driverProfileId: driverLando.id, position: 1, points: 25, grid: 1, fastestLap: true, status: "Finished" },
  });
  const resultAlicya = await prisma.raceResult.create({
    data: { raceId: race.id, driverProfileId: driverAlicya.id, position: 2, points: 18, grid: 2, fastestLap: false, status: "Finished" },
  });

  const standingLando = await prisma.championshipStanding.create({
    data: { seasonId: season.id, driverProfileId: driverLando.id, position: 2, points: 18, wins: 0, podiums: 1 },
  });
  const standingAlicya = await prisma.championshipStanding.create({
    data: { seasonId: season.id, driverProfileId: driverAlicya.id, position: 1, points: 25, wins: 1, podiums: 1 },
  });

  const extSeason = await prisma.externalSeason.create({
    data: { source: JOLPICA_SOURCE, year: year, name: String(year), status: "ACTIVE", contentHash: "seed-ext-season" },
  });
  const extTeam = await prisma.externalTeam.create({
    data: { source: JOLPICA_SOURCE, externalId: "mclaren", name: "McLaren", shortName: "MCL", color: "#ff8000", contentHash: "seed-ext-team" },
  });
  const extLando = await prisma.externalDriver.create({
    data: { source: JOLPICA_SOURCE, externalId: "lando-norris", name: "Lando Norris", fullName: "Lando Norris", nationality: "British", number: 2, contentHash: "seed-ext-lando" },
  });
  const extOscar = await prisma.externalDriver.create({
    data: { source: JOLPICA_SOURCE, externalId: "oscar-piastri", name: "Oscar Piastri", fullName: "Oscar Piastri", nationality: "Australian", number: 4, contentHash: "seed-ext-oscar" },
  });
  const extReserveX = await prisma.externalDriver.create({
    data: { source: JOLPICA_SOURCE, externalId: "reserve-x", name: "Reserve X", fullName: "Reserve X", nationality: "Unknown", number: 88, contentHash: "seed-ext-reserve" },
  });

  const extDsLando = await prisma.externalDriverSeason.create({
    data: { source: JOLPICA_SOURCE, externalDriverId: extLando.id, seasonYear: year, teamExternalId: "mclaren", teamNameSnapshot: "McLaren", number: 2, role: null, contentHash: "seed-ext-ds-lando" },
  });
  const extDsOscar = await prisma.externalDriverSeason.create({
    data: { source: JOLPICA_SOURCE, externalDriverId: extOscar.id, seasonYear: year, teamExternalId: "mclaren", teamNameSnapshot: "McLaren", number: 4, role: null, contentHash: "seed-ext-ds-oscar" },
  });
  const extDsReserveX = await prisma.externalDriverSeason.create({
    data: { source: JOLPICA_SOURCE, externalDriverId: extReserveX.id, seasonYear: year, teamExternalId: "mclaren", teamNameSnapshot: "McLaren", number: 88, role: "RESERVE", contentHash: "seed-ext-ds-reserve" },
  });

  const extRace = await prisma.externalRace.create({
    data: { source: JOLPICA_SOURCE, seasonYear: year, round: 1, grandPrix: "Australian Grand Prix", name: "Australian Grand Prix", circuitName: "Albert Park", date: new Date("2026-03-08"), status: null, contentHash: "seed-ext-race" },
  });

  const extResultLando = await prisma.externalResult.create({
    data: { source: JOLPICA_SOURCE, externalRaceId: extRace.id, externalDriverId: extLando.id, position: 1, points: 25, grid: 1, fastestLap: true, status: "Finished", contentHash: "seed-ext-r-lando" },
  });
  const extResultOscar = await prisma.externalResult.create({
    data: { source: JOLPICA_SOURCE, externalRaceId: extRace.id, externalDriverId: extOscar.id, position: 2, points: 18, grid: 2, fastestLap: false, status: "Finished", contentHash: "seed-ext-r-oscar" },
  });

  const extStandingLando = await prisma.externalStanding.create({
    data: { source: JOLPICA_SOURCE, seasonYear: year, externalDriverId: extLando.id, position: 1, points: 25, wins: 1, podiums: 1, contentHash: "seed-ext-s-lando" },
  });
  const extStandingOscar = await prisma.externalStanding.create({
    data: { source: JOLPICA_SOURCE, seasonYear: year, externalDriverId: extOscar.id, position: 2, points: 18, wins: 0, podiums: 0, contentHash: "seed-ext-s-oscar" },
  });

  const ids: ReconFixtureIds = {
    userId: user.id,
    characterLandoId: characterLando.id,
    characterAlicyaId: characterAlicya.id,
    characterReserveXId: characterReserveX.id,
    characterOscarId: characterOscar.id,
    driverLandoId: driverLando.id,
    driverAlicyaId: driverAlicya.id,
    driverReserveXId: driverReserveX.id,
    driverOscarId: driverOscar.id,
    teamId: team.id,
    seasonId: season.id,
    raceId: race.id,
    entryLandoId: entryLando.id,
    entryAlicyaId: entryAlicya.id,
    entryReserveXId: entryReserveX.id,
    resultLandoId: resultLando.id,
    resultAlicyaId: resultAlicya.id,
    standingLandoId: standingLando.id,
    standingAlicyaId: standingAlicya.id,
    extSeasonId: extSeason.id,
    extTeamId: extTeam.id,
    extLandoId: extLando.id,
    extOscarId: extOscar.id,
    extReserveXId: extReserveX.id,
    extDsLandoId: extDsLando.id,
    extDsOscarId: extDsOscar.id,
    extDsReserveXId: extDsReserveX.id,
    extRaceId: extRace.id,
    extResultLandoId: extResultLando.id,
    extResultOscarId: extResultOscar.id,
    extStandingLandoId: extStandingLando.id,
    extStandingOscarId: extStandingOscar.id,
    all: [
      user.id,
      characterLando.id,
      characterAlicya.id,
      characterReserveX.id,
      characterOscar.id,
      driverLando.id,
      driverAlicya.id,
      driverReserveX.id,
      driverOscar.id,
      team.id,
      season.id,
      race.id,
      entryLando.id,
      entryAlicya.id,
      entryReserveX.id,
      resultLando.id,
      resultAlicya.id,
      standingLando.id,
      standingAlicya.id,
      extSeason.id,
      extTeam.id,
      extLando.id,
      extOscar.id,
      extReserveX.id,
      extDsLando.id,
      extDsOscar.id,
      extDsReserveX.id,
      extRace.id,
      extResultLando.id,
      extResultOscar.id,
      extStandingLando.id,
      extStandingOscar.id,
    ],
  };

  const cleanup = async () => {
    await prisma.externalResult.deleteMany({ where: { id: { in: [extResultLando.id, extResultOscar.id] } } });
    await prisma.externalStanding.deleteMany({ where: { id: { in: [extStandingLando.id, extStandingOscar.id] } } });
    await prisma.externalDriverSeason.deleteMany({ where: { id: { in: [extDsLando.id, extDsOscar.id, extDsReserveX.id] } } });
    await prisma.externalRace.deleteMany({ where: { id: extRace.id } });
    await prisma.externalTeam.deleteMany({ where: { id: extTeam.id } });
    await prisma.externalDriver.deleteMany({ where: { id: { in: [extLando.id, extOscar.id, extReserveX.id] } } });
    await prisma.externalSeason.deleteMany({ where: { id: extSeason.id } });
    await prisma.seasonDriverEntry.deleteMany({ where: { id: { in: [entryLando.id, entryAlicya.id, entryReserveX.id] } } });
    await prisma.raceResult.deleteMany({ where: { id: { in: [resultLando.id, resultAlicya.id] } } });
    await prisma.championshipStanding.deleteMany({ where: { id: { in: [standingLando.id, standingAlicya.id] } } });
    await prisma.race.deleteMany({ where: { id: race.id } });
    await prisma.season.deleteMany({ where: { id: season.id } });
    await prisma.driverProfile.deleteMany({ where: { id: { in: [driverLando.id, driverAlicya.id, driverReserveX.id, driverOscar.id] } } });
    await prisma.character.deleteMany({ where: { id: { in: [characterLando.id, characterAlicya.id, characterReserveX.id, characterOscar.id] } } });
    await prisma.team.deleteMany({ where: { id: team.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  };

  return { ids, cleanup };
}