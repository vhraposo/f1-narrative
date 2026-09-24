import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";

type TestUser = { cookie: string; userId: string };

const createdSeasonIds: string[] = [];
const createdRaceIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdTeamIds: string[] = [];

let app: FastifyInstance;
let owner: TestUser;

let mainSeasonId: string;
let mainTeamId: string;
let mainDriverA: string;
let mainDriverB: string;
let multiSeasonId: string;
let dnfSeasonId: string;

type SeasonShim = { id: string };

async function createUser(email: string, name: string): Promise<TestUser> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name, email, password: "champ-sim-strong-1" },
  });
  expect(res.statusCode).toBe(200);
  const cookie = (res.cookies ?? [])
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookie, userId: user.id };
}

async function createCharacter(user: TestUser, name: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/characters",
    headers: { cookie: user.cookie },
    payload: { name, nationality: "BR", birthDate: "1990-01-01" },
  });
  expect(res.statusCode).toBe(201);
  const character = res.json().character as { id: string };
  createdCharacterIds.push(character.id);
  return character;
}

async function createDriver(user: TestUser, characterId: string) {
  const res = await app.inject({
    method: "PUT",
    url: `/api/drivers/${characterId}`,
    headers: { cookie: user.cookie },
    payload: { name: "Piloto Teste" },
  });
  expect(res.statusCode).toBe(200);
  const driver = res.json().driver as { id: string };
  return { driverProfileId: driver.id };
}

async function createTeam(user: TestUser, name: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/teams",
    headers: { cookie: user.cookie },
    payload: { name },
  });
  expect(res.statusCode).toBe(201);
  const team = res.json().team as { id: string };
  createdTeamIds.push(team.id);
  return team;
}

async function createSeason(user: TestUser, year: number) {
  const res = await app.inject({
    method: "POST",
    url: "/api/seasons",
    headers: { cookie: user.cookie },
    payload: { year },
  });
  expect(res.statusCode).toBe(201);
  const season = res.json().season as SeasonShim;
  createdSeasonIds.push(season.id);
  return season;
}

async function createRace(
  user: TestUser,
  seasonId: string,
  round: number,
  name: string,
) {
  const res = await app.inject({
    method: "POST",
    url: `/api/seasons/${seasonId}/races`,
    headers: { cookie: user.cookie },
    payload: {
      name,
      circuit: "Interlagos",
      country: "Brasil",
      date: `2099-0${round}-15T14:00:00.000Z`,
      round,
    },
  });
  expect(res.statusCode).toBe(201);
  const race = res.json().race as { id: string };
  createdRaceIds.push(race.id);
  return race;
}

async function assignSeat(
  user: TestUser,
  seasonId: string,
  teamId: string,
  driverProfileId: string,
  seat: 1 | 2,
): Promise<void> {
  const res = await app.inject({
    method: "POST",
    url: "/api/roster/assign",
    headers: { cookie: user.cookie },
    payload: { seasonId, teamId, driverProfileId, seat },
  });
  expect(res.statusCode).toBe(200);
}

async function setTeamPerformance(
  user: TestUser,
  seasonId: string,
  teamId: string,
  reliability: number,
): Promise<void> {
  const res = await app.inject({
    method: "PUT",
    url: `/api/performance/seasons/${seasonId}/teams/${teamId}`,
    headers: { cookie: user.cookie },
    payload: { carSpeed: 50, reliability, operations: 50 },
  });
  expect(res.statusCode).toBe(200);
}

async function simulateQualifying(user: TestUser, raceId: string) {
  const res = await app.inject({
    method: "POST",
    url: `/api/races/${raceId}/qualifying/simulate`,
    headers: { cookie: user.cookie },
  });
  expect(res.statusCode).toBe(200);
}

async function simulateRace(user: TestUser, raceId: string) {
  const res = await app.inject({
    method: "POST",
    url: `/api/races/${raceId}/race/simulate`,
    headers: { cookie: user.cookie },
  });
  expect(res.statusCode).toBe(200);
}

async function applyChampionship(user: TestUser, raceId: string) {
  const res = await app.inject({
    method: "POST",
    url: `/api/races/${raceId}/championship/apply`,
    headers: { cookie: user.cookie },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as {
    race: { id: string; status: string };
    season: { id: string; status: string };
    standings: Array<{
      driverProfileId: string;
      points: number;
      wins: number;
      podiums: number;
      position: number;
    }>;
  };
}

async function driverSeasonPoints(driverProfileId: string, seasonId: string) {
  const rows = await prisma.raceResult.findMany({
    where: { driverProfileId, race: { seasonId } },
    select: { points: true },
  });
  return rows.reduce((sum, row) => sum + row.points, 0);
}

async function resultsSnapshot(raceId: string) {
  return prisma.raceResult.findMany({
    where: { raceId },
    select: {
      driverProfileId: true,
      position: true,
      status: true,
      grid: true,
    },
    orderBy: { driverProfileId: "asc" },
  });
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();

  owner = await createUser("progression@example.com", "Dona Progression");

  const charA = await createCharacter(owner, "Piloto A");
  mainDriverA = (await createDriver(owner, charA.id)).driverProfileId;
  const charB = await createCharacter(owner, "Piloto B");
  mainDriverB = (await createDriver(owner, charB.id)).driverProfileId;

  mainTeamId = (await createTeam(owner, "Equipe Principal")).id;
  const season = await createSeason(owner, 2100);
  mainSeasonId = season.id;

  await assignSeat(owner, mainSeasonId, mainTeamId, mainDriverA, 1);
  await assignSeat(owner, mainSeasonId, mainTeamId, mainDriverB, 2);
  await setTeamPerformance(owner, mainSeasonId, mainTeamId, 100);

  await createRace(owner, mainSeasonId, 1, "GP Principal 1");
  await createRace(owner, mainSeasonId, 2, "GP Principal 2");

  const multiSeason = await createSeason(owner, 2088);
  multiSeasonId = multiSeason.id;
  const teamTwo = await createTeam(owner, "Equipe Rival");
  const teamThree = await createTeam(owner, "Equipe Terceira");
  const charC = await createCharacter(owner, "Piloto C");
  const driverC = (await createDriver(owner, charC.id)).driverProfileId;
  const charD = await createCharacter(owner, "Piloto D");
  const driverD = (await createDriver(owner, charD.id)).driverProfileId;
  const charE = await createCharacter(owner, "Piloto E");
  const driverE = (await createDriver(owner, charE.id)).driverProfileId;
  await assignSeat(owner, multiSeasonId, teamTwo.id, driverC, 1);
  await assignSeat(owner, multiSeasonId, teamTwo.id, driverD, 2);
  await assignSeat(owner, multiSeasonId, teamThree.id, driverE, 1);
  await setTeamPerformance(owner, multiSeasonId, teamTwo.id, 100);
  await setTeamPerformance(owner, multiSeasonId, teamThree.id, 100);
  await createRace(owner, multiSeasonId, 1, "GP Multi");

  const dnfSeason = await createSeason(owner, 2089);
  dnfSeasonId = dnfSeason.id;
  const brokenTeam = await createTeam(owner, "Equipe Fraca");
  const charF = await createCharacter(owner, "Piloto F");
  const driverF = (await createDriver(owner, charF.id)).driverProfileId;
  await assignSeat(owner, dnfSeasonId, brokenTeam.id, driverF, 1);
  await setTeamPerformance(owner, dnfSeasonId, brokenTeam.id, 0);
  await createRace(owner, dnfSeasonId, 1, "GP Fracassado");
});

afterAll(async () => {
  await prisma.championshipStanding.deleteMany({
    where: { seasonId: { in: createdSeasonIds } },
  });
  await prisma.raceResult.deleteMany({
    where: { raceId: { in: createdRaceIds } },
  });
  await prisma.race.deleteMany({
    where: { id: { in: createdRaceIds } },
  });
  await prisma.seasonDriverEntry.deleteMany({
    where: { seasonId: { in: createdSeasonIds } },
  });
  await prisma.season.deleteMany({
    where: { id: { in: createdSeasonIds } },
  });
  await prisma.driverProfile.deleteMany({
    where: { characterId: { in: createdCharacterIds } },
  });
  await prisma.character.deleteMany({
    where: { id: { in: createdCharacterIds } },
  });
  await prisma.team.deleteMany({
    where: { id: { in: createdTeamIds } },
  });
  await prisma.user.deleteMany({
    where: { id: owner.userId },
  });
  await app.close();
});

describe("Progressao de campeonato", () => {
  it("rejeita sem autenticacao", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/races/00000000-0000-4000-8000-000000000001/championship/apply",
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejeita identificador de corrida invalido", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/races/nao-e-uuid/championship/apply",
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejeita corrida inexistente", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/races/00000000-0000-4000-8000-000000000099/championship/apply",
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("aplica pontos da corrida na classificacao e avanca a temporada", async () => {
    const race = await prisma.race.findFirstOrThrow({
      where: { seasonId: mainSeasonId, round: 1 },
    });
    await simulateQualifying(owner, race.id);
    await simulateRace(owner, race.id);
    const before = await resultsSnapshot(race.id);

    const payload = await applyChampionship(owner, race.id);

    expect(payload.race.status).toBe("FINISHED");
    expect(payload.season.status).toBe("ACTIVE");
    expect(payload.standings).toHaveLength(2);
    expect(payload.standings.map((s) => s.driverProfileId).sort()).toEqual([
      mainDriverA,
      mainDriverB,
    ].sort());
    expect(payload.standings[0].position).toBe(1);
    expect(payload.standings[1].position).toBe(2);

    const recorded = await resultsSnapshot(race.id);
    expect(recorded).toEqual(before);
    for (const standing of payload.standings) {
      expect(standing.points).toBe(
        await driverSeasonPoints(standing.driverProfileId, mainSeasonId),
      );
    }

    const winnerTop = payload.standings.find(
      (s) => s.points === Math.max(...payload.standings.map((x) => x.points)),
    );
    expect(winnerTop).toBeDefined();
    expect(winnerTop!.wins).toBe(1);
  });

  it("progressao e idempotente e nao altera resultados historicos", async () => {
    const race = await prisma.race.findFirstOrThrow({
      where: { seasonId: mainSeasonId, round: 1 },
    });
    const before = await resultsSnapshot(race.id);
    const standingsBefore = await prisma.championshipStanding.findMany({
      where: { seasonId: mainSeasonId },
      select: { driverProfileId: true, points: true, wins: true },
      orderBy: { driverProfileId: "asc" },
    });

    const payload = await applyChampionship(owner, race.id);

    expect(await resultsSnapshot(race.id)).toEqual(before);
    const standingsAfter = await prisma.championshipStanding.findMany({
      where: { seasonId: mainSeasonId },
      select: { driverProfileId: true, points: true, wins: true },
      orderBy: { driverProfileId: "asc" },
    });
    expect(standingsAfter).toEqual(standingsBefore);
    expect(payload.standings.map((s) => s.position).sort()).toEqual([1, 2]);
  });

  it("acumula pontos em multiplas corridas e detecta encerramento da temporada", async () => {
    const race = await prisma.race.findFirstOrThrow({
      where: { seasonId: mainSeasonId, round: 2 },
    });
    await simulateQualifying(owner, race.id);
    await simulateRace(owner, race.id);

    const payload = await applyChampionship(owner, race.id);

    expect(payload.race.status).toBe("FINISHED");
    expect(payload.season.status).toBe("FINISHED");
    for (const standing of payload.standings) {
      expect(standing.points).toBe(
        await driverSeasonPoints(standing.driverProfileId, mainSeasonId),
      );
    }

    const season = await prisma.season.findUniqueOrThrow({
      where: { id: mainSeasonId },
    });
    expect(season.status).toBe("FINISHED");
  });

  it("dnf sem posicao nao pontua", async () => {
    const race = await prisma.race.findFirstOrThrow({
      where: { seasonId: dnfSeasonId },
    });
    await simulateQualifying(owner, race.id);
    await simulateRace(owner, race.id);

    const payload = await applyChampionship(owner, race.id);

    expect(payload.standings).toHaveLength(1);
    expect(payload.standings[0].points).toBe(0);
    expect(payload.standings[0].wins).toBe(0);
    expect(payload.standings[0].podiums).toBe(0);

    const dnfResult = await prisma.raceResult.findFirstOrThrow({
      where: { raceId: race.id },
    });
    expect(dnfResult.status).toBe("Retired");
    expect(dnfResult.position).toBeNull();
  });

  it("deriva classificacao de equipes em memoria a partir dos pilotos", async () => {
    const race = await prisma.race.findFirstOrThrow({
      where: { seasonId: multiSeasonId },
    });
    await simulateQualifying(owner, race.id);
    await simulateRace(owner, race.id);
    await applyChampionship(owner, race.id);

    const res = await app.inject({
      method: "GET",
      url: `/api/seasons/${multiSeasonId}/standings/teams`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const payload = res.json() as {
      teams: Array<{
        position: number;
        teamId: string;
        name: string;
        points: number;
        wins: number;
        podiums: number;
      }>;
    };

    const [standings, entries] = await Promise.all([
      prisma.championshipStanding.findMany({
        where: { seasonId: multiSeasonId },
        select: {
          driverProfileId: true,
          points: true,
          wins: true,
          podiums: true,
        },
      }),
      prisma.seasonDriverEntry.findMany({
        where: { seasonId: multiSeasonId },
        select: { driverProfileId: true, teamId: true },
      }),
    ]);
    const teamByDriver = new Map(
      entries.map((entry) => [entry.driverProfileId, entry.teamId]),
    );
    expect(payload.teams).toHaveLength(2);
    expect(payload.teams.map((t) => t.position).sort()).toEqual([1, 2]);
    expect(payload.teams[0].points).toBeGreaterThanOrEqual(
      payload.teams[1].points,
    );
    expect(payload.teams[0].position).toBe(1);

    for (const team of payload.teams) {
      const members = standings.filter(
        (s) => teamByDriver.get(s.driverProfileId) === team.teamId,
      );
      const expectedPoints = members.reduce(
        (sum, member) => sum + member.points,
        0,
      );
      const expectedWins = members.reduce(
        (sum, member) => sum + member.wins,
        0,
      );
      expect(team.points).toBe(expectedPoints);
      expect(team.wins).toBe(expectedWins);
    }
  });

  it("isola a classificacao entre temporadas", async () => {
    const mainStandings = await prisma.championshipStanding.findMany({
      where: { seasonId: mainSeasonId },
      select: { driverProfileId: true },
    });
    const dnfStandings = await prisma.championshipStanding.findMany({
      where: { seasonId: dnfSeasonId },
      select: { driverProfileId: true },
    });
    const multiStandings = await prisma.championshipStanding.findMany({
      where: { seasonId: multiSeasonId },
      select: { driverProfileId: true },
    });

    const mainIds = mainStandings.map((s) => s.driverProfileId);
    const dnfIds = dnfStandings.map((s) => s.driverProfileId);
    const multiIds = multiStandings.map((s) => s.driverProfileId);

    expect(mainIds.some((id) => dnfIds.includes(id))).toBe(false);
    expect(mainIds.some((id) => multiIds.includes(id))).toBe(false);
    expect(dnfIds.some((id) => multiIds.includes(id))).toBe(false);
    expect(dnfIds).toHaveLength(1);
    expect(multiIds).toHaveLength(3);
  });
});