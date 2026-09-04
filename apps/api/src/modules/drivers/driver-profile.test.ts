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
  controlledBy: string;
};

type Driver = {
  id: string;
  characterId: string;
  number: number | null;
  teamId: string | null;
  team: {
    id: string;
    name: string;
    shortName: string | null;
    color: string | null;
  } | null;
  character: {
    id: string;
    name: string;
    nationality: string;
    imageUrl: string | null;
  };
};

type Team = {
  id: string;
  name: string;
  shortName: string | null;
  color: string | null;
};

async function createTeam(
  user: TestUser,
  payload: Record<string, unknown>,
): Promise<Team> {
  const res = await app.inject({
    method: "POST",
    url: "/api/teams",
    headers: { cookie: user.cookie },
    payload,
  });
  expect(res.statusCode).toBe(201);
  return res.json().team as Team;
}

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
): Promise<Character> {
  const res = await app.inject({
    method: "POST",
    url: "/api/characters",
    headers: { cookie: user.cookie },
    payload,
  });
  return res.json().character as Character;
}

async function putDriver(
  user: TestUser,
  characterId: string,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; body: Driver | null }> {
  const res = await app.inject({
    method: "PUT",
    url: `/api/drivers/${characterId}`,
    headers: { cookie: user.cookie },
    payload,
  });
  const json = res.json() as { driver?: Driver } | null;
  return { statusCode: res.statusCode, body: json?.driver ?? null };
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});

describe("GET /api/drivers", () => {
  it("retorna 401 sem sessão", async () => {
    const res = await app.inject({ method: "GET", url: "/api/drivers" });
    expect(res.statusCode).toBe(401);
  });

  it("lista somente os pilotos do usuário autenticado", async () => {
    const a = await createUser(`dlista-a-${Date.now()}@f1nw.test`, "A");
    const b = await createUser(`dlista-b-${Date.now()}@f1nw.test`, "B");

    const cha = await createCharacter(a, {
      name: "Meu Piloto",
      nationality: "Brasileira",
      birthDate: "1995-05-10",
    });
    const chb = await createCharacter(b, {
      name: "Piloto de Outro",
      nationality: "Britânica",
      birthDate: "1990-01-01",
    });

    await putDriver(a, cha.id, { number: 44 });
    await putDriver(b, chb.id, { number: 1 });

    const res = await app.inject({
      method: "GET",
      url: "/api/drivers",
      headers: { cookie: a.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const mine = body.drivers.filter(
      (d: Driver) => d.character.name === "Meu Piloto",
    );
    const theirs = body.drivers.filter(
      (d: Driver) => d.character.name === "Piloto de Outro",
    );
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.length).toBe(0);
  });
});

describe("PUT /api/drivers/:characterId", () => {
  it("retorna 401 sem sessão", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/drivers/00000000-0000-4000-8000-000000000000",
    });
    expect(res.statusCode).toBe(401);
  });

  it("transforma um personagem em piloto com número", async () => {
    const u = await createUser(`piloto-${Date.now()}@f1nw.test`, "Pil");
    const ch = await createCharacter(u, {
      name: "Novo Piloto",
      nationality: "Italiana",
      birthDate: "1998-03-15",
    });

    const { statusCode, body } = await putDriver(u, ch.id, { number: 10 });
    expect(statusCode).toBe(200);
    expect(body!.character.name).toBe("Novo Piloto");
    expect(body!.number).toBe(10);
    expect(body!.teamId).toBeNull();
  });

  it("permite mais de um piloto e exige um DriverProfile por personagem (upsert, sem duplicar)", async () => {
    const u = await createUser(`upsert-${Date.now()}@f1nw.test`, "Ups");
    const ch = await createCharacter(u, {
      name: "Upsert Piloto",
      nationality: "Alemã",
      birthDate: "1992-05-20",
    });

    await putDriver(u, ch.id, { number: 5 });
    // Chamada repetida atualiza em vez de duplicar.
    const { statusCode, body } = await putDriver(u, ch.id, { number: 6 });
    expect(statusCode).toBe(200);
    expect(body!.number).toBe(6);

    const count = await prisma.driverProfile.count({
      where: { characterId: ch.id },
    });
    expect(count).toBe(1);
  });

  it("aceita número nulo (sem número)", async () => {
    const u = await createUser(`semnum-${Date.now()}@f1nw.test`, "SemNum");
    const ch = await createCharacter(u, {
      name: "Sem Número",
      nationality: "Francesa",
      birthDate: "1991-01-01",
    });

    const { statusCode, body } = await putDriver(u, ch.id, { number: null });
    expect(statusCode).toBe(200);
    expect(body!.number).toBeNull();
  });

  it("retorna 404 ao criar piloto de personagem de outro usuário", async () => {
    const owner = await createUser(`own-${Date.now()}@f1nw.test`, "Ow");
    const intruder = await createUser(`intr-${Date.now()}@f1nw.test`, "In");
    const ch = await createCharacter(owner, {
      name: "Do Dono",
      nationality: "Canadense",
      birthDate: "1993-07-07",
    });

    const { statusCode } = await putDriver(intruder, ch.id, { number: 30 });
    expect(statusCode).toBe(404);
  });

  it("retorna 404 para characterId inexistente", async () => {
    const u = await createUser(`ghost-${Date.now()}@f1nw.test`, "Ghost");
    const { statusCode } = await putDriver(u, "00000000-0000-4000-8000-000000000000", {
      number: 20,
    });
    expect(statusCode).toBe(404);
  });

  it("valida characterId (UUID inválido → 400)", async () => {
    const u = await createUser(`badid-${Date.now()}@f1nw.test`, "BadId");
    const res = await app.inject({
      method: "PUT",
      url: "/api/drivers/nao-e-um-uuid",
      headers: { cookie: u.cookie },
      payload: { number: 20 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("valida número (fora de 2-99 ou não inteiro → 400)", async () => {
    const u = await createUser(`num-${Date.now()}@f1nw.test`, "Num");
    const ch = await createCharacter(u, {
      name: "Número Inválido",
      nationality: "Belga",
      birthDate: "1990-02-02",
    });

    for (const bad of [1, 100, 1.5, -3, "dez"]) {
      const res = await app.inject({
        method: "PUT",
        url: `/api/drivers/${ch.id}`,
        headers: { cookie: u.cookie },
        payload: { number: bad },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it("ignora userId e controlledBy enviados pelo cliente (ownership vem do Character)", async () => {
    const u = await createUser(`fuzz-${Date.now()}@f1nw.test`, "Fuzz");
    const other = await createUser(`fuzz-other-${Date.now()}@f1nw.test`, "FO");
    const ch = await createCharacter(u, {
      name: "Fuzz Piloto",
      nationality: "Mexicana",
      birthDate: "1994-09-09",
    });

    const { statusCode, body } = await putDriver(u, ch.id, {
      number: 11,
      userId: other.userId,
      controlledBy: "AI",
    });
    expect(statusCode).toBe(200);
    expect(body!.number).toBe(11);

    const stored = await prisma.driverProfile.findUnique({
      where: { characterId: ch.id },
      include: { character: true },
    });
    expect(stored!.character.userId).toBe(u.userId);
  });
});

describe("DELETE /api/drivers/:characterId", () => {
  it("retorna 401 sem sessão", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/drivers/00000000-0000-4000-8000-000000000000",
    });
    expect(res.statusCode).toBe(401);
  });

  it("remove o perfil de piloto", async () => {
    const u = await createUser(`rem-${Date.now()}@f1nw.test`, "Rem");
    const ch = await createCharacter(u, {
      name: "Para Remover",
      nationality: "Holandesa",
      birthDate: "1997-10-10",
    });
    await putDriver(u, ch.id, { number: 3 });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/drivers/${ch.id}`,
      headers: { cookie: u.cookie },
    });
    expect(res.statusCode).toBe(204);

    const gone = await prisma.driverProfile.findUnique({
      where: { characterId: ch.id },
    });
    expect(gone).toBeNull();
  });

  it("retorna 404 ao remover piloto de personagem de outro usuário", async () => {
    const owner = await createUser(`remown-${Date.now()}@f1nw.test`, "RO");
    const intruder = await createUser(`remint-${Date.now()}@f1nw.test`, "RI");
    const ch = await createCharacter(owner, {
      name: "Não Remover",
      nationality: "Espanhola",
      birthDate: "1988-08-08",
    });
    await putDriver(owner, ch.id, { number: 8 });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/drivers/${ch.id}`,
      headers: { cookie: intruder.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("PUT /api/drivers/:characterId — vinculação de Team", () => {
  it("cria piloto sem Team → teamId e team null", async () => {
    const u = await createUser(`vtsem-${Date.now()}@f1nw.test`, "Vsem");
    const ch = await createCharacter(u, {
      name: "Sem Time",
      nationality: "Italiana",
      birthDate: "1995-01-01",
    });
    const { statusCode, body } = await putDriver(u, ch.id, { number: 2 });
    expect(statusCode).toBe(200);
    expect(body!.teamId).toBeNull();
    expect(body!.team).toBeNull();
  });

  it("cria piloto já com Team própria", async () => {
    const u = await createUser(`vtcom-${Date.now()}@f1nw.test`, "Vcom");
    const ch = await createCharacter(u, {
      name: "Com Time",
      nationality: "Brasileira",
      birthDate: "1993-03-03",
    });
    const team = await createTeam(u, { name: "Equipe do Piloto" });
    const { statusCode, body } = await putDriver(u, ch.id, {
      number: 10,
      teamId: team.id,
    });
    expect(statusCode).toBe(200);
    expect(body!.teamId).toBe(team.id);
    expect(body!.team!.id).toBe(team.id);
    expect(body!.team!.name).toBe("Equipe do Piloto");
  });

  it("adiciona Team a piloto existente", async () => {
    const u = await createUser(`vtadd-${Date.now()}@f1nw.test`, "Vadd");
    const ch = await createCharacter(u, {
      name: "Adicionar Time",
      nationality: "Alemã",
      birthDate: "1992-02-02",
    });
    await putDriver(u, ch.id, { number: 5 });

    const team = await createTeam(u, { name: "Time Adicionado" });
    const { statusCode, body } = await putDriver(u, ch.id, {
      number: 5,
      teamId: team.id,
    });
    expect(statusCode).toBe(200);
    expect(body!.teamId).toBe(team.id);
    expect(body!.team!.id).toBe(team.id);
  });

  it("troca Team", async () => {
    const u = await createUser(`vtswap-${Date.now()}@f1nw.test`, "Vswap");
    const ch = await createCharacter(u, {
      name: "Trocar Time",
      nationality: "Francesa",
      birthDate: "1991-04-04",
    });
    const teamA = await createTeam(u, { name: "Time A" });
    const teamB = await createTeam(u, { name: "Time B" });

    await putDriver(u, ch.id, { number: 7, teamId: teamA.id });
    const { statusCode, body } = await putDriver(u, ch.id, {
      number: 7,
      teamId: teamB.id,
    });
    expect(statusCode).toBe(200);
    expect(body!.teamId).toBe(teamB.id);
    expect(body!.team!.id).toBe(teamB.id);
  });

  it("remove Team enviando teamId: null", async () => {
    const u = await createUser(`vtdel-${Date.now()}@f1nw.test`, "Vunlink");
    const ch = await createCharacter(u, {
      name: "Desvincular",
      nationality: "Britânica",
      birthDate: "1990-05-05",
    });
    const team = await createTeam(u, { name: "Time Removível" });
    await putDriver(u, ch.id, { number: 3, teamId: team.id });

    const { statusCode, body } = await putDriver(u, ch.id, {
      number: 3,
      teamId: null,
    });
    expect(statusCode).toBe(200);
    expect(body!.teamId).toBeNull();
    expect(body!.team).toBeNull();
  });

  it("PUT sem teamId preserva a Team existente", async () => {
    const u = await createUser(`vtkeep-${Date.now()}@f1nw.test`, "Vkeep");
    const ch = await createCharacter(u, {
      name: "Preservar Time",
      nationality: "Canadense",
      birthDate: "1989-06-06",
    });
    const team = await createTeam(u, { name: "Time Preservado" });
    await putDriver(u, ch.id, { number: 12, teamId: team.id });

    // Envia apenas number, sem teamId: a Team deve ser preservada.
    const { statusCode, body } = await putDriver(u, ch.id, { number: 13 });
    expect(statusCode).toBe(200);
    expect(body!.teamId).toBe(team.id);
    expect(body!.team!.id).toBe(team.id);
  });

  it("retorna 404 para Team inexistente", async () => {
    const u = await createUser(`vtmiss-${Date.now()}@f1nw.test`, "Vmiss");
    const ch = await createCharacter(u, {
      name: "Time Sumido",
      nationality: "Espanhola",
      birthDate: "1988-07-07",
    });
    const { statusCode } = await putDriver(u, ch.id, {
      number: 4,
      teamId: "00000000-0000-4000-8000-000000000000",
    });
    expect(statusCode).toBe(404);
  });

  it("retorna 404 para Team de outro usuário", async () => {
    const owner = await createUser(`vtotherowner-${Date.now()}@f1nw.test`, "VO");
    const intruder = await createUser(`vtother-${Date.now()}@f1nw.test`, "VI");
    const team = await createTeam(owner, { name: "Time Alheio" });

    const ch = await createCharacter(intruder, {
      name: "Time Alheio Piloto",
      nationality: "Holandesa",
      birthDate: "1987-08-08",
    });
    const { statusCode } = await putDriver(intruder, ch.id, {
      number: 9,
      teamId: team.id,
    });
    expect(statusCode).toBe(404);
  });

  it("não altera ownership quando userId/characterId são enviados no body", async () => {
    const u = await createUser(`vtown-${Date.now()}@f1nw.test`, "VOwn");
    const other = await createUser(`vtown-other-${Date.now()}@f1nw.test`, "VOt");
    const ch = await createCharacter(u, {
      name: "Ownership Intacto",
      nationality: "Argentina",
      birthDate: "1986-09-09",
    });
    const team = await createTeam(u, { name: "Time Privacy" });

    const { statusCode, body } = await putDriver(u, ch.id, {
      number: 8,
      teamId: team.id,
      userId: other.userId,
      characterId: "00000000-0000-4000-8000-000000000000",
    });
    expect(statusCode).toBe(200);
    expect(body!.teamId).toBe(team.id);

    const stored = await prisma.driverProfile.findFirst({
      where: { characterId: ch.id },
      include: { character: true },
    });
    expect(stored!.character.userId).toBe(u.userId);
  });

  it("valida teamId não-UUID → 400", async () => {
    const u = await createUser(`vtbadt-${Date.now()}@f1nw.test`, "VBadT");
    const ch = await createCharacter(u, {
      name: "Time Inválido",
      nationality: "Belga",
      birthDate: "1985-10-10",
    });
    const res = await app.inject({
      method: "PUT",
      url: `/api/drivers/${ch.id}`,
      headers: { cookie: u.cookie },
      payload: { number: 6, teamId: "nao-e-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/drivers — Team na resposta e pilotos sem Team", () => {
  it("retorna teamId/team e mantém pilotos sem Team na listagem", async () => {
    const u = await createUser(`vtget-${Date.now()}@f1nw.test`, "VG");
    const chCom = await createCharacter(u, {
      name: "Piloto Com Time",
      nationality: "Mexicana",
      birthDate: "1984-01-01",
    });
    const chSem = await createCharacter(u, {
      name: "Piloto Sem Time",
      nationality: "Portuguesa",
      birthDate: "1983-02-02",
    });
    const team = await createTeam(u, { name: "Time do GET" });

    await putDriver(u, chCom.id, { number: 20, teamId: team.id });
    await putDriver(u, chSem.id, { number: 21 });

    const res = await app.inject({
      method: "GET",
      url: "/api/drivers",
      headers: { cookie: u.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const withTeam = body.drivers.find(
      (d: Driver) => d.character.name === "Piloto Com Time",
    );
    const withoutTeam = body.drivers.find(
      (d: Driver) => d.character.name === "Piloto Sem Time",
    );
    expect(withTeam.teamId).toBe(team.id);
    expect(withTeam.team.id).toBe(team.id);
    expect(withTeam.team.name).toBe("Time do GET");
    expect(withoutTeam.teamId).toBeNull();
    expect(withoutTeam.team).toBeNull();
  });
});
