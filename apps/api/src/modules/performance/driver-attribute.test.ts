import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { DEFAULT_DRIVER_ATTRIBUTES } from "./driver-attribute.js";

let app: FastifyInstance;

type TestUser = {
  cookie: string;
  userId: string;
};

type Season = {
  id: string;
  year: number;
};

type Character = {
  id: string;
  name: string;
};

const createdSeasonIds: string[] = [];
const createdCharacterIds: string[] = [];

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

async function createCharacter(
  user: TestUser,
  name: string,
): Promise<Character> {
  const res = await app.inject({
    method: "POST",
    url: "/api/characters",
    headers: { cookie: user.cookie },
    payload: { name, nationality: "BR", birthDate: "1990-01-01" },
  });
  expect(res.statusCode).toBe(201);
  const character = res.json().character as Character;
  createdCharacterIds.push(character.id);
  return character;
}

async function createDriver(
  user: TestUser,
  characterId: string,
): Promise<string> {
  const res = await app.inject({
    method: "PUT",
    url: `/api/drivers/${characterId}`,
    headers: { cookie: user.cookie },
    payload: { number: 19 },
  });
  expect(res.statusCode).toBe(200);
  return (res.json().driver as { id: string }).id;
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

function attributesUrl(seasonId: string, characterId: string): string {
  return `/api/attributes/seasons/${seasonId}/drivers/${characterId}`;
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  if (createdSeasonIds.length > 0) {
    await prisma.season.deleteMany({ where: { id: { in: createdSeasonIds } } });
  }
  await app.close();
});

describe("Driver Attributes", () => {
  it("GET retorna baseline padrão quando não há registro", async () => {
    const user = await createUser(
      `attr-get-default-${Date.now()}@test.dev`,
      "Attr Get",
    );
    const character = await createCharacter(user, "Attr Base Driver");
    await createDriver(user, character.id);
    const season = await createSeason(user, 2026);

    const res = await app.inject({
      method: "GET",
      url: attributesUrl(season.id, character.id),
      headers: { cookie: user.cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().attributes).toEqual(DEFAULT_DRIVER_ATTRIBUTES);
  });

  it("PUT cria o registro e GET reflete os valores", async () => {
    const user = await createUser(
      `attr-put-${Date.now()}@test.dev`,
      "Attr Put",
    );
    const character = await createCharacter(user, "Attr Create Driver");
    await createDriver(user, character.id);
    const season = await createSeason(user, 2027);

    const put = await app.inject({
      method: "PUT",
      url: attributesUrl(season.id, character.id),
      headers: { cookie: user.cookie },
      payload: { speed: 92, consistency: 80, racecraft: 88, aggression: 70 },
    });

    expect(put.statusCode).toBe(200);
    expect(put.json().attributes).toEqual({
      speed: 92,
      consistency: 80,
      racecraft: 88,
      aggression: 70,
    });

    const get = await app.inject({
      method: "GET",
      url: attributesUrl(season.id, character.id),
      headers: { cookie: user.cookie },
    });

    expect(get.statusCode).toBe(200);
    expect(get.json().attributes).toEqual({
      speed: 92,
      consistency: 80,
      racecraft: 88,
      aggression: 70,
    });
  });

  it("PUT sobrescreve registro existente", async () => {
    const user = await createUser(
      `attr-update-${Date.now()}@test.dev`,
      "Attr Update",
    );
    const character = await createCharacter(user, "Attr Update Driver");
    await createDriver(user, character.id);
    const season = await createSeason(user, 2028);

    await app.inject({
      method: "PUT",
      url: attributesUrl(season.id, character.id),
      headers: { cookie: user.cookie },
      payload: { speed: 40, consistency: 40, racecraft: 40, aggression: 40 },
    });

    const put = await app.inject({
      method: "PUT",
      url: attributesUrl(season.id, character.id),
      headers: { cookie: user.cookie },
      payload: { speed: 95, consistency: 20, racecraft: 55, aggression: 10 },
    });

    expect(put.statusCode).toBe(200);
    expect(put.json().attributes).toEqual({
      speed: 95,
      consistency: 20,
      racecraft: 55,
      aggression: 10,
    });
  });

  it("DELETE remove o registro e GET volta ao baseline", async () => {
    const user = await createUser(
      `attr-delete-${Date.now()}@test.dev`,
      "Attr Delete",
    );
    const character = await createCharacter(user, "Attr Delete Driver");
    await createDriver(user, character.id);
    const season = await createSeason(user, 2029);

    await app.inject({
      method: "PUT",
      url: attributesUrl(season.id, character.id),
      headers: { cookie: user.cookie },
      payload: { speed: 90, consistency: 90, racecraft: 90, aggression: 90 },
    });

    const del = await app.inject({
      method: "DELETE",
      url: attributesUrl(season.id, character.id),
      headers: { cookie: user.cookie },
    });

    expect(del.statusCode).toBe(204);

    const get = await app.inject({
      method: "GET",
      url: attributesUrl(season.id, character.id),
      headers: { cookie: user.cookie },
    });

    expect(get.statusCode).toBe(200);
    expect(get.json().attributes).toEqual(DEFAULT_DRIVER_ATTRIBUTES);
  });

  it("PUT rejeita valores fora de 0..100", async () => {
    const user = await createUser(
      `attr-range-${Date.now()}@test.dev`,
      "Attr Range",
    );
    const character = await createCharacter(user, "Attr Range Driver");
    await createDriver(user, character.id);
    const season = await createSeason(user, 2030);

    const res = await app.inject({
      method: "PUT",
      url: attributesUrl(season.id, character.id),
      headers: { cookie: user.cookie },
      payload: { speed: 150, consistency: 70, racecraft: 60, aggression: 60 },
    });

    expect(res.statusCode).toBe(400);
  });

  it("PUT de piloto inexistente ou não pertencente ao usuário retorna 404", async () => {
    const user = await createUser(
      `attr-owner-${Date.now()}@test.dev`,
      "Attr Owner",
    );
    const season = await createSeason(user, 2031);

    const res = await app.inject({
      method: "PUT",
      url: attributesUrl(
        season.id,
        "00000000-0000-0000-0000-000000000000",
      ),
      headers: { cookie: user.cookie },
      payload: {
        speed: 80,
        consistency: 80,
        racecraft: 80,
        aggression: 80,
      },
    });

    expect(res.statusCode).toBe(404);
  });

  it("PUT de temporada inexistente retorna 404", async () => {
    const user = await createUser(
      `attr-season-${Date.now()}@test.dev`,
      "Attr Season",
    );
    const character = await createCharacter(user, "Attr Season Driver");
    await createDriver(user, character.id);

    const res = await app.inject({
      method: "PUT",
      url: attributesUrl(
        "00000000-0000-0000-0000-000000000000",
        character.id,
      ),
      headers: { cookie: user.cookie },
      payload: {
        speed: 80,
        consistency: 80,
        racecraft: 80,
        aggression: 80,
      },
    });

    expect(res.statusCode).toBe(404);
  });

  it("registros de atributos são isolados por temporada", async () => {
    const user = await createUser(
      `attr-isolated-${Date.now()}@test.dev`,
      "Attr Isolated",
    );
    const character = await createCharacter(user, "Attr Isolated Driver");
    await createDriver(user, character.id);
    const seasonA = await createSeason(user, 2032);
    const seasonB = await createSeason(user, 2033);

    await app.inject({
      method: "PUT",
      url: attributesUrl(seasonA.id, character.id),
      headers: { cookie: user.cookie },
      payload: {
        speed: 88,
        consistency: 40,
        racecraft: 70,
        aggression: 30,
      },
    });

    const getA = await app.inject({
      method: "GET",
      url: attributesUrl(seasonA.id, character.id),
      headers: { cookie: user.cookie },
    });
    const getB = await app.inject({
      method: "GET",
      url: attributesUrl(seasonB.id, character.id),
      headers: { cookie: user.cookie },
    });

    expect(getA.json().attributes.speed).toBe(88);
    expect(getB.json().attributes).toEqual(DEFAULT_DRIVER_ATTRIBUTES);
  });
});