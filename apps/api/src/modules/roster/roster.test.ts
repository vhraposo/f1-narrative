import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { rosterService, RosterError } from "./roster.service.js";

const WORLD_KEY = "default";

let app: FastifyInstance;

type User = { id: string; cookie: string };

type Driver = { characterId: string; driverProfileId: string };

type Team = { id: string };

type Season = { id: string };

type Entry = {
  id: string;
  seasonId: string;
  teamId: string | null;
  driverProfileId: string;
  role: string | null;
  seat: number | null;
  number: number | null;
  status: string;
};

async function createUser(email: string, name: string): Promise<User> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name, email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: user.id, cookie };
}

async function createDriver(userId: string, name: string): Promise<Driver> {
  const character = await prisma.character.create({
    data: {
      userId,
      name,
      nationality: "Teste",
      birthDate: new Date("1995-05-10"),
    },
  });
  const driverProfile = await prisma.driverProfile.create({
    data: { characterId: character.id },
  });
  return { characterId: character.id, driverProfileId: driverProfile.id };
}

async function createTeam(userId: string, name: string): Promise<Team> {
  const team = await prisma.team.create({
    data: { name, userId },
  });
  return { id: team.id };
}

async function createSeason(year: number): Promise<Season> {
  const season = await prisma.season.create({
    data: { year },
  });
  return { id: season.id };
}

async function setCurrentSeason(seasonId: string | null): Promise<void> {
  await prisma.worldState.upsert({
    where: { key: WORLD_KEY },
    update: { currentSeasonId: seasonId },
    create: { key: WORLD_KEY, currentSeasonId: seasonId },
  });
}

async function readCurrentSeason(): Promise<string | null> {
  const world = await prisma.worldState.findUnique({ where: { key: WORLD_KEY } });
  return world?.currentSeasonId ?? null;
}

async function getEntry(driverProfileId: string, seasonId: string): Promise<Entry | null> {
  return prisma.seasonDriverEntry.findUnique({
    where: { seasonId_driverProfileId: { seasonId, driverProfileId } },
  }) as Promise<Entry | null>;
}

async function getEvents(entryId: string) {
  return prisma.driverEntryEvent.findMany({
    where: { entryId },
    orderBy: { createdAt: "asc" },
  });
}

function expectRosterError(promise: Promise<unknown>, code: string): Promise<void> {
  return expect(promise).rejects.toMatchObject({ name: "RosterError", code });
}

let owner: User;
let intruder: User;
let teamA: Team;
let teamB: Team;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  owner = await createUser(`roster-owner-${Date.now()}@f1nw.test`, "Roster");
  intruder = await createUser(`roster-intr-${Date.now()}@f1nw.test`, "RIntr");
  teamA = await createTeam(owner.id, "Equipe Alfa");
  teamB = await createTeam(owner.id, "Equipe Beta");
});

afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});

describe("RosterService — designação de assentos", () => {
  it("posiciona dois pilotos nos assentos 1 e 2 da equipe", async () => {
    const season = await createSeason(2026);
    const lando = await createDriver(owner.id, "Lando");
    const oscar = await createDriver(owner.id, "Oscar");

    const e1 = await rosterService.assignDriverToSeat(owner.id, {
      seasonId: season.id,
      teamId: teamA.id,
      driverProfileId: lando.driverProfileId,
      seat: 1,
      number: 4,
    });
    const e2 = await rosterService.assignDriverToSeat(owner.id, {
      seasonId: season.id,
      teamId: teamA.id,
      driverProfileId: oscar.driverProfileId,
      seat: 2,
      number: 81,
    });

    expect(e1.role).toBe("RACE_SEAT");
    expect(e1.seat).toBe(1);
    expect(e1.status).toBe("ACTIVE");
    expect(e2.seat).toBe(2);

    const roster = await rosterService.getSeasonRoster(season.id);
    expect(roster).toHaveLength(2);
    expect(roster.map((e) => e.seat).sort()).toEqual([1, 2]);
  });

  it("substituição: Alicya desloca Oscar do assento, Oscar vira agente livre", async () => {
    const season = await createSeason(2026);
    const lando = await createDriver(owner.id, "Lando 2");
    const oscar = await createDriver(owner.id, "Oscar 2");
    const alicya = await createDriver(owner.id, "Alicya");

    await rosterService.assignDriverToSeat(owner.id, {
      seasonId: season.id,
      teamId: teamA.id,
      driverProfileId: lando.driverProfileId,
      seat: 1,
    });
    await rosterService.assignDriverToSeat(owner.id, {
      seasonId: season.id,
      teamId: teamA.id,
      driverProfileId: oscar.driverProfileId,
      seat: 2,
    });

    const alicyaEntry = await rosterService.assignDriverToSeat(owner.id, {
      seasonId: season.id,
      teamId: teamA.id,
      driverProfileId: alicya.driverProfileId,
      seat: 2,
    });

    expect(alicyaEntry.role).toBe("RACE_SEAT");
    expect(alicyaEntry.seat).toBe(2);
    expect(alicyaEntry.status).toBe("ACTIVE");
    expect(alicyaEntry.teamId).toBe(teamA.id);

    const oscarEntry = await getEntry(oscar.driverProfileId, season.id);
    expect(oscarEntry?.status).toBe("AVAILABLE");
    expect(oscarEntry?.teamId).toBeNull();
    expect(oscarEntry?.seat).toBeNull();

    const landoEntry = await getEntry(lando.driverProfileId, season.id);
    expect(landoEntry?.seat).toBe(1);
    expect(landoEntry?.status).toBe("ACTIVE");

    const events = await getEvents(oscarEntry!.id);
    const displaced = events.find((e) => e.kind === "DISPLACED");
    expect(displaced).toBeTruthy();
  });

  it("assento inválido (3) é rejeitado sem alterar o banco", async () => {
    const season = await createSeason(2026);
    const driver = await createDriver(owner.id, "Terciario");

    await expectRosterError(
      rosterService.assignDriverToSeat(owner.id, {
        seasonId: season.id,
        teamId: teamA.id,
        driverProfileId: driver.driverProfileId,
        seat: 3,
      }),
      "INVALID_SEAT",
    );

    const count = await prisma.seasonDriverEntry.count({
      where: { seasonId: season.id, driverProfileId: driver.driverProfileId },
    });
    expect(count).toBe(0);
  });

  it("piloto não pode pertencer a duas equipes na mesma temporada", async () => {
    const season = await createSeason(2026);
    const driver = await createDriver(owner.id, "Bifrentista");

    await rosterService.assignDriverToSeat(owner.id, {
      seasonId: season.id,
      teamId: teamA.id,
      driverProfileId: driver.driverProfileId,
      seat: 1,
    });

    await expectRosterError(
      rosterService.assignDriverToSeat(owner.id, {
        seasonId: season.id,
        teamId: teamB.id,
        driverProfileId: driver.driverProfileId,
        seat: 1,
      }),
      "DRIVER_ALREADY_IN_TEAM",
    );

    const entry = await getEntry(driver.driverProfileId, season.id);
    expect(entry?.teamId).toBe(teamA.id);
  });
});

describe("RosterService — contratação (hire)", () => {
  it("contrata agente livre (AVAILABLE) para um assento", async () => {
    const season = await createSeason(2026);
    const driver = await createDriver(owner.id, "Agente Livre");

    const entry = await rosterService.hireDriver(owner.id, {
      seasonId: season.id,
      teamId: teamA.id,
      driverProfileId: driver.driverProfileId,
      role: "RACE_SEAT",
      seat: 1,
      number: 44,
    });

    expect(entry.status).toBe("ACTIVE");
    expect(entry.role).toBe("RACE_SEAT");
    expect(entry.seat).toBe(1);
    expect(entry.teamId).toBe(teamA.id);
    expect(entry.number).toBe(44);
  });

  it("rejeita contratação de piloto já ativo na temporada", async () => {
    const season = await createSeason(2026);
    const driver = await createDriver(owner.id, "Ativo Contratado");

    await rosterService.assignDriverToSeat(owner.id, {
      seasonId: season.id,
      teamId: teamA.id,
      driverProfileId: driver.driverProfileId,
      seat: 1,
    });

    await expectRosterError(
      rosterService.hireDriver(owner.id, {
        seasonId: season.id,
        teamId: teamB.id,
        driverProfileId: driver.driverProfileId,
        role: "RACE_SEAT",
        seat: 1,
      }),
      "DRIVER_NOT_AVAILABLE",
    );
  });
});

describe("RosterService — reserva e promoção", () => {
  it("designa um reserva (sem assento) para a equipe", async () => {
    const season = await createSeason(2026);
    const driver = await createDriver(owner.id, "Reserva Unica");

    const entry = await rosterService.assignReserve(owner.id, {
      seasonId: season.id,
      teamId: teamA.id,
      driverProfileId: driver.driverProfileId,
    });

    expect(entry.status).toBe("ACTIVE");
    expect(entry.role).toBe("RESERVE");
    expect(entry.seat).toBeNull();
    expect(entry.teamId).toBe(teamA.id);
  });

  it("rejeita um segundo reserva para a mesma equipe", async () => {
    const season = await createSeason(2026);
    const r1 = await createDriver(owner.id, "Reserva Um");
    const r2 = await createDriver(owner.id, "Reserva Dois");

    await rosterService.assignReserve(owner.id, {
      seasonId: season.id,
      teamId: teamA.id,
      driverProfileId: r1.driverProfileId,
    });

    await expectRosterError(
      rosterService.assignReserve(owner.id, {
        seasonId: season.id,
        teamId: teamA.id,
        driverProfileId: r2.driverProfileId,
      }),
      "RESERVE_LIMIT",
    );

    const count = await prisma.seasonDriverEntry.count({
      where: { seasonId: season.id, teamId: teamA.id, role: "RESERVE", status: "ACTIVE" },
    });
    expect(count).toBe(1);
  });

  it("promove reserva para assento vago", async () => {
    const season = await createSeason(2026);
    const reserve = await createDriver(owner.id, "Reserva Promo");

    await rosterService.assignReserve(owner.id, {
      seasonId: season.id,
      teamId: teamA.id,
      driverProfileId: reserve.driverProfileId,
    });

    const promoted = await rosterService.promoteReserve(owner.id, {
      seasonId: season.id,
      teamId: teamA.id,
      driverProfileId: reserve.driverProfileId,
      seat: 1,
    });

    expect(promoted.role).toBe("RACE_SEAT");
    expect(promoted.seat).toBe(1);
    expect(promoted.status).toBe("ACTIVE");

    const events = await getEvents(promoted.id);
    expect(events.some((e) => e.kind === "PROMOTED")).toBe(true);
  });

  it("rejeita promoção para assento ocupado", async () => {
    const season = await createSeason(2026);
    const titulares = await createDriver(owner.id, "Titular Promo");
    const reserve = await createDriver(owner.id, "Reserva Ocupada");

    await rosterService.assignDriverToSeat(owner.id, {
      seasonId: season.id,
      teamId: teamA.id,
      driverProfileId: titulares.driverProfileId,
      seat: 1,
    });
    await rosterService.assignReserve(owner.id, {
      seasonId: season.id,
      teamId: teamA.id,
      driverProfileId: reserve.driverProfileId,
    });

    await expectRosterError(
      rosterService.promoteReserve(owner.id, {
        seasonId: season.id,
        teamId: teamA.id,
        driverProfileId: reserve.driverProfileId,
        seat: 1,
      }),
      "SEAT_OCCUPIED",
    );
  });
});

describe("RosterService — histórico e independência", () => {
  it("registra eventos encadeados na vida do vínculo", async () => {
    const season = await createSeason(2026);
    const driver = await createDriver(owner.id, "Historico Vivo");

    const created = await rosterService.assignDriverToSeat(owner.id, {
      seasonId: season.id,
      teamId: teamA.id,
      driverProfileId: driver.driverProfileId,
      seat: 1,
    });
    const released = await rosterService.releaseDriver(owner.id, {
      seasonId: season.id,
      teamId: teamA.id,
      driverProfileId: driver.driverProfileId,
    });
    const hired = await rosterService.hireDriver(owner.id, {
      seasonId: season.id,
      teamId: teamA.id,
      driverProfileId: driver.driverProfileId,
      role: "RACE_SEAT",
      seat: 1,
    });

    const events = (await getEvents(created.id)).map((e) => e.kind);
    expect(events).toEqual(["CREATED", "RELEASED", "HIRED"]);
    expect(released.status).toBe("AVAILABLE");
    expect(hired.status).toBe("ACTIVE");
  });

  it("temporadas são independentes para o mesmo piloto e equipe", async () => {
    const s1 = await createSeason(2025);
    const s2 = await createSeason(2026);
    const driver = await createDriver(owner.id, "Multitemporal");

    await rosterService.assignDriverToSeat(owner.id, {
      seasonId: s1.id,
      teamId: teamA.id,
      driverProfileId: driver.driverProfileId,
      seat: 1,
    });
    await rosterService.assignDriverToSeat(owner.id, {
      seasonId: s2.id,
      teamId: teamA.id,
      driverProfileId: driver.driverProfileId,
      seat: 2,
    });

    await rosterService.releaseDriver(owner.id, {
      seasonId: s2.id,
      teamId: teamA.id,
      driverProfileId: driver.driverProfileId,
    });

    const e1 = await getEntry(driver.driverProfileId, s1.id);
    const e2 = await getEntry(driver.driverProfileId, s2.id);
    expect(e1?.status).toBe("ACTIVE");
    expect(e1?.seat).toBe(1);
    expect(e2?.status).toBe("AVAILABLE");
  });
});

describe("RosterService — cache teamId e atomicidade", () => {
  it("sincroniza o cache DriverProfile.teamId a partir da temporada corrente", async () => {
    const season = await createSeason(2026);
    const other = await createSeason(2027);
    const driver = await createDriver(owner.id, "Cacheado");
    const originalSeason = await readCurrentSeason();

    await setCurrentSeason(season.id);
    await rosterService.assignDriverToSeat(owner.id, {
      seasonId: season.id,
      teamId: teamA.id,
      driverProfileId: driver.driverProfileId,
      seat: 1,
    });

    let cached = await prisma.driverProfile.findUnique({
      where: { id: driver.driverProfileId },
      select: { teamId: true },
    });
    expect(cached?.teamId).toBe(teamA.id);

    await setCurrentSeason(other.id);
    await rosterService.releaseDriver(owner.id, {
      seasonId: season.id,
      teamId: teamA.id,
      driverProfileId: driver.driverProfileId,
    });

    // O cache deriva da temporada CORRENTE (2027): sem entrada em 2027, null.
    cached = await prisma.driverProfile.findUnique({
      where: { id: driver.driverProfileId },
      select: { teamId: true },
    });
    expect(cached?.teamId).toBeNull();

    await setCurrentSeason(originalSeason);
  });

  it("rollback transacional: corrida no mesmo assento deixa exatamente um vínculo", async () => {
    const season = await createSeason(2026);
    const driver = await createDriver(owner.id, "Concorrente");
    const originalSeason = await readCurrentSeason();

    await setCurrentSeason(season.id);

    const results = await Promise.allSettled([
      rosterService.assignDriverToSeat(owner.id, {
        seasonId: season.id,
        teamId: teamA.id,
        driverProfileId: driver.driverProfileId,
        seat: 1,
      }),
      rosterService.assignDriverToSeat(owner.id, {
        seasonId: season.id,
        teamId: teamB.id,
        driverProfileId: driver.driverProfileId,
        seat: 1,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const winnerTeamId = (
      fulfilled[0] as { status: "fulfilled"; value: { teamId: string } }
    ).value.teamId;
    const loserError = (
      rejected[0] as { status: "rejected"; reason: unknown }
    ).reason;
    const loserIsConflict =
      loserError instanceof RosterError ||
      (loserError instanceof Error &&
        "code" in loserError &&
        (loserError as { code?: string | number }).code === "P2002");

    const entries = await prisma.seasonDriverEntry.count({
      where: { seasonId: season.id, driverProfileId: driver.driverProfileId },
    });
    const events = await prisma.driverEntryEvent.count({
      where: { entry: { seasonId: season.id, driverProfileId: driver.driverProfileId } },
    });

    expect(entries).toBe(1);
    expect(events).toBe(1);
    const cached = await prisma.driverProfile.findUnique({
      where: { id: driver.driverProfileId },
      select: { teamId: true },
    });
    expect(cached?.teamId).toBe(winnerTeamId);
    expect(loserIsConflict).toBe(true);

    await setCurrentSeason(originalSeason);
  });
});

describe("RosterService — regressões (fontes únicas de verdade)", () => {
  it("transferência entre temporadas: cache reflete a equipe da temporada corrente", async () => {
    const season2026 = await createSeason(2026);
    const season2027 = await createSeason(2027);
    const lando = await createDriver(owner.id, "Lando Transfere");
    const originalSeason = await readCurrentSeason();

    await setCurrentSeason(season2026.id);
    await rosterService.assignDriverToSeat(owner.id, {
      seasonId: season2026.id,
      teamId: teamA.id,
      driverProfileId: lando.driverProfileId,
      seat: 1,
    });

    let cached = await prisma.driverProfile.findUnique({
      where: { id: lando.driverProfileId },
      select: { teamId: true },
    });
    expect(cached?.teamId).toBe(teamA.id);

    // Designa em 2027 (Ferrari/teamB) mesmo com a corrente ainda sendo 2026,
    // e depois troca o WorldState para 2027 via API (dispara resync).
    await rosterService.assignDriverToSeat(owner.id, {
      seasonId: season2027.id,
      teamId: teamB.id,
      driverProfileId: lando.driverProfileId,
      seat: 1,
    });

    const patch = await app.inject({
      method: "PATCH",
      url: "/api/world",
      headers: { cookie: owner.cookie },
      payload: { currentSeasonId: season2027.id },
    });
    expect(patch.statusCode).toBe(200);

    cached = await prisma.driverProfile.findUnique({
      where: { id: lando.driverProfileId },
      select: { teamId: true },
    });
    expect(cached?.teamId).toBe(teamB.id);

    const e2026 = await getEntry(lando.driverProfileId, season2026.id);
    const e2027 = await getEntry(lando.driverProfileId, season2027.id);
    expect(e2026?.teamId).toBe(teamA.id);
    expect(e2027?.teamId).toBe(teamB.id);

    await setCurrentSeason(originalSeason);
  });

  it("substituição de assento: deslocado vira AVAILABLE com teamId null e histórico preservado", async () => {
    const season = await createSeason(2026);
    const oscar = await createDriver(owner.id, "Oscar Desloc");
    const alicya = await createDriver(owner.id, "Alicya Entra");
    const originalSeason = await readCurrentSeason();

    await setCurrentSeason(season.id);
    const oscarEntry = await rosterService.assignDriverToSeat(owner.id, {
      seasonId: season.id,
      teamId: teamA.id,
      driverProfileId: oscar.driverProfileId,
      seat: 2,
    });
    await rosterService.assignDriverToSeat(owner.id, {
      seasonId: season.id,
      teamId: teamA.id,
      driverProfileId: alicya.driverProfileId,
      seat: 2,
    });

    const oscarNow = await getEntry(oscar.driverProfileId, season.id);
    expect(oscarNow?.status).toBe("AVAILABLE");
    expect(oscarNow?.teamId).toBeNull();
    expect(oscarNow?.seat).toBeNull();

    const cached = await prisma.driverProfile.findUnique({
      where: { id: oscar.driverProfileId },
      select: { teamId: true },
    });
    expect(cached?.teamId).toBeNull();

    const oscarEvents = (await getEvents(oscarEntry.id)).map((e) => e.kind);
    expect(oscarEvents).toEqual(["CREATED", "DISPLACED"]);

    await setCurrentSeason(originalSeason);
  });

  it("reserva ACTIVE com equipe mantém teamId (cache)", async () => {
    const season = await createSeason(2026);
    const reserve = await createDriver(owner.id, "Reserva Cache");
    const originalSeason = await readCurrentSeason();

    await setCurrentSeason(season.id);
    await rosterService.hireDriver(owner.id, {
      seasonId: season.id,
      teamId: teamA.id,
      driverProfileId: reserve.driverProfileId,
      role: "RESERVE",
    });

    const cached = await prisma.driverProfile.findUnique({
      where: { id: reserve.driverProfileId },
      select: { teamId: true },
    });
    expect(cached?.teamId).toBe(teamA.id);

    await setCurrentSeason(originalSeason);
  });
});

describe("Roster routes", () => {
  it("GET /api/roster/seasons/:id exige sessão", async () => {
    const season = await createSeason(2026);
    const res = await app.inject({
      method: "GET",
      url: `/api/roster/seasons/${season.id}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/roster/seasons/:id lista escalação", async () => {
    const season = await createSeason(2026);
    const driver = await createDriver(owner.id, "Rota Listada");
    await rosterService.assignDriverToSeat(owner.id, {
      seasonId: season.id,
      teamId: teamA.id,
      driverProfileId: driver.driverProfileId,
      seat: 1,
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/roster/seasons/${season.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const entries = res.json().entries as { role: string; seat: number }[];
    expect(entries).toHaveLength(1);
    expect(entries[0].role).toBe("RACE_SEAT");
    expect(entries[0].seat).toBe(1);
  });

  it("POST /api/roster/assign com equipe de outro usuário → 404", async () => {
    const season = await createSeason(2026);
    const strangerTeam = await createTeam(intruder.id, "Equipe Alheia");
    const driver = await createDriver(owner.id, "Rota Alheia");

    const res = await app.inject({
      method: "POST",
      url: "/api/roster/assign",
      headers: { cookie: owner.cookie },
      payload: {
        seasonId: season.id,
        teamId: strangerTeam.id,
        driverProfileId: driver.driverProfileId,
        seat: 1,
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("TEAM_NOT_FOUND");
  });

  it("POST /api/roster/hire titular sem assento → 400", async () => {
    const season = await createSeason(2026);
    const driver = await createDriver(owner.id, "Rota Sem Assento");

    const res = await app.inject({
      method: "POST",
      url: "/api/roster/hire",
      headers: { cookie: owner.cookie },
      payload: {
        seasonId: season.id,
        teamId: teamA.id,
        driverProfileId: driver.driverProfileId,
        role: "RACE_SEAT",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("GET /api/roster/seasons/:id/available lista pilotos livres do usuário", async () => {
    const season = await createSeason(2026);
    const free = await createDriver(owner.id, "Rota Livre");
    const taken = await createDriver(owner.id, "Rota Tomada");
    await rosterService.assignDriverToSeat(owner.id, {
      seasonId: season.id,
      teamId: teamA.id,
      driverProfileId: taken.driverProfileId,
      seat: 1,
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/roster/seasons/${season.id}/available`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const drivers = res.json().drivers as { driver: { id: string }; entry: unknown }[];
    const names = drivers.map((d) => d.driver.id);
    expect(names).toContain(free.driverProfileId);
    expect(names).toContain(taken.driverProfileId);
    const takenRow = drivers.find((d) => d.driver.id === taken.driverProfileId);
    expect(takenRow?.entry).toBeTruthy();
    const freeRow = drivers.find((d) => d.driver.id === free.driverProfileId);
    expect(freeRow?.entry).toBeNull();
  });
});