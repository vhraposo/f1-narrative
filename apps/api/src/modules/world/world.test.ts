import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";

let app: FastifyInstance;

type TestUser = {
  cookie: string;
  userId: string;
};

type Season = { id: string; year: number };
type Race = { id: string; seasonId: string; name: string };

async function createUser(email: string, name: string): Promise<TestUser> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name, email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookie, userId: user.id };
}

async function createSeason(
  user: TestUser,
  year: number,
): Promise<Season> {
  const res = await app.inject({
    method: "POST",
    url: "/api/seasons",
    headers: { cookie: user.cookie },
    payload: { year },
  });
  expect(res.statusCode).toBe(201);
  return res.json().season as Season;
}

async function createRace(
  user: TestUser,
  seasonId: string,
  name: string,
): Promise<Race> {
  const res = await app.inject({
    method: "POST",
    url: `/api/seasons/${seasonId}/races`,
    headers: { cookie: user.cookie },
    payload: { name, round: 1 },
  });
  expect(res.statusCode).toBe(201);
  return res.json().race as Race;
}

let owner: TestUser;
let intruder: TestUser;
let season: Season;
let race: Race;

beforeAll(async () => {
  app = buildApp();
  await app.ready();

  owner = await createUser(`world-owner-${Date.now()}@f1nw.test`, "Mundo");
  intruder = await createUser(`world-intr-${Date.now()}@f1nw.test`, "WIntr");

  season = await createSeason(owner, 2026);
  race = await createRace(owner, season.id, "GP Estado do Mundo");
});

afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});

describe("auth — 401 sem sessão", () => {
  it("GET /api/world", async () => {
    const res = await app.inject({ method: "GET", url: "/api/world" });
    expect(res.statusCode).toBe(401);
  });
  it("PATCH /api/world", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/world",
      payload: { currentDate: "2026-01-01T00:00:00.000Z" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("WorldState — singleton global", () => {
  it("GET autenticado cria o singleton default na primeira resolução", async () => {
    // Baseline limpo: o teste é determinístico independentemente de resíduos
    // de outros arquivos de teste que compartilham o mesmo banco. O singleton
    // é recriado no próprio GET (seria 401/400 se não houvesse rota).
    await prisma.worldState.deleteMany({});
    const before = await prisma.worldState.count();
    const res = await app.inject({
      method: "GET",
      url: "/api/world",
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const world = res.json().world;
    expect(world.key).toBe("default");
    expect(world.id).toBeTruthy();
    expect(typeof world.currentDate).toBe("string");
    const after = await prisma.worldState.count();
    // A primeira leitura cria exatamente um registro global.
    expect(after).toBe(before + 1);
  });

  it("segunda leitura retorna o MESMO WorldState (não outro registro)", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/api/world",
      headers: { cookie: intruder.cookie },
    });
    const second = await app.inject({
      method: "GET",
      url: "/api/world",
      headers: { cookie: owner.cookie },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().world.id).toBe(second.json().world.id);
    // independentemente do usuário, o estado do mundo é um só (global).
    const count = await prisma.worldState.count();
    expect(count).toBe(1);
  });

  it("nunca há mais de 1 WorldState após sucessivas leituras", async () => {
    await app.inject({ method: "GET", url: "/api/world", headers: { cookie: owner.cookie } });
    await app.inject({ method: "GET", url: "/api/world", headers: { cookie: intruder.cookie } });
    const count = await prisma.worldState.count();
    expect(count).toBe(1);
  });

  it("concorrência na resolução inicial → exatamente 1 WorldState", async () => {
    // Garante baseline sem o singleton, isoladamente, para o teste de corrida.
    await prisma.worldState.deleteMany({});
    const [r1, r2, r3, r4] = await Promise.all([
      app.inject({ method: "GET", url: "/api/world", headers: { cookie: owner.cookie } }),
      app.inject({ method: "GET", url: "/api/world", headers: { cookie: intruder.cookie } }),
      app.inject({ method: "GET", url: "/api/world", headers: { cookie: owner.cookie } }),
      app.inject({ method: "GET", url: "/api/world", headers: { cookie: intruder.cookie } }),
    ]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r3.statusCode).toBe(200);
    expect(r4.statusCode).toBe(200);
    const count = await prisma.worldState.count();
    expect(count).toBe(1);
    const ids = new Set([r1.json().world.id, r2.json().world.id, r3.json().world.id, r4.json().world.id]);
    expect(ids.size).toBe(1);
  });
});

describe("WorldState — atualização (PATCH)", () => {
  it("PATCH válido de currentDate → 200 e data atualizada", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/world",
      headers: { cookie: owner.cookie },
      payload: { currentDate: "2026-05-15T10:00:00.000Z" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().world.currentDate).toBe("2026-05-15T10:00:00.000Z");
  });

  it("PATCH de Season válida → 200", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/world",
      headers: { cookie: owner.cookie },
      payload: { currentSeasonId: season.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().world.currentSeasonId).toBe(season.id);
  });

  it("PATCH de Race válida → 200", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/world",
      headers: { cookie: owner.cookie },
      payload: { currentRaceId: race.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().world.currentRaceId).toBe(race.id);
  });

  it("PATCH de currentSession válido → 200", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/world",
      headers: { cookie: owner.cookie },
      payload: { currentSession: "QUALIFYING" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().world.currentSession).toBe("QUALIFYING");
  });

  it("referência de Season inexistente → 400 VALIDATION_ERROR", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/world",
      headers: { cookie: owner.cookie },
      payload: { currentSeasonId: "00000000-0000-4000-8000-000000000000" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
    expect(res.json().error).toBe("Temporada não encontrada");
  });

  it("referência de Race inexistente → 400 VALIDATION_ERROR", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/world",
      headers: { cookie: owner.cookie },
      payload: { currentRaceId: "00000000-0000-4000-8000-000000000000" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
    expect(res.json().error).toBe("Corrida não encontrada");
  });

  it("UUID inválido → 400", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/world",
      headers: { cookie: owner.cookie },
      payload: { currentSeasonId: "nao-e-uuid" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("payload inválido (currentSession fora do enum) → 400", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/world",
      headers: { cookie: owner.cookie },
      payload: { currentSession: "ESPECIAL" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("não aceita campos inexistentes no modelo (ex.: userId) como forma de criar estado paralelo", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/world",
      headers: { cookie: owner.cookie },
      payload: { userId: owner.userId, key: "default", currentDate: "2026-01-01T00:00:00.000Z" },
    });
    // zod strip por padrão remove desconhecidos; currentDate é atualizado,
    // mas não pode criar um segundo registro.
    expect(res.statusCode).toBe(200);
    const count = await prisma.worldState.count();
    expect(count).toBe(1);
  });
});