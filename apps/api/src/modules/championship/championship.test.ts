import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";

let app: FastifyInstance;

type TestUser = {
  cookie: string;
  userId: string;
};

type Season = {
  id: string;
  year: number;
  name: string | null;
  status: string;
};

type Race = {
  id: string;
  seasonId: string;
  name: string;
  round: number | null;
};

type Driver = {
  id: string;
  characterId: string;
};

async function createUser(
  email: string,
  name: string,
): Promise<TestUser> {
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

async function createCharacter(
  user: TestUser,
  payload: Record<string, unknown>,
): Promise<{ id: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/characters",
    headers: { cookie: user.cookie },
    payload,
  });
  expect(res.statusCode).toBe(201);
  return res.json().character as { id: string };
}

async function putDriver(
  user: TestUser,
  characterId: string,
): Promise<Driver> {
  const res = await app.inject({
    method: "PUT",
    url: `/api/drivers/${characterId}`,
    headers: { cookie: user.cookie },
    payload: {},
  });
  expect(res.statusCode).toBe(200);
  return res.json().driver as Driver;
}

async function createSeason(
  user: TestUser,
  payload: Record<string, unknown>,
): Promise<Season> {
  const res = await app.inject({
    method: "POST",
    url: "/api/seasons",
    headers: { cookie: user.cookie },
    payload,
  });
  expect(res.statusCode).toBe(201);
  return res.json().season as Season;
}

async function createRace(
  user: TestUser,
  seasonId: string,
  payload: Record<string, unknown>,
): Promise<Race> {
  const res = await app.inject({
    method: "POST",
    url: `/api/seasons/${seasonId}/races`,
    headers: { cookie: user.cookie },
    payload,
  });
  expect(res.statusCode).toBe(201);
  return res.json().race as Race;
}

// Conjunto base compartilhado (evita estourar o rate limit de 100 req/min).
let owner: TestUser;
let intruder: TestUser;
let season: Season;
let race: Race;
let driver: Driver;
let intruderDriver: Driver;

beforeAll(async () => {
  app = buildApp();
  await app.ready();

  owner = await createUser(`champ-owner-${Date.now()}@f1nw.test`, "Champ");
  intruder = await createUser(`champ-intr-${Date.now()}@f1nw.test`, "CIntr");

  const ch = await createCharacter(owner, {
    name: "Campeão Piloto",
    nationality: "Brasileira",
    birthDate: "1995-05-10",
  });
  const chi = await createCharacter(intruder, {
    name: "Piloto Alheio",
    nationality: "Britânica",
    birthDate: "1990-01-01",
  });
  driver = await putDriver(owner, ch.id);
  intruderDriver = await putDriver(intruder, chi.id);

  season = await createSeason(owner, { year: 2026, name: "Temporada 2026" });
  race = await createRace(owner, season.id, {
    name: "GP Brasil",
    circuit: "Interlagos",
    country: "Brasil",
    date: "2026-11-15T14:00:00.000Z",
    round: 1,
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});

describe("auth — 401 sem sessão (entities globais e com ownership)", () => {
  it("GET /api/seasons", async () => {
    const res = await app.inject({ method: "GET", url: "/api/seasons" });
    expect(res.statusCode).toBe(401);
  });
  it("POST /api/seasons", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/seasons",
      payload: { year: 2030 },
    });
    expect(res.statusCode).toBe(401);
  });
  it("GET /api/seasons/:id/races", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/seasons/${season.id}/races`,
    });
    expect(res.statusCode).toBe(401);
  });
  it("GET /api/races/:raceId/results", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/races/${race.id}/results`,
    });
    expect(res.statusCode).toBe(401);
  });
  it("GET /api/seasons/:id/standings", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/seasons/${season.id}/standings`,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("Seasons (globais — qualquer usuário autenticado)", () => {
  it("lista todas as temporadas", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/seasons",
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const names = (res.json().seasons as Season[]).map((s) => s.name);
    expect(names).toContain("Temporada 2026");
  });

  it("valida ano fora da faixa → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/seasons",
      headers: { cookie: owner.cookie },
      payload: { year: 1800 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("lê, atualiza e exclui temporada", async () => {
    const created = await createSeason(owner, { year: 2031 });
    const get = await app.inject({
      method: "GET",
      url: `/api/seasons/${created.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().season.year).toBe(2031);

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/seasons/${created.id}`,
      headers: { cookie: intruder.cookie },
      payload: { status: "ACTIVE" },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().season.status).toBe("ACTIVE");

    const del = await app.inject({
      method: "DELETE",
      url: `/api/seasons/${created.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(del.statusCode).toBe(204);
  });

  it("retorna 404 para temporada inexistente", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/seasons/00000000-0000-4000-8000-000000000000",
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("Races (globais, vinculadas a Season)", () => {
  it("lista corridas da temporada", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/seasons/${season.id}/races`,
      headers: { cookie: intruder.cookie },
    });
    expect(res.statusCode).toBe(200);
    const names = (res.json().races as Race[]).map((r) => r.name);
    expect(names).toContain("GP Brasil");
  });

  it("retorna 404 ao criar corrida em temporada inexistente", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/seasons/00000000-0000-4000-8000-000000000000/races",
      headers: { cookie: owner.cookie },
      payload: { name: "GP Fantasma", round: 2 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("valida round não inteiro → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/seasons/${season.id}/races`,
      headers: { cookie: owner.cookie },
      payload: { name: "GP Inválido", round: 1.5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("lê, atualiza e exclui corrida", async () => {
    const created = await createRace(owner, season.id, {
      name: "GP Interino",
      round: 10,
    });
    const get = await app.inject({
      method: "GET",
      url: `/api/races/${created.id}`,
      headers: { cookie: intruder.cookie },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().race.name).toBe("GP Interino");

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/races/${created.id}`,
      headers: { cookie: owner.cookie },
      payload: { status: "FINISHED" },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().race.status).toBe("FINISHED");

    const del = await app.inject({
      method: "DELETE",
      url: `/api/races/${created.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(del.statusCode).toBe(204);
  });
});

describe("RaceResults (ownership indireta via DriverProfile)", () => {
  it("cria resultado para piloto próprio", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/races/${race.id}/results`,
      headers: { cookie: owner.cookie },
      payload: {
        driverProfileId: driver.id,
        position: 1,
        points: 25,
        fastestLap: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const result = res.json().result;
    expect(result.driverProfile.character.name).toBe("Campeão Piloto");
    expect(result.points).toBe(25);
  });

  it("retorna 404 ao criar resultado para piloto de outro usuário", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/races/${race.id}/results`,
      headers: { cookie: owner.cookie },
      payload: { driverProfileId: intruderDriver.id, position: 2 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("retorna 404 ao criar resultado para piloto global (Character sem userId)", async () => {
    const ai = await prisma.character.create({
      data: {
        userId: null,
        name: "IA Global Piloto",
        nationality: "Global",
        birthDate: new Date("1990-01-01"),
      },
    });
    const aiDriver = await prisma.driverProfile.create({
      data: { characterId: ai.id },
      select: { id: true },
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/races/${race.id}/results`,
      headers: { cookie: owner.cookie },
      payload: { driverProfileId: aiDriver.id, position: 3 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("retorna 409 para resultado duplicado do mesmo piloto na mesma corrida", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/races/${race.id}/results`,
      headers: { cookie: owner.cookie },
      payload: { driverProfileId: driver.id, position: 5 },
    });
    expect(res.statusCode).toBe(409);
  });

  it("lista somente os resultados dos pilotos do usuário", async () => {
    // piloto do intruder em outra corrida
    const otherRace = await createRace(owner, season.id, {
      name: "GP dos Dois",
      round: 2,
    });
    await app.inject({
      method: "POST",
      url: `/api/races/${otherRace.id}/results`,
      headers: { cookie: intruder.cookie },
      payload: { driverProfileId: intruderDriver.id, position: 4 },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/races/${otherRace.id}/results`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const results = res.json().results as {
      driverProfile: { character: { name: string } };
    }[];
    expect(results.length).toBe(0); // nenhum resultado do owner nessa corrida
  });

  it("lê, atualiza e exclui resultado próprio; detalhe alheio → 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/races/${race.id}/results`,
      headers: { cookie: intruder.cookie },
      payload: { driverProfileId: intruderDriver.id, position: 2, points: 18 },
    });
    expect(res.statusCode).toBe(201);
    const resultId = res.json().result.id;

    // Update pelo dono
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/race-results/${resultId}`,
      headers: { cookie: intruder.cookie },
      payload: { points: 20 },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().result.points).toBe(20);

    // Detalhe por outro usuário → 404
    const getOther = await app.inject({
      method: "GET",
      url: `/api/race-results/${resultId}`,
      headers: { cookie: owner.cookie },
    });
    expect(getOther.statusCode).toBe(404);

    // Delete pelo dono
    const del = await app.inject({
      method: "DELETE",
      url: `/api/race-results/${resultId}`,
      headers: { cookie: intruder.cookie },
    });
    expect(del.statusCode).toBe(204);
  });

  it("concorrência na criação → [201, 409]", async () => {
    const r = await createRace(owner, season.id, { name: "GP Concorrente", round: 3 });
    const d = await putDriver(owner, (
      await createCharacter(owner, {
        name: "Concorrente Piloto",
        nationality: "Italiana",
        birthDate: "1994-01-01",
      })
    ).id);

    const payload = { driverProfileId: d.id, position: 1, points: 25 };
    const [r1, r2] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/races/${r.id}/results`,
        headers: { cookie: owner.cookie },
        payload,
      }),
      app.inject({
        method: "POST",
        url: `/api/races/${r.id}/results`,
        headers: { cookie: owner.cookie },
        payload,
      }),
    ]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes).toEqual([201, 409]);
  });
});

describe("ChampionshipStandings (ownership indireta via DriverProfile)", () => {
  it("cria classificação para piloto próprio", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/seasons/${season.id}/standings`,
      headers: { cookie: owner.cookie },
      payload: { driverProfileId: driver.id, points: 25, position: 1, wins: 1 },
    });
    expect(res.statusCode).toBe(201);
    const s = res.json().standing;
    expect(s.driverProfile.character.name).toBe("Campeão Piloto");
    expect(s.points).toBe(25);
  });

  it("retorna 404 ao criar classificação para piloto de outro usuário", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/seasons/${season.id}/standings`,
      headers: { cookie: owner.cookie },
      payload: { driverProfileId: intruderDriver.id, points: 10 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("retorna 409 para classificação duplicada", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/seasons/${season.id}/standings`,
      headers: { cookie: owner.cookie },
      payload: { driverProfileId: driver.id, points: 99 },
    });
    expect(res.statusCode).toBe(409);
  });

  it("lista, atualiza e exclui classificação própria", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/seasons/${season.id}/standings`,
      headers: { cookie: intruder.cookie },
      payload: { driverProfileId: intruderDriver.id, points: 18, position: 2 },
    });
    expect(res.statusCode).toBe(201);
    const sId = res.json().standing.id;

    const list = await app.inject({
      method: "GET",
      url: `/api/seasons/${season.id}/standings`,
      headers: { cookie: intruder.cookie },
    });
    expect(list.statusCode).toBe(200);
    const mine = (list.json().standings as { driverProfile: { character: { name: string } } }[])
      .filter((s) => s.driverProfile.character.name === "Piloto Alheio");
    expect(mine.length).toBeGreaterThan(0);

    // Ownership: outro usuário não vê a do intruder
    const listOwner = await app.inject({
      method: "GET",
      url: `/api/seasons/${season.id}/standings`,
      headers: { cookie: owner.cookie },
    });
    const alheia = (listOwner.json().standings as { driverProfile: { character: { name: string } } }[])
      .filter((s) => s.driverProfile.character.name === "Piloto Alheio");
    expect(alheia.length).toBe(0);

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/championship-standings/${sId}`,
      headers: { cookie: intruder.cookie },
      payload: { points: 22 },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().standing.points).toBe(22);

    // Delete por outro usuário → 404
    const delOther = await app.inject({
      method: "DELETE",
      url: `/api/championship-standings/${sId}`,
      headers: { cookie: owner.cookie },
    });
    expect(delOther.statusCode).toBe(404);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/championship-standings/${sId}`,
      headers: { cookie: intruder.cookie },
    });
    expect(del.statusCode).toBe(204);
  });

  it("concorrência na criação → [201, 409]", async () => {
    const s2 = await createSeason(owner, { year: 2027 });
    const d = await putDriver(owner, (
      await createCharacter(owner, {
        name: "Outlet Piloto",
        nationality: "Espanhola",
        birthDate: "1993-01-01",
      })
    ).id);

    const payload = { driverProfileId: d.id, points: 12, position: 3 };
    const [r1, r2] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/seasons/${s2.id}/standings`,
        headers: { cookie: owner.cookie },
        payload,
      }),
      app.inject({
        method: "POST",
        url: `/api/seasons/${s2.id}/standings`,
        headers: { cookie: owner.cookie },
        payload,
      }),
    ]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes).toEqual([201, 409]);
  });
});

describe("Integridade referencial", () => {
  it("excluir corrida remove resultados em cascata", async () => {
    const r = await createRace(owner, season.id, { name: "GP Cascata", round: 9 });
    const d = await putDriver(owner, (
      await createCharacter(owner, {
        name: "Cascata Piloto",
        nationality: "Alemã",
        birthDate: "1992-01-01",
      })
    ).id);
    await app.inject({
      method: "POST",
      url: `/api/races/${r.id}/results`,
      headers: { cookie: owner.cookie },
      payload: { driverProfileId: d.id, position: 1 },
    });

    const del = await app.inject({
      method: "DELETE",
      url: `/api/races/${r.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(del.statusCode).toBe(204);

    const count = await prisma.raceResult.count({ where: { raceId: r.id } });
    expect(count).toBe(0);
  });

  it("excluir piloto com resultados/classificação retorna 409 (RESTRICT)", async () => {
    const ch = await createCharacter(owner, {
      name: "Piloto Restrito",
      nationality: "Francesa",
      birthDate: "1991-01-01",
    });
    const d = await putDriver(owner, ch.id);
    const rac = await createRace(owner, season.id, { name: "GP Restritor", round: 7 });
    await app.inject({
      method: "POST",
      url: `/api/races/${rac.id}/results`,
      headers: { cookie: owner.cookie },
      payload: { driverProfileId: d.id, position: 1 },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/drivers/${ch.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("CONFLICT");
  });

  it("P2003 defensivo: resultado inexistente para PATCH → 404 (sem 500)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/race-results/00000000-0000-4000-8000-000000000000",
      headers: { cookie: owner.cookie },
      payload: { points: 1 },
    });
    expect(res.statusCode).toBe(404);
  });
});
