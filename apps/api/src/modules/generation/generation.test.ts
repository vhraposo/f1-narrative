import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  composeSystemPrompt,
  generateGeneration,
  nullProvider,
  GENERATION_VERSION,
  GENERATION_RULE,
} from "./generation.assembly.js";
import { canonicalizeRelationshipPair } from "../relationships/relationship.pair.js";

// Testes da orquestração de Generation (Fase 12 STEP 3, determinístico, SEM LLM).
// Fixtures criadas principalmente via Prisma direto (evita o rate-limit da API);
// o endpoint HTTP `/craft` é exercitado apenas em auth/ownership.
// Todos os artefatos são rastreados e removidos em afterAll (filho → pai).

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
const createdNewsIds: string[] = [];
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

async function createUser(email: string, name: string): Promise<TestUser> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name, email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
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

// Cria Conversation + participant links via Prisma direto (evita API).
async function createConversationDirect(
  type: string,
  participantIds: string[],
): Promise<{ id: string }> {
  const conv = track(
    createdConversationIds,
    await prisma.conversation.create({ data: { title: "gen", type: type === "DM" ? "DM" : "GROUP" } }),
  );
  await prisma.conversationParticipant.createMany({
    data: [...new Set(participantIds)].map((characterId) => ({
      conversationId: conv.id,
      characterId,
    })),
  });
  return { id: conv.id };
}

async function createMemoryDirect(payload: {
  ownerUserId: string;
  content: string;
  characterIds: string[];
  importance?: string;
  eventId?: string;
}): Promise<{ id: string }> {
  const memory = track(
    createdMemoryIds,
    await prisma.memory.create({
      data: {
        content: payload.content,
        source: "USER_DEFINED",
        importance: (payload.importance ?? "MEDIUM") as never,
        ...(payload.eventId ? { eventId: payload.eventId } : {}),
      },
    }),
  );
  await prisma.memoryCharacter.createMany({
    data: payload.characterIds.map((characterId) => ({ memoryId: memory.id, characterId })),
  });
  return { id: memory.id };
}

async function createEventDirect(payload: {
  type?: string;
  importance?: string;
  title: string;
  characterIds: string[];
}): Promise<{ id: string }> {
  const event = track(
    createdEventIds,
    await prisma.event.create({
      data: {
        type: (payload.type ?? "SOCIAL") as never,
        importance: (payload.importance ?? "MEDIUM") as never,
        title: payload.title,
      },
    }),
  );
  await prisma.eventCharacter.createMany({
    data: payload.characterIds.map((characterId) => ({ eventId: event.id, characterId })),
  });
  return { id: event.id };
}

async function createNewsDirect(eventId: string, title: string): Promise<{ id: string }> {
  return track(
    createdNewsIds,
    await prisma.newsItem.create({ data: { eventId, title, source: "USER_DEFINED" } }),
  );
}

async function createRelationshipDirect(
  characterAId: string,
  characterBId: string,
): Promise<{ id: string }> {
  return track(
    createdRelationshipIds,
    await prisma.relationship.create({
      data: canonicalizeRelationshipPair(characterAId, characterBId),
    }),
  );
}

async function createTeam(userId: string, name: string): Promise<{ id: string }> {
  return track(
    createdTeamIds,
    await prisma.team.create({ data: { name, userId } }),
  );
}

async function createSeason(): Promise<{ id: string }> {
  return track(createdSeasonIds, await prisma.season.create({ data: { year: 2026 } }));
}

async function createRace(seasonId: string, name: string): Promise<{ id: string }> {
  return track(
    createdRaceIds,
    await prisma.race.create({ data: { seasonId, name, status: "UPCOMING" } }),
  );
}

async function createDriverProfile(
  characterId: string,
  teamId: string | null,
  number: number,
): Promise<{ id: string }> {
  return track(
    createdDriverProfileIds,
    await prisma.driverProfile.create({
      data: {
        characterId,
        ...(teamId ? { teamId } : {}),
        number,
      },
    }),
  );
}

async function createRaceResult(
  raceId: string,
  driverProfileId: string,
  position = 1,
  points = 25,
): Promise<{ id: string }> {
  return track(
    createdRaceResultIds,
    await prisma.raceResult.create({
      data: { raceId, driverProfileId, position, points },
    }),
  );
}

async function createStanding(
  seasonId: string,
  driverProfileId: string,
  position = 1,
  points = 25,
): Promise<{ id: string }> {
  return track(
    createdStandingIds,
    await prisma.championshipStanding.create({
      data: { seasonId, driverProfileId, position, points },
    }),
  );
}

async function resetWorld(next: {
  currentDate?: Date;
  currentSeasonId?: string | null;
  currentRaceId?: string | null;
  currentSession?: string | null;
}): Promise<void> {
  await prisma.worldState.upsert({
    where: { key: "default" },
    update: {
      ...(next.currentDate !== undefined ? { currentDate: next.currentDate } : {}),
      ...(next.currentSeasonId !== undefined ? { currentSeasonId: next.currentSeasonId } : {}),
      ...(next.currentRaceId !== undefined ? { currentRaceId: next.currentRaceId } : {}),
      ...(next.currentSession !== undefined ? { currentSession: next.currentSession as never } : {}),
    },
    create: {
      key: "default",
      ...(next.currentDate !== undefined ? { currentDate: next.currentDate } : {}),
      ...(next.currentSeasonId !== undefined ? { currentSeasonId: next.currentSeasonId } : {}),
      ...(next.currentRaceId !== undefined ? { currentRaceId: next.currentRaceId } : {}),
      ...(next.currentSession !== undefined ? { currentSession: next.currentSession as never } : {}),
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
  await prisma.newsItem.deleteMany({ where: { id: { in: createdNewsIds } } });
  await prisma.raceResult.deleteMany({ where: { id: { in: createdRaceResultIds } } });
  await prisma.championshipStanding.deleteMany({ where: { id: { in: createdStandingIds } } });
  await prisma.race.deleteMany({ where: { id: { in: createdRaceIds } } });
  await prisma.season.deleteMany({ where: { id: { in: createdSeasonIds } } });
  await prisma.driverProfile.deleteMany({ where: { id: { in: createdDriverProfileIds } } });
  await prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
  await prisma.memoryCharacter.deleteMany({ where: { memoryId: { in: createdMemoryIds } } });
  await prisma.memory.deleteMany({ where: { id: { in: createdMemoryIds } } });
  await prisma.eventCharacter.deleteMany({ where: { eventId: { in: createdEventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
  await prisma.relationship.deleteMany({ where: { id: { in: createdRelationshipIds } } });
  await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
  await app.close();
});

// ---------------------------------------------------------------------------
// A) Auth
// ---------------------------------------------------------------------------

describe("Generation - auth 401", () => {
  const convId = "00000000-0000-4000-8000-00000000000b";

  it("GET /api/conversations/:id/craft retorna 401 sem sessão", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${convId}/craft`,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// B) Ownership e isolamento (via endpoint HTTP)
// ---------------------------------------------------------------------------

describe("Generation - ownership e isolamento", () => {
  let owner: TestUser;
  let intruder: TestUser;
  let charA: Character;
  let outsiderAI: Character;
  let convId: string;
  let otherConvId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`gen-own-${suffix}@f1nw.test`, "GenOwner");
    intruder = await createUser(`gen-int-${suffix}@f1nw.test`, "GenInt");
    charA = await createCharacter(owner, {
      name: "Bruno",
      nationality: "BR",
      birthDate: "1990-01-01",
    });
    outsiderAI = await createAICharacter({ name: "Outsider (AI)", nationality: "NL" });
    const conv = await createConversationDirect("GROUP", [charA.id]);
    convId = conv.id;
    const other = await createConversationDirect("GROUP", [charA.id]);
    otherConvId = other.id;

    // Mensagem de OUTRA conversa (mesmo charA) não deve vazar para convId's prompt.
    await prisma.message.create({
      data: {
        conversationId: otherConvId,
        senderType: "SYSTEM",
        characterId: null,
        content: "mensagem da outra conversa",
        createdAt: new Date("2026-01-01T09:00:00Z"),
      },
    });
    // Memória de um Character FORA do escopo não deve entrar.
    await createMemoryDirect({
      ownerUserId: owner.userId,
      content: "memoria privada fora do escopo",
      characterIds: [outsiderAI.id],
    });
  });

  it("owner acessa craft -> 200 com generation.meta version", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${convId}/craft`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const gen = res.json().generation!;
    expect(gen.context.meta.version).toBe("context.v1");
    expect(gen.context.meta.conversationId).toBe(convId);
    expect(gen.meta.provider).toBe("null");
    expect(gen.meta.mode).toBe("assembly-only");
  });

  it("intruder sem Character participante -> 404 (sem vazamento)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${convId}/craft`,
      headers: { cookie: intruder.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("conversation inexistente -> 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${randomUUID()}/craft`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("H) dados de outra conversa / de fora do escopo não aparecem no prompt", async () => {
    const gen = await generateGeneration(prisma, {
      conversationId: convId,
      userId: owner.userId,
      now: new Date("2026-01-01T00:00:00Z"),
    });
    // mensagens da outra conversa não vazam
    expect(gen.context.recentMessages.map((m) => m.content)).not.toContain(
      "mensagem da outra conversa",
    );
    expect(gen.systemPrompt).not.toContain("mensagem da outra conversa");
    // memória de character fora do escopo não vaza
    expect(gen.context.memories.map((m) => m.content)).not.toContain(
      "memoria privada fora do escopo",
    );
    expect(gen.systemPrompt).not.toContain("memoria privada fora do escopo");
    // outras conversas não vazam metadados
    expect(gen.context.meta.conversationId).toBe(convId);
    expect(gen.context.meta.conversationId).not.toBe(otherConvId);
  });
});

// ---------------------------------------------------------------------------
// C) Composição (serviço direto) — seções, ordem, markers, conteúdo
// ---------------------------------------------------------------------------

describe("Generation - composição e sections", () => {
  let owner: TestUser;
  let charA: Character;
  let aiB: Character;
  let convId: string;
  let emptyConvId: string;
  const FIXED_NOW = new Date("2026-03-01T12:00:00Z");

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`gen-cmp-${suffix}@f1nw.test`, "GenCmp");
    charA = await createCharacter(owner, {
      name: "Carlos",
      nationality: "MX",
      birthDate: "1992-01-01",
    });
    aiB = await createAICharacter({ name: "Ana (AI)", nationality: "ES" });

    const conv = await createConversationDirect("GROUP", [charA.id, aiB.id]);
    convId = conv.id;
    const empty = await createConversationDirect("GROUP", [charA.id]);
    emptyConvId = empty.id;

    await prisma.message.createMany({
      data: [
        { conversationId: convId, senderType: "SYSTEM", characterId: null, content: "inicio", createdAt: new Date("2026-01-01T08:00:00Z") },
        { conversationId: convId, senderType: "AI_CHARACTER", characterId: aiB.id, content: "ola", createdAt: new Date("2026-01-01T08:00:01Z") },
        { conversationId: convId, senderType: "USER_CHARACTER", characterId: charA.id, content: "estamos prontos", createdAt: new Date("2026-01-01T08:00:02Z") },
      ],
    });

    const event = await createEventDirect({
      title: "Anuncio de temporada",
      characterIds: [charA.id],
    });
    await createMemoryDirect({
      ownerUserId: owner.userId,
      content: "Carlos venceu em Interlagos",
      characterIds: [charA.id],
      importance: "HIGH",
      eventId: event.id,
    });
    await createMemoryDirect({
      ownerUserId: owner.userId,
      content: "Ana treinou grid de inicio",
      characterIds: [aiB.id],
      importance: "MEDIUM",
    });
    await createRelationshipDirect(charA.id, aiB.id);
    await createNewsDirect(event.id, "Corrida historica em Interlagos");

    await resetWorld({
      currentDate: new Date("2026-03-01T00:00:00Z"),
      currentSeasonId: null,
      currentRaceId: null,
      currentSession: "QUALIFYING",
    });
  });

  it("conversa vazia -> prompt ainda tem as 12 seções na ordem fixa", async () => {
    const gen = await generateGeneration(prisma, {
      conversationId: emptyConvId,
      userId: owner.userId,
      now: FIXED_NOW,
    });
    const order = ["GLOBAL_RULES", "PHASE_MARKER", "PARTICIPANTS", "ACTIVE_SPEAKER", "WORLD_STATE", "MEMORIES", "RELATIONSHIPS", "EVENTS", "NEWS", "MOTORSPORT", "OMITTED_CONTEXT", "BEHAVIORAL_INVARIANTS"];
    let last = -1;
    for (const [i, id] of order.entries()) {
      const header = `<BEGIN ${i + 1}:${id}>`;
      const footer = `<END ${i + 1}:${id}>`;
      expect(gen.systemPrompt).toContain(header);
      expect(gen.systemPrompt).toContain(footer);
      const hIdx = gen.systemPrompt.indexOf(header);
      expect(hIdx).toBeGreaterThan(last);
      last = hIdx;
    }
  });

  it("C) composição reflete mensagens, memórias, relaciones, eventos, news, motorsport(mensagem ausente)", async () => {
    const gen = await generateGeneration(prisma, {
      conversationId: convId,
      userId: owner.userId,
      now: FIXED_NOW,
    });
    expect(gen.context.recentMessages.map((m) => m.content)).toEqual([
      "inicio",
      "ola",
      "estamos prontos",
    ]);
    // memories de Carlos (ambos os character no escopo)
    const mems = gen.context.memories.map((m) => m.content);
    expect(mems).toContain("Carlos venceu em Interlagos");
    expect(mems).toContain("Ana treinou grid de inicio");
    expect(
      gen.context.relationships.map((r) => [r.characterAName, r.characterBName].sort()),
    ).toContainEqual(["Ana (AI)", "Carlos"].sort());
    expect(gen.context.events.map((e) => e.title)).toContain("Anuncio de temporada");
    expect(gen.context.news.map((n) => n.title)).toContain("Corrida historica em Interlagos");
    expect(gen.context.motorsport).toBeNull();
    // Sem motorsport: seção traz aviso de ausência, sem dados inventados
    expect(gen.systemPrompt).toContain("Nenhum dado esportivo disponível");
    // Active speaker USER do primeiro character USER
    expect(gen.context.activeSpeaker.characterId).toBe(charA.id);
    expect(gen.context.activeSpeaker.senderType).toBe("USER_CHARACTER");
  });

  it("I) AI Character participa (isAIParticipant true) sem userId", async () => {
    const gen = await generateGeneration(prisma, {
      conversationId: convId,
      userId: owner.userId,
      now: FIXED_NOW,
    });
    const ana = gen.context.participants.find((p) => p.characterId === aiB.id)!;
    expect(ana.isAIParticipant).toBe(true);
    expect(gen.context.participants).toContainEqual(
      expect.objectContaining({ characterId: charA.id, isAIParticipant: false }),
    );
  });

  it("D) métodos de seção estáveis e metadata via NullProvider", async () => {
    const gen = await generateGeneration(prisma, {
      conversationId: convId,
      userId: owner.userId,
      now: FIXED_NOW,
    });
    expect(GENERATION_VERSION).toBe("generation.v1");
    expect(GENERATION_RULE).toBe("generation.v1-policy:provider=null#mode=assembly-only");
    expect(gen.meta.provider).toBe("null");
    expect(gen.meta.mode).toBe("assembly-only");
    expect(gen.meta.ruleApplied).toBe(GENERATION_RULE);
    expect(gen.meta.tokens.contextBlocks).toBe(12);
    expect(gen.meta.tokens.systemPromptChars).toBe(gen.systemPrompt.length);
    expect(gen.systemPrompt).toContain("Character é o ator narrativo");
    expect(gen.systemPrompt).toContain("NÃO invente fatos contraditórios");
    expect(gen.systemPrompt).toContain("NÃO avance WorldState");
    expect(gen.systemPrompt).toContain("SESSION:QUALIFYING"); // phase marker de sessão

    // Provider explícito (interface aceita o NullProvider).
    const explicit = await generateGeneration(
      prisma,
      { conversationId: convId, userId: owner.userId, now: FIXED_NOW },
      nullProvider,
    );
    expect(explicit.meta.provider).toBe("null");
    expect(explicit.meta.mode).toBe("assembly-only");
  });

  it("G) determinismo: duas execuções com mesmo now -> prompts e frames idênticos", async () => {
    const a = await generateGeneration(prisma, {
      conversationId: convId,
      userId: owner.userId,
      now: FIXED_NOW,
    });
    const b = await generateGeneration(prisma, {
      conversationId: convId,
      userId: owner.userId,
      now: FIXED_NOW,
    });
    expect(JSON.stringify(a.context)).toBe(JSON.stringify(b.context));
    expect(a.systemPrompt).toBe(b.systemPrompt);
    expect(JSON.stringify(a.meta)).toBe(JSON.stringify(b.meta));
  });

  it("composeSystemPrompt puro é determinístico para o mesmo context", () => {
    expect(composeSystemPrompt(a_FIXED)).toBe(composeSystemPrompt(a_FIXED));
    expect(composeSystemPrompt(a_FIXED)).toContain(`<BEGIN 1:GLOBAL_RULES>`);
    expect(composeSystemPrompt(a_FIXED)).toContain(`<END 12:BEHAVIORAL_INVARIANTS>`);
    // phaseMarker null -> seção de fase registra que não foi determinado
    expect(composeSystemPrompt(a_FIXED)).toContain("Nenhum phase marker foi determinado");
  });
});

// fixture puro compartilhado apenas dentro do describe acima (compilador ok).
const a_FIXED = {
  meta: {
    version: "context.v1" as const,
    conversationId: "00000000-0000-4000-8000-00000000ffff",
    conversationType: "GROUP" as const,
    participantCharacterIds: [],
    assembledAt: "2026-01-01T00:00:00.000Z",
    ruleApplied: "context.v1-policy:msgs=50#mem=15#evt=10#rel=10#news=8",
  },
  participants: [],
  activeSpeaker: { characterId: null, senderType: "USER_CHARACTER" as const },
  temporal: {
    worldDate: null,
    currentSeasonId: null,
    currentRaceId: null,
    currentSession: null,
    phaseMarker: null,
  },
  recentMessages: [],
  memories: [],
  events: [],
  relationships: [],
  motorsport: null,
  news: [],
  omitted: { oldestMessagesTruncated: 0, memoriesOmitted: 0, reasons: [] },
};

// ---------------------------------------------------------------------------
// E) Omissions e fallback (WorldState quebrado + truncamentos)
// ---------------------------------------------------------------------------

describe("Generation - omissions e fallback", () => {
  let owner: TestUser;
  let charA: Character;
  let convId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`gen-om-${suffix}@f1nw.test`, "GenOm");
    charA = await createCharacter(owner, {
      name: "Diego",
      nationality: "AR",
      birthDate: "1993-01-01",
    });
    const conv = await createConversationDirect("GROUP", [charA.id]);
    convId = conv.id;

    // 52 mensagens (janela 50 -> 2 truncadas).
    await prisma.message.createMany({
      data: Array.from({ length: 52 }, (_, i) => ({
        conversationId: convId,
        senderType: "SYSTEM",
        characterId: null,
        content: `om${i}`,
        createdAt: new Date(Date.UTC(2026, 5, 1, 0, 0, i)),
      })),
    });

    // 18 memórias relevantes (limite 15 -> 3 omitidas).
    for (let i = 0; i < 18; i++) {
      await createMemoryDirect({
        ownerUserId: owner.userId,
        content: `mem relevante ${i}`,
        characterIds: [charA.id],
        importance: "HIGH",
      });
    }

    // WorldState apontando para referências quebradas.
    await resetWorld({
      currentDate: new Date("2026-06-01T00:00:00Z"),
      currentSeasonId: randomUUID(),
      currentRaceId: randomUUID(),
      currentSession: null,
    });
  });

  it("E) mensagens truncadas, memórias omitidas e fallback de referências quebradas", async () => {
    const gen = await generateGeneration(prisma, {
      conversationId: convId,
      userId: owner.userId,
      now: new Date("2026-06-02T00:00:00Z"),
    });
    expect(gen.context.omitted.oldestMessagesTruncated).toBe(2);
    expect(gen.context.omitted.memoriesOmitted).toBe(3);
    expect(gen.context.omitted.reasons.some((r) => r.includes("currentSeasonId"))).toBe(true);
    expect(gen.context.omitted.reasons.some((r) => r.includes("currentRaceId"))).toBe(true);
    // fallback regulado no prompt
    expect(gen.systemPrompt).toContain("2 mensagem(ns) mais antigas foram truncadas");
    expect(gen.systemPrompt).toContain("3 memória(s) foram omitidas");
    expect(gen.systemPrompt).toContain("Motivo de omissão: currentSeasonId");
  });
});

// ---------------------------------------------------------------------------
// J) Motorsport (participante com/sem DriverProfile)
// ---------------------------------------------------------------------------

describe("Generation - motorsport", () => {
  let owner: TestUser;
  let charDriver: Character;
  let charNoDriver: Character;
  let convDriverId: string;
  let convNoDriverId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`gen-mot-${suffix}@f1nw.test`, "GenMot");
    charDriver = await createCharacter(owner, {
      name: "Enzo",
      nationality: "IT",
      birthDate: "1994-01-01",
    });
    charNoDriver = await createCharacter(owner, {
      name: "Felipe",
      nationality: "PT",
      birthDate: "1990-01-01",
    });

    const team = await createTeam(owner.userId, "Scuderia Test");
    const season = await createSeason();
    const race = await createRace(season.id, "GP Test");
    const dp = await createDriverProfile(charDriver.id, team.id, 44);
    await createRaceResult(race.id, dp.id, 1, 25);
    await createStanding(season.id, dp.id, 1, 25);

    // Motorport usa WorldState.currentSeasonId para ancorar calendário/resultados.
    await resetWorld({
      currentSeasonId: season.id,
      currentRaceId: race.id,
      currentSession: null,
    });

    const c1 = await createConversationDirect("GROUP", [charDriver.id]);
    convDriverId = c1.id;
    const c2 = await createConversationDirect("GROUP", [charNoDriver.id]);
    convNoDriverId = c2.id;
  });

  it("participante com DriverProfile -> motorsport presente no prompt", async () => {
    const gen = await generateGeneration(prisma, {
      conversationId: convDriverId,
      userId: owner.userId,
      now: new Date("2026-07-01T00:00:00Z"),
    });
    expect(gen.context.motorsport).not.toBeNull();
    expect(gen.context.motorsport!.drivers.length).toBe(1);
    expect(gen.context.motorsport!.drivers[0].name).toBe("Enzo");
    expect(gen.context.motorsport!.teams.length).toBe(1);
    expect(gen.context.motorsport!.races.length).toBe(1);
    expect(gen.context.motorsport!.results.length).toBe(1);
    expect(gen.context.motorsport!.standings.length).toBe(1);
    expect(gen.systemPrompt).toContain("Pilotos no escopo:");
    expect(gen.systemPrompt).toContain("Enzo");
  });

  it("participante sem DriverProfile -> motorsport ausente", async () => {
    const gen = await generateGeneration(prisma, {
      conversationId: convNoDriverId,
      userId: owner.userId,
      now: new Date("2026-07-01T00:00:00Z"),
    });
    expect(gen.context.motorsport).toBeNull();
    expect(gen.systemPrompt).toContain("Nenhum dado esportivo disponível");
  });
});