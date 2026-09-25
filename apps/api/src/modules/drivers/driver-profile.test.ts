import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { DriverRole, DriverStatus } from "@prisma/client";
import { createHmac, randomBytes } from "node:crypto";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { rosterService } from "../roster/roster.service.js";

const WORLD_KEY = "default";

const createdSeasonIds: string[] = [];

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
  headshotUrl: string | null;
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

afterEach(async () => {
  if (createdSeasonIds.length === 0) return;
  await prisma.worldState.updateMany({
    where: { currentSeasonId: { in: createdSeasonIds } },
    data: { currentSeasonId: null },
  });
  await prisma.seasonDriverEntry.deleteMany({ where: { seasonId: { in: createdSeasonIds } } });
  await prisma.season.deleteMany({ where: { id: { in: createdSeasonIds } } });
  createdSeasonIds.length = 0;
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
    await putDriver(b, chb.id, { number: 2 });

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

async function universeForUser(userId: string): Promise<string> {
  const universe = await prisma.universe.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
  return universe.id;
}

async function createSeason(userId: string, year: number): Promise<string> {
  const universeId = await universeForUser(userId);
  const season = await prisma.season.create({ data: { universeId, year } });
  createdSeasonIds.push(season.id);
  return season.id;
}

async function setCurrentSeason(
  userId: string,
  seasonId: string | null,
): Promise<void> {
  const universeId = await universeForUser(userId);
  await prisma.worldState.upsert({
    where: { universeId_key: { universeId, key: WORLD_KEY } },
    update: { currentSeasonId: seasonId },
    create: { universeId, key: WORLD_KEY, currentSeasonId: seasonId },
  });
}

async function readCurrentSeason(userId: string): Promise<string | null> {
  const universeId = await universeForUser(userId);
  const world = await prisma.worldState.findUnique({
    where: { universeId_key: { universeId, key: WORLD_KEY } },
  });
  return world?.currentSeasonId ?? null;
}

describe("PUT /api/drivers/:characterId — vinculação de Team é do roster", () => {
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

  it("rejeita teamId no corpo (criar piloto já com Team) → 400 ROSTER_OPERATION_REQUIRED", async () => {
    const u = await createUser(`vtcom-${Date.now()}@f1nw.test`, "Vcom");
    const ch = await createCharacter(u, {
      name: "Com Time",
      nationality: "Brasileira",
      birthDate: "1993-03-03",
    });
    const team = await createTeam(u, { name: "Equipe do Piloto" });

    const res = await app.inject({
      method: "PUT",
      url: `/api/drivers/${ch.id}`,
      headers: { cookie: u.cookie },
      payload: { number: 10, teamId: team.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("ROSTER_OPERATION_REQUIRED");
  });

  it("rejeita teamId no corpo (adicionar Team a piloto existente) → 400 ROSTER_OPERATION_REQUIRED", async () => {
    const u = await createUser(`vtadd-${Date.now()}@f1nw.test`, "Vadd");
    const ch = await createCharacter(u, {
      name: "Adicionar Time",
      nationality: "Alemã",
      birthDate: "1992-02-02",
    });
    await putDriver(u, ch.id, { number: 5 });

    const team = await createTeam(u, { name: "Time Adicionado" });
    const res = await app.inject({
      method: "PUT",
      url: `/api/drivers/${ch.id}`,
      headers: { cookie: u.cookie },
      payload: { number: 5, teamId: team.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("ROSTER_OPERATION_REQUIRED");
  });

  it("rejeita teamId no corpo (trocar Team) → 400 ROSTER_OPERATION_REQUIRED", async () => {
    const u = await createUser(`vtswap-${Date.now()}@f1nw.test`, "Vswap");
    const ch = await createCharacter(u, {
      name: "Trocar Time",
      nationality: "Francesa",
      birthDate: "1991-04-04",
    });
    const teamA = await createTeam(u, { name: "Time A" });
    const teamB = await createTeam(u, { name: "Time B" });

    await putDriver(u, ch.id, { number: 7 });
    const res = await app.inject({
      method: "PUT",
      url: `/api/drivers/${ch.id}`,
      headers: { cookie: u.cookie },
      payload: { number: 7, teamId: teamB.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("ROSTER_OPERATION_REQUIRED");
    expect(teamA.id).not.toBe(teamB.id);
  });

  it("rejeita teamId: null no corpo (desvincular via profile) → 400 ROSTER_OPERATION_REQUIRED", async () => {
    const u = await createUser(`vtdel-${Date.now()}@f1nw.test`, "Vunlink");
    const ch = await createCharacter(u, {
      name: "Desvincular",
      nationality: "Britânica",
      birthDate: "1990-05-05",
    });
    await putDriver(u, ch.id, { number: 3 });

    const res = await app.inject({
      method: "PUT",
      url: `/api/drivers/${ch.id}`,
      headers: { cookie: u.cookie },
      payload: { number: 3, teamId: null },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("ROSTER_OPERATION_REQUIRED");
  });

  it("PUT sem teamId preserva a Team vinda do roster", async () => {
    const u = await createUser(`vtkeep-${Date.now()}@f1nw.test`, "Vkeep");
    const ch = await createCharacter(u, {
      name: "Preservar Time",
      nationality: "Canadense",
      birthDate: "1989-06-06",
    });
    const team = await createTeam(u, { name: "Time Preservado" });
    const seasonId = await createSeason(u.userId, 2026);
    const originalSeason = await readCurrentSeason(u.userId);

    await putDriver(u, ch.id, { number: 12 });
    const driverRow = await prisma.driverProfile.findUnique({
      where: { characterId: ch.id },
    });
    await setCurrentSeason(u.userId, seasonId);
    await rosterService.assignDriverToSeat(u.userId, {
      seasonId,
      teamId: team.id,
      driverProfileId: driverRow!.id,
      seat: 1,
    });

    // Envia apenas number, sem teamId: a Team (cache via roster) deve permanecer.
    const { statusCode, body } = await putDriver(u, ch.id, { number: 13 });
    expect(statusCode).toBe(200);
    expect(body!.teamId).toBe(team.id);
    expect(body!.team!.id).toBe(team.id);

    await setCurrentSeason(u.userId, originalSeason);
  });

  it("rejeita teamId mesmo com equipe de outro usuário → 400 ROSTER_OPERATION_REQUIRED (não vaza 404)", async () => {
    const owner = await createUser(`vtotherowner-${Date.now()}@f1nw.test`, "VO");
    const intruder = await createUser(`vtother-${Date.now()}@f1nw.test`, "VI");
    const team = await createTeam(owner, { name: "Time Alheio" });

    const ch = await createCharacter(intruder, {
      name: "Time Alheio Piloto",
      nationality: "Holandesa",
      birthDate: "1987-08-08",
    });
    const res = await app.inject({
      method: "PUT",
      url: `/api/drivers/${ch.id}`,
      headers: { cookie: intruder.cookie },
      payload: { number: 9, teamId: team.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("ROSTER_OPERATION_REQUIRED");
  });

  it("não altera ownership quando userId/characterId são enviados no body", async () => {
    const u = await createUser(`vtown-${Date.now()}@f1nw.test`, "VOwn");
    const other = await createUser(`vtown-other-${Date.now()}@f1nw.test`, "VOt");
    const ch = await createCharacter(u, {
      name: "Ownership Intacto",
      nationality: "Argentina",
      birthDate: "1986-09-09",
    });

    const { statusCode, body } = await putDriver(u, ch.id, {
      number: 8,
      userId: other.userId,
      characterId: "00000000-0000-4000-8000-000000000000",
    });
    expect(statusCode).toBe(200);
    expect(body!.teamId).toBeNull();

    const stored = await prisma.driverProfile.findFirst({
      where: { characterId: ch.id },
      include: { character: true },
    });
    expect(stored!.character.userId).toBe(u.userId);
  });

  it("valida teamId não-UUID → 400 ROSTER_OPERATION_REQUIRED (antes da validação de payload)", async () => {
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
    expect(res.json().code).toBe("ROSTER_OPERATION_REQUIRED");
  });
});

describe("GET /api/drivers — Team na resposta e pilotos sem Team", () => {
  it("retorna teamId/team (cache via roster) e mantém pilotos sem Team na listagem", async () => {
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
    const seasonId = await createSeason(u.userId, 2026);
    const originalSeason = await readCurrentSeason(u.userId);

    await putDriver(u, chCom.id, { number: 20 });
    await putDriver(u, chSem.id, { number: 21 });
    const comDriver = await prisma.driverProfile.findUnique({
      where: { characterId: chCom.id },
    });

    await setCurrentSeason(u.userId, seasonId);
    await rosterService.assignDriverToSeat(u.userId, {
      seasonId,
      teamId: team.id,
      driverProfileId: comDriver!.id,
      seat: 1,
    });

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

    await setCurrentSeason(u.userId, originalSeason);
  });
});

type MaterializedEntryInput = {
  seasonId: string;
  teamId: string;
  driverProfileId: string;
  role?: DriverRole | null;
  seat?: number | null;
  number?: number | null;
  status?: DriverStatus;
};

async function createMaterializedEntry(
  input: MaterializedEntryInput,
): Promise<void> {
  await prisma.seasonDriverEntry.create({
    data: {
      seasonId: input.seasonId,
      teamId: input.teamId,
      driverProfileId: input.driverProfileId,
      role: input.role ?? "RACE_SEAT",
      seat: input.seat ?? null,
      number: input.number ?? null,
      status: input.status ?? "ACTIVE",
    },
  });
}

async function getDrivers(
  user: TestUser,
  query = "",
  remoteAddress?: string,
): Promise<{ status: number; drivers: Driver[] }> {
  const res = await app.inject({
    method: "GET",
    url: `/api/drivers${query}`,
    headers: { cookie: user.cookie },
    remoteAddress: remoteAddress ?? "127.0.0.1",
  });
  return { status: res.statusCode, drivers: (res.json() as { drivers: Driver[] }).drivers };
}

async function createDbUser(name: string, email: string): Promise<TestUser> {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET not set");
  const user = await prisma.user.create({
    data: { email, name, password: null, emailVerified: false },
  });
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      userId: user.id,
    },
  });
  const sig = Buffer.from(createHmac("sha256", secret).update(token).digest()).toString(
    "base64",
  );
  const cookie = `f1nw.session_token=${token}.${sig}`;
  return { cookie, userId: user.id };
}

async function createDbCharacter(
  userId: string,
  name: string,
  nationality = "Brasileira",
): Promise<{ id: string }> {
  const universeId = await universeForUser(userId);
  const character = await prisma.character.create({
    data: {
      userId,
      universeId,
      name,
      nationality,
      birthDate: new Date("1990-01-01"),
    },
    select: { id: true },
  });
  return character;
}

async function createDbDriver(characterId: string, number: number | null): Promise<string> {
  const profile = await prisma.driverProfile.create({
    data: { characterId, number },
    select: { id: true },
  });
  return profile.id;
}

async function createDbTeam(userId: string, name: string): Promise<Team> {
  const universeId = await universeForUser(userId);
  return prisma.team.create({
    data: { userId, universeId, name },
    select: {
      id: true,
      name: true,
      shortName: true,
      color: true,
    },
  });
}

async function makeDriverUser(
  suffix: string,
  name: string,
): Promise<{ user: TestUser; characterId: string; profileId: string }> {
  const user = await createDbUser(
    suffix,
    `${suffix}-${Date.now()}@f1nw.test`,
  );
  const ch = await createDbCharacter(user.userId, name);
  const profileId = await createDbDriver(ch.id, 44);
  return { user, characterId: ch.id, profileId };
}

describe("GET /api/drivers — Piloto ↔ Equipe pela SeasonDriverEntry (STEP 14)", () => {
  it("participante materializado (cache nulo) retorna a equipe da SeasonDriverEntry", async () => {
    const { user, profileId } = await makeDriverUser("step14a", "Cache Nulo");
    const team = await createDbTeam(user.userId, "Time da Entrada");
    const seasonId = await createSeason(user.userId, 2027);
    await createMaterializedEntry({ seasonId, teamId: team.id, driverProfileId: profileId, seat: 1 });

    const cached = await prisma.driverProfile.findUnique({ where: { id: profileId } });
    expect(cached!.teamId).toBeNull();

    await setCurrentSeason(user.userId, seasonId);
    const { status, drivers } = await getDrivers(user, "", "10.14.1.1");
    const found = drivers.find((d) => d.id === profileId)!;
    expect(status).toBe(200);
    expect(found.teamId).toBe(team.id);
    expect(found.team!.id).toBe(team.id);
    expect(found.team!.name).toBe("Time da Entrada");
    expect(found.number).toBe(44);
  });

  it("retorna o número da SeasonDriverEntry (fonte de verdade) sobre o número base", async () => {
    const { user, profileId } = await makeDriverUser("step14b", "Número da Entrada");
    const team = await createDbTeam(user.userId, "Time do Número");
    const seasonId = await createSeason(user.userId, 2027);
    await createMaterializedEntry({ seasonId, teamId: team.id, driverProfileId: profileId, number: 88, seat: 1 });

    await setCurrentSeason(user.userId, seasonId);
    const { drivers } = await getDrivers(user, "", "10.14.1.2");
    expect(drivers.find((d) => d.id === profileId)!.number).toBe(88);
  });

  it("participante sem seat (role/seat nulos) continua com a equipe", async () => {
    const { user, profileId } = await makeDriverUser("step14c", "Sem Seat");
    const team = await createDbTeam(user.userId, "Time Sem Seat");
    const seasonId = await createSeason(user.userId, 2027);
    await createMaterializedEntry({
      seasonId,
      teamId: team.id,
      driverProfileId: profileId,
      role: null,
      seat: null,
      number: 22,
      status: "ACTIVE",
    });

    await setCurrentSeason(user.userId, seasonId);
    const { drivers } = await getDrivers(user, "", "10.14.1.3");
    const driver = drivers.find((d) => d.id === profileId)!;
    expect(driver.teamId).toBe(team.id);
    expect(driver.team!.name).toBe("Time Sem Seat");
    expect(driver.number).toBe(22);
  });

  it("piloto sem equipe na temporada não gera equipe fictícia", async () => {
    const { user, profileId } = await makeDriverUser("step14d", "Sem Equipe");
    const team = await createDbTeam(user.userId, "Time de Referência");
    const seasonId = await createSeason(user.userId, 2027);
    const otherSeasonId = await createSeason(user.userId, 2028);

    const chOutra = await createDbCharacter(user.userId, "Em Outra Temporada", "Italiana");
    const outId = await createDbDriver(chOutra.id, 30);
    await createMaterializedEntry({ seasonId: otherSeasonId, teamId: team.id, driverProfileId: outId, seat: 1 });

    await setCurrentSeason(user.userId, seasonId);
    const { drivers } = await getDrivers(user, "", "10.14.1.4");
    expect(drivers.find((d) => d.id === profileId)!.teamId).toBeNull();
    expect(drivers.find((d) => d.id === profileId)!.team).toBeNull();
    expect(drivers.find((d) => d.id === outId)!.teamId).toBeNull();
  });

  it("ordena a listagem por número ASC", async () => {
    const { user } = await makeDriverUser("step14e", "Fora de Ordem");
    const seasonId = await createSeason(user.userId, 2027);

    const names = ["Cinquenta", "Dezena", "Primeiro"];
    const numbers = [50, 10, 1];
    const created: { id: string; number: number }[] = [];
    for (let i = 0; i < names.length; i++) {
      const ch = await createDbCharacter(user.userId, names[i]);
      const profileId = await createDbDriver(ch.id, numbers[i]);
      created.push({ id: profileId, number: numbers[i] });
    }

    await setCurrentSeason(user.userId, seasonId);
    const { drivers } = await getDrivers(user, "", "10.14.1.5");
    const ids = drivers.filter((d) => created.some((c) => c.id === d.id));
    expect(ids.map((d) => d.number)).toEqual([1, 10, 50]);
  });

  it("sem número fica por último; empate desempata por nome", async () => {
    const user = await createDbUser(
      "step14f",
      `step14f-${Date.now()}@f1nw.test`,
    );
    const seasonId = await createSeason(user.userId, 2027);

    const rows: { name: string; number: number | null }[] = [
      { name: "Zed Sem Número", number: null },
      { name: "Zolo Já Numerado", number: 10 },
      { name: "Adam Já Numerado", number: 10 },
      { name: "Alpha Sem Número", number: null },
    ];
    const ids: string[] = [];
    for (const row of rows) {
      const ch = await createDbCharacter(user.userId, row.name);
      const profileId = await createDbDriver(ch.id, row.number);
      ids.push(profileId);
    }

    await setCurrentSeason(user.userId, seasonId);
    const { drivers } = await getDrivers(user, "", "10.14.1.6");
    const ordered = drivers.filter((d) => ids.includes(d.id));
    expect(ordered.map((d) => d.character.name)).toEqual([
      "Adam Já Numerado",
      "Zolo Já Numerado",
      "Alpha Sem Número",
      "Zed Sem Número",
    ]);
  });

  it("seasonId na query retorna a equipe daquela temporada", async () => {
    const { user, profileId } = await makeDriverUser("step14g", "Duas Temporadas");
    const teamA = await createDbTeam(user.userId, "Time 2027");
    const teamB = await createDbTeam(user.userId, "Time 2028");
    const season27 = await createSeason(user.userId, 2027);
    const season28 = await createSeason(user.userId, 2028);
    await createMaterializedEntry({ seasonId: season27, teamId: teamA.id, driverProfileId: profileId, seat: 1 });
    await createMaterializedEntry({ seasonId: season28, teamId: teamB.id, driverProfileId: profileId, seat: 1 });

    await setCurrentSeason(user.userId, season27);
    const s27 = await getDrivers(user, "", "10.14.1.7");
    const s28 = await getDrivers(user, `?seasonId=${season28}`, "10.14.1.8");
    const d27 = s27.drivers.find((d) => d.id === profileId)!;
    const d28 = s28.drivers.find((d) => d.id === profileId)!;
    expect(d27.team!.name).toBe("Time 2027");
    expect(d28.team!.name).toBe("Time 2028");
  });

  it("player-created driver (PUT + roster) mantém equipe e número corretos", async () => {
    const { user, profileId } = await makeDriverUser("step14h", "Player Criado");
    const team = await createDbTeam(user.userId, "Time Player");
    const seasonId = await createSeason(user.userId, 2027);
    await setCurrentSeason(user.userId, seasonId);
    await rosterService.assignDriverToSeat(user.userId, {
      seasonId,
      teamId: team.id,
      driverProfileId: profileId,
      seat: 1,
      number: 28,
    });

    const { drivers } = await getDrivers(user, "", "10.14.1.9");
    const driver = drivers.find((d) => d.id === profileId)!;
    expect(driver.teamId).toBe(team.id);
    expect(driver.team!.name).toBe("Time Player");
    expect(driver.number).toBe(28);
  });

  it("DriverProfile.teamId (cache stale) não sobrescreve a SeasonDriverEntry", async () => {
    const { user, profileId } = await makeDriverUser("step14i", "Cache Stale");
    const teamReal = await createDbTeam(user.userId, "Time Real da Entrada");
    const teamStale = await createDbTeam(user.userId, "Time Stale do Cache");
    const seasonId = await createSeason(user.userId, 2027);
    await createMaterializedEntry({ seasonId, teamId: teamReal.id, driverProfileId: profileId, seat: 1 });
    await prisma.driverProfile.update({ where: { id: profileId }, data: { teamId: teamStale.id } });

    await setCurrentSeason(user.userId, seasonId);
    const { drivers } = await getDrivers(user, "", "10.14.1.10");
    const driver = drivers.find((d) => d.id === profileId)!;
    expect(driver.teamId).toBe(teamReal.id);
    expect(driver.team!.name).toBe("Time Real da Entrada");
  });

  it("valida seasonId na query (UUID inválido → 400)", async () => {
    const { user } = await makeDriverUser("step14j", "UUID Inválido");
    const res = await app.inject({
      method: "GET",
      url: "/api/drivers?seasonId=nao-e-uuid",
      headers: { cookie: user.cookie },
      remoteAddress: "10.14.1.11",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/drivers — headshotUrl do enriquecimento externo (STEP 107.16)", () => {
  it("expõe headshotUrl do ExternalDriver vinculado e null sem vínculo", async () => {
    const user = await createDbUser(
      "step10716",
      `step10716-${Date.now()}@f1nw.test`,
    );
    const chCom = await createDbCharacter(user.userId, "Com Headshot");
    const chSem = await createDbCharacter(user.userId, "Sem Headshot");
    await createDbDriver(chCom.id, 44);
    await createDbDriver(chSem.id, 5);

    const ext = await prisma.externalDriver.create({
      data: {
        source: "jolpica",
        externalId: `step10716-${Date.now()}`,
        name: "Com Headshot",
        number: 44,
        headshotUrl: "https://img.example/44.jpg",
        contentHash: "ch-step10716",
      },
      select: { id: true },
    });
    const universeId = await universeForUser(user.userId);
    await prisma.externalBindingDriver.create({
      data: {
        universeId,
        externalDriverId: ext.id,
        characterId: chCom.id,
      },
    });

    const { status, drivers } = await getDrivers(user, "", "10.16.1.1");
    expect(status).toBe(200);

    const com = drivers.find((d) => d.characterId === chCom.id)!;
    const sem = drivers.find((d) => d.characterId === chSem.id)!;
    expect(com.headshotUrl).toBe("https://img.example/44.jpg");
    expect(sem.headshotUrl).toBeNull();

    await prisma.externalDriver.delete({ where: { id: ext.id } });
  });
});
