import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { assembleContext } from "./context.assembly.js";

// Testes do Context Assembly (Fase 12, determinístico, SEM LLM).
// Todos os artefatos criados são rastreados e removidos em afterAll, devolvendo
// o f1_narrative_test ao baseline limpo, sem TRUNCATE/reset.

type TestUser = { cookie: string; userId: string };
type Character = {
  id: string;
  name: string;
  nationality: string;
  controlledBy: string;
  userId: string | null;
};

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];
const createdMemoryIds: string[] = [];
const createdEventIds: string[] = [];
const createdRelationshipIds: string[] = [];
const createdTeamIds: string[] = [];
const createdSeasonIds: string[] = [];
const createdRaceIds: string[] = [];
const createdDriverProfileIds: string[] = [];
const createdRaceResultIds: string[] = [];
const createdStandingIds: string[] = [];

function track<T extends { id: string }>(list: string[], entity: T): T {
  list.push(entity.id);
  return entity;
}

let app: FastifyInstance;

type JsonContext = {
  meta: {
    conversationId: string;
    conversationType: string;
    participantCharacterIds: string[];
    version: string;
  };
  participants: Array<{ characterId: string; name: string; isAIParticipant: boolean }>;
  activeSpeaker: { characterId: string | null; senderType: string };
  temporal: {
    worldDate: string | null;
    currentSeasonId: string | null;
    currentRaceId: string | null;
    currentSession: string | null;
    phaseMarker: string | null;
  };
  recentMessages: Array<{
    id: string;
    senderType: string;
    characterId: string | null;
    content: string;
    createdAt: string;
  }>;
  memories: Array<{ id: string; content: string; importance: string; eventId: string | null }>;
  events: Array<{ id: string; title: string }>;
  relationships: Array<{ id: string; characterAName: string; characterBName: string }>;
  motorsport: null | Record<string, unknown>;
  news: Array<{ id: string; title: string }>;
  omitted: { oldestMessagesTruncated: number; memoriesOmitted: number; reasons: string[] };
};

async function getContext(
  user: TestUser,
  conversationId: string,
): Promise<{ statusCode: number; json: { context?: JsonContext; code?: string } }> {
  const res = await app.inject({
    method: "GET",
    url: `/api/conversations/${conversationId}/context`,
    headers: { cookie: user.cookie },
  });
  return { statusCode: res.statusCode, json: res.json() };
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

async function createCharacter(user: TestUser, payload: Record<string, unknown>): Promise<Character> {
  const res = await app.inject({
    method: "POST",
    url: "/api/characters",
    headers: { cookie: user.cookie },
    payload,
  });
  expect(res.statusCode).toBe(201);
  return track(createdCharacterIds, res.json().character as Character);
}

async function createAICharacter(payload: { name: string; nationality: string }): Promise<Character> {
  const character = await prisma.character.create({
    data: {
      name: payload.name,
      nationality: payload.nationality,
      birthDate: new Date("1995-01-01"),
      controlledBy: "AI",
      userId: null,
    },
  });
  return track(createdCharacterIds, character as unknown as Character);
}

async function createConversation(
  user: TestUser,
  payload: Record<string, unknown>,
): Promise<{ id: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/conversations",
    headers: { cookie: user.cookie },
    payload,
  });
  expect(res.statusCode).toBe(201);
  return track(createdConversationIds, res.json().conversation as { id: string });
}

async function createMemory(user: TestUser, payload: Record<string, unknown>): Promise<{ id: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/memories",
    headers: { cookie: user.cookie },
    payload,
  });
  expect(res.statusCode).toBe(201);
  return track(createdMemoryIds, res.json().memory as { id: string });
}

async function createEvent(user: TestUser, title: string): Promise<{ id: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/events",
    headers: { cookie: user.cookie },
    payload: { type: "SOCIAL", title },
  });
  expect(res.statusCode).toBe(201);
  return track(createdEventIds, res.json().event as { id: string });
}

async function createRelationship(
  user: TestUser,
  characterAId: string,
  characterBId: string,
): Promise<{ id: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/relationships",
    headers: { cookie: user.cookie },
    payload: { characterAId, characterBId },
  });
  expect(res.statusCode).toBe(201);
  return track(createdRelationshipIds, res.json().relationship as { id: string });
}

async function resetWorld(next: {
  currentDate?: Date;
  currentSeasonId?: string | null;
  currentRaceId?: string | null;
}): Promise<void> {
  await prisma.worldState.upsert({
    where: { key: "default" },
    update: {
      ...(next.currentDate !== undefined ? { currentDate: next.currentDate } : {}),
      ...(next.currentSeasonId !== undefined ? { currentSeasonId: next.currentSeasonId } : {}),
      ...(next.currentRaceId !== undefined ? { currentRaceId: next.currentRaceId } : {}),
    },
    create: {
      key: "default",
      ...(next.currentDate !== undefined ? { currentDate: next.currentDate } : {}),
      ...(next.currentSeasonId !== undefined ? { currentSeasonId: next.currentSeasonId } : {}),
      ...(next.currentRaceId !== undefined ? { currentRaceId: next.currentRaceId } : {}),
    },
  });
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await prisma.message.deleteMany({
    where: { conversationId: { in: createdConversationIds } },
  });
  await prisma.conversationParticipant.deleteMany({
    where: { conversationId: { in: createdConversationIds } },
  });
  await prisma.newsItem.deleteMany({ where: { eventId: { in: createdEventIds } } });
  await prisma.raceResult.deleteMany({ where: { id: { in: createdRaceResultIds } } });
  await prisma.championshipStanding.deleteMany({ where: { id: { in: createdStandingIds } } });
  await prisma.race.deleteMany({ where: { id: { in: createdRaceIds } } });
  await prisma.season.deleteMany({ where: { id: { in: createdSeasonIds } } });
  await prisma.memoryCharacter.deleteMany({ where: { memoryId: { in: createdMemoryIds } } });
  await prisma.memory.deleteMany({ where: { id: { in: createdMemoryIds } } });
  await prisma.eventCharacter.deleteMany({ where: { eventId: { in: createdEventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
  await prisma.relationship.deleteMany({ where: { id: { in: createdRelationshipIds } } });
  await prisma.driverProfile.deleteMany({ where: { id: { in: createdDriverProfileIds } } });
  await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
  await app.close();
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe("Context - auth 401", () => {
  const convId = "00000000-0000-4000-8000-00000000000a";

  it("GET /api/conversations/:id/context retorna 401 sem sessão", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${convId}/context`,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Ownership e isolamento
// ---------------------------------------------------------------------------

describe("Context - ownership e isolamento", () => {
  let owner: TestUser;
  let intruder: TestUser;
  let charA: Character;
  let convId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`ctx-own-${suffix}@f1nw.test`, "CtxOwner");
    intruder = await createUser(`ctx-int-${suffix}@f1nw.test`, "CtxInt");
    charA = await createCharacter(owner, {
      name: "Alicya",
      nationality: "GB",
      birthDate: "1990-01-01",
    });
    const conv = await createConversation(owner, {
      type: "GROUP",
      participantIds: [charA.id],
    });
    convId = conv.id;
  });

  it("owner acessa o contexto -> 200 com meta correta", async () => {
    const res = await getContext(owner, convId);
    expect(res.statusCode).toBe(200);
    const ctx = res.json.context!;
    expect(ctx.meta.conversationId).toBe(convId);
    expect(ctx.meta.conversationType).toBe("GROUP");
    expect(ctx.meta.participantCharacterIds).toEqual([charA.id]);
    expect(ctx.meta.version).toBe("context.v1");
    expect(ctx.participants.map((p) => p.characterId)).toContain(charA.id);
  });

  it("intruder sem Character participante -> 404 (sem vazamento)", async () => {
    const res = await getContext(intruder, convId);
    expect(res.statusCode).toBe(404);
  });

  it("conversation inexistente -> 404", async () => {
    const res = await getContext(owner, randomUUID());
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Mensagens (vazia, ASC, USER+AI+SYSTEM)
// ---------------------------------------------------------------------------

describe("Context - mensagens", () => {
  let owner: TestUser;
  let charA: Character;
  let aiB: Character;
  let convId: string;
  let emptyConvId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`ctx-msg-${suffix}@f1nw.test`, "CtxMsg");
    charA = await createCharacter(owner, {
      name: "Max",
      nationality: "NL",
      birthDate: "1991-01-01",
    });
    aiB = await createAICharacter({ name: "Zoe (AI)", nationality: "FR" });
    const conv = await createConversation(owner, {
      type: "GROUP",
      participantIds: [charA.id, aiB.id],
    });
    convId = conv.id;
    const empty = await createConversation(owner, {
      type: "GROUP",
      participantIds: [charA.id],
    });
    emptyConvId = empty.id;

    await prisma.message.createMany({
      data: [
        { conversationId: convId, senderType: "SYSTEM", characterId: null, content: "primeira", createdAt: new Date("2026-01-01T10:00:00Z") },
        { conversationId: convId, senderType: "AI_CHARACTER", characterId: aiB.id, content: "segunda", createdAt: new Date("2026-01-01T10:00:01Z") },
        { conversationId: convId, senderType: "USER_CHARACTER", characterId: charA.id, content: "terceira", createdAt: new Date("2026-01-01T10:00:02Z") },
      ],
    });
  });

  it("conversa sem mensagens -> janela vazia, assembly mínimo", async () => {
    const res = await getContext(owner, emptyConvId);
    expect(res.statusCode).toBe(200);
    const ctx = res.json.context!;
    expect(ctx.recentMessages).toEqual([]);
    expect(ctx.omitted.oldestMessagesTruncated).toBe(0);
  });

  it("mensagens em ordem ASC com USER_CHARACTER, AI_CHARACTER e SYSTEM", async () => {
    const res = await getContext(owner, convId);
    expect(res.statusCode).toBe(200);
    const ctx = res.json.context!;
    expect(ctx.recentMessages.map((m) => m.content)).toEqual([
      "primeira",
      "segunda",
      "terceira",
    ]);
    expect(ctx.recentMessages[0].senderType).toBe("SYSTEM");
    expect(ctx.recentMessages[0].characterId).toBeNull();
    expect(ctx.recentMessages[1].senderType).toBe("AI_CHARACTER");
    expect(ctx.recentMessages[1].characterId).toBe(aiB.id);
    expect(ctx.recentMessages[2].senderType).toBe("USER_CHARACTER");
    expect(ctx.recentMessages[2].characterId).toBe(charA.id);
    const created = ctx.recentMessages.map((m) => m.createdAt);
    const sorted = [...created].sort((a, b) => a.localeCompare(b));
    expect(created).toEqual(sorted);
  });

  it("participantes incluem USER e AI marcados corretamente", async () => {
    const res = await getContext(owner, convId);
    const ctx = res.json.context!;
    const byName = new Map(ctx.participants.map((p) => [p.name, p]));
    expect(byName.get("Max")!.isAIParticipant).toBe(false);
    expect(byName.get("Zoe (AI)")!.isAIParticipant).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Memories relevantes / irrelevantes / ranking
// ---------------------------------------------------------------------------

describe("Context - memories", () => {
  let owner: TestUser;
  let charA: Character;
  let outsiderChar: Character;
  let convId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`ctx-mem-${suffix}@f1nw.test`, "CtxMem");
    charA = await createCharacter(owner, {
      name: "Carlos",
      nationality: "ES",
      birthDate: "1994-09-01",
    });
    outsiderChar = await createCharacter(owner, {
      name: "Charles",
      nationality: "MC",
      birthDate: "1997-10-16",
    });
    const conv = await createConversation(owner, {
      type: "GROUP",
      participantIds: [charA.id],
    });
    convId = conv.id;

    await createMemory(owner, {
      content: "relevante A",
      characterIds: [charA.id],
      importance: "LOW",
    });
    await createMemory(owner, {
      content: "relevante HIGH",
      characterIds: [charA.id],
      importance: "HIGH",
    });
    await createMemory(owner, {
      content: "relevante CRITICAL",
      characterIds: [charA.id],
      importance: "CRITICAL",
    });
    await createMemory(owner, {
      content: "irrelevante",
      characterIds: [outsiderChar.id],
      importance: "CRITICAL",
    });
  });

  it("só entram memórias relevantes ao escopo; irrelevantes ficam fora", async () => {
    const res = await getContext(owner, convId);
    expect(res.statusCode).toBe(200);
    const ctx = res.json.context!;
    const contents = ctx.memories.map((m) => m.content);
    expect(contents).toEqual(
      expect.arrayContaining([
        "relevante A",
        "relevante HIGH",
        "relevante CRITICAL",
      ]),
    );
    expect(contents).not.toContain("irrelevante");
  });

  it("memórias ordenadas por importância (CRITICAL > HIGH > LOW)", async () => {
    const res = await getContext(owner, convId);
    const ctx = res.json.context!;
    const rank = (imp: string) =>
      imp === "CRITICAL" ? 4 : imp === "HIGH" ? 3 : imp === "MEDIUM" ? 2 : 1;
    const importances = ctx.memories.map((m) => rank(m.importance));
    const sorted = [...importances].sort((a, b) => b - a);
    expect(importances).toEqual(sorted);
    expect(ctx.memories[0].importance).toBe("CRITICAL");
  });
});

// ---------------------------------------------------------------------------
// Eventos e memories vinculadas
// ---------------------------------------------------------------------------

describe("Context - eventos e memories vinculadas", () => {
  let owner: TestUser;
  let charA: Character;
  let outsiderChar: Character;
  let convId: string;
  let eventId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`ctx-evt-${suffix}@f1nw.test`, "CtxEvt");
    charA = await createCharacter(owner, {
      name: "Lando",
      nationality: "GB",
      birthDate: "1999-11-13",
    });
    outsiderChar = await createCharacter(owner, {
      name: "Oscar",
      nationality: "AU",
      birthDate: "2001-05-30",
    });
    const conv = await createConversation(owner, {
      type: "GROUP",
      participantIds: [charA.id],
    });
    convId = conv.id;

    const event = await createEvent(owner, "Evento do escopo");
    eventId = event.id;
    await prisma.eventCharacter.create({ data: { eventId, characterId: charA.id } });
    await createMemory(owner, {
      content: "memoria do evento",
      characterIds: [charA.id],
      eventId,
    });
    void outsiderChar;
  });

  it("evento do escopo entra no bloco events", async () => {
    const res = await getContext(owner, convId);
    expect(res.statusCode).toBe(200);
    const ctx = res.json.context!;
    const ids = ctx.events.map((e) => e.id);
    expect(ids).toContain(eventId);
  });

  it("memory vinculada ao evento entra com eventId", async () => {
    const res = await getContext(owner, convId);
    const ctx = res.json.context!;
    const mem = ctx.memories.find((m) => m.content === "memoria do evento");
    expect(mem).toBeTruthy();
    expect(mem!.eventId).toBe(eventId);
  });
});

// ---------------------------------------------------------------------------
// Relationships (só pares no escopo)
// ---------------------------------------------------------------------------

describe("Context - relationships", () => {
  let owner: TestUser;
  let charA: Character;
  let charB: Character;
  let aiC: Character;
  let convId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`ctx-rel-${suffix}@f1nw.test`, "CtxRel");
    charA = await createCharacter(owner, {
      name: "Sergio",
      nationality: "MX",
      birthDate: "1990-01-26",
    });
    charB = await createCharacter(owner, {
      name: "Nico",
      nationality: "DE",
      birthDate: "1992-07-03",
    });
    aiC = await createAICharacter({ name: "Perez (AI)", nationality: "MX" });
    const conv = await createConversation(owner, {
      type: "GROUP",
      participantIds: [charA.id, charB.id],
    });
    convId = conv.id;

    await createRelationship(owner, charA.id, charB.id);
    // Par com AI fora do escopo -> NÃO deve entrar (aiC não participa da conv)
    await prisma.relationship
      .create({
        data: { characterAId: charA.id, characterBId: aiC.id },
      })
      .then((r) => createdRelationshipIds.push(r.id));
  });

  it("só relationships com ambos os endpoints no escopo entram", async () => {
    const res = await getContext(owner, convId);
    expect(res.statusCode).toBe(200);
    const ctx = res.json.context!;
    // charA-charB está no escopo: deve haver ao menos 1 relationship.
    expect(ctx.relationships.length).toBeGreaterThanOrEqual(1);
    const hasInScope = ctx.relationships.some(
      (r) => r.characterAName === "Sergio" || r.characterBName === "Sergio",
    );
    expect(hasInScope).toBe(true);
    // A relationship que envolve aiC (fora do escopo) NÃO deve aparecer.
    const hasAI = ctx.relationships.some(
      (r) => r.characterAName === "Perez (AI)" || r.characterBName === "Perez (AI)",
    );
    expect(hasAI).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WorldState (leitura e referência quebrada)
// ---------------------------------------------------------------------------

describe("Context - WorldState", () => {
  let owner: TestUser;
  let charA: Character;
  let convId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`ctx-ws-${suffix}@f1nw.test`, "CtxWs");
    charA = await createCharacter(owner, {
      name: "Charles",
      nationality: "MC",
      birthDate: "1997-10-16",
    });
    const conv = await createConversation(owner, {
      type: "GROUP",
      participantIds: [charA.id],
    });
    convId = conv.id;
  });

  it("lê WorldState currentDate quando existir", async () => {
    await resetWorld({ currentDate: new Date("2026-06-01T12:00:00Z") });
    const res = await getContext(owner, convId);
    expect(res.statusCode).toBe(200);
    const ctx = res.json.context!;
    expect(ctx.temporal.worldDate).not.toBeNull();
  });

  it("corrige referência quebrada de currentSeasonId para null (sem escrever)", async () => {
    await resetWorld({ currentSeasonId: randomUUID() });
    const res = await getContext(owner, convId);
    const ctx = res.json.context!;
    expect(ctx.temporal.currentSeasonId).toBeNull();
    expect(
      ctx.omitted.reasons.some((r) =>
        r.includes("currentSeasonId aponta para Season inexistente"),
      ),
    ).toBe(true);
  });

  it("corrige referência quebrada de currentRaceId para null (sem escrever)", async () => {
    await resetWorld({ currentRaceId: randomUUID() });
    const res = await getContext(owner, convId);
    const ctx = res.json.context!;
    expect(ctx.temporal.currentRaceId).toBeNull();
    expect(
      ctx.omitted.reasons.some((r) => r.includes("currentRaceId aponta para Race inexistente")),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Motorsport (condicional)
// ---------------------------------------------------------------------------

describe("Context - motorsport", () => {
  let owner: TestUser;
  let charPilot: Character;
  let charNonPilot: Character;
  let convPilotId: string;
  let convNoPilotId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`ctx-mo-${suffix}@f1nw.test`, "CtxMo");
    charPilot = await createCharacter(owner, {
      name: "Piloto 99",
      nationality: "BR",
      birthDate: "1992-01-01",
    });
    charNonPilot = await createCharacter(owner, {
      name: "Comum",
      nationality: "IT",
      birthDate: "1995-01-01",
    });

    const team = track(
      createdTeamIds,
      await prisma.team.create({
        data: { name: `Team ${suffix}`, userId: owner.userId },
      }),
    );
    const season = track(
      createdSeasonIds,
      await prisma.season.create({
        data: { year: 2026, name: "2026 Championship", status: "ACTIVE" },
      }),
    );
    const race = track(
      createdRaceIds,
      await prisma.race.create({
        data: { seasonId: season.id, name: "GP de Interlagos", round: 1, status: "RACE" },
      }),
    );
    const dp = track(
      createdDriverProfileIds,
      await prisma.driverProfile.create({
        data: { characterId: charPilot.id, teamId: team.id, number: 99 },
      }),
    );
    track(
      createdRaceResultIds,
      await prisma.raceResult.create({
        data: { raceId: race.id, driverProfileId: dp.id, position: 1, points: 25, grid: 2 },
      }),
    );
    track(
      createdStandingIds,
      await prisma.championshipStanding.create({
        data: {
          seasonId: season.id,
          driverProfileId: dp.id,
          points: 25,
          position: 1,
          wins: 1,
          podiums: 1,
        },
      }),
    );
    await resetWorld({ currentSeasonId: season.id });

    const conv1 = await createConversation(owner, {
      type: "GROUP",
      participantIds: [charPilot.id],
    });
    convPilotId = conv1.id;
    const conv2 = await createConversation(owner, {
      type: "GROUP",
      participantIds: [charNonPilot.id],
    });
    convNoPilotId = conv2.id;
  });

  it("conversa com piloto inclui bloco motorsport", async () => {
    const res = await getContext(owner, convPilotId);
    expect(res.statusCode).toBe(200);
    const ctx = res.json.context!;
    expect(ctx.motorsport).not.toBeNull();
    const ms = ctx.motorsport!;
    const drivers = ms.drivers as Array<{ characterId: string }>;
    expect(drivers.map((d) => d.characterId)).toContain(charPilot.id);
    expect((ms.races as Array<{ name: string }>).map((r) => r.name)).toContain(
      "GP de Interlagos",
    );
    const standings = ms.standings as Array<{ characterName: string; position: number | null }>;
    expect(standings.length).toBeGreaterThanOrEqual(1);
    expect(standings[0].characterName).toBe("Piloto 99");
  });

  it("conversa sem piloto não inclui motorsport", async () => {
    const res = await getContext(owner, convNoPilotId);
    expect(res.statusCode).toBe(200);
    const ctx = res.json.context!;
    expect(ctx.motorsport).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// News internas
// ---------------------------------------------------------------------------

describe("Context - news internas", () => {
  let owner: TestUser;
  let charA: Character;
  let convId: string;
  let eventId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`ctx-news-${suffix}@f1nw.test`, "CtxNews");
    charA = await createCharacter(owner, {
      name: "George",
      nationality: "GB",
      birthDate: "1998-02-15",
    });
    const conv = await createConversation(owner, {
      type: "GROUP",
      participantIds: [charA.id],
    });
    convId = conv.id;

    const event = await createEvent(owner, "Evento com noticia");
    eventId = event.id;
    await prisma.eventCharacter.create({ data: { eventId, characterId: charA.id } });
    await prisma.newsItem.create({
      data: {
        eventId,
        title: "Noticia interna",
        body: "corpo",
        worldDate: new Date("2026-03-01"),
      },
    });
  });

  it("news vinculada a evento do escopo entra no bloco", async () => {
    const res = await getContext(owner, convId);
    expect(res.statusCode).toBe(200);
    const ctx = res.json.context!;
    const titles = ctx.news.map((n) => n.title);
    expect(titles).toContain("Noticia interna");
    void eventId;
  });
});

// ---------------------------------------------------------------------------
// Limites de contexto
// ---------------------------------------------------------------------------

describe("Context - limites de contexto", () => {
  let owner: TestUser;
  let charA: Character;
  let convId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`ctx-lim-${suffix}@f1nw.test`, "CtxLim");
    charA = await createCharacter(owner, {
      name: "Fernando",
      nationality: "ES",
      birthDate: "1981-07-29",
    });
    const conv = await createConversation(owner, {
      type: "GROUP",
      participantIds: [charA.id],
    });
    convId = conv.id;

    // Insere 60 mensagens diretamente (evita o rate-limit da API; a persistência
    // é o que importa para medir a janela de contexto). createdAt escalonado por
    // índice garante ordenação determinística (m0...m59 mais antigas→mais novas).
    await prisma.message.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        conversationId: convId,
        senderType: "SYSTEM" as const,
        characterId: null,
        content: `m${i}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
      })),
    });
  });

  it("janela de mensagens é limitada a 50, truncando as 10 mais antigas", async () => {
    const res = await getContext(owner, convId);
    expect(res.statusCode).toBe(200);
    const ctx = res.json.context!;
    expect(ctx.recentMessages.length).toBe(50);
    expect(ctx.omitted.oldestMessagesTruncated).toBe(10);
    expect(ctx.recentMessages[0].content).toBe("m10");
    expect(ctx.recentMessages[49].content).toBe("m59");
  });
});

// ---------------------------------------------------------------------------
// Determinismo (frame idêntico em execuções repetidas)
// ---------------------------------------------------------------------------

describe("Context - determinismo", () => {
  let owner: TestUser;
  let charA: Character;
  let aiB: Character;
  let outsiderChar: Character;
  let convId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`ctx-det-${suffix}@f1nw.test`, "CtxDet");
    charA = await createCharacter(owner, {
      name: "Raikkonen",
      nationality: "FI",
      birthDate: "1979-10-17",
    });
    aiB = await createAICharacter({ name: "Bottas (AI)", nationality: "FI" });
    outsiderChar = await createCharacter(owner, {
      name: "Hamilton",
      nationality: "GB",
      birthDate: "1985-01-07",
    });
    const conv = await createConversation(owner, {
      type: "GROUP",
      participantIds: [charA.id, aiB.id],
    });
    convId = conv.id;

    const event = await createEvent(owner, "Evento deterministico");
    await prisma.eventCharacter.create({ data: { eventId: event.id, characterId: charA.id } });
    await createMemory(owner, {
      content: "memoria alpha",
      characterIds: [charA.id],
      importance: "MEDIUM",
    });
    await createMemory(owner, {
      content: "memoria beta",
      characterIds: [charA.id],
      importance: "HIGH",
      eventId: event.id,
    });
    await createMemory(owner, {
      content: "memoria fora do escopo",
      characterIds: [outsiderChar.id],
      importance: "CRITICAL",
    });
    // Relationship USER+AI (via prisma, pois a API exige ownership dos dois lados).
    await prisma.relationship.create({
      data: { characterAId: charA.id, characterBId: aiB.id },
    }).then((r) => createdRelationshipIds.push(r.id));

    await prisma.message.createMany({
      data: [
        { conversationId: convId, senderType: "SYSTEM", characterId: null, content: "d1", createdAt: new Date("2026-08-01T08:00:00Z") },
        { conversationId: convId, senderType: "AI_CHARACTER", characterId: aiB.id, content: "d2", createdAt: new Date("2026-08-01T08:00:01Z") },
        { conversationId: convId, senderType: "USER_CHARACTER", characterId: charA.id, content: "d3", createdAt: new Date("2026-08-01T08:00:02Z") },
      ],
    });
    await resetWorld({ currentDate: new Date("2026-08-01T00:00:00Z") });
  });

  it("duas execuções produzem o mesmo frame (só assembledAt difere)", async () => {
    // Fixamos `now` para tornar o determinismo total (assembledAt fora da decisão).
    const fixedNow = new Date("2026-08-02T00:00:00Z");
    const a = await assembleContext(prisma, { conversationId: convId, userId: owner.userId, now: fixedNow });
    const b = await assembleContext(prisma, { conversationId: convId, userId: owner.userId, now: fixedNow });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("seleção determinística: memórias fora do escopo nunca entram", async () => {
    const res = await getContext(owner, convId);
    const ctx = res.json.context!;
    const contents = ctx.memories.map((m) => m.content);
    expect(contents).not.toContain("memoria fora do escopo");
    expect(contents).toEqual(
      expect.arrayContaining(["memoria alpha", "memoria beta"]),
    );
  });

  it("participantes e relationships corretos mesmo com User + AI", async () => {
    const res = await getContext(owner, convId);
    const ctx = res.json.context!;
    const aiCount = ctx.participants.filter((p) => p.isAIParticipant).length;
    expect(aiCount).toBeGreaterThanOrEqual(1);
    // aiB está no escopo; relationship charA-aiB (ambos no escopo) deve entrar.
    const hasRel = ctx.relationships.some(
      (r) => JSON.stringify(r).includes(charA.id) && JSON.stringify(r).includes(aiB.id),
    );
    expect(hasRel).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integração contrato neutro RAG → Assembly (Fase 13 STEP 11)
// ---------------------------------------------------------------------------

describe("Context - integração RAG (externalRag)", () => {
  type RagItem = {
    sourceId: string;
    documentId: string;
    chunkId: string;
    title: string;
    content: string;
    orderOriginal: number;
    score: number;
    distance: number;
    citation: string;
  };

  let owner: TestUser;
  let charA: Character;
  let convId: string;

  function mkRag(items: RagItem[] = []): Record<string, unknown> {
    return {
      sourceType: "external",
      provider: "cohere",
      model: "embed-multilingual-v3.0",
      version: "v3.0",
      dimensions: 1024,
      ruleApplied: "external-retrieval.v1#mode=pgvector#scope=service",
      items,
    };
  }

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`ctx-rag-${suffix}@f1nw.test`, "CtxRag");
    charA = await createCharacter(owner, {
      name: "RagPilot",
      nationality: "DE",
      birthDate: "1993-05-01",
    });
    const conv = await createConversation(owner, {
      type: "GROUP",
      participantIds: [charA.id],
    });
    convId = conv.id;
  });

  it("sem externalRag → assembleContext NÃO expõe a propriedade externalRag", async () => {
    const fixedNow = new Date("2026-08-02T00:00:00Z");
    const ctx = await assembleContext(prisma, {
      conversationId: convId,
      userId: owner.userId,
      now: fixedNow,
    });
    expect("externalRag" in ctx).toBe(false);
  });

  it("com externalRag → assembleContext anexa o bloco com provenance intacta", async () => {
    const fixedNow = new Date("2026-08-02T00:00:00Z");
    const rag = mkRag([
      { sourceId: "s", documentId: "d", chunkId: "c1", title: "T", content: "C", orderOriginal: 0, score: 0.9, distance: 0.1, citation: "Fonte [c1]" },
    ]) as ExternalRagFixture;

    const ctx = await assembleContext(prisma, {
      conversationId: convId,
      userId: owner.userId,
      now: fixedNow,
      externalRag: rag,
    });

    expect(ctx.externalRag).toBeTruthy();
    expect(ctx.externalRag!.sourceType).toBe("external");
    expect(ctx.externalRag!.provider).toBe("cohere");
    expect(ctx.externalRag!.dimensions).toBe(1024);
    expect(ctx.externalRag!.ruleApplied).toMatch(/^external-retrieval\.v1/);
    expect(ctx.externalRag!.items).toHaveLength(1);
    expect(ctx.externalRag!.items[0].chunkId).toBe("c1");
    expect(ctx.externalRag!.items[0].score).toBe(0.9);
    expect(ctx.externalRag!.items[0].citation).toContain("Fonte");
  });

  it("RAG não contamina os demais blocos do contexto (isolamento)", async () => {
    const fixedNow = new Date("2026-08-02T00:00:00Z");
    const rag = mkRag([
      { sourceId: "s", documentId: "d", chunkId: "x1", title: "XT", content: "XC", orderOriginal: 0, score: 0.8, distance: 0.2, citation: "Fonte [x1]" },
    ]) as ExternalRagFixture;
    const ctx = await assembleContext(prisma, {
      conversationId: convId,
      userId: owner.userId,
      now: fixedNow,
      externalRag: rag,
    });
    expect(ctx.meta.conversationId).toBe(convId);
    expect(ctx.participants.map((p) => p.characterId)).toContain(charA.id);
    expect(ctx.recentMessages).toEqual([]);
    expect(ctx.externalRag!.items.map((i) => i.chunkId)).toEqual(["x1"]);
  });
});

type ExternalRagFixture = {
  sourceType: "external";
  provider: string;
  model: string;
  version: string;
  dimensions: number;
  ruleApplied: string;
  items: Array<{
    sourceId: string;
    documentId: string;
    chunkId: string;
    title: string;
    content: string;
    orderOriginal: number;
    score: number;
    distance: number;
    citation: string;
  }>;
};