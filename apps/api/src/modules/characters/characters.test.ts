import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";

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
