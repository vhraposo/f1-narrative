import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { syncAiCatalog } from "./ai-catalog.js";

let app: FastifyInstance;

type TestUser = {
  cookie: string;
  userId: string;
};

type Character = {
  id: string;
  name: string;
  nationality: string;
  gender: string | null;
  birthDate: Date;
  imageUrl: string | null;
  biography: string | null;
  userId: string;
  controlledBy: string;
};

// Cria uma conta real via endpoint de autenticação e devolve o cookie de sessão.
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
  return { cookie, userId: user.id };
}

async function createCharacter(
  user: TestUser,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; json: { character: Character } }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/characters",
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
  await prisma.$disconnect();
  await app.close();
});

describe("GET /api/characters", () => {
  it("retorna 401 sem sessão", async () => {
    const res = await app.inject({ method: "GET", url: "/api/characters" });
    expect(res.statusCode).toBe(401);
  });

  it("lista somente os personagens do usuário autenticado", async () => {
    const a = await createUser(`lista-a-${Date.now()}@f1nw.test`, "A");
    const b = await createUser(`lista-b-${Date.now()}@f1nw.test`, "B");

    await createCharacter(a, {
      name: "Meu Personagem",
      nationality: "Brasileira",
      birthDate: "1995-05-10",
    });
    // Personagem do outro usuário não deve aparecer na lista de A.
    await createCharacter(b, {
      name: "Personagem de Outro",
      nationality: "Britânica",
      birthDate: "1990-01-01",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/characters",
      headers: { cookie: a.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const mine = body.characters.filter(
      (c: Character) => c.name === "Meu Personagem",
    );
    const theirs = body.characters.filter(
      (c: Character) => c.name === "Personagem de Outro",
    );
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.length).toBe(0);
  });
});

describe("GET /api/characters — somente personagens do usuário", () => {
  it("A) retorna exatamente os 4 Characters próprios do usuário", async () => {
    const u = await createUser(`proprios-${Date.now()}@f1nw.test`, "Proprios");
    for (let i = 0; i < 4; i++) {
      const { statusCode } = await createCharacter(u, {
        name: `Personagem Proprio ${i}`,
        nationality: "Brasileira",
        birthDate: "1990-01-01",
      });
      expect(statusCode).toBe(201);
    }

    const res = await app.inject({
      method: "GET",
      url: "/api/characters",
      headers: { cookie: u.cookie },
    });
    expect(res.statusCode).toBe(200);
    const characters = res.json().characters as Character[];
    expect(characters).toHaveLength(4);
    expect(characters.map((c) => c.name).sort()).toEqual([
      "Personagem Proprio 0",
      "Personagem Proprio 1",
      "Personagem Proprio 2",
      "Personagem Proprio 3",
    ]);
  });

  it("B) não retorna Characters de IA/pilotos do grid (userId null)", async () => {
    const u = await createUser(`sem-ia-${Date.now()}@f1nw.test`, "SemIA");
    for (let i = 0; i < 4; i++) {
      await createCharacter(u, {
        name: `Dono ${i}`,
        nationality: "Brasileira",
        birthDate: "1990-01-01",
      });
    }

    const aiNames: string[] = [];
    for (let i = 0; i < 19; i++) {
      const name = `Piloto Grid ${Date.now()}-${i}`;
      aiNames.push(name);
      await prisma.character.create({
        data: {
          name,
          nationality: "Brasileira",
          birthDate: new Date("1990-01-01"),
          controlledBy: "AI",
          userId: null,
        },
      });
    }

    const res = await app.inject({
      method: "GET",
      url: "/api/characters",
      headers: { cookie: u.cookie },
    });
    expect(res.statusCode).toBe(200);
    const characters = res.json().characters as Character[];
    expect(characters).toHaveLength(4);
    const returned = new Set(characters.map((c) => c.name));
    for (const name of aiNames) {
      expect(returned.has(name)).toBe(false);
    }
  });

  it("C) o Chat acessa os Characters de IA via /api/characters/ai", async () => {
    const u = await createUser(`chat-ia-${Date.now()}@f1nw.test`, "ChatIA");
    const name = `Piloto IA Chat ${Date.now()}`;
    await prisma.character.create({
      data: {
        name,
        nationality: "Brasileira",
        birthDate: new Date("1990-01-01"),
        controlledBy: "AI",
        userId: null,
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/characters/ai",
      headers: { cookie: u.cookie },
    });
    expect(res.statusCode).toBe(200);
    const names = (res.json().characters as Character[]).map((c) => c.name);
    expect(names).toContain(name);
  });
});

describe("POST /api/characters", () => {
  it("cria personagem autenticado com controlledBy=USER e userId do token", async () => {
    const u = await createUser(`cria-${Date.now()}@f1nw.test`, "Cria");
    const { statusCode, json } = await createCharacter(u, {
      name: "Novo Piloto",
      nationality: "Argentina",
      birthDate: "1998-03-15",
    });
    expect(statusCode).toBe(201);
    expect(json.character.name).toBe("Novo Piloto");
    expect(json.character.controlledBy).toBe("USER");
    expect(json.character.userId).toBe(u.userId);
  });

  it("rejeita personagem sem campos obrigatórios", async () => {
    const u = await createUser(`inval-${Date.now()}@f1nw.test`, "Inval");
    const { statusCode } = await createCharacter(u, {
      name: "",
      nationality: "",
    });
    expect(statusCode).toBe(400);
  });

  it("rejeita birthDate futura", async () => {
    const u = await createUser(`futura-${Date.now()}@f1nw.test`, "Futura");
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3650)
      .toISOString()
      .slice(0, 10);
    const { statusCode } = await createCharacter(u, {
      name: "Do Futuro",
      nationality: "Brasileira",
      birthDate: future,
    });
    expect(statusCode).toBe(400);
  });

  it("não altera ownership quando userId é enviado no payload", async () => {
    const u = await createUser(`uid-${Date.now()}@f1nw.test`, "Uid");
    const other = await createUser(`uid-other-${Date.now()}@f1nw.test`, "Outro");
    const { statusCode, json } = await createCharacter(u, {
      name: "Com Uid",
      nationality: "Canadense",
      birthDate: "1992-07-07",
      // Tentativa de forçar ownership para outro usuário deve ser ignorada.
      userId: other.userId,
    });
    expect(statusCode).toBe(201);
    expect(json.character.userId).toBe(u.userId);
  });

  it("não altera controlledBy quando enviado no payload", async () => {
    const u = await createUser(`cb-${Date.now()}@f1nw.test`, "Cb");
    const { statusCode, json } = await createCharacter(u, {
      name: "Com Cb",
      nationality: "Mexicana",
      birthDate: "1993-09-09",
      controlledBy: "AI",
    });
    expect(statusCode).toBe(201);
    expect(json.character.controlledBy).toBe("USER");
  });
});

describe("GET /api/characters/:id", () => {
  it("lê personagem próprio", async () => {
    const u = await createUser(`get-${Date.now()}@f1nw.test`, "Get");
    const created = await createCharacter(u, {
      name: "Leitura",
      nationality: "Italiana",
      birthDate: "1991-04-04",
    });
    const id = created.json.character.id as string;

    const res = await app.inject({
      method: "GET",
      url: `/api/characters/${id}`,
      headers: { cookie: u.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().character.name).toBe("Leitura");
  });

  it("retorna 404 para personagem de outro usuário", async () => {
    const owner = await createUser(`owner-${Date.now()}@f1nw.test`, "Owner");
    const intruder = await createUser(`intruder-${Date.now()}@f1nw.test`, "Intr");
    const created = await createCharacter(owner, {
      name: "Alheio",
      nationality: "Alemã",
      birthDate: "1994-11-11",
    });
    const id = created.json.character.id as string;

    const res = await app.inject({
      method: "GET",
      url: `/api/characters/${id}`,
      headers: { cookie: intruder.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("PATCH /api/characters/:id", () => {
  it("edita personagem próprio", async () => {
    const u = await createUser(`edit-${Date.now()}@f1nw.test`, "Edit");
    const created = await createCharacter(u, {
      name: "Antes",
      nationality: "Francesa",
      birthDate: "1990-02-02",
    });
    const id = created.json.character.id as string;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/characters/${id}`,
      headers: { cookie: u.cookie },
      payload: { name: "Depois" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().character.name).toBe("Depois");
    expect(res.json().character.nationality).toBe("Francesa");
  });

  it("retorna 404 ao editar personagem de outro usuário", async () => {
    const owner = await createUser(`edit-owner-${Date.now()}@f1nw.test`, "EO");
    const intruder = await createUser(`edit-intruder-${Date.now()}@f1nw.test`, "EI");
    const created = await createCharacter(owner, {
      name: "De Outro",
      nationality: "Espanhola",
      birthDate: "1988-08-08",
    });
    const id = created.json.character.id as string;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/characters/${id}`,
      headers: { cookie: intruder.cookie },
      payload: { name: "Hack" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /api/characters/:id", () => {
  it("exclui personagem próprio", async () => {
    const u = await createUser(`del-${Date.now()}@f1nw.test`, "Del");
    const created = await createCharacter(u, {
      name: "Para Excluir",
      nationality: "Holandesa",
      birthDate: "1997-10-10",
    });
    const id = created.json.character.id as string;

    const res = await app.inject({
      method: "DELETE",
      url: `/api/characters/${id}`,
      headers: { cookie: u.cookie },
    });
    expect(res.statusCode).toBe(204);

    const gone = await prisma.character.findUnique({ where: { id } });
    expect(gone).toBeNull();
  });

  it("retorna 404 ao excluir personagem de outro usuário", async () => {
    const owner = await createUser(`del-owner-${Date.now()}@f1nw.test`, "DO");
    const intruder = await createUser(`del-intruder-${Date.now()}@f1nw.test`, "DI");
    const created = await createCharacter(owner, {
      name: "Não Apagar",
      nationality: "Belga",
      birthDate: "1985-05-05",
    });
    const id = created.json.character.id as string;

    const res = await app.inject({
      method: "DELETE",
      url: `/api/characters/${id}`,
      headers: { cookie: intruder.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/characters/:id/switch-control", () => {
  it("assume o controle de um AI character e libera os anteriores", async () => {
    const u = await createUser(`sw-a-${Date.now()}@f1nw.test`, "SWA");
    const existing = await createCharacter(u, {
      name: "Meu Antigo",
      nationality: "Brasileira",
      birthDate: "1994-04-04",
    });
    const count = await syncAiCatalog(prisma);
    expect(count).toBeGreaterThan(0);
    const target = await prisma.character.findFirstOrThrow({
      where: { controlledBy: "AI", userId: null },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/characters/${target.id}/switch-control`,
      headers: { cookie: u.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.character.id).toBe(target.id);
    expect(body.character.controlledBy).toBe("USER");
    expect(body.character.userId).toBe(u.userId);
    expect(body.releasedCount).toBeGreaterThanOrEqual(1);

    const releasedDb = await prisma.character.findUnique({
      where: { id: existing.json.character.id as string },
    });
    expect(releasedDb?.controlledBy).toBe("AI");
    expect(releasedDb?.userId).toBe(u.userId);

    const targetDb = await prisma.character.findUnique({
      where: { id: target.id },
    });
    expect(targetDb?.controlledBy).toBe("USER");
    expect(targetDb?.userId).toBe(u.userId);
  });

  it("libera o controle anterior preservando o ownership na troca", async () => {
    const u = await createUser(`sw-b-${Date.now()}@f1nw.test`, "SWB");
    const c1 = await createCharacter(u, {
      name: "Origem Um",
      nationality: "Italiana",
      birthDate: "1990-01-01",
    });
    const c2 = await createCharacter(u, {
      name: "Origem Dois",
      nationality: "Francesa",
      birthDate: "1991-02-02",
    });
    await syncAiCatalog(prisma);
    const target = await prisma.character.findFirstOrThrow({
      where: { controlledBy: "AI", userId: null },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/characters/${target.id}/switch-control`,
      headers: { cookie: u.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().releasedCount).toBe(2);

    for (const c of [c1, c2]) {
      const row = await prisma.character.findUnique({
        where: { id: c.json.character.id as string },
      });
      expect(row?.controlledBy).toBe("AI");
      expect(row?.userId).toBe(u.userId);
    }
  });

  it("trocar o controle não encolhe Characters, Drivers nem Teams do universo", async () => {
    const u = await createUser(`sw-g-${Date.now()}@f1nw.test`, "SWG");
    const c1 = await createCharacter(u, {
      name: "Coleção Um",
      nationality: "Brasileira",
      birthDate: "1990-01-01",
    });
    const c2 = await createCharacter(u, {
      name: "Coleção Dois",
      nationality: "Portuguesa",
      birthDate: "1991-02-02",
    });

    await prisma.driverProfile.create({
      data: { characterId: c1.json.character.id as string, number: 10 },
    });
    await prisma.driverProfile.create({
      data: { characterId: c2.json.character.id as string, number: 11 },
    });
    const universe = await prisma.universe.upsert({
      where: { userId: u.userId },
      update: {},
      create: { userId: u.userId },
    });
    await prisma.team.create({
      data: {
        userId: u.userId,
        universeId: universe.id,
        name: `Equipe SWG ${Date.now()}`,
      },
    });

    await syncAiCatalog(prisma);
    const target = await prisma.character.findFirstOrThrow({
      where: { controlledBy: "AI", userId: null },
    });

    const driversBefore = await app.inject({
      method: "GET",
      url: "/api/drivers",
      headers: { cookie: u.cookie },
    });
    const teamsBefore = await app.inject({
      method: "GET",
      url: "/api/teams",
      headers: { cookie: u.cookie },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/characters/${target.id}/switch-control`,
      headers: { cookie: u.cookie },
    });
    expect(res.statusCode).toBe(200);

    const characters = await app.inject({
      method: "GET",
      url: "/api/characters",
      headers: { cookie: u.cookie },
    });
    expect(characters.statusCode).toBe(200);
    const names = (characters.json().characters as Character[]).map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(["Coleção Um", "Coleção Dois", target.name]),
    );

    const driversAfter = await app.inject({
      method: "GET",
      url: "/api/drivers",
      headers: { cookie: u.cookie },
    });
    const teamsAfter = await app.inject({
      method: "GET",
      url: "/api/teams",
      headers: { cookie: u.cookie },
    });
    expect(driversAfter.json().drivers).toHaveLength(
      driversBefore.json().drivers.length,
    );
    expect(teamsAfter.json().teams).toHaveLength(teamsBefore.json().teams.length);
    const afterNames = (
      driversAfter.json().drivers as Array<{ character: { name: string } }>
    ).map((d) => d.character.name);
    expect(afterNames).toContain("Coleção Um");
    expect(afterNames).toContain("Coleção Dois");
  });

  it("retorna 409 ao tentar controlar personagem já controlado", async () => {
    const u = await createUser(`sw-c-${Date.now()}@f1nw.test`, "SWC");
    const created = await createCharacter(u, {
      name: "Já Meu",
      nationality: "Espanhola",
      birthDate: "1996-06-06",
    });
    const id = created.json.character.id as string;

    const res = await app.inject({
      method: "POST",
      url: `/api/characters/${id}/switch-control`,
      headers: { cookie: u.cookie },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("ALREADY_CONTROLLED");
  });

  it("retorna 404 ao tentar controlar personagem de outro universo", async () => {
    const owner = await createUser(`sw-d1-${Date.now()}@f1nw.test`, "SWD1");
    const intruder = await createUser(`sw-d2-${Date.now()}@f1nw.test`, "SWD2");
    const created = await createCharacter(owner, {
      name: "Do Vizinho",
      nationality: "Canadense",
      birthDate: "1993-03-03",
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/characters/${created.json.character.id as string}/switch-control`,
      headers: { cookie: intruder.cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("retorna 404 para personagem inexistente", async () => {
    const u = await createUser(`sw-e-${Date.now()}@f1nw.test`, "SWE");
    const res = await app.inject({
      method: "POST",
      url: "/api/characters/00000000-0000-4000-8000-0000000fffff/switch-control",
      headers: { cookie: u.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("não altera o histórico de mensagens na troca", async () => {
    const u = await createUser(`sw-f-${Date.now()}@f1nw.test`, "SWF");
    const created = await createCharacter(u, {
      name: "Com Histórico",
      nationality: "Sueca",
      birthDate: "1995-07-07",
    });
    const charId = created.json.character.id as string;

    const hour = 60 * 60 * 1000;
    const [aiId, conv] = await prisma.$transaction(async (tx) => {
      const ai = await tx.character.findFirstOrThrow({
        where: { controlledBy: "AI", userId: null },
      });
      const conv = await tx.conversation.create({
        data: {
          type: "DM",
          participants: {
            create: [
              { characterId: charId },
              { characterId: ai.id },
            ],
          },
        },
      });
      await tx.message.create({
        data: {
          conversationId: conv.id,
          senderType: "USER_CHARACTER",
          characterId: charId,
          content: "histórico imutável",
          createdAt: new Date(Date.now() - hour),
        },
      });
      return [ai.id, conv.id];
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/characters/${aiId}/switch-control`,
      headers: { cookie: u.cookie },
    });
    expect(res.statusCode).toBe(200);

    const messages = await prisma.message.findMany({ where: { conversationId: conv } });
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("histórico imutável");
    expect(messages[0].characterId).toBe(charId);
    expect(messages[0].senderType).toBe("USER_CHARACTER");
  });
});
