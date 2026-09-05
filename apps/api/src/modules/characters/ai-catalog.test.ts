import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { aiCatalog, syncAiCatalog } from "./ai-catalog.js";

let app: FastifyInstance;
let conversationIds: string[] = [];
const catalogIds = aiCatalog.map((c) => c.id);

type TestUser = {
  cookie: string;
  userId: string;
};

async function createUser(email: string, name: string): Promise<TestUser> {
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
  return { cookie, userId: user.id };
}

async function createCharacter(
  user: TestUser,
  payload: Record<string, unknown>,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/characters",
    headers: { cookie: user.cookie },
    payload,
  });
  expect(res.statusCode).toBe(201);
  return res.json().character.id;
}

async function createConversation(
  user: TestUser,
  participantIds: string[],
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/conversations",
    headers: { cookie: user.cookie },
    payload: { type: "GROUP", participantIds },
  });
  expect(res.statusCode).toBe(201);
  const conversationId = res.json().conversation.id;
  conversationIds.push(conversationId);
  return conversationId;
}

async function addAIParticipant(
  user: TestUser,
  conversationId: string,
  characterId: string,
) {
  return app.inject({
    method: "POST",
    url: `/api/conversations/${conversationId}/participants`,
    headers: { cookie: user.cookie },
    payload: { characterId },
  });
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  await syncAiCatalog(prisma);
});

afterAll(async () => {
  // Limpeza restrita: somente as Conversas deste arquivo (cascade remove
  // participants/messages) e os AI Characters do catálogo sincronizados aqui.
  for (const id of conversationIds) {
    await prisma.conversation
      .delete({ where: { id } })
      .catch(() => undefined);
  }
  await prisma.character.deleteMany({ where: { id: { in: catalogIds } } });
  await prisma.$disconnect();
  await app.close();
});

describe("catálogo AI — idempotência do seed (STEP 20)", () => {
  it("sincronizar repetidamente não cria duplicatas e preserva identidade", async () => {
    await syncAiCatalog(prisma);
    await syncAiCatalog(prisma);

    const rows = await prisma.character.findMany({
      where: { id: { in: catalogIds } },
    });
    expect(rows).toHaveLength(aiCatalog.length);
    for (const row of rows) {
      const catalog = aiCatalog.find((c) => c.id === row.id);
      expect(catalog).toBeDefined();
      expect(row.name).toBe(catalog!.name);
      expect(row.nationality).toBe(catalog!.nationality);
      expect(row.birthDate.toISOString()).toBe(catalog!.birthDate);
      expect(row.controlledBy).toBe("AI");
      expect(row.userId).toBeNull();
    }
  });
});

describe("GET /api/characters/ai", () => {
  it("A - exige autenticação", async () => {
    const res = await app.inject({ method: "GET", url: "/api/characters/ai" });
    expect(res.statusCode).toBe(401);
  });

  it("A - retorna somente AI Characters oficiais", async () => {
    const u = await createUser(`cat-a-${Date.now()}@f1nw.test`, "CatA");
    const res = await app.inject({
      method: "GET",
      url: "/api/characters/ai",
      headers: { cookie: u.cookie },
    });
    expect(res.statusCode).toBe(200);
    const characters = res.json().characters;
    expect(characters).toHaveLength(aiCatalog.length);
    expect(characters.every((c: { controlledBy: string }) => c.controlledBy === "AI")).toBe(
      true,
    );
  });

  it("C - AI Characters possuem controlledBy=AI e userId=null", async () => {
    const u = await createUser(`cat-c-${Date.now()}@f1nw.test`, "CatC");
    const res = await app.inject({
      method: "GET",
      url: "/api/characters/ai",
      headers: { cookie: u.cookie },
    });
    const characters = res.json().characters;
    for (const c of characters) {
      expect(c.controlledBy).toBe("AI");
      expect(c.userId).toBeNull();
    }
  });

  it("B - nenhum Character USER aparece no catálogo", async () => {
    const u = await createUser(`cat-b-${Date.now()}@f1nw.test`, "CatB");
    await createCharacter(u, {
      name: "Meu Personagem",
      nationality: "Brasileira",
      birthDate: "1995-05-10",
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/characters/ai",
      headers: { cookie: u.cookie },
    });
    const characters = res.json().characters;
    expect(characters.length).toBe(aiCatalog.length);
    expect(characters.some((c: { name: string }) => c.name === "Meu Personagem")).toBe(
      false,
    );
    expect(characters.every((c: { userId: unknown }) => c.userId === null)).toBe(true);
  });

  it("D - catálogo não permite mutation", async () => {
    const u = await createUser(`cat-d-${Date.now()}@f1nw.test`, "CatD");
    const aiId = aiCatalog[0].id;

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/characters/${aiId}`,
      headers: { cookie: u.cookie },
      payload: { name: "Hack" },
    });
    expect(patch.statusCode).toBe(404);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/characters/${aiId}`,
      headers: { cookie: u.cookie },
    });
    expect(del.statusCode).toBe(404);

    const viaProfile = await app.inject({
      method: "GET",
      url: `/api/characters/${aiId}`,
      headers: { cookie: u.cookie },
    });
    expect(viaProfile.statusCode).toBe(404);

    const post = await app.inject({
      method: "POST",
      url: "/api/characters/ai",
      headers: { cookie: u.cookie },
      payload: {},
    });
    expect(post.statusCode).toBe(404);
  });
});

describe("participante AI no fluxo existente", () => {
  it("E - adicionar AI participant funciona", async () => {
    const owner = await createUser(`ai-part-${Date.now()}@f1nw.test`, "AIP");
    const ownChar = await createCharacter(owner, {
      name: "Dono",
      nationality: "Brasileira",
      birthDate: "1995-05-10",
    });
    const conversationId = await createConversation(owner, [ownChar]);

    const add = await addAIParticipant(owner, conversationId, aiCatalog[0].id);
    expect(add.statusCode).toBe(201);
    expect(add.json().participant.controlledBy).toBe("AI");
    expect(add.json().participant.userId).toBeNull();
  });

  it("F - adicionar o mesmo AI novamente retorna 409", async () => {
    const owner = await createUser(`ai-dup-${Date.now()}@f1nw.test`, "AID");
    const ownChar = await createCharacter(owner, {
      name: "Dono2",
      nationality: "Brasileira",
      birthDate: "1995-05-10",
    });
    const conversationId = await createConversation(owner, [ownChar]);

    const first = await addAIParticipant(owner, conversationId, aiCatalog[0].id);
    expect(first.statusCode).toBe(201);

    const second = await addAIParticipant(owner, conversationId, aiCatalog[0].id);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("CONFLICT");
  });

  it("G - usuário sem acesso à conversa recebe 404 ao adicionar", async () => {
    const owner = await createUser(`ai-owner-${Date.now()}@f1nw.test`, "AIO");
    const intruder = await createUser(`ai-intr-${Date.now()}@f1nw.test`, "IN");
    const ownChar = await createCharacter(owner, {
      name: "Dono3",
      nationality: "Brasileira",
      birthDate: "1995-05-10",
    });
    const conversationId = await createConversation(owner, [ownChar]);

    const res = await addAIParticipant(intruder, conversationId, aiCatalog[0].id);
    expect(res.statusCode).toBe(404);
  });

  it("H - AI participant não concede ownership", async () => {
    const owner = await createUser(`ai-access-${Date.now()}@f1nw.test`, "AIA");
    const outsider = await createUser(`ai-out-${Date.now()}@f1nw.test`, "OUT");
    const ownChar = await createCharacter(owner, {
      name: "Dono4",
      nationality: "Brasileira",
      birthDate: "1995-05-10",
    });
    const conversationId = await createConversation(owner, [ownChar]);
    const add = await addAIParticipant(owner, conversationId, aiCatalog[0].id);
    expect(add.statusCode).toBe(201);

    const read = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}`,
      headers: { cookie: outsider.cookie },
    });
    expect(read.statusCode).toBe(404);
  });

  it("I - remoção do AI participant continua funcionando", async () => {
    const owner = await createUser(`ai-rem-${Date.now()}@f1nw.test`, "AIR");
    const ownChar = await createCharacter(owner, {
      name: "Dono5",
      nationality: "Brasileira",
      birthDate: "1995-05-10",
    });
    const conversationId = await createConversation(owner, [ownChar]);
    const add = await addAIParticipant(owner, conversationId, aiCatalog[0].id);
    expect(add.statusCode).toBe(201);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/conversations/${conversationId}/participants/${aiCatalog[0].id}`,
      headers: { cookie: owner.cookie },
    });
    expect(del.statusCode).toBe(204);

    const list = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}/participants`,
      headers: { cookie: owner.cookie },
    });
    expect(list.json().participants.length).toBe(1);
    expect(list.json().participants[0].id).toBe(ownChar);
  });
});