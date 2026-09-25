import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { JOLPICA_SOURCE } from "../external-sync/jolpica.service.js";
import { OPENING_GRID_SOURCE } from "../opening-grid/opening-grid.source.js";

const YEAR = 2026;

type User = { id: string; cookie: string };

type Fixture = {
  ids: {
    seasonId: string;
    teamId: string;
    extTeamExternalId: string;
    driverLandoId: string;
    driverOscarId: string;
    driverZeId: string;
    driverBiaId: string;
  };
  cleanup: () => Promise<void>;
};

type DecisionSeatShape = {
  seat: number;
  status: string;
  source: { name: string } | null;
  universe: { characterName: string } | null;
};

async function seedMirrorWithClaims(userId: string, claimLandoSeat: 1 | 2 = 1): Promise<Fixture> {
  const runId = Math.random().toString(36).slice(2, 8);
  const universe = await prisma.universe.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });

  const season = await prisma.season.create({
    data: {
      universeId: universe.id,
      year: YEAR,
      name: String(YEAR),
      status: "PRE_SEASON",
    },
  });
  const team = await prisma.team.create({
    data: {
      name: `McLaren ${runId}`,
      shortName: "MCL",
      color: "#ff8000",
      userId,
      universeId: universe.id,
    },
  });

  const characterLando = await prisma.character.create({
    data: { name: "Lando Norris", nationality: "British", birthDate: new Date("1999-11-13"), userId, universeId: universe.id },
  });
  const characterOscar = await prisma.character.create({
    data: { name: "Oscar Piastri", nationality: "Australian", birthDate: new Date("2001-04-06"), userId, universeId: universe.id },
  });
  const characterZe = await prisma.character.create({
    data: { name: "Zé da Silva", nationality: "Brasileira", birthDate: new Date("2002-06-14"), userId, universeId: universe.id },
  });
  const characterBia = await prisma.character.create({
    data: { name: "Bia Fonseca", nationality: "Brasileira", birthDate: new Date("2003-05-20"), userId, universeId: universe.id },
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
  const driverBia = await prisma.driverProfile.create({
    data: { characterId: characterBia.id, number: 5 },
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
        data: { source: JOLPICA_SOURCE, year: YEAR, name: String(YEAR), status: "ACTIVE", contentHash: `ued-ext-season-${runId}` },
      });
  if (!extSeasonShared) extSeasonCreated = true;

  const extTeam = await prisma.externalTeam.create({
    data: { source: JOLPICA_SOURCE, externalId: `mclaren-ued-${runId}`, name: "McLaren", shortName: "MCL", color: "#ff8000", contentHash: "ued-ext-team" },
  });

  const extLandoId = `lando-ued-${runId}`;
  const extOscarId = `oscar-ued-${runId}`;

  const extLando = await prisma.externalDriver.create({
    data: { source: JOLPICA_SOURCE, externalId: extLandoId, name: "Lando Norris", fullName: "Lando Norris", nationality: "British", number: 1, contentHash: "ued-ext-lando" },
  });
  const extOscar = await prisma.externalDriver.create({
    data: { source: JOLPICA_SOURCE, externalId: extOscarId, name: "Oscar Piastri", fullName: "Oscar Piastri", nationality: "Australian", number: 81, contentHash: "ued-ext-oscar" },
  });

  const dsLando = await prisma.externalDriverSeason.create({
    data: { source: JOLPICA_SOURCE, externalDriverId: extLando.id, seasonYear: YEAR, teamExternalId: extTeam.externalId, teamNameSnapshot: "McLaren", number: 1, role: null, contentHash: "ued-ds-lando" },
  });
  const dsOscar = await prisma.externalDriverSeason.create({
    data: { source: JOLPICA_SOURCE, externalDriverId: extOscar.id, seasonYear: YEAR, teamExternalId: extTeam.externalId, teamNameSnapshot: "McLaren", number: 81, role: null, contentHash: "ued-ds-oscar" },
  });

  const claimLando = await prisma.externalDriver.create({
    data: { source: OPENING_GRID_SOURCE, externalId: extLandoId, name: "Lando Norris", fullName: "Lando Norris", nationality: "British", number: 1, contentHash: "ued-claim-lando" },
  });
  const claimOscar = await prisma.externalDriver.create({
    data: { source: OPENING_GRID_SOURCE, externalId: extOscarId, name: "Oscar Piastri", fullName: "Oscar Piastri", nationality: "Australian", number: 81, contentHash: "ued-claim-oscar" },
  });

  const claimDsLando = await prisma.externalDriverSeason.create({
    data: {
      source: OPENING_GRID_SOURCE,
      externalDriverId: claimLando.id,
      seasonYear: YEAR,
      teamExternalId: extTeam.externalId,
      teamNameSnapshot: "McLaren",
      number: 1,
      role: claimLandoSeat === 1 ? "RACE_SEAT:1" : "RACE_SEAT:2",
      contentHash: "ued-claim-ds-lando",
    },
  });
  const claimDsOscar = await prisma.externalDriverSeason.create({
    data: {
      source: OPENING_GRID_SOURCE,
      externalDriverId: claimOscar.id,
      seasonYear: YEAR,
      teamExternalId: extTeam.externalId,
      teamNameSnapshot: "McLaren",
      number: 81,
      role: claimLandoSeat === 1 ? "RACE_SEAT:2" : "RACE_SEAT:1",
      contentHash: "ued-claim-ds-oscar",
    },
  });

  await prisma.externalBindingSeason.create({
    data: { universeId: universe.id, externalSeasonId: extSeason.id, seasonId: season.id, confidence: "CONFIRMED", boundBy: "ADMIN" },
  });
  await prisma.externalBindingTeam.create({
    data: { universeId: universe.id, externalTeamId: extTeam.id, teamId: team.id, confidence: "CONFIRMED", boundBy: "ADMIN" },
  });
  await prisma.externalBindingDriver.create({
    data: { universeId: universe.id, externalDriverId: extLando.id, characterId: characterLando.id, confidence: "CONFIRMED", boundBy: "ADMIN" },
  });
  await prisma.externalBindingDriver.create({
    data: { universeId: universe.id, externalDriverId: extOscar.id, characterId: characterOscar.id, confidence: "CONFIRMED", boundBy: "ADMIN" },
  });
  await prisma.externalBindingDriverSeason.create({
    data: { universeId: universe.id, externalDriverSeasonId: dsLando.id, seasonDriverEntryId: entryLando.id, confidence: "CONFIRMED", boundBy: "ADMIN" },
  });
  await prisma.externalBindingDriverSeason.create({
    data: { universeId: universe.id, externalDriverSeasonId: dsOscar.id, seasonDriverEntryId: entryOscar.id, confidence: "CONFIRMED", boundBy: "ADMIN" },
  });

  const cleanup = async () => {
    await prisma.externalBindingSeason.deleteMany({
      where: { externalSeasonId: extSeason.id, seasonId: season.id },
    });
    await prisma.externalBindingTeam.deleteMany({ where: { teamId: team.id } });
    await prisma.seasonDriverEntry.deleteMany({ where: { seasonId: season.id } });
    await prisma.user
      .findUnique({ where: { id: userId } })
      .then((user) => {
        if (user?.id) return user.id;
        return null;
      });
    await prisma.driverProfile.deleteMany({ where: { character: { userId } } });
    await prisma.character.deleteMany({ where: { userId } });
    await prisma.team.deleteMany({ where: { userId } });
    await prisma.season.deleteMany({ where: { id: season.id } });
    await prisma.externalBindingDriverSeason.deleteMany({
      where: { id: { in: [] } },
    });
    await prisma.externalDriverSeason.deleteMany({
      where: { id: { in: [dsLando.id, dsOscar.id, claimDsLando.id, claimDsOscar.id] } },
    });
    await prisma.externalDriver.deleteMany({
      where: { id: { in: [extLando.id, extOscar.id, claimLando.id, claimOscar.id] } },
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
      driverBiaId: driverBia.id,
    },
    cleanup,
  };
}

let app: FastifyInstance;
let user: User;
let intruder: User;
const activeCleanups: Array<() => Promise<void>> = [];

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

async function postKeepUniverse(actor: User, seasonId: string, teamId: string) {
  return app.inject({
    method: "POST",
    url: `/api/universe/roster-comparison/${seasonId}/keep-universe`,
    headers: { cookie: actor.cookie },
    payload: { teamId },
  });
}

async function getDecisions(actor: User, seasonId: string, teamId: string) {
  return app.inject({
    method: "GET",
    url: `/api/universe/roster-comparison/${seasonId}/decisions?teamId=${teamId}`,
    headers: { cookie: actor.cookie },
  });
}

async function countDecisions(seasonId: string, teamId: string) {
  return prisma.universeEditorDecision.count({ where: { seasonId, teamId } });
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  user = await createUser(`ued-user-${Date.now()}@f1nw.test`, "UED User");
  intruder = await createUser(`ued-intr-${Date.now()}@f1nw.test`, "UED Intruder");
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

describe("Universe Editor — persistência da decisão Keep Universe", () => {
  it("keep-universe registra decisão durável quando há divergência", async () => {
    const fixture = await seedMirrorWithClaims(user.id);
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

    const keepRes = await postKeepUniverse(user, fixture.ids.seasonId, fixture.ids.teamId);
    expect(keepRes.statusCode).toBe(200);
    expect(keepRes.json().team.status).toBe("DIVERGENT");

    expect(await countDecisions(fixture.ids.seasonId, fixture.ids.teamId)).toBe(1);

    const decisions = await prisma.universeEditorDecision.findMany({
      where: { seasonId: fixture.ids.seasonId, teamId: fixture.ids.teamId },
    });
    const decision = decisions[0];
    expect(decision.userId).toBe(user.id);
    expect(decision.seasonId).toBe(fixture.ids.seasonId);
    expect(decision.teamId).toBe(fixture.ids.teamId);
    expect(decision.signature.length).toBeGreaterThan(0);
    const seats = decision.seats as unknown as DecisionSeatShape[];
    expect(seats).toHaveLength(2);
    const seat2 = seats.find((s) => s.seat === 2);
    expect(seat2?.status).toBe("DIVERGENCE");
    expect(seat2?.source?.name).toBe("Oscar Piastri");
    expect(seat2?.universe?.characterName).toBe("Zé da Silva");
  });

  it("segundo keep-universe sem nova divergência não duplica a decisão", async () => {
    const fixture = await seedMirrorWithClaims(user.id);
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

    const first = await postKeepUniverse(user, fixture.ids.seasonId, fixture.ids.teamId);
    expect(first.statusCode).toBe(200);
    const second = await postKeepUniverse(user, fixture.ids.seasonId, fixture.ids.teamId);
    expect(second.statusCode).toBe(200);

    expect(await countDecisions(fixture.ids.seasonId, fixture.ids.teamId)).toBe(1);
  });

  it("nova divergência posterior permite registrar nova decisão", async () => {
    const fixture = await seedMirrorWithClaims(user.id);
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
    const first = await postKeepUniverse(user, fixture.ids.seasonId, fixture.ids.teamId);
    expect(first.statusCode).toBe(200);

    const secondAssign = await app.inject({
      method: "POST",
      url: "/api/roster/assign",
      headers: { cookie: user.cookie },
      payload: {
        seasonId: fixture.ids.seasonId,
        teamId: fixture.ids.teamId,
        driverProfileId: fixture.ids.driverBiaId,
        seat: 2,
        number: 5,
      },
    });
    expect(secondAssign.statusCode).toBe(200);

    const second = await postKeepUniverse(user, fixture.ids.seasonId, fixture.ids.teamId);
    expect(second.statusCode).toBe(200);

    expect(await countDecisions(fixture.ids.seasonId, fixture.ids.teamId)).toBe(2);

    const decisions = await prisma.universeEditorDecision.findMany({
      where: { seasonId: fixture.ids.seasonId, teamId: fixture.ids.teamId },
      orderBy: { createdAt: "asc" },
    });
    expect(decisions).toHaveLength(2);
    const saddest = decisions[0].seats as unknown as DecisionSeatShape[];
    const newest = decisions[1].seats as unknown as DecisionSeatShape[];
    expect(saddest.find((s) => s.seat === 2)?.universe?.characterName).toBe("Zé da Silva");
    expect(newest.find((s) => s.seat === 2)?.universe?.characterName).toBe("Bia Fonseca");
    expect(decisions[0].signature).not.toBe(decisions[1].signature);
  });

  it("keep-universe sobre time MATCH não registra decisão", async () => {
    const fixture = await seedMirrorWithClaims(user.id);
    activeCleanups.push(fixture.cleanup);

    const keepRes = await postKeepUniverse(user, fixture.ids.seasonId, fixture.ids.teamId);
    expect(keepRes.statusCode).toBe(200);
    expect(keepRes.json().team.status).toBe("MATCH");
    expect(await countDecisions(fixture.ids.seasonId, fixture.ids.teamId)).toBe(0);
  });

  it("restore-source preserva o histórico e não cria decisão nova após MATCH", async () => {
    const fixture = await seedMirrorWithClaims(user.id);
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
    const before = await postKeepUniverse(user, fixture.ids.seasonId, fixture.ids.teamId);
    expect(before.statusCode).toBe(200);
    expect(await countDecisions(fixture.ids.seasonId, fixture.ids.teamId)).toBe(1);

    const restoreRes = await app.inject({
      method: "POST",
      url: `/api/universe/roster-comparison/${fixture.ids.seasonId}/restore-source`,
      headers: { cookie: user.cookie },
      payload: { teamId: fixture.ids.teamId },
    });
    expect(restoreRes.statusCode).toBe(200);
    expect(restoreRes.json().restored).toBe(1);
    expect(restoreRes.json().team.status).toBe("MATCH");

    const after = await postKeepUniverse(user, fixture.ids.seasonId, fixture.ids.teamId);
    expect(after.statusCode).toBe(200);
    expect(after.json().team.status).toBe("MATCH");

    expect(await countDecisions(fixture.ids.seasonId, fixture.ids.teamId)).toBe(1);
  });

  it("GET decisions exige sessão e valida dono da equipe", async () => {
    const fixture = await seedMirrorWithClaims(user.id);
    activeCleanups.push(fixture.cleanup);

    const noAuth = await getDecisions({ cookie: "" } as User, fixture.ids.seasonId, fixture.ids.teamId);
    expect(noAuth.statusCode).toBe(401);

    const intruderRes = await getDecisions(intruder, fixture.ids.seasonId, fixture.ids.teamId);
    expect(intruderRes.statusCode).toBe(404);
    expect(intruderRes.json().code).toBe("TEAM_NOT_FOUND");

    const res = await getDecisions(user, fixture.ids.seasonId, fixture.ids.teamId);
    expect(res.statusCode).toBe(200);
    expect(res.json().decisions).toEqual([]);
  });
});

describe("Universe Editor — fonte dos assentos via opening-grid claims", () => {
  it("comparação usa as claims para definir quem ocupa cada assento", async () => {
    const fixture = await seedMirrorWithClaims(user.id, 2);
    activeCleanups.push(fixture.cleanup);

    const res = await app.inject({
      method: "GET",
      url: `/api/universe/roster-comparison/${fixture.ids.seasonId}`,
      headers: { cookie: user.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.comparable).toBe(true);
    const team = body.teams[0];
    expect(team.status).toBe("DIVERGENT");

    const seat1 = team.seats[0];
    const seat2 = team.seats[1];
    expect(seat1.status).toBe("DIVERGENCE");
    expect(seat1.source?.name).toBe("Oscar Piastri");
    expect(seat1.universe?.characterName).toBe("Lando Norris");
    expect(seat1.canRestore).toBe(true);
    expect(seat2.status).toBe("DIVERGENCE");
    expect(seat2.source?.name).toBe("Lando Norris");
    expect(seat2.universe?.characterName).toBe("Oscar Piastri");
    expect(seat2.canRestore).toBe(true);
  });

  it("comparação MATCH quando as claims coincidem com o universo", async () => {
    const fixture = await seedMirrorWithClaims(user.id, 1);
    activeCleanups.push(fixture.cleanup);

    const res = await app.inject({
      method: "GET",
      url: `/api/universe/roster-comparison/${fixture.ids.seasonId}`,
      headers: { cookie: user.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const team = body.teams[0];
    expect(team.status).toBe("MATCH");
    expect(team.seats[0].status).toBe("MATCH");
    expect(team.seats[1].status).toBe("MATCH");
  });
});