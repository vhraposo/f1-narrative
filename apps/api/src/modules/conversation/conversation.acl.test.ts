import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";

// F7.1 — ACL estrutural de Conversation em TEST DB.
// Cobre: criação/adición de participante por Universe, acesso PRIVATE,
// listagem e fail-closed do valor reservado UNIVERSE. Cleanup completo.

const PREFIX = "conversation-acl";

let app: FastifyInstance;

type TestUser = { cookie: string; userId: string };

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];

async function createUser(label: string): Promise<TestUser> {
  const email = `${PREFIX}-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@f1nw.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: label, email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  createdUserIds.push(user.id);
  return { cookie, userId: user.id };
}

async function createUserCharacter(user: TestUser, name: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/characters",
    headers: { cookie: user.cookie },
    payload: { name, nationality: "BR", birthDate: "1995-05-10" },
  });
  expect(res.statusCode).toBe(201);
  const id = (res.json() as { character: { id: string } }).character.id;
  createdCharacterIds.push(id);
  return id;
}

async function createGlobalAiCharacter(name: string): Promise<string> {
  const character = await prisma.character.create({
    data: {
      name,
      nationality: "Global",
      birthDate: new Date("1995-01-01T00:00:00.000Z"),
      controlledBy: "AI",
      userId: null,
      universeId: null,
    },
  });
  createdCharacterIds.push(character.id);
  return character.id;
}

async function createConversation(
  user: TestUser,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/conversations",
    headers: { cookie: user.cookie },
    payload,
  });
  const body = res.json() as Record<string, unknown>;
  const conversation = body.conversation as { id?: string } | undefined;
  if (res.statusCode === 201 && conversation?.id) createdConversationIds.push(conversation.id);
  return { statusCode: res.statusCode, body };
}

function auth(user: TestUser) {
  return { headers: { cookie: user.cookie } };
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  if (createdConversationIds.length > 0) {
    await prisma.message.deleteMany({
      where: { conversationId: { in: createdConversationIds } },
    });
    await prisma.conversationParticipant.deleteMany({
      where: { conversationId: { in: createdConversationIds } },
    });
    await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  }
  if (createdCharacterIds.length > 0) {
    await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  }
  if (createdUserIds.length > 0) {
    await prisma.universe.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await app.close();
  await prisma.$disconnect();
});

describe("F7.1 — ACL de Conversation (TEST DB)", () => {
  it("criação válida (personagem próprio + AI global) retorna PRIVATE", async () => {
    const owner = await createUser("owner-create");
    const ownChar = await createUserCharacter(owner, `${PREFIX}-own-create`);
    const globalAi = await createGlobalAiCharacter(`${PREFIX}-global-ai-create`);

    const created = await createConversation(owner, {
      type: "GROUP",
      participantIds: [ownChar, globalAi],
    });
    expect(created.statusCode).toBe(201);
    const conversation = created.body.conversation as {
      id: string;
      visibility: string;
      participants: Array<{ id: string }>;
    };
    expect(conversation.visibility).toBe("PRIVATE");
    expect(conversation.participants.map((p) => p.id).sort()).toEqual([ownChar, globalAi].sort());
  });

  it("criação com personagem de outro Universe falha (404) e não persiste", async () => {
    const owner = await createUser("owner-cross");
    const outsider = await createUser("outsider-cross");
    const ownChar = await createUserCharacter(owner, `${PREFIX}-own-cross`);
    const foreignChar = await createUserCharacter(outsider, `${PREFIX}-foreign-cross`);

    const created = await createConversation(owner, {
      type: "GROUP",
      participantIds: [ownChar, foreignChar],
    });
    expect(created.statusCode).toBe(404);
    expect(
      await prisma.conversation.count({
        where: { participants: { some: { characterId: foreignChar } } },
      }),
    ).toBe(0);
  });

  it("criação com personagem inexistente falha (404)", async () => {
    const owner = await createUser("owner-missing");
    const created = await createConversation(owner, {
      type: "GROUP",
      participantIds: [randomUUID()],
    });
    expect(created.statusCode).toBe(404);
  });

  it("participante legítimo acessa Conversation PRIVATE (conversa, mensagens e participantes)", async () => {
    const owner = await createUser("owner-read");
    const ownChar = await createUserCharacter(owner, `${PREFIX}-own-read`);
    const created = await createConversation(owner, {
      type: "GROUP",
      participantIds: [ownChar],
    });
    const conversationId = (created.body.conversation as { id: string }).id;

    const conversation = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}`,
      ...auth(owner),
    });
    expect(conversation.statusCode).toBe(200);

    const messages = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}/messages`,
      ...auth(owner),
    });
    expect(messages.statusCode).toBe(200);

    const participants = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}/participants`,
      ...auth(owner),
    });
    expect(participants.statusCode).toBe(200);
  });

  it("não participante não acessa Conversation PRIVATE em nenhuma rota", async () => {
    const owner = await createUser("owner-deny");
    const outsider = await createUser("outsider-deny");
    const ownChar = await createUserCharacter(owner, `${PREFIX}-own-deny`);
    const created = await createConversation(owner, {
      type: "GROUP",
      participantIds: [ownChar],
    });
    const conversationId = (created.body.conversation as { id: string }).id;

    const reads = await Promise.all([
      app.inject({ method: "GET", url: `/api/conversations/${conversationId}`, ...auth(outsider) }),
      app.inject({
        method: "GET",
        url: `/api/conversations/${conversationId}/messages`,
        ...auth(outsider),
      }),
      app.inject({
        method: "GET",
        url: `/api/conversations/${conversationId}/participants`,
        ...auth(outsider),
      }),
      app.inject({
        method: "GET",
        url: `/api/conversations/${conversationId}/context`,
        ...auth(outsider),
      }),
    ]);
    for (const response of reads) expect(response.statusCode).toBe(404);

    const writes = await Promise.all([
      app.inject({
        method: "PATCH",
        url: `/api/conversations/${conversationId}`,
        ...auth(outsider),
        payload: { title: "Hack" },
      }),
      app.inject({
        method: "DELETE",
        url: `/api/conversations/${conversationId}`,
        ...auth(outsider),
      }),
      app.inject({
        method: "POST",
        url: `/api/conversations/${conversationId}/messages`,
        ...auth(outsider),
        payload: { senderType: "SYSTEM", content: "invadindo" },
      }),
    ]);
    for (const response of writes) expect(response.statusCode).toBe(404);
  });

  it("usuário não autorizado não adiciona participante", async () => {
    const owner = await createUser("owner-add-deny");
    const outsider = await createUser("outsider-add-deny");
    const ownChar = await createUserCharacter(owner, `${PREFIX}-own-add-deny`);
    const outsiderChar = await createUserCharacter(outsider, `${PREFIX}-outsider-add-deny`);
    const created = await createConversation(owner, {
      type: "GROUP",
      participantIds: [ownChar],
    });
    const conversationId = (created.body.conversation as { id: string }).id;

    const res = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/participants`,
      ...auth(outsider),
      payload: { characterId: outsiderChar },
    });
    expect(res.statusCode).toBe(404);
    expect(
      await prisma.conversationParticipant.count({ where: { conversationId } }),
    ).toBe(1);
  });

  it("adicionar personagem de outro Universe falha (404) e não cria vínculo", async () => {
    const owner = await createUser("owner-add-cross");
    const outsider = await createUser("outsider-add-cross");
    const ownChar = await createUserCharacter(owner, `${PREFIX}-own-add-cross`);
    const foreignChar = await createUserCharacter(outsider, `${PREFIX}-foreign-add-cross`);
    const created = await createConversation(owner, {
      type: "GROUP",
      participantIds: [ownChar],
    });
    const conversationId = (created.body.conversation as { id: string }).id;

    const res = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/participants`,
      ...auth(owner),
      payload: { characterId: foreignChar },
    });
    expect(res.statusCode).toBe(404);
    expect(
      await prisma.conversationParticipant.count({ where: { conversationId } }),
    ).toBe(1);
  });

  it("personagem de outro usuário sem Universe (legado) também é rejeitado", async () => {
    const owner = await createUser("owner-legacy");
    const outsider = await createUser("outsider-legacy");
    const ownChar = await createUserCharacter(owner, `${PREFIX}-own-legacy`);
    const legacy = await prisma.character.create({
      data: {
        name: `${PREFIX}-legacy-foreign`,
        nationality: "BR",
        birthDate: new Date("1995-01-01T00:00:00.000Z"),
        controlledBy: "USER",
        userId: outsider.userId,
        universeId: null,
      },
    });
    createdCharacterIds.push(legacy.id);

    const res = await createConversation(owner, {
      type: "GROUP",
      participantIds: [ownChar, legacy.id],
    });
    expect(res.statusCode).toBe(404);
  });

  it("adicionar personagem do mesmo Universe e AI global funciona", async () => {
    const owner = await createUser("owner-add-ok");
    const ownChar = await createUserCharacter(owner, `${PREFIX}-own-add-ok`);
    const secondChar = await createUserCharacter(owner, `${PREFIX}-second-add-ok`);
    const globalAi = await createGlobalAiCharacter(`${PREFIX}-global-add-ok`);
    const created = await createConversation(owner, {
      type: "GROUP",
      participantIds: [ownChar],
    });
    const conversationId = (created.body.conversation as { id: string }).id;

    const addSecond = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/participants`,
      ...auth(owner),
      payload: { characterId: secondChar },
    });
    expect(addSecond.statusCode).toBe(201);

    const addAi = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/participants`,
      ...auth(owner),
      payload: { characterId: globalAi },
    });
    expect(addAi.statusCode).toBe(201);
    expect(
      await prisma.conversationParticipant.count({ where: { conversationId } }),
    ).toBe(3);
  });

  it("listagem não expõe Conversation PRIVATE para não autorizado", async () => {
    const owner = await createUser("owner-list");
    const outsider = await createUser("outsider-list");
    const ownChar = await createUserCharacter(owner, `${PREFIX}-own-list`);
    const created = await createConversation(owner, {
      type: "GROUP",
      participantIds: [ownChar],
    });
    const conversationId = (created.body.conversation as { id: string }).id;

    const ownerList = await app.inject({ method: "GET", url: "/api/conversations", ...auth(owner) });
    expect(ownerList.statusCode).toBe(200);
    const ownerIds = (ownerList.json() as { conversations: Array<{ id: string }> }).conversations.map(
      (conversation) => conversation.id,
    );
    expect(ownerIds).toContain(conversationId);

    const outsiderList = await app.inject({
      method: "GET",
      url: "/api/conversations",
      ...auth(outsider),
    });
    expect(outsiderList.statusCode).toBe(200);
    const outsiderIds = (
      outsiderList.json() as { conversations: Array<{ id: string }> }
    ).conversations.map((conversation) => conversation.id);
    expect(outsiderIds).not.toContain(conversationId);
  });

  it("valor reservado UNIVERSE permanece fail-closed para não participante", async () => {
    const owner = await createUser("owner-universe");
    const outsider = await createUser("outsider-universe");
    const ownChar = await createUserCharacter(owner, `${PREFIX}-own-universe`);
    const created = await createConversation(owner, {
      type: "GROUP",
      participantIds: [ownChar],
    });
    const conversationId = (created.body.conversation as { id: string }).id;
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { visibility: "UNIVERSE" },
    });

    const ownerRead = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}`,
      ...auth(owner),
    });
    expect(ownerRead.statusCode).toBe(200);
    const outsiderRead = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}`,
      ...auth(outsider),
    });
    expect(outsiderRead.statusCode).toBe(404);
  });

  it("regressão: DM exige 2 participantes e duplicados não duplicam vínculo", async () => {
    const owner = await createUser("owner-regression");
    const firstChar = await createUserCharacter(owner, `${PREFIX}-first-regression`);
    const secondChar = await createUserCharacter(owner, `${PREFIX}-second-regression`);

    const dmOne = await createConversation(owner, {
      type: "DM",
      participantIds: [firstChar],
    });
    expect(dmOne.statusCode).toBe(400);

    const duplicated = await createConversation(owner, {
      type: "GROUP",
      participantIds: [firstChar, firstChar, secondChar],
    });
    expect(duplicated.statusCode).toBe(201);
    expect(
      (duplicated.body.conversation as { participants: unknown[] }).participants,
    ).toHaveLength(2);
  });
});
