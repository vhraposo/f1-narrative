import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";

type TestUser = { cookie: string; userId: string };
type Race = { id: string; seasonId: string; status: string };

const createdSeasonIds: string[] = [];
const createdRaceIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdTeamIds: string[] = [];

let app: FastifyInstance;
let owner: TestUser;
let season: RaceSeasonShim;
let race: Race;

type RaceSeasonShim = { id: string };

async function createUser(email: string, name: string): Promise<TestUser> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name, email, password: "qual-sim-strong-1" },
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
  const season = res.json().season as RaceSeasonShim;
  createdSeasonIds.push(season.id);
  return season;
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

async function createRace(user: TestUser, seasonId: string) {
  const res = await app.inject({
    method: "POST",
    url: `/api/seasons/${seasonId}/races`,
    headers: { cookie: user.cookie },
    payload: {
      name: "GP Brasil",
      circuit: "Interlagos",
      country: "Brasil",
      date: "2099-03-15T14:00:00.000Z",
      round: 1,
    },
  });
  expect(res.statusCode).toBe(201);
  race = res.json().race as Race;
  createdRaceIds.push(race.id);
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();

  owner = await createUser(`qual-${Date.now()}@test.dev`, "Dona Qual");
  const charA = await createCharacter(owner, "Piloto A");
  const charB = await createCharacter(owner, "Piloto B");
  const driverA = await createDriver(owner, charA.id);
  const driverB = await createDriver(owner, charB.id);
  const team = await createTeam(owner, "Equipe Qual");
  season = await createSeason(owner, 2099);
  await assignSeat(owner, season.id, team.id, driverA.driverProfileId, 1);
  await assignSeat(owner, season.id, team.id, driverB.driverProfileId, 2);
  await createRace(owner, season.id);
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

describe("Simulacao de qualificacao", () => {
  it("requer autenticacao", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/races/${race.id}/qualifying/simulate`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("valida o identificador da corrida", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/races/invalido/qualifying/simulate",
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it("retorna 404 para corrida inexistente", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/races/${"00000000-0000-0000-0000-000000000000"}/qualifying/simulate`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("gera grid deterministico com grid 1 e 2", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/races/${race.id}/qualifying/simulate`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const grid = res.json().grid as Array<{
      driverProfileId: string;
      grid: number;
    }>;
    expect(grid).toHaveLength(2);
    expect(grid.map((row) => row.grid).sort()).toEqual([1, 2]);

    const repeated = await app.inject({
      method: "POST",
      url: `/api/races/${race.id}/qualifying/simulate`,
      headers: { cookie: owner.cookie },
    });
    expect(repeated.statusCode).toBe(200);
    const order = grid.map((row) => row.driverProfileId).join("|");
    const order2 = (repeated.json().grid as Array<{ driverProfileId: string }>)
      .map((row) => row.driverProfileId)
      .join("|");
    expect(order).toBe(order2);
  });
});
