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
let seasonId: string;
let raceId: string;
let raceTwoId: string;
let raceTwoSeasonId: string;

type SeasonShim = { id: string };
type RaceShim = { id: string; status: string };

async function createUser(email: string, name: string): Promise<TestUser> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name, email, password: "race-sim-strong-1" },
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

async function assignSeat(
  user: TestUser,
  seasonId: string,
  teamId: string,
  driverProfileId: string,
  seat: 1 | 2,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/roster/assign",
    headers: { cookie: user.cookie },
    payload: { seasonId, teamId, driverProfileId, seat },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as {
    entry?: { id?: string };
    driverProfileId?: string;
  };
  return (
    body.entry?.id ??
    body.driverProfileId ??
    String(seat)
  );
}

async function createRace(
  user: TestUser,
  seasonId: string,
  round: number,
  name: string,
): Promise<RaceShim> {
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
  const race = res.json().race as RaceShim;
  createdRaceIds.push(race.id);
  return race;
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
  return res.json().grid as Array<{ driverProfileId: string; grid: number }>;
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();

  owner = await createUser(`race-${Date.now()}@test.dev`, "Dona Race");
  const charA = await createCharacter(owner, "Piloto A");
  const charB = await createCharacter(owner, "Piloto B");
  const driverA = await createDriver(owner, charA.id);
  const driverB = await createDriver(owner, charB.id);
  const team = await createTeam(owner, "Equipe Race");
  const season = await createSeason(owner, 2100);
  seasonId = season.id;
  await assignSeat(owner, seasonId, team.id, driverA.driverProfileId, 1);
  await assignSeat(owner, seasonId, team.id, driverB.driverProfileId, 2);
  await setTeamPerformance(owner, seasonId, team.id, 100);
  const race = await createRace(owner, seasonId, 1, "GP Race 1");
  raceId = race.id;
  await simulateQualifying(owner, raceId);
});

afterAll(async () => {
  await prisma.raceResult.deleteMany({
    where: { raceId: { in: createdRaceIds } },
  });
  await prisma.race.deleteMany({ where: { id: { in: createdRaceIds } } });
  await prisma.seasonDriverEntry.deleteMany({
    where: { seasonId: { in: createdSeasonIds } },
  });
  await prisma.season.deleteMany({ where: { id: { in: createdSeasonIds } } });
  await prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
  await prisma.character.deleteMany({
    where: { id: { in: createdCharacterIds } },
  });
  await prisma.user.deleteMany({ where: { id: owner.userId } });
  await prisma.$disconnect();
  await app.close();
});

describe("Simulacao de corrida", () => {
  it("requer autenticacao", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/races/${raceId}/race/simulate`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("valida o identificador da corrida", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/races/invalido/race/simulate",
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it("retorna 404 para corrida inexistente", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/races/${"00000000-0000-0000-0000-000000000000"}/race/simulate`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("produz resultado deterministico preservando o grid", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/races/${raceId}/race/simulate`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const payload = res.json() as {
      results: Array<{
        driverProfileId: string;
        position: number | null;
        startGrid: number;
        status: "Finished" | "Retired";
      }>;
    };
    expect(payload.results).toHaveLength(2);
    const finishers = payload.results.filter(
      (row) => row.position !== null,
    );
    expect(finishers).toHaveLength(2);
    const positions = finishers.map((row) => row.position);
    expect(positions).toEqual([1, 2]);

    const ids = payload.results
      .map((row) => row.driverProfileId)
      .join("|");
    const repeated = await app.inject({
      method: "POST",
      url: `/api/races/${raceId}/race/simulate`,
      headers: { cookie: owner.cookie },
    });
    expect(repeated.statusCode).toBe(200);
    const repeatedIds = (
      repeated.json() as {
        results: Array<{ driverProfileId: string }>;
      }
    ).results
      .map((row) => row.driverProfileId)
      .join("|");
    expect(repeatedIds).toBe(ids);

    const getRes = await app.inject({
      method: "GET",
      url: `/api/races/${raceId}/race`,
      headers: { cookie: owner.cookie },
    });
    expect(getRes.statusCode).toBe(200);
    const persisted = getRes.json() as {
      race: { status: string };
      results: Array<{ position: number | null; status: string }>;
    };
    expect(persisted.race.status).toBe("RACE");
    const persistedPositions = persisted.results
      .map((row) => row.position)
      .sort((a, b) => (a ?? 99) - (b ?? 99));
    expect(persistedPositions).toEqual([1, 2]);
  });

  it("marca DNF para equipe com confiabilidade baixa", async () => {
    const charC = await createCharacter(owner, "Piloto C");
    const driverC = await createDriver(owner, charC.id);
    const brokenSeason = await createSeason(owner, 2089);
    const brokenTeam = await createTeam(owner, "Equipe Quebrada");
    await assignSeat(
      owner,
      brokenSeason.id,
      brokenTeam.id,
      driverC.driverProfileId,
      1,
    );
    await setTeamPerformance(owner, brokenSeason.id, brokenTeam.id, 0);
    const brokenRace = await createRace(owner, brokenSeason.id, 1, "GP Quebrado");
    raceTwoId = brokenRace.id;
    await simulateQualifying(owner, raceTwoId);

    const res = await app.inject({
      method: "POST",
      url: `/api/races/${raceTwoId}/race/simulate`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const payload = res.json() as {
      results: Array<{ driverProfileId: string; status: string }>;
      incidents: Array<{ driverProfileId: string; type: string }>;
    };
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0].status).toBe("Retired");
    expect(payload.incidents).toHaveLength(1);
    expect(payload.incidents[0]).toEqual({
      driverProfileId: driverC.driverProfileId,
      type: "RETIREMENT",
    });
  });

  it("isola resultados entre temporadas", async () => {
    const charD = await createCharacter(owner, "Piloto D");
    const driverD = await createDriver(owner, charD.id);
    const otherTeam = await createTeam(owner, "Equipe Outra");
    const otherSeason = await createSeason(owner, 2090);
    raceTwoSeasonId = otherSeason.id;
    await assignSeat(
      owner,
      raceTwoSeasonId,
      otherTeam.id,
      driverD.driverProfileId,
      1,
    );
    const otherRace = await createRace(owner, raceTwoSeasonId, 1, "GP 2101");
    await simulateQualifying(owner, otherRace.id);

    const res = await app.inject({
      method: "POST",
      url: `/api/races/${otherRace.id}/race/simulate`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const payload = res.json() as {
      results: Array<{ driverProfileId: string }>;
    };
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0].driverProfileId).toBe(driverD.driverProfileId);
  });
});