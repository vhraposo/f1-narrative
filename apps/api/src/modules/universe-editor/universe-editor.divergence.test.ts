import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { JOLPICA_SOURCE } from "../external-sync/jolpica.service.js";

const YEAR = 2026;

type User = { id: string; cookie: string };

async function createUser(email: string, name: string): Promise<User> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name, email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: stored.id, cookie };
}

type Fixture = {
  ids: {
    seasonId: string;
    teamId: string;
    driverLandoId: string;
    driverOscarId: string;
    driverZeId: string;
    entryLandoId: string;
    entryOscarId: string;
    dsOscarId: string;
    extSeasonId: string;
    extTeamId: string;
    extTeamExternalId: string;
  };
  cleanup: () => Promise<void>;
};

async function seedMirror(userId: string): Promise<Fixture> {
  const runId = Math.random().toString(36).slice(2, 8);

  const season = await prisma.season.create({
    data: { year: YEAR, name: String(YEAR), status: "PRE_SEASON" },
  });
  const team = await prisma.team.create({
    data: { name: `McLaren ${runId}`, shortName: "MCL", color: "#ff8000", userId },
  });
  const characterLando = await prisma.character.create({
    data: { name: "Lando Norris", nationality: "British", birthDate: new Date("1999-11-13"), userId },
  });
  const characterOscar = await prisma.character.create({
    data: { name: "Oscar Piastri", nationality: "Australian", birthDate: new Date("2001-04-06"), userId },
  });
  const characterZe = await prisma.character.create({
    data: { name: "Zé da Silva", nationality: "Brasileira", birthDate: new Date("2002-06-14"), userId },
  });
  const driverLando = await prisma.driverProfile.create({
    data: { characterId: characterLando.id, number: 1, teamId: team.id },
  });
  const driverOscar = await prisma.driverProfile.create({
    data: { characterId: characterOscar.id, number: 81, teamId: team.id },
  });
  const driverZe = await prisma.driverProfile.create({
    data: { characterId: characterZe.id, number: 44 },
  });
  const entryLando = await prisma.seasonDriverEntry.create({
    data: {
      seasonId: season.id,
      driverProfileId: driverLando.id,
      teamId: team.id,
      role: "RACE_SEAT",
      seat: 1,
      number: 1,
      status: "ACTIVE",
      provenance: "IMPORTED",
    },
  });
  const entryOscar = await prisma.seasonDriverEntry.create({
    data: {
      seasonId: season.id,
      driverProfileId: driverOscar.id,
      teamId: team.id,
      role: "RACE_SEAT",
      seat: 2,
      number: 81,
      status: "ACTIVE",
      provenance: "IMPORTED",
    },
  });

  const extSeasonShared = await prisma.externalSeason.findUnique({
    where: { source_year: { source: JOLPICA_SOURCE, year: YEAR } },
    select: { id: true },
  });
  let extSeasonCreated = false;
  const extSeason = extSeasonShared
    ? extSeasonShared
    : await prisma.externalSeason.create({
        data: { source: JOLPICA_SOURCE, year: YEAR, name: String(YEAR), status: "ACTIVE", contentHash: `uev-ext-season-${runId}` },
      });
  if (!extSeasonShared) extSeasonCreated = true;

  const extTeam = await prisma.externalTeam.create({
    data: { source: JOLPICA_SOURCE, externalId: `mclaren-uev-${runId}`, name: "McLaren", shortName: "MCL", color: "#ff8000", contentHash: "uev-ext-team" },
  });
  const extLando = await prisma.externalDriver.create({
    data: { source: JOLPICA_SOURCE, externalId: `lando-uev-${runId}`, name: "Lando Norris", fullName: "Lando Norris", nationality: "British", number: 1, contentHash: "uev-ext-lando" },
  });
  const extOscar = await prisma.externalDriver.create({
    data: { source: JOLPICA_SOURCE, externalId: `oscar-uev-${runId}`, name: "Oscar Piastri", fullName: "Oscar Piastri", nationality: "Australian", number: 81, contentHash: "uev-ext-oscar" },
  });

  const dsLando = await prisma.externalDriverSeason.create({
    data: { source: JOLPICA_SOURCE, externalDriverId: extLando.id, seasonYear: YEAR, teamExternalId: extTeam.externalId, teamNameSnapshot: "McLaren", number: 1, role: null, contentHash: "uev-ds-lando" },
  });
  const dsOscar = await prisma.externalDriverSeason.create({
    data: { source: JOLPICA_SOURCE, externalDriverId: extOscar.id, seasonYear: YEAR, teamExternalId: extTeam.externalId, teamNameSnapshot: "McLaren", number: 81, role: null, contentHash: "uev-ds-oscar" },
  });

  await prisma.externalBindingSeason.create({
    data: { externalSeasonId: extSeason.id, seasonId: season.id, confidence: "CONFIRMED", boundBy: "ADMIN" },
  });
  await prisma.externalBindingTeam.create({
    data: { externalTeamId: extTeam.id, teamId: team.id, confidence: "CONFIRMED", boundBy: "ADMIN" },
  });
  await prisma.externalBindingDriver.create({
    data: { externalDriverId: extLando.id, characterId: characterLando.id, confidence: "CONFIRMED", boundBy: "ADMIN" },
  });
  await prisma.externalBindingDriver.create({
    data: { externalDriverId: extOscar.id, characterId: characterOscar.id, confidence: "CONFIRMED", boundBy: "ADMIN" },
  });
  await prisma.externalBindingDriverSeason.create({
    data: { externalDriverSeasonId: dsLando.id, seasonDriverEntryId: entryLando.id, confidence: "CONFIRMED", boundBy: "ADMIN" },
  });
  await prisma.externalBindingDriverSeason.create({
    data: { externalDriverSeasonId: dsOscar.id, seasonDriverEntryId: entryOscar.id, confidence: "CONFIRMED", boundBy: "ADMIN" },
  });

  const cleanup = async () => {
    await prisma.externalBindingSeason.deleteMany({
      where: { externalSeasonId: extSeason.id, seasonId: season.id },
    });
    await prisma.externalBindingTeam.deleteMany({ where: { teamId: team.id } });
    await prisma.seasonDriverEntry.deleteMany({ where: { seasonId: season.id } });
    await prisma.driverProfile.deleteMany({ where: { character: { userId } } });
    await prisma.character.deleteMany({ where: { userId } });
    await prisma.team.deleteMany({ where: { userId } });
    await prisma.season.deleteMany({ where: { id: season.id } });
    await prisma.externalBindingDriverSeason.deleteMany({
      where: { id: { in: [dsLando.id, dsOscar.id] } },
    });
    await prisma.externalDriverSeason.deleteMany({
      where: { id: { in: [dsLando.id, dsOscar.id] } },
    });
    await prisma.externalDriver.deleteMany({
      where: { id: { in: [extLando.id, extOscar.id] } },
    });
    await prisma.externalTeam.deleteMany({ where: { id: extTeam.id } });
    if (extSeasonCreated) {
      await prisma.externalSeason.deleteMany({ where: { id: extSeason.id } });
    }
  };

  return {
    ids: {
      seasonId: season.id,
      teamId: team.id,
      driverLandoId: driverLando.id,
      driverOscarId: driverOscar.id,
      driverZeId: driverZe.id,
      entryLandoId: entryLando.id,
      entryOscarId: entryOscar.id,
      dsOscarId: dsOscar.id,
      extSeasonId: extSeason.id,
      extTeamId: extTeam.id,
      extTeamExternalId: extTeam.externalId,
    },
    cleanup,
  };
}

let app: FastifyInstance;
let user: User;
const activeCleanups: Array<() => Promise<void>> = [];

async function getComparison(actor: User, seasonId: string) {
  return app.inject({
    method: "GET",
    url: `/api/universe/roster-comparison/${seasonId}`,
    headers: { cookie: actor.cookie },
  });
}

async function postPlayerEntry(actor: User, input: {
  seasonId: string;
  teamId: string;
  seat: number;
  name: string;
}) {
  return app.inject({
    method: "POST",
    url: "/api/universe/player-entry",
    headers: { cookie: actor.cookie },
    payload: {
      seasonId: input.seasonId,
      teamId: input.teamId,
      seat: input.seat,
      name: input.name,
      nationality: "Brasileira",
      birthDate: "2002-06-14",
    },
  });
}

async function postAssign(actor: User, input: {
  seasonId: string;
  teamId: string;
  driverProfileId: string;
  seat: number;
}) {
  return app.inject({
    method: "POST",
    url: "/api/roster/assign",
    headers: { cookie: actor.cookie },
    payload: { ...input, number: 44 },
  });
}

async function postRelease(actor: User, input: {
  seasonId: string;
  teamId: string;
  driverProfileId: string;
}) {
  return app.inject({
    method: "POST",
    url: "/api/roster/release",
    headers: { cookie: actor.cookie },
    payload: input,
  });
}

async function postHire(actor: User, input: {
  seasonId: string;
  teamId: string;
  driverProfileId: string;
  seat: number;
}) {
  return app.inject({
    method: "POST",
    url: "/api/roster/hire",
    headers: { cookie: actor.cookie },
    payload: { ...input, role: "RACE_SEAT", number: 44 },
  });
}

async function getEvents(entryId: string) {
  return prisma.driverEntryEvent.findMany({
    where: { entryId },
    orderBy: { createdAt: "asc" },
  });
}

async function divergentSeat2(seasonId: string) {
  const res = await getComparison(user, seasonId);
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.teams).toHaveLength(1);
  const team = body.teams[0];
  const seat2 = team.seats.find((s: { seat: number }) => s.seat === 2);
  expect(seat2).toBeTruthy();
  return seat2;
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  user = await createUser(`uev-user-${Date.now()}@f1nw.test`, "UEV User");
});

afterEach(async () => {
  for (const cleanup of activeCleanups.splice(0)) {
    await cleanup();
  }
});

afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});

describe("Universe Editor — Player Entry gera o histórico esperado", () => {
  it("Player Entry produz eventos CREATED + DISPLACED", async () => {
    const fixture = await seedMirror(user.id);
    activeCleanups.push(fixture.cleanup);

    const res = await postPlayerEntry(user, {
      seasonId: fixture.ids.seasonId,
      teamId: fixture.ids.teamId,
      seat: 2,
      name: "Alicya Teste",
    });
    expect(res.statusCode).toBe(201);
    const { entry, displaced } = res.json();
    expect(entry.provenance).toBe("CANONICAL");
    expect(displaced).toBeTruthy();

    const entryEvents = await getEvents(entry.id);
    expect(entryEvents.some((e) => e.kind === "CREATED")).toBe(true);

    const oscarEvents = await getEvents(fixture.ids.entryOscarId);
    expect(oscarEvents.some((e) => e.kind === "DISPLACED")).toBe(true);
  });
});

describe("Universe Editor — histórico de divergência na comparação", () => {
  it("a divergência do roster consegue identificar a origem histórica", async () => {
    const fixture = await seedMirror(user.id);
    activeCleanups.push(fixture.cleanup);

    const res = await postPlayerEntry(user, {
      seasonId: fixture.ids.seasonId,
      teamId: fixture.ids.teamId,
      seat: 2,
      name: "Alicya Histórica",
    });
    const { entry } = res.json();

    const createdEvent = (await getEvents(entry.id)).find((e) => e.kind === "CREATED");
    expect(createdEvent).toBeTruthy();

    const seat2 = await divergentSeat2(fixture.ids.seasonId);
    expect(seat2.status).toBe("DIVERGENCE");
    expect(seat2.divergence).not.toBeNull();
    expect(seat2.divergence.kind).toBe("CREATED");
    expect(seat2.divergence.eventId).toBe(createdEvent!.id);
    expect(seat2.divergence.occurredAt).toBe(createdEvent!.createdAt.toISOString());
    expect(seat2.divergence.summary).toContain("inserido");
    expect(seat2.divergence.readOnly).toBe(true);
    expect(seat2.divergence.origin).toBeNull();
  });

  it("contratação via roster é atribuída como ROSTER_HIRE", async () => {
    const fixture = await seedMirror(user.id);
    activeCleanups.push(fixture.cleanup);

    await postAssign(user, {
      seasonId: fixture.ids.seasonId,
      teamId: fixture.ids.teamId,
      driverProfileId: fixture.ids.driverZeId,
      seat: 2,
    });
    await postRelease(user, {
      seasonId: fixture.ids.seasonId,
      teamId: fixture.ids.teamId,
      driverProfileId: fixture.ids.driverZeId,
    });
    const hireRes = await postHire(user, {
      seasonId: fixture.ids.seasonId,
      teamId: fixture.ids.teamId,
      driverProfileId: fixture.ids.driverZeId,
      seat: 2,
    });
    expect(hireRes.statusCode).toBe(200);

    const seat2 = await divergentSeat2(fixture.ids.seasonId);
    expect(seat2.status).toBe("DIVERGENCE");
    expect(seat2.divergence).not.toBeNull();
    expect(seat2.divergence.kind).toBe("HIRED");
    expect(seat2.divergence.origin).toBe("ROSTER_HIRE");
  });

  it("entrada importada na inicialização é atribuída como INITIALIZATION", async () => {
    const fixture = await seedMirror(user.id);
    activeCleanups.push(fixture.cleanup);

    await postRelease(user, {
      seasonId: fixture.ids.seasonId,
      teamId: fixture.ids.teamId,
      driverProfileId: fixture.ids.driverOscarId,
    });

    const entryZe = await prisma.seasonDriverEntry.create({
      data: {
        seasonId: fixture.ids.seasonId,
        driverProfileId: fixture.ids.driverZeId,
        teamId: fixture.ids.teamId,
        role: "RACE_SEAT",
        seat: 2,
        number: 44,
        status: "ACTIVE",
        provenance: "IMPORTED",
      },
    });
    await prisma.driverEntryEvent.create({
      data: {
        entryId: entryZe.id,
        kind: "CREATED",
        from: Prisma.JsonNull,
        to: {
          teamId: fixture.ids.teamId,
          role: "RACE_SEAT",
          seat: 2,
          number: 44,
          status: "ACTIVE",
        },
        reason: "Initialization do universo a partir do External Season",
      },
    });

    const seat2 = await divergentSeat2(fixture.ids.seasonId);
    expect(seat2.status).toBe("DIVERGENCE");
    expect(seat2.divergence).not.toBeNull();
    expect(seat2.divergence.kind).toBe("CREATED");
    expect(seat2.divergence.origin).toBe("INITIALIZATION");
  });

  it("MATCH não apresenta divergência histórica falsa", async () => {
    const fixture = await seedMirror(user.id);
    activeCleanups.push(fixture.cleanup);

    const res = await getComparison(user, fixture.ids.seasonId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const team = body.teams[0];
    expect(team.status).toBe("MATCH");
    for (const seat of team.seats) {
      expect(seat.status).toBe("MATCH");
      expect(seat.divergence).toBeNull();
    }
  });

  it("SOURCE_ONLY sem evento não inventa uma origem", async () => {
    const fixture = await seedMirror(user.id);
    activeCleanups.push(fixture.cleanup);

    await postRelease(user, {
      seasonId: fixture.ids.seasonId,
      teamId: fixture.ids.teamId,
      driverProfileId: fixture.ids.driverOscarId,
    });

    const seat2 = await divergentSeat2(fixture.ids.seasonId);
    expect(seat2.status).toBe("SOURCE_ONLY");
    expect(seat2.divergence).toBeNull();
  });

  it("UNIVERSE_ONLY sem evento não inventa uma origem", async () => {
    const fixture = await seedMirror(user.id);
    activeCleanups.push(fixture.cleanup);

    await prisma.externalBindingDriverSeason.deleteMany({
      where: { externalDriverSeasonId: fixture.ids.dsOscarId },
    });
    await prisma.externalDriverSeason.deleteMany({
      where: { id: fixture.ids.dsOscarId },
    });

    const seat2 = await divergentSeat2(fixture.ids.seasonId);
    expect(seat2.status).toBe("UNIVERSE_ONLY");
    expect(seat2.divergence).toBeNull();
  });

  it("múltiplos eventos resolvem para o mais recente sem relação ambígua", async () => {
    const fixture = await seedMirror(user.id);
    activeCleanups.push(fixture.cleanup);

    const res = await postPlayerEntry(user, {
      seasonId: fixture.ids.seasonId,
      teamId: fixture.ids.teamId,
      seat: 2,
      name: "Alicya Dupla",
    });
    const { entry } = res.json();

    await postAssign(user, {
      seasonId: fixture.ids.seasonId,
      teamId: fixture.ids.teamId,
      driverProfileId: entry.driverProfileId,
      seat: 2,
    });

    const seat2 = await divergentSeat2(fixture.ids.seasonId);
    expect(seat2.status).toBe("DIVERGENCE");
    expect(seat2.divergence).not.toBeNull();
    expect(seat2.divergence.kind).toBe("SEATED");
    expect(seat2.divergence.origin).toBeNull();

    const team = (await (await getComparison(user, fixture.ids.seasonId)).json()).teams[0];
    expect(team.seats.filter((s: { divergence: unknown }) => s.divergence != null)).toHaveLength(1);
  });

  it("o evento permanece histórico: leitura não muta o roster nem cria eventos", async () => {
    const fixture = await seedMirror(user.id);
    activeCleanups.push(fixture.cleanup);

    const res = await postPlayerEntry(user, {
      seasonId: fixture.ids.seasonId,
      teamId: fixture.ids.teamId,
      seat: 2,
      name: "Alicya Estável",
    });
    const { entry } = res.json();

    const eventsBefore = await prisma.driverEntryEvent.count();
    const rosterBefore = await prisma.seasonDriverEntry.findMany({
      where: { seasonId: fixture.ids.seasonId },
      orderBy: { createdAt: "asc" },
    });

    const seat2 = await divergentSeat2(fixture.ids.seasonId);
    expect(seat2.divergence).not.toBeNull();
    expect(seat2.universe.entryId).toBe(entry.id);

    const eventsAfter = await prisma.driverEntryEvent.count();
    expect(eventsAfter).toBe(eventsBefore);

    const rosterAfter = await prisma.seasonDriverEntry.findMany({
      where: { seasonId: fixture.ids.seasonId },
      orderBy: { createdAt: "asc" },
    });
    expect(rosterAfter).toEqual(rosterBefore);
  });

  it("leitura de divergência não altera registros External*", async () => {
    const fixture = await seedMirror(user.id);
    activeCleanups.push(fixture.cleanup);

    await postPlayerEntry(user, {
      seasonId: fixture.ids.seasonId,
      teamId: fixture.ids.teamId,
      seat: 2,
      name: "Alicya Ext",
    });

    const snapshots = [
      () => prisma.externalDriver.count(),
      () => prisma.externalDriverSeason.count(),
      () => prisma.externalTeam.count(),
      () => prisma.externalSeason.count(),
      () => prisma.externalBindingDriverSeason.count(),
    ];
    const before = await Promise.all(snapshots.map((fn) => fn()));

    await divergentSeat2(fixture.ids.seasonId);

    const after = await Promise.all(snapshots.map((fn) => fn()));
    expect(after).toEqual(before);
  });

  it("leitura da comparação continua funcionando (sessão, 200 e 404)", async () => {
    const fixture = await seedMirror(user.id);
    activeCleanups.push(fixture.cleanup);

    const anon = await app.inject({
      method: "GET",
      url: `/api/universe/roster-comparison/${fixture.ids.seasonId}`,
    });
    expect(anon.statusCode).toBe(401);

    const res = await getComparison(user, fixture.ids.seasonId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.comparable).toBe(true);
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0].seats).toHaveLength(2);

    const missing = await getComparison(user, "00000000-0000-4000-8000-000000000000");
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe("SEASON_NOT_FOUND");
  });
});