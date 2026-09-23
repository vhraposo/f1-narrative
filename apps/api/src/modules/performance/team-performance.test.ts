import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { DEFAULT_PERFORMANCE } from "./team-performance.js";

let app: FastifyInstance;

type TestUser = {
  cookie: string;
  userId: string;
};

type Team = {
  id: string;
  name: string;
};

type Season = {
  id: string;
  year: number;
};

const createdTeamIds: string[] = [];
const createdSeasonIds: string[] = [];

async function createUser(email: string, name: string): Promise<TestUser> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name, email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const cookie = (res.cookies ?? [])
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookie, userId: user.id };
}

async function createTeam(
  user: TestUser,
  name: string,
): Promise<Team> {
  const res = await app.inject({
    method: "POST",
    url: "/api/teams",
    headers: { cookie: user.cookie },
    payload: { name },
  });
  expect(res.statusCode).toBe(201);
  const team = res.json().team as Team;
  createdTeamIds.push(team.id);
  return team;
}

async function createSeason(user: TestUser, year: number): Promise<Season> {
  const res = await app.inject({
    method: "POST",
    url: "/api/seasons",
    headers: { cookie: user.cookie },
    payload: { year },
  });
  expect(res.statusCode).toBe(201);
  const season = res.json().season as Season;
  createdSeasonIds.push(season.id);
  return season;
}

function performanceUrl(seasonId: string, teamId: string): string {
  return `/api/performance/seasons/${seasonId}/teams/${teamId}`;
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  if (createdTeamIds.length > 0) {
    await prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
  }
  if (createdSeasonIds.length > 0) {
    await prisma.season.deleteMany({ where: { id: { in: createdSeasonIds } } });
  }
  await app.close();
});

describe("Team Performance", () => {
  it("GET retorna baseline padrão quando não há registro", async () => {
    const user = await createUser(
      `perf-get-default-${Date.now()}@test.dev`,
      "Perf Get",
    );
    const team = await createTeam(user, "Perf Base Team");
    const season = await createSeason(user, 2027);

    const res = await app.inject({
      method: "GET",
      url: performanceUrl(season.id, team.id),
      headers: { cookie: user.cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().performance).toEqual(DEFAULT_PERFORMANCE);
  });

  it("PUT cria o registro e GET reflete os valores", async () => {
    const user = await createUser(
      `perf-put-${Date.now()}@test.dev`,
      "Perf Put",
    );
    const team = await createTeam(user, "Perf Create Team");
    const season = await createSeason(user, 2028);

    const put = await app.inject({
      method: "PUT",
      url: performanceUrl(season.id, team.id),
      headers: { cookie: user.cookie },
      payload: { carSpeed: 85, reliability: 70, operations: 60 },
    });

    expect(put.statusCode).toBe(200);
    expect(put.json().performance).toEqual({
      carSpeed: 85,
      reliability: 70,
      operations: 60,
    });

    const get = await app.inject({
      method: "GET",
      url: performanceUrl(season.id, team.id),
      headers: { cookie: user.cookie },
    });

    expect(get.statusCode).toBe(200);
    expect(get.json().performance).toEqual({
      carSpeed: 85,
      reliability: 70,
      operations: 60,
    });
  });

  it("PUT sobrescreve registro existente", async () => {
    const user = await createUser(
      `perf-update-${Date.now()}@test.dev`,
      "Perf Update",
    );
    const team = await createTeam(user, "Perf Update Team");
    const season = await createSeason(user, 2029);

    await app.inject({
      method: "PUT",
      url: performanceUrl(season.id, team.id),
      headers: { cookie: user.cookie },
      payload: { carSpeed: 40, reliability: 40, operations: 40 },
    });

    const put = await app.inject({
      method: "PUT",
      url: performanceUrl(season.id, team.id),
      headers: { cookie: user.cookie },
      payload: { carSpeed: 95, reliability: 20, operations: 55 },
    });

    expect(put.statusCode).toBe(200);
    expect(put.json().performance).toEqual({
      carSpeed: 95,
      reliability: 20,
      operations: 55,
    });
  });

  it("DELETE remove o registro e GET volta ao baseline", async () => {
    const user = await createUser(
      `perf-delete-${Date.now()}@test.dev`,
      "Perf Delete",
    );
    const team = await createTeam(user, "Perf Delete Team");
    const season = await createSeason(user, 2030);

    await app.inject({
      method: "PUT",
      url: performanceUrl(season.id, team.id),
      headers: { cookie: user.cookie },
      payload: { carSpeed: 90, reliability: 90, operations: 90 },
    });

    const del = await app.inject({
      method: "DELETE",
      url: performanceUrl(season.id, team.id),
      headers: { cookie: user.cookie },
    });

    expect(del.statusCode).toBe(204);

    const get = await app.inject({
      method: "GET",
      url: performanceUrl(season.id, team.id),
      headers: { cookie: user.cookie },
    });

    expect(get.statusCode).toBe(200);
    expect(get.json().performance).toEqual(DEFAULT_PERFORMANCE);
  });

  it("PUT rejeita valores fora de 0..100", async () => {
    const user = await createUser(
      `perf-range-${Date.now()}@test.dev`,
      "Perf Range",
    );
    const team = await createTeam(user, "Perf Range Team");
    const season = await createSeason(user, 2031);

    const res = await app.inject({
      method: "PUT",
      url: performanceUrl(season.id, team.id),
      headers: { cookie: user.cookie },
      payload: { carSpeed: 150, reliability: 70, operations: 60 },
    });

    expect(res.statusCode).toBe(400);
  });

  it("PUT de equipe inexistente ou não pertencente ao usuário retorna 404", async () => {
    const user = await createUser(
      `perf-owner-${Date.now()}@test.dev`,
      "Perf Owner",
    );
    const season = await createSeason(user, 2032);

    const res = await app.inject({
      method: "PUT",
      url: performanceUrl(season.id, "00000000-0000-0000-0000-000000000000"),
      headers: { cookie: user.cookie },
      payload: { carSpeed: 80, reliability: 80, operations: 80 },
    });

    expect(res.statusCode).toBe(404);

    const other = await createUser(
      `perf-owner-other-${Date.now()}@test.dev`,
      "Perf Other",
    );
    const otherTeam = await createTeam(other, "Perf Other Team");

    const resForbidden = await app.inject({
      method: "PUT",
      url: performanceUrl(season.id, otherTeam.id),
      headers: { cookie: user.cookie },
      payload: { carSpeed: 80, reliability: 80, operations: 80 },
    });

    expect(resForbidden.statusCode).toBe(404);
  });

  it("PUT de temporada inexistente retorna 404", async () => {
    const user = await createUser(
      `perf-season-${Date.now()}@test.dev`,
      "Perf Season",
    );
    const team = await createTeam(user, "Perf Season Team");

    const res = await app.inject({
      method: "PUT",
      url: performanceUrl(
        "00000000-0000-0000-0000-000000000000",
        team.id,
      ),
      headers: { cookie: user.cookie },
      payload: { carSpeed: 80, reliability: 80, operations: 80 },
    });

    expect(res.statusCode).toBe(404);
  });

  it("registros de performance são isolados por temporada", async () => {
    const user = await createUser(
      `perf-isolated-${Date.now()}@test.dev`,
      "Perf Isolated",
    );
    const team = await createTeam(user, "Perf Isolated Team");
    const seasonA = await createSeason(user, 2033);
    const seasonB = await createSeason(user, 2034);

    await app.inject({
      method: "PUT",
      url: performanceUrl(seasonA.id, team.id),
      headers: { cookie: user.cookie },
      payload: { carSpeed: 88, reliability: 40, operations: 70 },
    });

    const getA = await app.inject({
      method: "GET",
      url: performanceUrl(seasonA.id, team.id),
      headers: { cookie: user.cookie },
    });
    const getB = await app.inject({
      method: "GET",
      url: performanceUrl(seasonB.id, team.id),
      headers: { cookie: user.cookie },
    });

    expect(getA.json().performance.carSpeed).toBe(88);
    expect(getB.json().performance).toEqual(DEFAULT_PERFORMANCE);
  });
});