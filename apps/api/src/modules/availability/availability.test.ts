import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";

let app: FastifyInstance;

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];

function track<T extends { id: string }>(list: string[], entity: T): T {
  list.push(entity.id);
  return entity;
}

type TestUser = {
  cookie: string;
  userId: string;
};

type Character = {
  id: string;
  name: string;
  nationality: string;
};

type Availability = {
  id: string;
  characterId: string;
  status: string;
  reason: string | null;
  since: string;
  until: string | null;
};

async function createUser(
  email: string,
  name: string,
): Promise<TestUser> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: {
      name,
      email,
      password: "senha-segura-123",
    },
  });

  expect(res.statusCode).toBe(200);

  const cookie = (res.cookies ?? [])
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  track(createdUserIds, user);
  return { cookie, userId: user.id };
}

async function createCharacter(
  user: TestUser,
  payload: Record<string, unknown>,
): Promise<Character> {
  const res = await app.inject({
    method: "POST",
    url: "/api/characters",
    headers: { cookie: user.cookie },
    payload,
  });
  expect(res.statusCode).toBe(201);
  return track(createdCharacterIds, res.json().character as Character);
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await prisma.characterAvailability.deleteMany({
    where: { characterId: { in: createdCharacterIds } },
  });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
  await app.close();
});

describe("Availability - auth 401", () => {
  it("GET retorna 401 sem sessão", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/characters/${crypto.randomUUID()}/availability`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("PATCH retorna 401 sem sessão", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/characters/${crypto.randomUUID()}/availability`,
      payload: { status: "BUSY" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("Availability - ownership e validação de character", () => {
  let owner: TestUser;
  let intruder: TestUser;
  let character: Character;

  beforeAll(async () => {
    owner = await createUser(`avail-owner-${Date.now()}@f1nw.test`, "Dono");
    intruder = await createUser(`avail-intr-${Date.now()}@f1nw.test`, "Intruso");
    character = await createCharacter(owner, {
      name: "Piloto de Teste",
      nationality: "BR",
      birthDate: "1995-01-01",
    });
  });

  it("character inexistente -> 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/characters/${crypto.randomUUID()}/availability`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("character de outro usuário -> 404 (nunca 403)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/characters/${character.id}/availability`,
      headers: { cookie: intruder.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("PATCH em character de outro usuário -> 404", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/characters/${character.id}/availability`,
      headers: { cookie: intruder.cookie },
      payload: { status: "BUSY" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET resolve o default AVAILABLE via upsert", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/characters/${character.id}/availability`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const { availability } = res.json() as { availability: Availability };
    expect(availability.status).toBe("AVAILABLE");
    expect(availability.characterId).toBe(character.id);
  });

  it("GET repetido retorna o MESMO registro (singleton por character)", async () => {
    const a = await app.inject({
      method: "GET",
      url: `/api/characters/${character.id}/availability`,
      headers: { cookie: owner.cookie },
    });
    const b = await app.inject({
      method: "GET",
      url: `/api/characters/${character.id}/availability`,
      headers: { cookie: owner.cookie },
    });
    expect(a.json().availability.id).toBe(b.json().availability.id);
    const count = await prisma.characterAvailability.count({
      where: { characterId: character.id },
    });
    expect(count).toBe(1);
  });

  it("concorrência na resolução inicial -> exatamente 1 registro", async () => {
    const ch = await createCharacter(owner, {
      name: "Piloto concorrente",
      nationality: "IT",
      birthDate: "1996-02-02",
    });
    await app.inject({
      method: "GET",
      url: `/api/characters/${ch.id}/availability`,
      headers: { cookie: owner.cookie },
    });
    const results = await Promise.all([
      app.inject({
        method: "PATCH",
        url: `/api/characters/${ch.id}/availability`,
        headers: { cookie: owner.cookie },
        payload: { status: "BUSY" },
      }),
      app.inject({
        method: "PATCH",
        url: `/api/characters/${ch.id}/availability`,
        headers: { cookie: owner.cookie },
        payload: { status: "TRAINING" },
      }),
      app.inject({
        method: "PATCH",
        url: `/api/characters/${ch.id}/availability`,
        headers: { cookie: owner.cookie },
        payload: { status: "TRAVELING" },
      }),
    ]);
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const count = await prisma.characterAvailability.count({
      where: { characterId: ch.id },
    });
    expect(count).toBe(1);
  });
});

describe("Availability - PATCH", () => {
  let owner: TestUser;
  let character: Character;

  beforeAll(async () => {
    owner = await createUser(`avail-patch-${Date.now()}@f1nw.test`, "PatchDono");
    character = await createCharacter(owner, {
      name: "Piloto PATCH",
      nationality: "GB",
      birthDate: "1994-03-03",
    });
  });

  it("atualiza status/reason/until com sucesso", async () => {
    const until = "2099-01-01T00:00:00.000Z";
    const res = await app.inject({
      method: "PATCH",
      url: `/api/characters/${character.id}/availability`,
      headers: { cookie: owner.cookie },
      payload: { status: "BUSY", reason: "Treino de pista", until },
    });
    expect(res.statusCode).toBe(200);
    const { availability } = res.json() as { availability: Availability };
    expect(availability.status).toBe("BUSY");
    expect(availability.reason).toBe("Treino de pista");
    expect(availability.until).toBe(until);
  });

  it("cleanup: clear via payload null", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/characters/${character.id}/availability`,
      headers: { cookie: owner.cookie },
      payload: { status: "AVAILABLE", reason: null, until: null },
    });
    expect(res.statusCode).toBe(200);
    const { availability } = res.json() as { availability: Availability };
    expect(availability.status).toBe("AVAILABLE");
    expect(availability.reason).toBeNull();
    expect(availability.until).toBeNull();
  });

  it("until no passado (< since) -> 400 VALIDATION_ERROR", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/characters/${character.id}/availability`,
      headers: { cookie: owner.cookie },
      payload: { status: "BUSY", until: "2020-01-01T00:00:00.000Z" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("status inválido -> 400", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/characters/${character.id}/availability`,
      headers: { cookie: owner.cookie },
      payload: { status: "INVALID_STATUS" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("atualização parcial preserva campos não enviados", async () => {
    await app.inject({
      method: "PATCH",
      url: `/api/characters/${character.id}/availability`,
      headers: { cookie: owner.cookie },
      payload: { status: "RACE_WEEKEND", reason: "GP em casa" },
    });
    const res = await app.inject({
      method: "GET",
      url: `/api/characters/${character.id}/availability`,
      headers: { cookie: owner.cookie },
    });
    const { availability } = res.json() as { availability: Availability };
    expect(availability.status).toBe("RACE_WEEKEND");
    expect(availability.reason).toBe("GP em casa");
  });
});