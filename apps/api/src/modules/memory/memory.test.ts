import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";

// Todos os artefatos criados (users, characters, memories, memoryCharacter,
// events, news) são rastreados e removidos em afterAll, devolvendo o
// f1_narrative_test ao baseline limpo, sem TRUNCATE/reset.

let app: FastifyInstance;

type TestUser = { cookie: string; userId: string };

type Character = {
  id: string;
  name: string;
  nationality: string;
  controlledBy: string;
  userId: string | null;
};

type Memory = {
  id: string;
  eventId: string | null;
  importance: string;
  source: string;
  content: string;
  summary: string | null;
  context: unknown;
  emotionalImpact: number | null;
  createdAt: string;
  updatedAt: string;
};

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdMemoryIds: string[] = [];
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

// Character controlado por IA (userId null, controlledBy AI). Não existe rota
// pública para criá-lo (a API de characters fixa controlledBy=USER), então é
// criado diretamente via Prisma — equivalente ao que um seed/IA faria.
async function createAICharacter(payload: {
  name: string;
  nationality: string;
}): Promise<Character> {
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

async function createEvent(user: TestUser, title = "Evento origem"): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/events",
    headers: { cookie: user.cookie },
    payload: { type: "SOCIAL", title },
  });
  expect(res.statusCode).toBe(201);
  return track(createdEventIds, res.json().event as { id: string }).id;
}

async function createMemory(
  user: TestUser,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; json: { memory?: Memory; code?: string } }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/memories",
    headers: { cookie: user.cookie },
    payload,
  });
  if (res.statusCode === 201 && res.json().memory) {
    track(createdMemoryIds, res.json().memory as { id: string });
  }
  return { statusCode: res.statusCode, json: res.json() };
}

async function addMemoryCharacter(
  user: TestUser,
  memoryId: string,
  characterId: string,
): Promise<{ statusCode: number; json: { code?: string } }> {
  const res = await app.inject({
    method: "POST",
    url: `/api/memories/${memoryId}/characters`,
    headers: { cookie: user.cookie },
    payload: { characterId },
  });
  return { statusCode: res.statusCode, json: res.json() };
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await prisma.memoryCharacter.deleteMany({
    where: { memoryId: { in: createdMemoryIds } },
  });
  await prisma.memory.deleteMany({ where: { id: { in: createdMemoryIds } } });
  await prisma.newsItem.deleteMany({ where: { eventId: { in: createdEventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
  await app.close();
});

describe("Memory - auth 401", () => {
  const memId = "00000000-0000-4000-8000-000000000001";
  const charId = "00000000-0000-4000-8000-000000000002";

  it("GET /api/memories retorna 401 sem sessão", async () => {
    const res = await app.inject({ method: "GET", url: "/api/memories" });
    expect(res.statusCode).toBe(401);
  });

  it("POST /api/memories retorna 401 sem sessão", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/memories",
      payload: { content: "Memória", characterIds: [charId] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/memories/:id retorna 401 sem sessão", async () => {
    const res = await app.inject({ method: "GET", url: `/api/memories/${memId}` });
    expect(res.statusCode).toBe(401);
  });

  it("PATCH /api/memories/:id retorna 401 sem sessão", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/memories/${memId}`,
      payload: { content: "X" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("DELETE /api/memories/:id retorna 401 sem sessão", async () => {
    const res = await app.inject({ method: "DELETE", url: `/api/memories/${memId}` });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/characters/:characterId/memories retorna 401 sem sessão", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/characters/${charId}/memories`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /api/memories/:id/characters retorna 401 sem sessão", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/memories/${memId}/characters`,
      payload: { characterId: charId },
    });
    expect(res.statusCode).toBe(401);
  });

  it("DELETE /api/memories/:id/characters/:characterId retorna 401 sem sessão", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/memories/${memId}/characters/${charId}`,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("Memory - validação e ownership da criação", () => {
  let owner: TestUser;
  let intruder: TestUser;
  let character: Character;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`mem-o-${suffix}@f1nw.test`, "MemOwner");
    intruder = await createUser(`mem-i-${suffix}@f1nw.test`, "MemIntru");
    character = await createCharacter(owner, {
      name: "Piloto Memória",
      nationality: "BR",
      birthDate: "1995-01-01",
    });
  });

  it("POST sem characterIds -> 400 VALIDATION_ERROR", async () => {
    const res = await createMemory(owner, { content: "Sem participante" });
    expect(res.statusCode).toBe(400);
    expect(res.json.code).toBe("VALIDATION_ERROR");
  });

  it("POST characterIds vazio -> 400", async () => {
    const res = await createMemory(owner, { content: "X", characterIds: [] });
    expect(res.statusCode).toBe(400);
    expect(res.json.code).toBe("VALIDATION_ERROR");
  });

  it("content vazio -> 400", async () => {
    const res = await createMemory(owner, {
      content: "   ",
      characterIds: [character.id],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json.code).toBe("VALIDATION_ERROR");
  });

  it("character inexistente -> 404", async () => {
    const res = await createMemory(owner, {
      content: "X",
      characterIds: [crypto.randomUUID()],
    });
    expect(res.statusCode).toBe(404);
  });

  it("nenhum participante próprio (só character de outro usuário) -> 404", async () => {
    // intruder não possui character; tenta criar ancorada no character do owner
    const res = await createMemory(intruder, {
      content: "X",
      characterIds: [character.id],
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/characters/:id/memories em character de outro usuário -> 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/characters/${character.id}/memories`,
      headers: { cookie: intruder.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/characters/:id/memories em character inexistente -> 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/characters/${crypto.randomUUID()}/memories`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("Memory - source (CanonSource)", () => {
  let owner: TestUser;
  let character: Character;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`mem-src-${suffix}@f1nw.test`, "SrcOwner");
    character = await createCharacter(owner, {
      name: "Fonte Radar",
      nationality: "IT",
      birthDate: "1993-04-01",
    });
  });

  const sourceValues = [
    "USER_DEFINED",
    "GENERATED_EVENT",
    "CANON",
    "EXTERNAL_INFORMATION",
  ] as const;

  for (const source of sourceValues) {
    it(`persiste e recupera source=${source}`, async () => {
      const created = await createMemory(owner, {
        content: `Memória com source ${source}`,
        characterIds: [character.id],
        source,
      });
      expect(created.statusCode).toBe(201);
      expect(created.json.memory!.source).toBe(source);

      const res = await app.inject({
        method: "GET",
        url: `/api/memories/${created.json.memory!.id}`,
        headers: { cookie: owner.cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().memory.source).toBe(source);
    });
  }

  it("source inválido fora do enum -> 400", async () => {
    const res = await createMemory(owner, {
      content: "X",
      characterIds: [character.id],
      source: "FROM_THE_WEB",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json.code).toBe("VALIDATION_ERROR");
  });

  it("default do Prisma para Memory.source = USER_DEFINED", async () => {
    const created = await createMemory(owner, {
      content: "Sem source explícito",
      characterIds: [character.id],
    });
    expect(created.statusCode).toBe(201);
    expect(created.json.memory!.source).toBe("USER_DEFINED");
  });
});

describe("Memory - ownership vs participação (Characters USER e AI)", () => {
  let owner: TestUser;
  let outsider: TestUser;
  let charA: Character; // USER (owned)
  let aiB: Character; // AI
  let aiC: Character; // AI

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`mem-own-${suffix}@f1nw.test`, "OwnOwner");
    outsider = await createUser(`mem-own-o-${suffix}@f1nw.test`, "OutsideOwn");
    charA = await createCharacter(owner, {
      name: "Alicya",
      nationality: "GB",
      birthDate: "1990-01-01",
    });
    aiB = await createAICharacter({ name: "Max (AI)", nationality: "NL" });
    aiC = await createAICharacter({ name: "Lando (AI)", nationality: "GB" });
  });

  it("A) cria Memory com USER próprio (A) + AI (B) -> 201, ambos participantes", async () => {
    const res = await createMemory(owner, {
      content: "Memória A + B (AI)",
      characterIds: [charA.id, aiB.id],
    });
    expect(res.statusCode).toBe(201);
    const mem = res.json.memory as Memory;
    const detail = await app.inject({
      method: "GET",
      url: `/api/memories/${mem.id}`,
      headers: { cookie: owner.cookie },
    });
    const parts = (detail.json().memory.participants as Character[]);
    const names = parts.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["Alicya", "Max (AI)"]));
  });

  it("B) cria Memory com USER (A) + 2 AI (B e C) -> 201", async () => {
    const res = await createMemory(owner, {
      content: "Memória A + B + C (AI)",
      characterIds: [charA.id, aiB.id, aiC.id],
    });
    expect(res.statusCode).toBe(201);
  });

  it("C) usuário não possui nenhum participante -> 404 (sem vazamento)", async () => {
    // onlyAI: o usuário outsider não possui A nem B/C → 404
    const res = await createMemory(outsider, {
      content: "X",
      characterIds: [aiB.id, aiC.id],
    });
    expect(res.statusCode).toBe(404);
  });

  it("D) usuário possui ≥1 participante e adiciona Character AI posteriormente", async () => {
    const res = await createMemory(owner, {
      content: "Base para adicionar AI depois",
      characterIds: [charA.id],
    });
    expect(res.statusCode).toBe(201);
    const memId = (res.json.memory as Memory).id;

    const added = await addMemoryCharacter(owner, memId, aiB.id);
    expect(added.statusCode).toBe(201);
  });

  it("E) usuário sem nenhum participante não manipula a Memory -> 404", async () => {
    const created = await createMemory(owner, {
      content: "Memory privada do dono",
      characterIds: [charA.id],
    });
    const memId = (created.json.memory as Memory).id;

    const reads = await app.inject({
      method: "GET",
      url: `/api/memories/${memId}`,
      headers: { cookie: outsider.cookie },
    });
    expect(reads.statusCode).toBe(404);

    const patches = await app.inject({
      method: "PATCH",
      url: `/api/memories/${memId}`,
      headers: { cookie: outsider.cookie },
      payload: { content: "Hack" },
    });
    expect(patches.statusCode).toBe(404);

    const deletes = await app.inject({
      method: "DELETE",
      url: `/api/memories/${memId}`,
      headers: { cookie: outsider.cookie },
    });
    expect(deletes.statusCode).toBe(404);

    const addParticipant = await app.inject({
      method: "POST",
      url: `/api/memories/${memId}/characters`,
      headers: { cookie: outsider.cookie },
      payload: { characterId: aiB.id },
    });
    expect(addParticipant.statusCode).toBe(404);
  });
});

describe("Memory - CRUD", () => {
  let owner: TestUser;
  let other: TestUser;
  let charA: Character;
  let charB: Character;
  let eventId: string;
  let memoryId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`mem-crud-${suffix}@f1nw.test`, "CrudOwner");
    other = await createUser(`mem-other-${suffix}@f1nw.test`, "Other");
    charA = await createCharacter(owner, {
      name: "Alicya",
      nationality: "GB",
      birthDate: "1990-01-01",
    });
    charB = await createCharacter(owner, {
      name: "Max",
      nationality: "NL",
      birthDate: "1991-02-02",
    });
    eventId = await createEvent(owner, "Evento de origem");
  });

  it("POST cria Memory sem eventId", async () => {
    const res = await createMemory(owner, {
      content: "Vitória emocionante em Spa",
      characterIds: [charA.id, charB.id],
    });
    expect(res.statusCode).toBe(201);
    const memory = res.json.memory as Memory;
    expect(memory.content).toBe("Vitória emocionante em Spa");
    expect(memory.eventId).toBeNull();
    expect(memory.importance).toBe("LOW");
    expect(memory.source).toBe("USER_DEFINED");
    memoryId = memory.id;
  });

  it("POST cria Memory vinculada a um Event", async () => {
    const res = await createMemory(owner, {
      content: "Memória originada por evento",
      characterIds: [charA.id],
      eventId,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json.memory!.eventId).toBe(eventId);
  });

  it("POST eventId inexistente -> 404", async () => {
    const res = await createMemory(owner, {
      content: "X",
      characterIds: [charA.id],
      eventId: crypto.randomUUID(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST cria Memory com todos os campos", async () => {
    const res = await createMemory(owner, {
      content: "Memória completa",
      summary: "Resumo curto",
      context: { local: "Interlagos" },
      importance: "HIGH",
      source: "CANON",
      emotionalImpact: 8,
      characterIds: [charA.id],
    });
    expect(res.statusCode).toBe(201);
    const mem = res.json.memory as Memory;
    expect(mem.summary).toBe("Resumo curto");
    expect(mem.importance).toBe("HIGH");
    expect(mem.source).toBe("CANON");
    expect(mem.emotionalImpact).toBe(8);
    expect(mem.context).toEqual({ local: "Interlagos" });
  });

  it("POST emotionalImpact fora do intervalo -> 400", async () => {
    const res = await createMemory(owner, {
      content: "X",
      characterIds: [charA.id],
      emotionalImpact: 11,
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /api/memories/:id retorna a Memory com participantes", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/memories/${memoryId}`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const { memory } = res.json() as {
      memory: Memory & { participants: { character: Character }[] };
    };
    expect(memory.id).toBe(memoryId);
    expect(memory.participants.length).toBe(2);
  });

  it("GET /api/memories/:id inexistente -> 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/memories/${crypto.randomUUID()}`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/memories/:id de user sem participante -> 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/memories/${memoryId}`,
      headers: { cookie: other.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("PATCH edita content", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/memories/${memoryId}`,
      headers: { cookie: owner.cookie },
      payload: { content: "Conteúdo editado" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().memory.content).toBe("Conteúdo editado");
  });

  it("PATCH mantém campos não enviados", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/memories/${memoryId}`,
      headers: { cookie: owner.cookie },
      payload: { importance: "CRITICAL" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().memory.content).toBe("Conteúdo editado");
    expect(res.json().memory.importance).toBe("CRITICAL");
  });

  it("PATCH altera eventId para um Event válido", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/memories/${memoryId}`,
      headers: { cookie: owner.cookie },
      payload: { eventId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().memory.eventId).toBe(eventId);
  });

  it("PATCH eventId inexistente -> 404", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/memories/${memoryId}`,
      headers: { cookie: owner.cookie },
      payload: { eventId: crypto.randomUUID() },
    });
    expect(res.statusCode).toBe(404);
  });

  it("PATCH limpa summary com null", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/memories/${memoryId}`,
      headers: { cookie: owner.cookie },
      payload: { summary: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().memory.summary).toBeNull();
  });

  it("PATCH em Memory de outro usuário -> 404", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/memories/${memoryId}`,
      headers: { cookie: other.cookie },
      payload: { content: "Hack" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE em Memory de outro usuário -> 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/memories/${memoryId}`,
      headers: { cookie: other.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("Memory - participants (MemoryCharacter)", () => {
  let owner: TestUser;
  let charA: Character;
  let charB: Character;
  let aiChar: Character;
  let memozinhaId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`mem-p-${suffix}@f1nw.test`, "PartOwner");
    charA = await createCharacter(owner, {
      name: "Lando",
      nationality: "GB",
      birthDate: "1999-11-13",
    });
    charB = await createCharacter(owner, {
      name: "Oscar",
      nationality: "AU",
      birthDate: "2001-05-30",
    });
    aiChar = await createAICharacter({ name: "Zoe (AI)", nationality: "FR" });
    const created = await createMemory(owner, {
      content: "Dupla da McLaren",
      characterIds: [charA.id],
    });
    memozinhaId = (created.json.memory as Memory).id;
  });

  it("adicionar Character 2 (USER próprio) -> 201", async () => {
    const res = await addMemoryCharacter(owner, memozinhaId, charB.id);
    expect(res.statusCode).toBe(201);
  });

  it("adicionar Character AI -> 201 (participação, não ownership)", async () => {
    const res = await addMemoryCharacter(owner, memozinhaId, aiChar.id);
    expect(res.statusCode).toBe(201);
  });

  it("duplicação (USER) -> 409 CONFLICT", async () => {
    const res = await addMemoryCharacter(owner, memozinhaId, charA.id);
    expect(res.statusCode).toBe(409);
    expect(res.json.code).toBe("CONFLICT");
  });

  it("duplicação direta após 201 fallback -> 409 (race condition via unique)", async () => {
    const dup = await addMemoryCharacter(owner, memozinhaId, charB.id);
    expect(dup.statusCode).toBe(409);
  });

  it("Character inexistente -> 404", async () => {
    const res = await addMemoryCharacter(owner, memozinhaId, crypto.randomUUID());
    expect(res.statusCode).toBe(404);
  });

  it("Memory inexistente -> 404", async () => {
    const res = await addMemoryCharacter(owner, crypto.randomUUID(), charA.id);
    expect(res.statusCode).toBe(404);
  });

  it("remover participante inexistente -> 404", async () => {
    const remove = async (cid: string) =>
      app.inject({
        method: "DELETE",
        url: `/api/memories/${memozinhaId}/characters/${cid}`,
        headers: { cookie: owner.cookie },
      });
    // aiChar foi adicionado; remove uma vez (204) e a segunda (404)
    const first = await remove(aiChar.id);
    expect(first.statusCode).toBe(204);
    const again = await remove(aiChar.id);
    expect(again.statusCode).toBe(404);
  });

  it("novo usuário sem acesso não adiciona character -> 404", async () => {
    const outsider = await createUser(`mem-p-out-${Date.now()}@f1nw.test`, "OutP");
    const res = await addMemoryCharacter(outsider, memozinhaId, charA.id);
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/memories/:id reflete participantes após adicionar/remover", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/memories/${memozinhaId}`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const { memory } = res.json() as {
      memory: Memory & { participants: Character[] };
    };
    const names = memory.participants.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["Lando"]));
    expect(names).not.toContain("Oscar2");
  });
});

describe("Memory - retrieval determinístico", () => {
  let owner: TestUser;
  let character: Character;
  let otherCharacter: Character;
  let aiChar: Character;
  let eventA: string;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`mem-get-${suffix}@f1nw.test`, "GetOwner");
    character = await createCharacter(owner, {
      name: "Carlos",
      nationality: "ES",
      birthDate: "1994-09-01",
    });
    otherCharacter = await createCharacter(owner, {
      name: "Charles",
      nationality: "MC",
      birthDate: "1997-10-16",
    });
    aiChar = await createAICharacter({ name: "Ollie (AI)", nationality: "GB" });
    eventA = await createEvent(owner, "Evento get A");

    await createMemory(owner, { content: "primeira", characterIds: [character.id], eventId: eventA });
    await createMemory(owner, { content: "segunda", characterIds: [character.id], importance: "HIGH" });
    await createMemory(owner, { content: "outra pessoa", characterIds: [otherCharacter.id] });
    await createMemory(owner, { content: "com AI", characterIds: [character.id, aiChar.id] });
  });

  it("GET /api/characters/:characterId/memories retorna só as do character, ordenadas createdAt DESC", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/characters/${character.id}/memories`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const { memories } = res.json() as { memories: Memory[] };
    const contents = memories.map((m) => m.content);
    expect(contents).not.toContain("outra pessoa");
    expect(contents).toEqual(expect.arrayContaining(["primeira", "segunda", "com AI"]));
    // ordem DESC por createdAt
    const created = memories.map((m) => m.createdAt);
    const sorted = [...created].sort((a, b) => b.localeCompare(a));
    expect(created).toEqual(sorted);
  });

  it("GET /api/memories filtra por importance", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/memories?importance=HIGH`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const { memories } = res.json() as { memories: Memory[] };
    expect(memories.length).toBeGreaterThanOrEqual(1);
    expect(memories.every((m) => m.importance === "HIGH")).toBe(true);
  });

  it("GET /api/memories filtra por eventId", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/memories?eventId=${eventA}`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const { memories } = res.json() as { memories: Memory[] };
    expect(memories.length).toBe(1);
    expect(memories[0].eventId).toBe(eventA);
  });

  it("GET /api/memories sem filtro lista só memories alcançáveis, ordenadas DESC", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/memories`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const { memories } = res.json() as { memories: Memory[] };
    expect(memories.length).toBeGreaterThanOrEqual(4);
    const created = memories.map((m) => m.createdAt);
    const sorted = [...created].sort((a, b) => b.localeCompare(a));
    expect(created).toEqual(sorted);
  });

  it("GET /api/memories alcançáveis incluem as com participante AI (usuário detém o USER)", async () => {
    // "com AI" participa character(USER) + aiChar(AI); deve aparecer para owner
    const res = await app.inject({
      method: "GET",
      url: `/api/memories`,
      headers: { cookie: owner.cookie },
    });
    const contents = (res.json() as { memories: Memory[] }).memories.map((m) => m.content);
    expect(contents).toContain("com AI");
  });

  it("GET /api/memories de user sem acesso -> lista vazia (não vaza)", async () => {
    const other = await createUser(`mem-get2-${Date.now()}@f1nw.test`, "GetOther");
    const res = await app.inject({
      method: "GET",
      url: `/api/memories`,
      headers: { cookie: other.cookie },
    });
    expect(res.statusCode).toBe(200);
    const { memories } = res.json() as { memories: Memory[] };
    expect(memories).toEqual([]);
  });
});

describe("Memory - DELETE com vínculos", () => {
  let owner: TestUser;
  let character: Character;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`mem-del-${suffix}@f1nw.test`, "DelOwner");
    character = await createCharacter(owner, {
      name: "Sergio",
      nationality: "MX",
      birthDate: "1990-01-26",
    });
  });

  it("DELETE remove Memory e vínculos (cascade) -> 204", async () => {
    const created = await createMemory(owner, {
      content: "Para excluir",
      characterIds: [character.id, (await createCharacter(owner, { name: "Nico", nationality: "DE", birthDate: "1992-07-03" })).id],
    });
    const id = (created.json.memory as Memory).id;
    const links = await prisma.memoryCharacter.count({ where: { memoryId: id } });
    expect(links).toBe(2);

    const res = await app.inject({
      method: "DELETE",
      url: `/api/memories/${id}`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(204);

    const after = await prisma.memoryCharacter.count({ where: { memoryId: id } });
    expect(after).toBe(0);
  });
});