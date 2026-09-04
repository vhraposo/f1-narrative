import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";

// Todos os artefatos criados (users, characters, schedules) são rastreados e
// removidos em afterAll, devolvendo o f1_narrative_test ao baseline limpo,
// sem TRUNCATE/reset. Só o que o teste criou é apagado.

let app: FastifyInstance;

type TestUser = {
  cookie: string;
  userId: string;
};

type Character = {
  id: string;
  name: string;
  nationality: string;
};

type Schedule = {
  id: string;
  characterId: string;
  activity: string;
  startsAt: string;
  endsAt: string | null;
  createdAt: string;
};

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];

function track<T extends { id: string }>(list: string[], entity: T): T {
  list.push(entity.id);
  return entity;
}

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
  const user = track(
    createdUserIds,
    await prisma.user.findUniqueOrThrow({ where: { email } }),
  );
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
  await prisma.characterSchedule.deleteMany({
    where: { characterId: { in: createdCharacterIds } },
  });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
  await app.close();
});

describe("Schedule - auth 401", () => {
  const charId = "00000000-0000-4000-8000-000000000001";
  const schedId = "00000000-0000-4000-8000-000000000002";

  it("GET retorna 401 sem sessão", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/characters/${charId}/schedule`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST retorna 401 sem sessão", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/characters/${charId}/schedule`,
      payload: { activity: "Treino", startsAt: "2099-01-01T10:00:00.000Z" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("PATCH retorna 401 sem sessão", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/characters/${charId}/schedule/${schedId}`,
      payload: { activity: "Treino" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("DELETE retorna 401 sem sessão", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/characters/${charId}/schedule/${schedId}`,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("Schedule - ownership e validação de character", () => {
  let owner: TestUser;
  let intruder: TestUser;
  let character: Character;

  beforeAll(async () => {
    owner = await createUser(`sched-owner-${Date.now()}@f1nw.test`, "SchedDono");
    intruder = await createUser(`sched-intr-${Date.now()}@f1nw.test`, "SchedIntr");
    character = await createCharacter(owner, {
      name: "Piloto Agenda",
      nationality: "BR",
      birthDate: "1995-01-01",
    });
  });

  it("Character inexistente -> 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/characters/${crypto.randomUUID()}/schedule`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("Character de outro usuário -> 404 (nunca 403)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/characters/${character.id}/schedule`,
      headers: { cookie: intruder.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST em character de outro usuário -> 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/characters/${character.id}/schedule`,
      headers: { cookie: intruder.cookie },
      payload: { activity: "Treino", startsAt: "2099-01-01T10:00:00.000Z" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("Schedule - POST", () => {
  let owner: TestUser;
  let character: Character;

  beforeAll(async () => {
    owner = await createUser(`sched-post-${Date.now()}@f1nw.test`, "PostDono");
    character = await createCharacter(owner, {
      name: "Piloto POST",
      nationality: "IT",
      birthDate: "1994-02-02",
    });
  });

  it("POST válido -> 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/characters/${character.id}/schedule`,
      headers: { cookie: owner.cookie },
      payload: {
        activity: "Treino livre",
        startsAt: "2099-01-01T10:00:00.000Z",
        endsAt: "2099-01-01T12:00:00.000Z",
      },
    });
    expect(res.statusCode).toBe(201);
    const { schedule } = res.json() as { schedule: Schedule };
    expect(schedule.activity).toBe("Treino livre");
    expect(schedule.characterId).toBe(character.id);
  });

  it("activity vazia -> 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/characters/${character.id}/schedule`,
      headers: { cookie: owner.cookie },
      payload: { activity: "   ", startsAt: "2099-01-01T10:00:00.000Z" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("startsAt inválido -> 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/characters/${character.id}/schedule`,
      headers: { cookie: owner.cookie },
      payload: { activity: "Treino", startsAt: "nao-e-uma-data" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("endsAt inválido -> 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/characters/${character.id}/schedule`,
      headers: { cookie: owner.cookie },
      payload: {
        activity: "Treino",
        startsAt: "2099-01-01T10:00:00.000Z",
        endsAt: "invalido",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("endsAt anterior a startsAt -> 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/characters/${character.id}/schedule`,
      headers: { cookie: owner.cookie },
      payload: {
        activity: "Treino",
        startsAt: "2099-01-01T12:00:00.000Z",
        endsAt: "2099-01-01T10:00:00.000Z",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("endsAt = startsAt é aceito (sem regra contrária)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/characters/${character.id}/schedule`,
      headers: { cookie: owner.cookie },
      payload: {
        activity: "Instante",
        startsAt: "2099-01-01T10:00:00.000Z",
        endsAt: "2099-01-01T10:00:00.000Z",
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("dois schedules com overlap são aceitos", async () => {
    const base = "2099-02-01T10:00:00.000Z";
    const a = await app.inject({
      method: "POST",
      url: `/api/characters/${character.id}/schedule`,
      headers: { cookie: owner.cookie },
      payload: { activity: "A", startsAt: base, endsAt: "2099-02-01T12:00:00.000Z" },
    });
    const b = await app.inject({
      method: "POST",
      url: `/api/characters/${character.id}/schedule`,
      headers: { cookie: owner.cookie },
      payload: { activity: "B", startsAt: "2099-02-01T11:00:00.000Z", endsAt: "2099-02-01T13:00:00.000Z" },
    });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
  });

  it("passado e futuro são aceitos", async () => {
    const past = await app.inject({
      method: "POST",
      url: `/api/characters/${character.id}/schedule`,
      headers: { cookie: owner.cookie },
      payload: { activity: "Passado", startsAt: "2019-01-01T10:00:00.000Z" },
    });
    const future = await app.inject({
      method: "POST",
      url: `/api/characters/${character.id}/schedule`,
      headers: { cookie: owner.cookie },
      payload: { activity: "Futuro", startsAt: "2099-01-01T10:00:00.000Z" },
    });
    expect(past.statusCode).toBe(201);
    expect(future.statusCode).toBe(201);
  });
});

describe("Schedule - GET ordenado", () => {
  let owner: TestUser;
  let character: Character;

  beforeAll(async () => {
    owner = await createUser(`sched-get-${Date.now()}@f1nw.test`, "GetDono");
    character = await createCharacter(owner, {
      name: "Piloto GET",
      nationality: "GB",
      birthDate: "1993-03-03",
    });
    // cria fora de ordem; a resposta deve vir por startsAt ASC
    await app.inject({
      method: "POST",
      url: `/api/characters/${character.id}/schedule`,
      headers: { cookie: owner.cookie },
      payload: { activity: "Tarde", startsAt: "2099-01-01T15:00:00.000Z" },
    });
    await app.inject({
      method: "POST",
      url: `/api/characters/${character.id}/schedule`,
      headers: { cookie: owner.cookie },
      payload: { activity: "Manhã", startsAt: "2099-01-01T08:00:00.000Z" },
    });
  });

  it("GET retorna ordenado por startsAt crescente", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/characters/${character.id}/schedule`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const { schedules } = res.json() as { schedules: Schedule[] };
    const starts = schedules.map((s) => s.startsAt);
    const sorted = [...starts].sort((a, b) => a.localeCompare(b));
    expect(starts).toEqual(sorted);
    expect(schedules[0].activity).toBe("Manhã");
  });
});

describe("Schedule - PATCH, DELETE, ownership indireto", () => {
  let owner: TestUser;
  let otherOwner: TestUser;
  let character: Character;
  let otherCharacter: Character;
  let scheduleId: string;

  beforeAll(async () => {
    owner = await createUser(`sched-patch-${Date.now()}@f1nw.test`, "PatchDono");
    otherOwner = await createUser(`sched-other-${Date.now()}@f1nw.test`, "OtherDono");
    character = await createCharacter(owner, {
      name: "Piloto Edit",
      nationality: "FR",
      birthDate: "1992-04-04",
    });
    otherCharacter = await createCharacter(otherOwner, {
      name: "Piloto Alheio",
      nationality: "US",
      birthDate: "1991-05-05",
    });

    const created = await app.inject({
      method: "POST",
      url: `/api/characters/${character.id}/schedule`,
      headers: { cookie: owner.cookie },
      payload: { activity: "Original", startsAt: "2099-01-01T10:00:00.000Z" },
    });
    scheduleId = (created.json() as { schedule: Schedule }).schedule.id;
  });

  it("PATCH válido -> 200", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/characters/${character.id}/schedule/${scheduleId}`,
      headers: { cookie: owner.cookie },
      payload: { activity: "Editado" },
    });
    expect(res.statusCode).toBe(200);
    const { schedule } = res.json() as { schedule: Schedule };
    expect(schedule.activity).toBe("Editado");
  });

  it("PATCH mantém campos não enviados", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/characters/${character.id}/schedule/${scheduleId}`,
      headers: { cookie: owner.cookie },
      payload: { activity: "Apenas atividade" },
    });
    expect(res.statusCode).toBe(200);
    const { schedule } = res.json() as { schedule: Schedule };
    expect(schedule.startsAt).toBe("2099-01-01T10:00:00.000Z");
    expect(schedule.endsAt).toBeNull();
  });

  it("PATCH endsAt anterior a startsAt -> 400", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/characters/${character.id}/schedule/${scheduleId}`,
      headers: { cookie: owner.cookie },
      payload: { endsAt: "2099-01-01T09:00:00.000Z" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("Schedule inexistente -> 404", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/characters/${character.id}/schedule/${crypto.randomUUID()}`,
      headers: { cookie: owner.cookie },
      payload: { activity: "X" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("Schedule pertencente a outro Character -> 404", async () => {
    // schedule existe no character do owner; acessar via otherCharacter -> 404
    const res = await app.inject({
      method: "PATCH",
      url: `/api/characters/${otherCharacter.id}/schedule/${scheduleId}`,
      headers: { cookie: owner.cookie },
      payload: { activity: "Y" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("Character de usuário A nunca é manipulado pelo usuário B (PATCH)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/characters/${character.id}/schedule/${scheduleId}`,
      headers: { cookie: otherOwner.cookie },
      payload: { activity: "Hack" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE válido do schedule de outro character -> 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/characters/${otherCharacter.id}/schedule/${scheduleId}`,
      headers: { cookie: owner.cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE inexistente -> 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/characters/${character.id}/schedule/${crypto.randomUUID()}`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE válido -> 204", async () => {
    const created = await app.inject({
      method: "POST",
      url: `/api/characters/${character.id}/schedule`,
      headers: { cookie: owner.cookie },
      payload: { activity: "Para deletar", startsAt: "2099-01-01T20:00:00.000Z" },
    });
    const id = (created.json() as { schedule: Schedule }).schedule.id;

    const res = await app.inject({
      method: "DELETE",
      url: `/api/characters/${character.id}/schedule/${id}`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(204);
  });
});