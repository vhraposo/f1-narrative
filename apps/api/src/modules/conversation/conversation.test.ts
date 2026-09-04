import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";

// Todos os artefatos criados (users, characters, conversations, participants,
// messages, AI fixtures) são rastreados e removidos em afterAll, devolvendo o
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

type Conversation = {
  id: string;
  title: string | null;
  type: string;
  createdAt: string;
  updatedAt: string;
};

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];

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

async function createConversation(
  user: TestUser,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; json: { conversation?: Conversation & { participants: Character[] }; code?: string } }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/conversations",
    headers: { cookie: user.cookie },
    payload,
  });
  if (res.statusCode === 201 && res.json().conversation) {
    track(createdConversationIds, res.json().conversation as { id: string });
  }
  return { statusCode: res.statusCode, json: res.json() };
}

async function postMessage(
  user: TestUser,
  conversationId: string,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; json: { code?: string } }> {
  const res = await app.inject({
    method: "POST",
    url: `/api/conversations/${conversationId}/messages`,
    headers: { cookie: user.cookie },
    payload,
  });
  return { statusCode: res.statusCode, json: res.json() };
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  // Conversas são limpadas primeiro; participants/messages seguem em cascata
  // pelos onDelete de Conversation/ConversationParticipant, mas removemos de
  // forma explícita (filho → pai) para garantir baseline limpo.
  await prisma.message.deleteMany({
    where: { conversationId: { in: createdConversationIds } },
  });
  await prisma.conversationParticipant.deleteMany({
    where: { conversationId: { in: createdConversationIds } },
  });
  await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
  await app.close();
});

describe("Conversation - auth 401", () => {
  const convId = "00000000-0000-4000-8000-000000000001";
  const charId = "00000000-0000-4000-8000-000000000002";

  it("GET /api/conversations retorna 401 sem sessão", async () => {
    const res = await app.inject({ method: "GET", url: "/api/conversations" });
    expect(res.statusCode).toBe(401);
  });

  it("POST /api/conversations retorna 401 sem sessão", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/conversations",
      payload: { title: "X", participantIds: [charId] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/conversations/:id retorna 401 sem sessão", async () => {
    const res = await app.inject({ method: "GET", url: `/api/conversations/${convId}` });
    expect(res.statusCode).toBe(401);
  });

  it("PATCH /api/conversations/:id retorna 401 sem sessão", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/conversations/${convId}`,
      payload: { title: "X" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("DELETE /api/conversations/:id retorna 401 sem sessão", async () => {
    const res = await app.inject({ method: "DELETE", url: `/api/conversations/${convId}` });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/conversations/:id/participants retorna 401 sem sessão", async () => {
    const res = await app.inject({ method: "GET", url: `/api/conversations/${convId}/participants` });
    expect(res.statusCode).toBe(401);
  });

  it("POST /api/conversations/:id/participants retorna 401 sem sessão", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/conversations/${convId}/participants`,
      payload: { characterId: charId },
    });
    expect(res.statusCode).toBe(401);
  });

  it("DELETE /api/conversations/:id/participants/:characterId retorna 401 sem sessão", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/conversations/${convId}/participants/${charId}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /api/conversations/:id/messages retorna 401 sem sessão", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/conversations/${convId}/messages`,
      payload: { senderType: "SYSTEM", content: "X" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/conversations/:id/messages retorna 401 sem sessão", async () => {
    const res = await app.inject({ method: "GET", url: `/api/conversations/${convId}/messages` });
    expect(res.statusCode).toBe(401);
  });
});

describe("Conversation - criação, ownership e DM/GROUP", () => {
  let owner: TestUser;
  let intruder: TestUser;
  let charA: Character;
  let charB: Character;
  let aiC: Character;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`conv-o-${suffix}@f1nw.test`, "ConvOwner");
    intruder = await createUser(`conv-i-${suffix}@f1nw.test`, "ConvIntru");
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
    aiC = await createAICharacter({ name: "Lando (AI)", nationality: "GB" });
  });

  it("POST sem participantIds -> 400 VALIDATION_ERROR", async () => {
    const res = await createConversation(owner, { title: "Sem participantes" });
    expect(res.statusCode).toBe(400);
    expect(res.json.code).toBe("VALIDATION_ERROR");
  });

  it("POST participantIds vazio -> 400", async () => {
    const res = await createConversation(owner, { title: "X", participantIds: [] });
    expect(res.statusCode).toBe(400);
    expect(res.json.code).toBe("VALIDATION_ERROR");
  });

  it("participante inexistente -> 404", async () => {
    const res = await createConversation(owner, {
      title: "X",
      participantIds: [crypto.randomUUID()],
    });
    expect(res.statusCode).toBe(404);
  });

  it("nenhum participante próprio (só character de outro usuário) -> 404", async () => {
    const res = await createConversation(intruder, {
      title: "X",
      participantIds: [charA.id, aiC.id],
    });
    expect(res.statusCode).toBe(404);
  });

  it("GROUP válida com title opcional e participante AI -> 201", async () => {
    const res = await createConversation(owner, {
      title: "Garagem",
      type: "GROUP",
      participantIds: [charA.id, aiC.id],
    });
    expect(res.statusCode).toBe(201);
    const conv = res.json.conversation as Conversation & { participants: Character[] };
    expect(conv.title).toBe("Garagem");
    expect(conv.type).toBe("GROUP");
    const names = conv.participants.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["Alicya", "Lando (AI)"]));
  });

  it("DM válida com exatamente 2 participantes -> 201", async () => {
    const res = await createConversation(owner, {
      type: "DM",
      participantIds: [charA.id, charB.id],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json.conversation!.type).toBe("DM");
  });

  it("DM com != 2 participantes -> 400 (exige exatamente 2)", async () => {
    const one = await createConversation(owner, {
      type: "DM",
      participantIds: [charA.id],
    });
    expect(one.statusCode).toBe(400);
    expect(one.json.code).toBe("VALIDATION_ERROR");

    const three = await createConversation(owner, {
      type: "DM",
      participantIds: [charA.id, charB.id, aiC.id],
    });
    expect(three.statusCode).toBe(400);
  });

  it("GROUP com 1 participante -> 201 (1 ou mais)", async () => {
    const res = await createConversation(owner, {
      type: "GROUP",
      participantIds: [charA.id],
    });
    expect(res.statusCode).toBe(201);
  });

  it("type default é GROUP quando não informado", async () => {
    const res = await createConversation(owner, {
      participantIds: [charA.id, charB.id],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json.conversation!.type).toBe("GROUP");
  });

  it("participantes duplicados na criação não duplicam vínculo", async () => {
    const res = await createConversation(owner, {
      type: "GROUP",
      participantIds: [charA.id, charA.id, charB.id],
    });
    expect(res.statusCode).toBe(201);
    const conv = res.json.conversation as Conversation & { participants: Character[] };
    expect(conv.participants).toHaveLength(2);
  });
});

describe("Conversation - CRUD", () => {
  let owner: TestUser;
  let other: TestUser;
  let charA: Character;
  let convId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`conv-crud-${suffix}@f1nw.test`, "CrudOwner");
    other = await createUser(`conv-other-${suffix}@f1nw.test`, "Other");
    charA = await createCharacter(owner, {
      name: "Carlos",
      nationality: "ES",
      birthDate: "1994-09-01",
    });
    const created = await createConversation(owner, {
      title: "Rádio",
      type: "GROUP",
      participantIds: [charA.id],
    });
    convId = (created.json.conversation as Conversation).id;
  });

  it("GET /api/conversations/:id retorna a Conversation com participantes", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${convId}`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const { conversation } = res.json() as {
      conversation: Conversation & { participants: Character[]; messageCount: number };
    };
    expect(conversation.id).toBe(convId);
    expect(conversation.participants.map((p) => p.name)).toContain("Carlos");
    expect(conversation.messageCount).toBe(0);
  });

  it("GET /api/conversations/:id inexistente -> 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${crypto.randomUUID()}`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/conversations/:id de user sem participante -> 404 (não vaza)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${convId}`,
      headers: { cookie: other.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/conversations lista só as alcançáveis, ordenadas updatedAt DESC", async () => {
    // owner acessa convId; other não possui nenhuma.
    const ownerList = await app.inject({
      method: "GET",
      url: "/api/conversations",
      headers: { cookie: owner.cookie },
    });
    expect(ownerList.statusCode).toBe(200);
    const ownerConvs = (ownerList.json() as { conversations: Conversation[] }).conversations;
    expect(ownerConvs.map((c) => c.id)).toContain(convId);
    const updated = ownerConvs.map((c) => c.updatedAt);
    const sorted = [...updated].sort((a, b) => b.localeCompare(a));
    expect(updated).toEqual(sorted);

    const otherList = await app.inject({
      method: "GET",
      url: "/api/conversations",
      headers: { cookie: other.cookie },
    });
    expect(otherList.statusCode).toBe(200);
    expect((otherList.json() as { conversations: Conversation[] }).conversations).toEqual([]);
  });

  it("PATCH edita title", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/conversations/${convId}`,
      headers: { cookie: owner.cookie },
      payload: { title: "Rádio Paddock" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().conversation.title).toBe("Rádio Paddock");
  });

  it("PATCH edita type", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/conversations/${convId}`,
      headers: { cookie: owner.cookie },
      payload: { type: "DM" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().conversation.type).toBe("DM");
  });

  it("PATCH em Conversation de outro usuário -> 404", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/conversations/${convId}`,
      headers: { cookie: other.cookie },
      payload: { title: "Hack" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE em Conversation de outro usuário -> 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/conversations/${convId}`,
      headers: { cookie: other.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE em Conversation inexistente -> 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/conversations/${crypto.randomUUID()}`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("Conversation - participants", () => {
  let owner: TestUser;
  let charA: Character;
  let charB: Character;
  let aiChar: Character;
  let convId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`conv-p-${suffix}@f1nw.test`, "PartOwner");
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
    const created = await createConversation(owner, {
      type: "GROUP",
      participantIds: [charA.id],
    });
    convId = (created.json.conversation as Conversation).id;
  });

  it("adicionar Character 2 (USER próprio) -> 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/conversations/${convId}/participants`,
      headers: { cookie: owner.cookie },
      payload: { characterId: charB.id },
    });
    expect(res.statusCode).toBe(201);
  });

  it("adicionar Character AI -> 201 (participação, não ownership)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/conversations/${convId}/participants`,
      headers: { cookie: owner.cookie },
      payload: { characterId: aiChar.id },
    });
    expect(res.statusCode).toBe(201);
  });

  it("duplicação -> 409 CONFLICT", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/conversations/${convId}/participants`,
      headers: { cookie: owner.cookie },
      payload: { characterId: charA.id },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("CONFLICT");
  });

  it("Character inexistente -> 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/conversations/${convId}/participants`,
      headers: { cookie: owner.cookie },
      payload: { characterId: crypto.randomUUID() },
    });
    expect(res.statusCode).toBe(404);
  });

  it("Conversation inexistente -> 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/conversations/${crypto.randomUUID()}/participants`,
      headers: { cookie: owner.cookie },
      payload: { characterId: charA.id },
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/conversations/:id/participants lista com USER + AI", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${convId}/participants`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const { participants } = res.json() as { participants: Character[] };
    const names = participants.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["Lando", "Oscar", "Zoe (AI)"]));
    expect(participants.map((p) => p.controlledBy)).toEqual(
      expect.arrayContaining(["USER", "AI"]),
    );
  });

  it("remover participante AI -> 204; remover de novo -> 404", async () => {
    const remove = async (cid: string) =>
      app.inject({
        method: "DELETE",
        url: `/api/conversations/${convId}/participants/${cid}`,
        headers: { cookie: owner.cookie },
      });
    const first = await remove(aiChar.id);
    expect(first.statusCode).toBe(204);
    const again = await remove(aiChar.id);
    expect(again.statusCode).toBe(404);
  });

  it("user sem acesso não lista/adiciona/remove -> 404", async () => {
    const outsider = await createUser(`conv-p-out-${Date.now()}@f1nw.test`, "OutP");
    const list = await app.inject({
      method: "GET",
      url: `/api/conversations/${convId}/participants`,
      headers: { cookie: outsider.cookie },
    });
    expect(list.statusCode).toBe(404);

    const add = await app.inject({
      method: "POST",
      url: `/api/conversations/${convId}/participants`,
      headers: { cookie: outsider.cookie },
      payload: { characterId: charA.id },
    });
    expect(add.statusCode).toBe(404);
  });
});

describe("Conversation - ownership (PARTICIPAÇÃO ≠ OWNERSHIP)", () => {
  let userA: TestUser;
  let userB: TestUser;
  let charA: Character;
  let aiB: Character;
  let convId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    userA = await createUser(`conv-own-${suffix}@f1nw.test`, "OwnA");
    userB = await createUser(`conv-own-b-${suffix}@f1nw.test`, "OwnB");
    charA = await createCharacter(userA, {
      name: "Alicya",
      nationality: "GB",
      birthDate: "1990-01-01",
    });
    aiB = await createAICharacter({ name: "Max (AI)", nationality: "NL" });

    // Conversation de A + AI (B). A possui um participante -> detém acesso.
    const created = await createConversation(userA, {
      type: "GROUP",
      participantIds: [charA.id, aiB.id],
    });
    convId = (created.json.conversation as Conversation).id;
  });

  it("A (possui charA participante) acessa a Conversation -> 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${convId}`,
      headers: { cookie: userA.cookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it("B (não possui nenhum participante) recebe 404 (sem vazamento)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${convId}`,
      headers: { cookie: userB.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("B não pode listar mensagens nem postar", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/api/conversations/${convId}/messages`,
      headers: { cookie: userB.cookie },
    });
    expect(list.statusCode).toBe(404);

    const post = await postMessage(userB, convId, {
      senderType: "SYSTEM",
      content: "invadindo",
    });
    expect(post.statusCode).toBe(404);
  });
});

describe("Conversation - Message sender (USER_CHARACTER / AI_CHARACTER / SYSTEM)", () => {
  let owner: TestUser;
  let charA: Character; // USER (owned)
  let charB: Character; // USER (owned, outro)
  let aiC: Character; // AI
  let convId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`conv-msg-${suffix}@f1nw.test`, "MsgOwner");
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
    aiC = await createAICharacter({ name: "Lando (AI)", nationality: "GB" });

    const created = await createConversation(owner, {
      type: "GROUP",
      participantIds: [charA.id, charB.id, aiC.id],
    });
    convId = (created.json.conversation as Conversation).id;
  });

  it("USER_CHARACTER com characterId próprio -> 201", async () => {
    const res = await postMessage(owner, convId, {
      senderType: "USER_CHARACTER",
      characterId: charA.id,
      content: "Vocês viram isso?",
    });
    expect(res.statusCode).toBe(201);
  });

  it("USER_CHARACTER sem characterId -> 400", async () => {
    const res = await postMessage(owner, convId, {
      senderType: "USER_CHARACTER",
      content: "Sem remetente",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json.code).toBe("VALIDATION_ERROR");
  });

  it("USER_CHARACTER com characterId AI -> 403 (AI não pertence ao usuário)", async () => {
    const res = await postMessage(owner, convId, {
      senderType: "USER_CHARACTER",
      characterId: aiC.id,
      content: "Tentando como AI",
    });
    expect(res.statusCode).toBe(403);
  });

  it("USER_CHARACTER como character de OUTRO usuário -> 403 (sem bypass)", async () => {
    const outsider = await createUser(`conv-msg-o-${Date.now()}@f1nw.test`, "MsgOut");
    const otherOwned = await createCharacter(outsider, {
      name: "Charles",
      nationality: "MC",
      birthDate: "1997-10-16",
    });
    // outsider precisa ser participante para acessar a conv; adicionamos seu char.
    await app.inject({
      method: "POST",
      url: `/api/conversations/${convId}/participants`,
      headers: { cookie: owner.cookie },
      payload: { characterId: otherOwned.id },
    });
    // Mas tenta enviar como charA (do owner) -> 403.
    const res = await postMessage(outsider, convId, {
      senderType: "USER_CHARACTER",
      characterId: charA.id,
      content: "Fingindo ser Alicya",
    });
    expect(res.statusCode).toBe(403);
  });

  it("AI_CHARACTER com characterId AI participante -> 201", async () => {
    const res = await postMessage(owner, convId, {
      senderType: "AI_CHARACTER",
      characterId: aiC.id,
      content: "Eu nem estava olhando.",
    });
    expect(res.statusCode).toBe(201);
  });

  it("AI_CHARACTER com characterId USER -> 400", async () => {
    const res = await postMessage(owner, convId, {
      senderType: "AI_CHARACTER",
      characterId: charA.id,
      content: "IA tentando como USER",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json.code).toBe("VALIDATION_ERROR");
  });

  it("AI_CHARACTER sem characterId -> 400", async () => {
    const res = await postMessage(owner, convId, {
      senderType: "AI_CHARACTER",
      content: "Sem remetente ai",
    });
    expect(res.statusCode).toBe(400);
  });

  it("AI_CHARACTER com characterId inexistente -> 404", async () => {
    const res = await postMessage(owner, convId, {
      senderType: "AI_CHARACTER",
      characterId: crypto.randomUUID(),
      content: "Fantasma",
    });
    expect(res.statusCode).toBe(404);
  });

  it("SYSTEM com characterId null/ausente -> 201", async () => {
    const res = await postMessage(owner, convId, {
      senderType: "SYSTEM",
      content: "Charles iniciou uma chamada.",
    });
    expect(res.statusCode).toBe(201);
  });

  it("SYSTEM com characterId informado -> 400", async () => {
    const res = await postMessage(owner, convId, {
      senderType: "SYSTEM",
      characterId: charA.id,
      content: "Indevido",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json.code).toBe("VALIDATION_ERROR");
  });

  it("sender not participant -> 403", async () => {
    const ghostAI = await createAICharacter({ name: "Ollie (AI)", nationality: "GB" });
    const res = await postMessage(owner, convId, {
      senderType: "AI_CHARACTER",
      characterId: ghostAI.id,
      content: "Não sou participante",
    });
    expect(res.statusCode).toBe(403);
    expect(res.json.code).toBe("FORBIDDEN");
  });

  it("content vazio -> 400", async () => {
    const res = await postMessage(owner, convId, {
      senderType: "SYSTEM",
      content: "   ",
    });
    expect(res.statusCode).toBe(400);
  });

  it("Message em Conversation inexistente -> 404", async () => {
    const res = await postMessage(owner, crypto.randomUUID(), {
      senderType: "SYSTEM",
      content: "X",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("Conversation - ordering (createdAt ASC) e integridade", () => {
  let owner: TestUser;
  let charA: Character;
  let aiC: Character;
  let convId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`conv-ord-${suffix}@f1nw.test`, "OrdOwner");
    charA = await createCharacter(owner, {
      name: "Alicya",
      nationality: "GB",
      birthDate: "1990-01-01",
    });
    aiC = await createAICharacter({ name: "Lando (AI)", nationality: "GB" });
    const created = await createConversation(owner, {
      type: "GROUP",
      participantIds: [charA.id, aiC.id],
    });
    convId = (created.json.conversation as Conversation).id;
  });

  it("GET messages retorna em ordem createdAt ASC", async () => {
    await postMessage(owner, convId, {
      senderType: "SYSTEM",
      content: "primeira",
    });
    await postMessage(owner, convId, {
      senderType: "AI_CHARACTER",
      characterId: aiC.id,
      content: "segunda",
    });
    await postMessage(owner, convId, {
      senderType: "USER_CHARACTER",
      characterId: charA.id,
      content: "terceira",
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${convId}/messages`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const { messages } = res.json() as {
      messages: { content: string; createdAt: string; senderType: string; characterId: string | null }[];
    };
    expect(messages.map((m) => m.content)).toEqual(["primeira", "segunda", "terceira"]);

    // createdAt é estritamente não-decrescente.
    const created = messages.map((m) => m.createdAt);
    const sorted = [...created].sort((a, b) => a.localeCompare(b));
    expect(created).toEqual(sorted);

    // senderType e characterId corretamente persistidos.
    expect(messages[0].senderType).toBe("SYSTEM");
    expect(messages[0].characterId).toBeNull();
    expect(messages[1].senderType).toBe("AI_CHARACTER");
    expect(messages[1].characterId).toBe(aiC.id);
    expect(messages[2].senderType).toBe("USER_CHARACTER");
    expect(messages[2].characterId).toBe(charA.id);
  });

  it("GET messages de user sem acesso -> 404", async () => {
    const outsider = await createUser(`conv-ord-o-${Date.now()}@f1nw.test`, "OrdOther");
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${convId}/messages`,
      headers: { cookie: outsider.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET messages de Conversation inexistente -> 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${crypto.randomUUID()}/messages`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("Conversation - DELETE com vínculos (cascade)", () => {
  let owner: TestUser;
  let charA: Character;
  let aiC: Character;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`conv-del-${suffix}@f1nw.test`, "DelOwner");
    charA = await createCharacter(owner, {
      name: "Sergio",
      nationality: "MX",
      birthDate: "1990-01-26",
    });
    aiC = await createAICharacter({ name: "Nico (AI)", nationality: "DE" });
  });

  it("DELETE remove Conversation e Participants/Messages em cascata -> 204", async () => {
    const created = await createConversation(owner, {
      type: "GROUP",
      participantIds: [charA.id, aiC.id],
    });
    const id = (created.json.conversation as Conversation).id;

    await postMessage(owner, id, { senderType: "SYSTEM", content: "msg 1" });
    await postMessage(owner, id, {
      senderType: "AI_CHARACTER",
      characterId: aiC.id,
      content: "msg 2",
    });

    const linksBefore = await prisma.conversationParticipant.count({ where: { conversationId: id } });
    const msgsBefore = await prisma.message.count({ where: { conversationId: id } });
    expect(linksBefore).toBe(2);
    expect(msgsBefore).toBe(2);

    const res = await app.inject({
      method: "DELETE",
      url: `/api/conversations/${id}`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(204);

    const linksAfter = await prisma.conversationParticipant.count({ where: { conversationId: id } });
    const msgsAfter = await prisma.message.count({ where: { conversationId: id } });
    const convAfter = await prisma.conversation.count({ where: { id } });
    expect(linksAfter).toBe(0);
    expect(msgsAfter).toBe(0);
    expect(convAfter).toBe(0);
  });
});