import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";

let app: FastifyInstance;

type TestUser = {
  cookie: string;
  userId: string;
};

type Team = {
  id: string;
  name: string;
  shortName: string | null;
  color: string | null;
  userId: string;
};

type Character = {
  id: string;
  name: string;
  nationality: string;
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

async function createTeam(
  user: TestUser,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; json: { team?: Team } }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/teams",
    headers: { cookie: user.cookie },
    payload,
  });
  return { statusCode: res.statusCode, json: res.json() };
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
  return res.json().character as Character;
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});

describe("GET /api/teams", () => {
  it("retorna 401 sem sessão", async () => {
    const res = await app.inject({ method: "GET", url: "/api/teams" });
    expect(res.statusCode).toBe(401);
  });

  it("lista somente as equipes do usuário autenticado", async () => {
    const a = await createUser(`tlista-a-${Date.now()}@f1nw.test`, "A");
    const b = await createUser(`tlista-b-${Date.now()}@f1nw.test`, "B");

    await createTeam(a, { name: "Minha Equipe", shortName: "MEQ" });
    // Equipe do outro usuário não deve aparecer na lista de A.
    await createTeam(b, { name: "Equipe de Outro", shortName: "EQO" });

    const res = await app.inject({
      method: "GET",
      url: "/api/teams",
      headers: { cookie: a.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const mine = body.teams.filter((t: Team) => t.name === "Minha Equipe");
    const theirs = body.teams.filter((t: Team) => t.name === "Equipe de Outro");
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.length).toBe(0);
  });
});

describe("POST /api/teams", () => {
  it("retorna 401 sem sessão", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/teams",
      payload: { name: "Ferrari" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("cria equipe autenticada atribuindo userId do token", async () => {
    const u = await createUser(`tcria-${Date.now()}@f1nw.test`, "Cria");
    const { statusCode, json } = await createTeam(u, {
      name: "Scuderia Azzurra",
      shortName: "AZZ",
      color: "blue",
    });
    expect(statusCode).toBe(201);
    expect(json.team!.name).toBe("Scuderia Azzurra");
    expect(json.team!.shortName).toBe("AZZ");
    expect(json.team!.color).toBe("blue");
    expect(json.team!.userId).toBe(u.userId);
  });

  it("cria equipe com campos opcionais ausentes", async () => {
    const u = await createUser(`tmin-${Date.now()}@f1nw.test`, "Min");
    const { statusCode, json } = await createTeam(u, { name: "Somente Nome" });
    expect(statusCode).toBe(201);
    expect(json.team!.shortName).toBeNull();
    expect(json.team!.color).toBeNull();
  });

  it("rejeita equipe sem nome", async () => {
    const u = await createUser(`tnome-${Date.now()}@f1nw.test`, "Nome");
    const { statusCode } = await createTeam(u, { name: "" });
    expect(statusCode).toBe(400);
  });

  it("nome duplicado dentro do mesmo usuário → 409", async () => {
    const u = await createUser(`tdup-${Date.now()}@f1nw.test`, "Dup");
    await createTeam(u, { name: "Equipe Única" });
    const { statusCode } = await createTeam(u, { name: "Equipe Única" });
    expect(statusCode).toBe(409);
  });

  it("mesmo nome permitido para usuários diferentes", async () => {
    const a = await createUser(`tdiff-a-${Date.now()}@f1nw.test`, "DA");
    const b = await createUser(`tdiff-b-${Date.now()}@f1nw.test`, "DB");
    const r1 = await createTeam(a, { name: "Ferrari" });
    const r2 = await createTeam(b, { name: "Ferrari" });
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect(r1.json.team!.userId).toBe(a.userId);
    expect(r2.json.team!.userId).toBe(b.userId);
  });

  it("não altera ownership quando userId é enviado no payload", async () => {
    const u = await createUser(`town-${Date.now()}@f1nw.test`, "Own");
    const other = await createUser(`town-other-${Date.now()}@f1nw.test`, "OO");
    const { statusCode, json } = await createTeam(u, {
      name: "Com UserId",
      // Tentativa de forçar ownership para outro usuário deve ser ignorada.
      userId: other.userId,
    });
    expect(statusCode).toBe(201);
    expect(json.team!.userId).toBe(u.userId);
  });
});

describe("GET /api/teams/:id", () => {
  it("retorna 401 sem sessão", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/teams/00000000-0000-4000-8000-000000000000",
    });
    expect(res.statusCode).toBe(401);
  });

  it("lê equipe própria", async () => {
    const u = await createUser(`tget-${Date.now()}@f1nw.test`, "Get");
    const created = await createTeam(u, { name: "Leitura" });
    const id = created.json.team!.id;

    const res = await app.inject({
      method: "GET",
      url: `/api/teams/${id}`,
      headers: { cookie: u.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().team.name).toBe("Leitura");
    expect(res.json().team.userId).toBe(u.userId);
  });

  it("retorna 404 para equipe de outro usuário", async () => {
    const owner = await createUser(`tget-owner-${Date.now()}@f1nw.test`, "GO");
    const intruder = await createUser(`tget-intruder-${Date.now()}@f1nw.test`, "GI");
    const created = await createTeam(owner, { name: "Alheia" });
    const id = created.json.team!.id;

    const res = await app.inject({
      method: "GET",
      url: `/api/teams/${id}`,
      headers: { cookie: intruder.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("valida id UUID inválido → 400", async () => {
    const u = await createUser(`tbadid-${Date.now()}@f1nw.test`, "BadId");
    const res = await app.inject({
      method: "GET",
      url: "/api/teams/nao-e-um-uuid",
      headers: { cookie: u.cookie },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("PATCH /api/teams/:id", () => {
  it("retorna 401 sem sessão", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/teams/00000000-0000-4000-8000-000000000000",
      payload: { name: "X" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("edita equipe própria", async () => {
    const u = await createUser(`tedit-${Date.now()}@f1nw.test`, "Edit");
    const created = await createTeam(u, {
      name: "Antes",
      shortName: "ANT",
      color: "red",
    });
    const id = created.json.team!.id;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/teams/${id}`,
      headers: { cookie: u.cookie },
      payload: { name: "Depois", color: "green" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().team.name).toBe("Depois");
    expect(res.json().team.shortName).toBe("ANT");
    expect(res.json().team.color).toBe("green");
    expect(res.json().team.userId).toBe(u.userId);
  });

  it("retorna 404 ao editar equipe de outro usuário", async () => {
    const owner = await createUser(`tedit-owner-${Date.now()}@f1nw.test`, "EO");
    const intruder = await createUser(`tedit-intruder-${Date.now()}@f1nw.test`, "EI");
    const created = await createTeam(owner, { name: "De Outro" });
    const id = created.json.team!.id;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/teams/${id}`,
      headers: { cookie: intruder.cookie },
      payload: { name: "Hack" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("nome duplicado na edição dentro do mesmo usuário → 409", async () => {
    const u = await createUser(`tedit-dup-${Date.now()}@f1nw.test`, "ED");
    await createTeam(u, { name: "Equipe A" });
    const created = await createTeam(u, { name: "Equipe B" });
    const id = created.json.team!.id;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/teams/${id}`,
      headers: { cookie: u.cookie },
      payload: { name: "Equipe A" },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe("DELETE /api/teams/:id", () => {
  it("retorna 401 sem sessão", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/teams/00000000-0000-4000-8000-000000000000",
    });
    expect(res.statusCode).toBe(401);
  });

  it("exclui equipe própria quando sem pilotos vinculados", async () => {
    const u = await createUser(`tdel-${Date.now()}@f1nw.test`, "Del");
    const created = await createTeam(u, { name: "Para Excluir" });
    const id = created.json.team!.id;

    const res = await app.inject({
      method: "DELETE",
      url: `/api/teams/${id}`,
      headers: { cookie: u.cookie },
    });
    expect(res.statusCode).toBe(204);

    const gone = await prisma.team.findUnique({ where: { id } });
    expect(gone).toBeNull();
  });

  it("retorna 404 ao excluir equipe de outro usuário", async () => {
    const owner = await createUser(`tdel-owner-${Date.now()}@f1nw.test`, "DO");
    const intruder = await createUser(`tdel-intruder-${Date.now()}@f1nw.test`, "DI");
    const created = await createTeam(owner, { name: "Não Apagar" });
    const id = created.json.team!.id;

    const res = await app.inject({
      method: "DELETE",
      url: `/api/teams/${id}`,
      headers: { cookie: intruder.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("retorna 409 ao excluir equipe com piloto vinculado", async () => {
    const u = await createUser(`tdel-linked-${Date.now()}@f1nw.test`, "DL");
    const ch = await createCharacter(u, {
      name: "Piloto Vinculado",
      nationality: "Brasileira",
      birthDate: "1995-05-10",
    });

    // Cria o perfil de piloto via API (exposto em fase anterior).
    const driverRes = await app.inject({
      method: "PUT",
      url: `/api/drivers/${ch.id}`,
      headers: { cookie: u.cookie },
      payload: { number: 44 },
    });
    expect(driverRes.statusCode).toBe(200);

    const created = await createTeam(u, { name: "Com Piloto" });
    const teamId = created.json.team!.id;

    // A vinculação teamId ainda não é exposta pela API nesta fase; ligamos o
    // piloto diretamente no banco para validar a restrição onDelete: Restrict.
    await prisma.driverProfile.update({
      where: { characterId: ch.id },
      data: { teamId },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/teams/${teamId}`,
      headers: { cookie: u.cookie },
    });
    expect(res.statusCode).toBe(409);

    const stillExists = await prisma.team.findUnique({ where: { id: teamId } });
    expect(stillExists).not.toBeNull();
  });
});
