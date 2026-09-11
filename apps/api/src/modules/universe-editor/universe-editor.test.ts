import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
    extTeamExternalId: string;
    driverLandoId: string;
    driverOscarId: string;
    driverZeId: string;
    entryLandoId: string;
    entryOscarId: string;
    dsLandoId: string;
    dsOscarId: string;
  };
  cleanup: () => Promise<void>;
};

async function seedUniverse2026(userId: string): Promise<Fixture> {
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
        data: { source: JOLPICA_SOURCE, year: YEAR, name: String(YEAR), status: "ACTIVE", contentHash: `ue-ext-season-${runId}` },
      });
  if (!extSeasonShared) extSeasonCreated = true;

  const extTeam = await prisma.externalTeam.create({
    data: { source: JOLPICA_SOURCE, externalId: `mclaren-ue-${runId}`, name: "McLaren", shortName: "MCL", color: "#ff8000", contentHash: "ue-ext-team" },
  });
  const extLando = await prisma.externalDriver.create({
    data: { source: JOLPICA_SOURCE, externalId: `lando-ue-${runId}`, name: "Lando Norris", fullName: "Lando Norris", nationality: "British", number: 1, contentHash: "ue-ext-lando" },
  });
  const extOscar = await prisma.externalDriver.create({
    data: { source: JOLPICA_SOURCE, externalId: `oscar-ue-${runId}`, name: "Oscar Piastri", fullName: "Oscar Piastri", nationality: "Australian", number: 81, contentHash: "ue-ext-oscar" },
  });

  const dsLando = await prisma.externalDriverSeason.create({
    data: { source: JOLPICA_SOURCE, externalDriverId: extLando.id, seasonYear: YEAR, teamExternalId: extTeam.externalId, teamNameSnapshot: "McLaren", number: 1, role: null, contentHash: "ue-ds-lando" },
  });
  const dsOscar = await prisma.externalDriverSeason.create({
    data: { source: JOLPICA_SOURCE, externalDriverId: extOscar.id, seasonYear: YEAR, teamExternalId: extTeam.externalId, teamNameSnapshot: "McLaren", number: 81, role: null, contentHash: "ue-ds-oscar" },
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
      where: { id: { in: [] } },
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
      extTeamExternalId: extTeam.externalId,
      driverLandoId: driverLando.id,
      driverOscarId: driverOscar.id,
      driverZeId: driverZe.id,
      entryLandoId: entryLando.id,
      entryOscarId: entryOscar.id,
      dsLandoId: dsLando.id,
      dsOscarId: dsOscar.id,
    },
    cleanup,
  };
}

let app: FastifyInstance;
let user: User;
let intruder: User;
const activeCleanups: Array<() => Promise<void>> = [];

async function getComparison(actor: User, seasonId: string) {
  return app.inject({
    method: "GET",
    url: `/api/universe/roster-comparison/${seasonId}`,
    headers: { cookie: actor.cookie },
  });
}

async function postKeepUniverse(actor: User, seasonId: string, teamId: string) {
  return app.inject({
    method: "POST",
    url: `/api/universe/roster-comparison/${seasonId}/keep-universe`,
    headers: { cookie: actor.cookie },
    payload: { teamId },
  });
}

async function postRestoreSource(actor: User, seasonId: string, teamId: string) {
  return app.inject({
    method: "POST",
    url: `/api/universe/roster-comparison/${seasonId}/restore-source`,
    headers: { cookie: actor.cookie },
    payload: { teamId },
  });
}

async function assertSeat(seat: any, expected: {
  status: string;
  canRestore?: boolean;
  sourceName?: string | null;
  universeName?: string | null;
}) {
  expect(seat.status).toBe(expected.status);
  if (expected.canRestore !== undefined) expect(seat.canRestore).toBe(expected.canRestore);
  if (expected.sourceName !== undefined) {
    expect(seat.source?.name ?? null).toBe(expected.sourceName);
  }
  if (expected.universeName !== undefined) {
    expect(seat.universe?.characterName ?? null).toBe(expected.universeName);
  }
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  user = await createUser(`ue-user-${Date.now()}@f1nw.test`, "UE User");
  intruder = await createUser(`ue-intr-${Date.now()}@f1nw.test`, "UE Intruder");
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

describe("Universe Editor API — comparação (SOURCE vs UNIVERSE)", () => {
  it("GET /api/universe/roster-comparison/:seasonId exige sessão", async () => {
    const fixture = await seedUniverse2026(user.id);
    activeCleanups.push(fixture.cleanup);
    const res = await getComparison({ cookie: "" } as User, fixture.ids.seasonId);
    expect(res.statusCode).toBe(401);
  });

  it("GET comparação devolve temporada não vinculada com comparable=false", async () => {
    const season = await prisma.season.create({ data: { year: YEAR } });
    activeCleanups.push(async () => {
      await prisma.season.delete({ where: { id: season.id } });
    });
    const res = await getComparison(user, season.id);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.comparable).toBe(false);
    expect(body.teams).toEqual([]);
    expect(body.season.year).toBe(YEAR);
  });

  it("GET comparação devolve 404 para temporada inexistente", async () => {
    const res = await getComparison(
      user,
      "00000000-0000-4000-8000-000000000000",
    );
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("SEASON_NOT_FOUND");
  });

  it("GET comparação devolve MATCH completo quando universo espelha a fonte", async () => {
    const fixture = await seedUniverse2026(user.id);
    activeCleanups.push(fixture.cleanup);
    const res = await getComparison(user, fixture.ids.seasonId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.comparable).toBe(true);
    expect(body.teams).toHaveLength(1);
    const team = body.teams[0];
    expect(team.externalTeamId).toBe(fixture.ids.extTeamExternalId);
    expect(team.status).toBe("MATCH");
    expect(team.seats).toHaveLength(2);

    await assertSeat(team.seats[0], {
      status: "MATCH",
      canRestore: true,
      sourceName: "Lando Norris",
      universeName: "Lando Norris",
    });
    await assertSeat(team.seats[1], {
      status: "MATCH",
      canRestore: true,
      sourceName: "Oscar Piastri",
      universeName: "Oscar Piastri",
    });
  });

  it("GET comparação para usuário sem equipes espelhadas devolve teams vazio", async () => {
    const fixture = await seedUniverse2026(user.id);
    activeCleanups.push(fixture.cleanup);
    const res = await getComparison(intruder, fixture.ids.seasonId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.comparable).toBe(true);
    expect(body.teams).toEqual([]);
  });
});

describe("Universe Editor API — estados de divergência", () => {
  it("assento com ocupante divergente devolve DIVERGENCE e time DIVERGENT", async () => {
    const fixture = await seedUniverse2026(user.id);
    activeCleanups.push(fixture.cleanup);

    const assignRes = await app.inject({
      method: "POST",
      url: "/api/roster/assign",
      headers: { cookie: user.cookie },
      payload: {
        seasonId: fixture.ids.seasonId,
        teamId: fixture.ids.teamId,
        driverProfileId: fixture.ids.driverZeId,
        seat: 2,
        number: 44,
      },
    });
    expect(assignRes.statusCode).toBe(200);

    const res = await getComparison(user, fixture.ids.seasonId);
    const body = res.json();
    const team = body.teams[0];
    expect(team.status).toBe("DIVERGENT");
    await assertSeat(team.seats[0], { status: "MATCH" });
    await assertSeat(team.seats[1], {
      status: "DIVERGENCE",
      canRestore: true,
      sourceName: "Oscar Piastri",
      universeName: "Zé da Silva",
    });
  });

  it("assento sem ocupante no universo devolve SOURCE_ONLY", async () => {
    const fixture = await seedUniverse2026(user.id);
    activeCleanups.push(fixture.cleanup);

    const releaseRes = await app.inject({
      method: "POST",
      url: "/api/roster/release",
      headers: { cookie: user.cookie },
      payload: {
        seasonId: fixture.ids.seasonId,
        teamId: fixture.ids.teamId,
        driverProfileId: fixture.ids.driverOscarId,
      },
    });
    expect(releaseRes.statusCode).toBe(200);

    const res = await getComparison(user, fixture.ids.seasonId);
    const body = res.json();
    const team = body.teams[0];
    expect(team.status).toBe("DIVERGENT");
    await assertSeat(team.seats[0], { status: "MATCH" });
    await assertSeat(team.seats[1], {
      status: "SOURCE_ONLY",
      canRestore: true,
      sourceName: "Oscar Piastri",
      universeName: null,
    });
  });

  it("assento sem piloto na fonte devolve UNIVERSE_ONLY", async () => {
    const fixture = await seedUniverse2026(user.id);
    activeCleanups.push(fixture.cleanup);
    await prisma.externalBindingDriverSeason.deleteMany({
      where: { externalDriverSeasonId: fixture.ids.dsOscarId },
    });
    await prisma.externalDriverSeason.deleteMany({
      where: { id: fixture.ids.dsOscarId },
    });

    const res = await getComparison(user, fixture.ids.seasonId);
    const body = res.json();
    const team = body.teams[0];
    expect(team.status).toBe("DIVERGENT");
    await assertSeat(team.seats[0], { status: "MATCH" });
    await assertSeat(team.seats[1], {
      status: "UNIVERSE_ONLY",
      canRestore: false,
      sourceName: null,
      universeName: "Oscar Piastri",
    });
  });

  it("assento com fonte sem binding confirmado não é restauável", async () => {
    const fixture = await seedUniverse2026(user.id);
    activeCleanups.push(fixture.cleanup);
    await prisma.externalBindingDriverSeason.deleteMany({
      where: { externalDriverSeasonId: fixture.ids.dsOscarId },
    });

    const res = await getComparison(user, fixture.ids.seasonId);
    const body = res.json();
    const team = body.teams[0];
    expect(team.status).toBe("DIVERGENT");
    const seat2 = team.seats[1];
    expect(seat2.status).toBe("DIVERGENCE");
    expect(seat2.canRestore).toBe(false);
  });
});

describe("Universe Editor API — ações de edição", () => {
  it("keep-universe preserva a divergência sem reescrever o universo", async () => {
    const fixture = await seedUniverse2026(user.id);
    activeCleanups.push(fixture.cleanup);

    await app.inject({
      method: "POST",
      url: "/api/roster/assign",
      headers: { cookie: user.cookie },
      payload: {
        seasonId: fixture.ids.seasonId,
        teamId: fixture.ids.teamId,
        driverProfileId: fixture.ids.driverZeId,
        seat: 2,
        number: 44,
      },
    });

    const before = await prisma.seasonDriverEntry.findUnique({
      where: { id: fixture.ids.entryOscarId },
    });
    expect(before?.status).toBe("AVAILABLE");

    const res = await postKeepUniverse(user, fixture.ids.seasonId, fixture.ids.teamId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.team.status).toBe("DIVERGENT");
    expect(body.team.seats[1].status).toBe("DIVERGENCE");

    const after = await prisma.seasonDriverEntry.findUnique({
      where: { id: fixture.ids.entryOscarId },
    });
    expect(after?.status).toBe("AVAILABLE");
    expect(after?.teamId).toBeNull();
  });

  it("restore-source restaura a configuração da fonte via RosterService", async () => {
    const fixture = await seedUniverse2026(user.id);
    activeCleanups.push(fixture.cleanup);

    await app.inject({
      method: "POST",
      url: "/api/roster/assign",
      headers: { cookie: user.cookie },
      payload: {
        seasonId: fixture.ids.seasonId,
        teamId: fixture.ids.teamId,
        driverProfileId: fixture.ids.driverZeId,
        seat: 2,
        number: 44,
      },
    });

    const res = await postRestoreSource(user, fixture.ids.seasonId, fixture.ids.teamId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.restored).toBe(1);
    expect(body.team.status).toBe("MATCH");

    const oscarEntry = await prisma.seasonDriverEntry.findUnique({
      where: { id: fixture.ids.entryOscarId },
    });
    expect(oscarEntry?.status).toBe("ACTIVE");
    expect(oscarEntry?.teamId).toBe(fixture.ids.teamId);
    expect(oscarEntry?.seat).toBe(2);
    expect(oscarEntry?.number).toBe(81);

    const zeEntry = await prisma.seasonDriverEntry.findUnique({
      where: {
        seasonId_driverProfileId: {
          seasonId: fixture.ids.seasonId,
          driverProfileId: fixture.ids.driverZeId,
        },
      },
    });
    expect(zeEntry?.status).toBe("AVAILABLE");
    expect(zeEntry?.teamId).toBeNull();
    expect(zeEntry?.role).toBeNull();
    expect(zeEntry?.seat).toBeNull();

    const zeEvents = await prisma.driverEntryEvent.findMany({
      where: { entryId: zeEntry?.id },
      orderBy: { createdAt: "asc" },
    });
    expect(zeEvents.some((e) => e.kind === "DISPLACED")).toBe(true);

    const oscarEvents = await prisma.driverEntryEvent.findMany({
      where: { entryId: oscarEntry!.id },
      orderBy: { createdAt: "asc" },
    });
    expect(oscarEvents.some((e) => e.kind === "SEATED")).toBe(true);
  });

  it("restore-source não reescreve vínculos não confirmados (restored=0)", async () => {
    const fixture = await seedUniverse2026(user.id);
    activeCleanups.push(fixture.cleanup);
    await prisma.externalBindingDriverSeason.deleteMany({
      where: { externalDriverSeasonId: fixture.ids.dsOscarId },
    });

    const res = await postRestoreSource(user, fixture.ids.seasonId, fixture.ids.teamId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.restored).toBe(0);
    expect(body.team.seats[1].status).toBe("DIVERGENCE");
    expect(body.team.seats[1].canRestore).toBe(false);
  });

  it("restore-source é idempotente quando já há MATCH", async () => {
    const fixture = await seedUniverse2026(user.id);
    activeCleanups.push(fixture.cleanup);

    const res = await postRestoreSource(user, fixture.ids.seasonId, fixture.ids.teamId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.restored).toBe(0);
    expect(body.team.status).toBe("MATCH");
  });

  it("keep-universe e restore-source devolvem 404 para equipe de outro usuário", async () => {
    const fixture = await seedUniverse2026(user.id);
    activeCleanups.push(fixture.cleanup);

    const keepRes = await postKeepUniverse(intruder, fixture.ids.seasonId, fixture.ids.teamId);
    expect(keepRes.statusCode).toBe(404);
    expect(keepRes.json().code).toBe("TEAM_NOT_FOUND");

    const restoreRes = await postRestoreSource(intruder, fixture.ids.seasonId, fixture.ids.teamId);
    expect(restoreRes.statusCode).toBe(404);
    expect(restoreRes.json().code).toBe("TEAM_NOT_FOUND");
  });

  it("keep-universe devolve 409 para temporada sem fonte vinculada", async () => {
    const season = await prisma.season.create({ data: { year: YEAR } });
    const team = await prisma.team.create({
      data: { name: `Solo ${Math.random().toString(36).slice(2, 8)}`, userId: user.id },
    });
    activeCleanups.push(async () => {
      await prisma.team.delete({ where: { id: team.id } });
      await prisma.season.delete({ where: { id: season.id } });
    });

    const res = await postKeepUniverse(user, season.id, team.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("SEASON_NOT_BOUND");
  });
});