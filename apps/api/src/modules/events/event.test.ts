import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";

// Importante: o rate limit da API é de 100 requests/min por instância de app.
// Como cada arquivo de teste cria sua própria instância (buildApp), este
// arquivo compartilha usuários/personagens/eventos entre os testes (via
// beforeAll) para permanecer bem abaixo desse limite, preservando a
// granularidade da matriz de testes.
//
// Todos os artefatos criados (users, characters, events, eventCharacter) são
// rastreados em conjuntos e removidos em afterAll, devolvendo o
// f1_narrative_test ao baseline limpo, sem TRUNCATE/ressettos.

let app: FastifyInstance;

type TestUser = {
  cookie: string;
  userId: string;
};

type EventRecord = {
  id: string;
  type: string;
  importance: string;
  source: string;
  title: string;
  description: string | null;
  worldDate: string | null;
  createdAt: string;
};

type Character = {
  id: string;
  name: string;
  nationality: string;
};

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdEventIds: string[] = [];

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
  const user = track(createdUserIds, await prisma.user.findUniqueOrThrow({ where: { email } }));
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

async function createEvent(
  user: TestUser,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; json: { event?: EventRecord; code?: string } }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/events",
    headers: { cookie: user.cookie },
    payload,
  });
  if (res.statusCode === 201 && res.json().event) {
    track(createdEventIds, res.json().event as { id: string });
  }
  return { statusCode: res.statusCode, json: res.json() as { event?: EventRecord; code?: string } };
}

async function addParticipant(
  user: TestUser,
  eventId: string,
  characterId: string,
): Promise<{ statusCode: number; json: { participant?: unknown; code?: string } }> {
  const res = await app.inject({
    method: "POST",
    url: `/api/events/${eventId}/participants`,
    headers: { cookie: user.cookie },
    payload: { characterId },
  });
  return { statusCode: res.statusCode, json: res.json() };
}

let owner: TestUser;
let intruder: TestUser;
let charA: Character;
let charB: Character;

beforeAll(async () => {
  app = buildApp();
  await app.ready();

  const suffix = Date.now();
  owner = await createUser(`ev-owner-${suffix}@f1nw.test`, "EvOwner");
  intruder = await createUser(`ev-intru-${suffix}@f1nw.test`, "EvIntru");

  charA = await createCharacter(owner, {
    name: "Evento Char A",
    nationality: "Brasileira",
    birthDate: "1995-01-01",
  });
  charB = await createCharacter(intruder, {
    name: "Evento Char B",
    nationality: "Britânica",
    birthDate: "1990-01-01",
  });
});

afterAll(async () => {
  // cleanup em ordem segura de FK: notícias e vínculos primeiro, depois
  // eventos e personagens, por fim usuários (cascade de Session/Account).
  await prisma.newsItem.deleteMany({
    where: { eventId: { in: createdEventIds } },
  });
  await prisma.eventCharacter.deleteMany({
    where: { characterId: { in: createdCharacterIds } },
  });
  await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

  await prisma.$disconnect();
  await app.close();
});

describe("Auth — todos os endpoints → 401 sem sessão", () => {
  it("Event + EventCharacter exigem autenticação", async () => {
    const uuid = "00000000-0000-4000-8000-000000000000";
    const cases: Array<{ method: string; url: string; payload?: unknown }> = [
      { method: "GET", url: "/api/events" },
      { method: "POST", url: "/api/events", payload: { type: "RACE", title: "X" } },
      { method: "GET", url: `/api/events/${uuid}` },
      { method: "PATCH", url: `/api/events/${uuid}`, payload: { title: "Y" } },
      { method: "DELETE", url: `/api/events/${uuid}` },
      { method: "GET", url: `/api/events/${uuid}/participants` },
      { method: "POST", url: `/api/events/${uuid}/participants`, payload: { characterId: uuid } },
      { method: "DELETE", url: `/api/events/${uuid}/participants/${uuid}` },
    ];
    for (const c of cases) {
      const res = await app.inject({
        method: c.method as "GET",
        url: c.url,
        payload: c.payload as Record<string, unknown>,
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("UNAUTHENTICATED");
    }
  });
});

describe("POST /api/events", () => {
  it("cria evento válido → 201 com defaults do Prisma (importance MEDIUM, source GENERATED_EVENT)", async () => {
    const { statusCode, json } = await createEvent(owner, {
      type: "RACE",
      title: "Grande Prêmio Teste",
    });
    expect(statusCode).toBe(201);
    const ev = json.event as EventRecord;
    expect(ev.importance).toBe("MEDIUM");
    expect(ev.source).toBe("GENERATED_EVENT");
    expect(ev.description).toBeNull();
    expect(ev.worldDate).toBeNull();
  });

  it("title vazio → 400 VALIDATION_ERROR", async () => {
    const { statusCode, json } = await createEvent(owner, { type: "RACE", title: "  " });
    expect(statusCode).toBe(400);
    expect(json.code).toBe("VALIDATION_ERROR");
  });

  it("type inválido → 400", async () => {
    const { statusCode, json } = await createEvent(owner, { type: "NOT_A_TYPE", title: "X" });
    expect(statusCode).toBe(400);
    expect(json.code).toBe("VALIDATION_ERROR");
  });

  it("importance inválida → 400", async () => {
    const { statusCode, json } = await createEvent(owner, {
      type: "RACE",
      title: "X",
      importance: "IMPOSSIVEL",
    });
    expect(statusCode).toBe(400);
    expect(json.code).toBe("VALIDATION_ERROR");
  });

  it("source inválido → 400", async () => {
    const { statusCode, json } = await createEvent(owner, {
      type: "RACE",
      title: "X",
      source: "FROM_THE_WEB",
    });
    expect(statusCode).toBe(400);
    expect(json.code).toBe("VALIDATION_ERROR");
  });

  it("persiste description nullável e worldDate persistido", async () => {
    const { statusCode, json } = await createEvent(owner, {
      type: "NEWS",
      title: "Notícia Teste",
      description: "Uma descrição narrativa.",
      worldDate: "2026-01-15T14:00:00.000Z",
      importance: "HIGH",
    });
    expect(statusCode).toBe(201);
    const ev = json.event as EventRecord;
    expect(ev.description).toBe("Uma descrição narrativa.");
    expect(ev.worldDate).toBe("2026-01-15T14:00:00.000Z");
    expect(ev.importance).toBe("HIGH");
  });

  it("persiste payload JSON", async () => {
    const { statusCode, json } = await createEvent(owner, {
      type: "RACE",
      title: "Com Payload",
      payload: { nota: 1, vitrine: true },
    });
    expect(statusCode).toBe(201);
    expect((json.event as EventRecord & { payload: unknown }).payload).toEqual({ nota: 1, vitrine: true });
  });

  it("response não expõe campos desnecessários", async () => {
    const { json } = await createEvent(owner, { type: "SOCIAL", title: "Social Limpo" });
    const keys = Object.keys(json.event as Record<string, unknown>).sort();
    expect(keys).toEqual([
      "createdAt",
      "description",
      "id",
      "importance",
      "payload",
      "source",
      "title",
      "type",
      "worldDate",
    ]);
    expect(keys).not.toContain("updatedAt");
    expect(keys).not.toContain("userId");
    expect(keys).not.toContain("participants");
    expect(keys).not.toContain("newsItems");
  });
});

describe("GET /api/events (global) — filtros", () => {
  it("lista sem filtros → 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/events",
      headers: { cookie: intruder.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().events)).toBe(true);
  });

  it("filtra por type → 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/events?type=RACE",
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const types = new Set((res.json().events as EventRecord[]).map((e) => e.type));
    expect(types.size).toBe(1);
    expect(types.has("RACE")).toBe(true);
  });

  it("combina type + importance → 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/events?type=RACE&importance=HIGH",
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    for (const e of res.json().events as EventRecord[]) {
      expect(e.type).toBe("RACE");
      expect(e.importance).toBe("HIGH");
    }
  });

  it("valor inválido de query → 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/events?type=INVALIDO",
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });
});

describe("Event global — ownership compartilhado entre usuários", () => {
  let sharedEventId: string;

  beforeAll(async () => {
    const { json } = await createEvent(owner, { type: "WORLD", title: "Evento Global" });
    sharedEventId = (json.event as EventRecord).id;
  });

  it("usuário B consulta evento criado por A → 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/events/${sharedEventId}`,
      headers: { cookie: intruder.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().event.title).toBe("Evento Global");
  });

  it("usuário B edita evento criado por A → 200", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/events/${sharedEventId}`,
      headers: { cookie: intruder.cookie },
      payload: { title: "Evento Global Editado" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().event.title).toBe("Evento Global Editado");
  });

  it("usuário B exclui evento criado por A → 204", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/events/${sharedEventId}`,
      headers: { cookie: intruder.cookie },
    });
    expect(res.statusCode).toBe(204);
  });
});

describe("GET /api/events/:id, PATCH, DELETE", () => {
  it("GET existente → 200; GET inexistente → 404", async () => {
    const { json } = await createEvent(owner, { type: "RACE", title: "Leitura Evento" });
    const id = (json.event as EventRecord).id;
    const ok = await app.inject({
      method: "GET",
      url: `/api/events/${id}`,
      headers: { cookie: owner.cookie },
    });
    expect(ok.statusCode).toBe(200);

    const missing = await app.inject({
      method: "GET",
      url: "/api/events/00000000-0000-4000-8000-000000000000",
      headers: { cookie: owner.cookie },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe("NOT_FOUND");
  });

  it("PATCH existente → 200; PATCH inexistente → 404; UUID inválido → 400", async () => {
    const { json } = await createEvent(owner, { type: "SOCIAL", title: "Editável" });
    const id = (json.event as EventRecord).id;

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/events/${id}`,
      headers: { cookie: owner.cookie },
      payload: { title: "Título Novo", importance: "LOW" },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().event.title).toBe("Título Novo");
    expect(patch.json().event.importance).toBe("LOW");

    const patchMissing = await app.inject({
      method: "PATCH",
      url: "/api/events/00000000-0000-4000-8000-000000000000",
      headers: { cookie: owner.cookie },
      payload: { title: "X" },
    });
    expect(patchMissing.statusCode).toBe(404);

    const badUuid = await app.inject({
      method: "GET",
      url: "/api/events/nao-e-uuid",
      headers: { cookie: owner.cookie },
    });
    expect(badUuid.statusCode).toBe(400);
    expect(badUuid.json().code).toBe("VALIDATION_ERROR");
  });

  it("DELETE existente → 204; DELETE inexistente → 404", async () => {
    const { json } = await createEvent(owner, { type: "RACE", title: "Excluir Evento" });
    const id = (json.event as EventRecord).id;

    const del = await app.inject({
      method: "DELETE",
      url: `/api/events/${id}`,
      headers: { cookie: owner.cookie },
    });
    expect(del.statusCode).toBe(204);

    const delMissing = await app.inject({
      method: "DELETE",
      url: "/api/events/00000000-0000-4000-8000-000000000000",
      headers: { cookie: owner.cookie },
    });
    expect(delMissing.statusCode).toBe(404);
  });

  it("criação com UUID inválido de id → 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/events/abc123",
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/events/:eventId/participants", () => {
  let event: EventRecord;

  beforeAll(async () => {
    const { json } = await createEvent(owner, { type: "RACE", title: "Evento Participantes" });
    event = json.event as EventRecord;
  });

  it("associa Character de A (owner) → 201", async () => {
    const { statusCode } = await addParticipant(owner, event.id, charA.id);
    expect(statusCode).toBe(201);
  });

  it("associação duplicada → 409", async () => {
    const { statusCode, json } = await addParticipant(owner, event.id, charA.id);
    expect(statusCode).toBe(409);
    expect(json.code).toBe("CONFLICT");
  });

  it("Character de outro usuário → 404 (sem vazar existência)", async () => {
    const { statusCode, json } = await addParticipant(owner, event.id, charB.id);
    expect(statusCode).toBe(404);
    expect(json.code).toBe("NOT_FOUND");
  });

  it("Character inexistente → 404", async () => {
    const { statusCode } = await addParticipant(
      owner,
      event.id,
      "00000000-0000-4000-8000-000000000000",
    );
    expect(statusCode).toBe(404);
  });

  it("Event inexistente → 404", async () => {
    const { statusCode } = await addParticipant(
      owner,
      "00000000-0000-4000-8000-000000000000",
      charA.id,
    );
    expect(statusCode).toBe(404);
  });

  it("Character com userId = null (IA/global) → 404", async () => {
    const aiCharacter = track(
      createdCharacterIds,
      await prisma.character.create({
        data: {
          userId: null,
          name: "IA Evento",
          nationality: "Global",
          birthDate: new Date("1990-01-01"),
        },
        select: { id: true },
      }),
    );
    const { statusCode } = await addParticipant(owner, event.id, aiCharacter.id);
    expect(statusCode).toBe(404);
  });

  it("concorrência no mesmo (event, character) → [201, 409]", async () => {
    const ev = (await createEvent(owner, { type: "SOCIAL", title: "Concorrente" })).json.event as EventRecord;
    const ch = await createCharacter(owner, {
      name: "Concorrente Char",
      nationality: "Italiana",
      birthDate: "1992-01-01",
    });
    const [a, b] = await Promise.all([
      addParticipant(owner, ev.id, ch.id),
      addParticipant(owner, ev.id, ch.id),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
  });
});

describe("GET /api/events/:eventId/participants — proteção de vazamento", () => {
  let event: EventRecord;

  beforeAll(async () => {
    // Evento global com participante de A e participante de B.
    const { json } = await createEvent(owner, { type: "RELATIONSHIP", title: "Evento Misto" });
    event = json.event as EventRecord;
    await addParticipant(owner, event.id, charA.id); // dono A
    await addParticipant(intruder, event.id, charB.id); // dono B
  });

  it("usuário A vê somente charA; nunca charB", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/events/${event.id}/participants`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const participants = res.json().participants as {
      character: { id: string; name: string; nationality: string; imageUrl: string | null };
    }[];
    const ids = participants.map((p) => p.character.id);
    expect(ids).toContain(charA.id);
    expect(ids).not.toContain(charB.id);
    for (const p of participants) {
      expect(Object.keys(p.character).sort()).toEqual(["id", "imageUrl", "name", "nationality"]);
    }
  });

  it("usuário B vê somente charB; nunca charA", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/events/${event.id}/participants`,
      headers: { cookie: intruder.cookie },
    });
    expect(res.statusCode).toBe(200);
    const participants = res.json().participants as {
      character: { id: string };
    }[];
    const ids = participants.map((p) => p.character.id);
    expect(ids).toContain(charB.id);
    expect(ids).not.toContain(charA.id);
  });

  it("Event inexistente → 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/events/00000000-0000-4000-8000-000000000000/participants",
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /api/events/:eventId/participants/:characterId", () => {
  it("dono remove seu Character → 204, e vínculo some", async () => {
    const ev = (await createEvent(owner, { type: "RACE", title: "Remove 1" })).json.event as EventRecord;
    const ch = await createCharacter(owner, { name: "Remover", nationality: "Alemã", birthDate: "1991-01-01" });
    await addParticipant(owner, ev.id, ch.id);

    const res = await app.inject({
      method: "DELETE",
      url: `/api/events/${ev.id}/participants/${ch.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(204);

    const link = await prisma.eventCharacter.findFirst({ where: { eventId: ev.id, characterId: ch.id } });
    expect(link).toBeNull();
  });

  it("Character não associado → 404", async () => {
    const ev = (await createEvent(owner, { type: "RACE", title: "Remove 2" })).json.event as EventRecord;
    const res = await app.inject({
      method: "DELETE",
      url: `/api/events/${ev.id}/participants/${charA.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("Event inexistente → 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/events/00000000-0000-4000-8000-000000000000/participants/00000000-0000-4000-8000-000000000000",
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("usuário B tenta remover charA de A → 404 e vínculo de A permanece", async () => {
    const ev = (await createEvent(owner, { type: "RACE", title: "Remove 3" })).json.event as EventRecord;
    await addParticipant(owner, ev.id, charA.id);

    // B conhece eventId + characterId e tenta apagar a associação de A.
    const res = await app.inject({
      method: "DELETE",
      url: `/api/events/${ev.id}/participants/${charA.id}`,
      headers: { cookie: intruder.cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");

    // A associação de A continua existindo.
    const link = await prisma.eventCharacter.findFirst({ where: { eventId: ev.id, characterId: charA.id } });
    expect(link).not.toBeNull();
  });
});

describe("Integridade / cascade Event → EventCharacter", () => {
  it("excluir Event remove EventCharacter associados e preserva o Character", async () => {
    const ev = (await createEvent(owner, { type: "WORLD", title: "Cascade" })).json.event as EventRecord;
    const ch = await createCharacter(owner, { name: "Cascata Char", nationality: "China", birthDate: "1993-01-01" });
    await addParticipant(owner, ev.id, ch.id);

    expect(await prisma.eventCharacter.count({ where: { eventId: ev.id } })).toBe(1);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/events/${ev.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(del.statusCode).toBe(204);

    expect(await prisma.eventCharacter.count({ where: { eventId: ev.id } })).toBe(0);
    // O Character segue existindo (não é apagado em cascata).
    expect(await prisma.character.findUnique({ where: { id: ch.id } })).not.toBeNull();
  });
});