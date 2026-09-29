import { createHmac, randomBytes } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { afterAll, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { deleteUniverseDataForUsers } from "../../test-utils/universe-cleanup.js";
import {
  isSprintEligible,
  pointsForPosition,
  sprintPointsByDriver,
  sprintPointsForPosition,
} from "../championship/championship-progression.engine.js";
import { recomputeSeasonStandings } from "../championship/championship-progression.service.js";

type TestUser = { cookie: string; userId: string };

type Fixture = {
  userId: string;
  universeId: string;
  seasonId: string;
  raceId: string;
  teamIds: string[];
  driverProfileIds: string[];
  externalRaceId: string | null;
};

const createdUserIds: string[] = [];
let externalRoundCounter = 1;

async function createDbUser(suffix: string): Promise<TestUser> {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET not set");
  const user = await prisma.user.create({
    data: {
      email: `rw-${suffix}-${Date.now()}${Math.random()}@f1nw.test`,
      name: `RW ${suffix}`,
      password: null,
      emailVerified: false,
    },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      userId: user.id,
    },
  });
  const sig = createHmac("sha256", secret).update(token).digest("base64");
  return { cookie: `f1nw.session_token=${token}.${sig}`, userId: user.id };
}

async function createFixture(
  user: TestUser,
  options: { sprintOverride?: boolean | null; sprintExternal?: boolean | null } = {},
): Promise<Fixture> {
  const userId = user.userId;
  const universe = await prisma.universe.create({
    data: { userId, status: "READY" },
  });
  const season = await prisma.season.create({
    data: { universeId: universe.id, year: 2087, name: "2087" },
  });

  const teamIds: string[] = [];
  const driverProfileIds: string[] = [];
  for (let teamIndex = 0; teamIndex < 2; teamIndex += 1) {
    const team = await prisma.team.create({
      data: {
        name: `Equipe ${teamIndex}-${Math.random().toString(36).slice(2, 6)}`,
        userId,
        universeId: universe.id,
      },
    });
    teamIds.push(team.id);
    await prisma.teamPerformance.create({
      data: {
        seasonId: season.id,
        teamId: team.id,
        carSpeed: 60,
        reliability: 90,
        operations: 50,
      },
    });
    for (let seat = 0; seat < 2; seat += 1) {
      const character = await prisma.character.create({
        data: {
          name: `Piloto ${teamIndex}${seat}-${Math.random().toString(36).slice(2, 6)}`,
          nationality: "Brazil",
          birthDate: new Date("2000-01-01"),
          userId,
          universeId: universe.id,
          controlledBy: "USER",
        },
      });
      const driver = await prisma.driverProfile.create({
        data: { characterId: character.id, teamId: team.id },
      });
      driverProfileIds.push(driver.id);
      await prisma.driverAttribute.create({
        data: {
          seasonId: season.id,
          driverProfileId: driver.id,
          speed: 70 - teamIndex * 5,
          consistency: 80,
          racecraft: 70,
          aggression: 50,
        },
      });
      await prisma.seasonDriverEntry.create({
        data: {
          driverProfileId: driver.id,
          seasonId: season.id,
          teamId: team.id,
          role: "RACE_SEAT",
          seat: teamIndex * 2 + seat + 1,
          number: teamIndex * 2 + seat + 1,
          status: "ACTIVE",
        },
      });
    }
  }

  const race = await prisma.race.create({
    data: {
      seasonId: season.id,
      name: "GP Weekend 2087",
      round: 1,
      date: new Date("2087-03-01T00:00:00.000Z"),
      sprintOverride: options.sprintOverride ?? null,
      sprintExternal: options.sprintExternal ?? null,
    },
  });
  await prisma.worldState.create({
    data: {
      universeId: universe.id,
      key: "default",
      currentSeasonId: season.id,
      currentDate: new Date("2087-02-28T00:00:00.000Z"),
    },
  });

  let externalRaceId: string | null = null;
  if (options.sprintExternal !== undefined && options.sprintExternal !== null) {
    const externalRace = await prisma.externalRace.create({
      data: {
        source: "jolpica",
        seasonYear: 2087,
        round: externalRoundCounter++,
        grandPrix: "GP Weekend 2087",
        name: "GP Weekend 2087",
        hasSprint: options.sprintExternal,
        contentHash: `rw-${Math.random()}`,
      },
    });
    externalRaceId = externalRace.id;
  }

  return {
    userId,
    universeId: universe.id,
    seasonId: season.id,
    raceId: race.id,
    teamIds,
    driverProfileIds,
    externalRaceId,
  };
}

function getWeekend(app: FastifyInstance, user: TestUser, raceId: string) {
  return app.inject({
    method: "GET",
    url: `/api/races/${raceId}/weekend`,
    headers: { cookie: user.cookie },
    remoteAddress: `10.133.1.${Math.floor(Math.random() * 200) + 1}`,
  });
}

function runSession(
  app: FastifyInstance,
  user: TestUser,
  raceId: string,
  session: string,
  body: Record<string, unknown> = {},
) {
  return app.inject({
    method: "POST",
    url: `/api/races/${raceId}/weekend/sessions/${session}/run`,
    headers: { cookie: user.cookie },
    payload: body,
    remoteAddress: `10.133.2.${Math.floor(Math.random() * 200) + 1}`,
  });
}

function applyChampionship(app: FastifyInstance, user: TestUser, raceId: string) {
  return app.inject({
    method: "POST",
    url: `/api/races/${raceId}/championship/apply`,
    headers: { cookie: user.cookie },
    payload: {},
    remoteAddress: `10.133.3.${Math.floor(Math.random() * 200) + 1}`,
  });
}

async function runFullSprintWeekend(
  app: FastifyInstance,
  user: TestUser,
  raceId: string,
) {
  for (const session of [
    "PRACTICE",
    "SPRINT_QUALIFYING",
    "SPRINT",
    "QUALIFYING",
    "RACE",
  ]) {
    const response = await runSession(app, user, raceId, session);
    expect(response.statusCode, session).toBe(200);
  }
}

describe("Race Weekend / Sessions (Fase Race Weekend)", () => {
  afterAll(async () => {
    await prisma.externalRace.deleteMany({
      where: { source: "jolpica", seasonYear: 2087 },
    });
    await deleteUniverseDataForUsers(prisma, createdUserIds);
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it("executa o lifecycle padrão: Practice, Qualifying e Race", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("standard");
    const fixture = await createFixture(user);

    const initial = await getWeekend(app, user, fixture.raceId);
    expect(initial.statusCode).toBe(200);
    expect(initial.json().weekend.effectiveSprint).toBe(false);
    expect(
      initial.json().weekend.sessions.map((s: { session: string }) => s.session),
    ).toEqual(["PRACTICE", "QUALIFYING", "RACE"]);

    const practice = await runSession(app, user, fixture.raceId, "PRACTICE");
    expect(practice.statusCode).toBe(200);
    expect(practice.json().weekend.currentSession).toBe("PRACTICE");
    expect(practice.json().weekend.nextSession).toBe("QUALIFYING");
    expect(
      practice.json().weekend.sessions[0].results.length,
    ).toBe(4);

    const worldAfterPractice = await prisma.worldState.findUniqueOrThrow({
      where: {
        universeId_key: { universeId: fixture.universeId, key: "default" },
      },
    });
    expect(worldAfterPractice.currentRaceId).toBe(fixture.raceId);
    expect(worldAfterPractice.currentSession).toBe("PRACTICE");

    const qualifying = await runSession(app, user, fixture.raceId, "QUALIFYING");
    expect(qualifying.statusCode).toBe(200);
    expect(qualifying.json().weekend.currentSession).toBe("QUALIFYING");
    const gridRows = await prisma.raceResult.findMany({
      where: { raceId: fixture.raceId, grid: { not: null } },
    });
    expect(gridRows).toHaveLength(4);
    const sessionRows = await prisma.raceSessionResult.findMany({
      where: { raceId: fixture.raceId, session: "QUALIFYING" },
    });
    expect(sessionRows).toHaveLength(4);
    const gridByDriver = new Map(
      sessionRows.map((row) => [row.driverProfileId, row.position]),
    );
    for (const row of gridRows) {
      expect(row.grid).toBe(gridByDriver.get(row.driverProfileId));
    }

    const race = await runSession(app, user, fixture.raceId, "RACE");
    expect(race.statusCode).toBe(200);
    expect(race.json().weekend.currentSession).toBe("RACE");
    const raceRows = await prisma.raceResult.findMany({
      where: { raceId: fixture.raceId },
    });
    expect(raceRows.some((row) => row.position !== null)).toBe(true);
    expect(
      await prisma.raceSessionResult.count({
        where: { raceId: fixture.raceId, session: "RACE" },
      }),
    ).toBe(0);

    const applied = await applyChampionship(app, user, fixture.raceId);
    expect(applied.statusCode).toBe(200);
    const worldAfterFinish = await prisma.worldState.findUniqueOrThrow({
      where: {
        universeId_key: { universeId: fixture.universeId, key: "default" },
      },
    });
    expect(worldAfterFinish.currentSession).toBeNull();

    await app.close();
  });

  it("executa o lifecycle com Sprint, pontua 8–1 e mantém Race em 25–1", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("sprint");
    const fixture = await createFixture(user, { sprintOverride: true });

    const initial = await getWeekend(app, user, fixture.raceId);
    expect(initial.json().weekend.effectiveSprint).toBe(true);
    expect(
      initial.json().weekend.sessions.map((s: { session: string }) => s.session),
    ).toEqual([
      "PRACTICE",
      "SPRINT_QUALIFYING",
      "SPRINT",
      "QUALIFYING",
      "RACE",
    ]);

    await runFullSprintWeekend(app, user, fixture.raceId);

    const sprintRows = await prisma.raceSessionResult.findMany({
      where: { raceId: fixture.raceId, session: "SPRINT" },
      orderBy: { position: "asc" },
    });
    expect(sprintRows.length).toBeGreaterThanOrEqual(2);
    for (const row of sprintRows) {
      if (row.position === null) {
        expect(row.points).toBe(0);
      } else {
        expect(row.points).toBe(sprintPointsForPosition(row.position));
      }
    }
    const winnerSprint = sprintRows.find((row) => row.position === 1);
    expect(winnerSprint?.points).toBe(8);
    expect(sprintRows.find((row) => row.position === 2)?.points).toBe(7);
    expect(winnerSprint?.teamId).toBeTruthy();

    const standingsBeforeApply = await prisma.championshipStanding.findMany({
      where: { seasonId: fixture.seasonId },
      orderBy: { position: "asc" },
    });
    expect(standingsBeforeApply[0].points).toBe(8);

    const raceWinner = await prisma.raceResult.findFirstOrThrow({
      where: { raceId: fixture.raceId, position: 1 },
    });
    const applied = await applyChampionship(app, user, fixture.raceId);
    expect(applied.statusCode).toBe(200);
    const standingsAfterApply = await prisma.championshipStanding.findMany({
      where: { seasonId: fixture.seasonId },
    });
    const sprintWinner = sprintRows.find((row) => row.position === 1);
    const sprintWinnerStanding = standingsAfterApply.find(
      (row) => row.driverProfileId === sprintWinner?.driverProfileId,
    );
    const sprintWinnerRacePoints = pointsForPosition(
      (
        await prisma.raceResult.findFirst({
          where: {
            raceId: fixture.raceId,
            driverProfileId: sprintWinner?.driverProfileId as string,
          },
          select: { position: true },
        })
      )?.position ?? null,
    );
    expect(sprintWinnerStanding?.points).toBe(sprintWinnerRacePoints + 8);
    const raceWinnerAfterApply = await prisma.raceResult.findFirstOrThrow({
      where: { raceId: fixture.raceId, position: 1 },
    });
    expect(raceWinnerAfterApply.points).toBe(25);
    expect(raceWinnerAfterApply.driverProfileId).toBe(raceWinner.driverProfileId);

    const teamTotals = new Map<string, number>();
    const expectedTeamTotals = new Map<string, number>();
    for (const standing of standingsAfterApply) {
      const driver = await prisma.driverProfile.findUniqueOrThrow({
        where: { id: standing.driverProfileId },
        select: { teamId: true },
      });
      const teamId = driver.teamId as string;
      teamTotals.set(teamId, (teamTotals.get(teamId) ?? 0) + standing.points);
      const racePoints =
        (
          await prisma.raceResult.findFirst({
            where: {
              raceId: fixture.raceId,
              driverProfileId: standing.driverProfileId,
            },
            select: { points: true },
          })
        )?.points ?? 0;
      const sprintPoints =
        sprintRows.find(
          (row) => row.driverProfileId === standing.driverProfileId,
        )?.points ?? 0;
      expectedTeamTotals.set(
        teamId,
        (expectedTeamTotals.get(teamId) ?? 0) + racePoints + sprintPoints,
      );
    }
    expect(teamTotals).toEqual(expectedTeamTotals);
    expect([...teamTotals.values()].some((total) => total > 0)).toBe(true);

    await app.close();
  });

  it("respeita Sprint externo, override e ausência de Sprint", async () => {
    const app = buildApp();
    await app.ready();

    const externalTestUser = await createDbUser("ext-true");
    const externalTrue = await createFixture(externalTestUser, {
      sprintExternal: true,
    });

    const externalWeekend = await getWeekend(
      app,
      externalTestUser,
      externalTrue.raceId,
    );
    expect(externalWeekend.json().weekend.effectiveSprint).toBe(true);

    await prisma.race.update({
      where: { id: externalTrue.raceId },
      data: { sprintOverride: false },
    });
    const overridden = await getWeekend(
      app,
      externalTestUser,
      externalTrue.raceId,
    );
    expect(overridden.json().weekend.effectiveSprint).toBe(false);
    expect(
      overridden.json().weekend.sessions.map((s: { session: string }) => s.session),
    ).toEqual(["PRACTICE", "QUALIFYING", "RACE"]);

    const standardUser = await createDbUser("no-sprint");
    const standard = await createFixture(standardUser);

    const blocked = await runSession(
      app,
      standardUser,
      standard.raceId,
      "SPRINT_QUALIFYING",
    );
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("SPRINT_NOT_CONFIGURED");

    await app.close();
  });

  it("rejeita transições inválidas e sessões duplicadas", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("invalid");
    const fixture = await createFixture(user, { sprintOverride: true });

    const qualifyingFirst = await runSession(
      app,
      user,
      fixture.raceId,
      "QUALIFYING",
    );
    expect(qualifyingFirst.statusCode).toBe(409);
    expect(qualifyingFirst.json().code).toBe("SESSION_NOT_AVAILABLE");

    const sprintFirst = await runSession(app, user, fixture.raceId, "SPRINT");
    expect(sprintFirst.statusCode).toBe(409);

    expect(
      (await runSession(app, user, fixture.raceId, "PRACTICE")).statusCode,
    ).toBe(200);
    const duplicate = await runSession(app, user, fixture.raceId, "PRACTICE");
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe("SESSION_NOT_AVAILABLE");

    const rerun = await runSession(app, user, fixture.raceId, "PRACTICE", {
      rerun: true,
    });
    expect(rerun.statusCode).toBe(200);
    expect(
      await prisma.raceSessionResult.count({
        where: { raceId: fixture.raceId, session: "PRACTICE" },
      }),
    ).toBe(4);
    expect(
      await prisma.timelineEvent.count({
        where: {
          universeId: fixture.universeId,
          kind: "SESSION_COMPLETED",
          AND: [{ payload: { path: ["raceId"], equals: fixture.raceId } }],
        },
      }),
    ).toBe(1);
  });

  it("garante execução única sob concorrência", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("concurrent");
    const fixture = await createFixture(user, { sprintOverride: true });

    const [first, second] = await Promise.all([
      runSession(app, user, fixture.raceId, "PRACTICE"),
      runSession(app, user, fixture.raceId, "PRACTICE"),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    expect(
      await prisma.raceSessionResult.count({
        where: { raceId: fixture.raceId, session: "PRACTICE" },
      }),
    ).toBe(4);

    for (const session of ["SPRINT_QUALIFYING", "SPRINT", "QUALIFYING"]) {
      expect(
        (await runSession(app, user, fixture.raceId, session)).statusCode,
        session,
      ).toBe(200);
    }
    const [raceFirst, raceSecond] = await Promise.all([
      runSession(app, user, fixture.raceId, "RACE"),
      runSession(app, user, fixture.raceId, "RACE"),
    ]);
    expect([raceFirst.statusCode, raceSecond.statusCode].sort()).toEqual([
      200, 409,
    ]);
    const raceRows = await prisma.raceResult.findMany({
      where: { raceId: fixture.raceId },
    });
    expect(raceRows).toHaveLength(4);
    expect(raceRows.filter((row) => row.position === 1)).toHaveLength(1);

    await app.close();
  });

  it("aplica Sprint Qualifying sem tocar o grid da corrida", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("sq");
    const fixture = await createFixture(user, { sprintOverride: true });

    await runSession(app, user, fixture.raceId, "PRACTICE");
    await runSession(app, user, fixture.raceId, "SPRINT_QUALIFYING");

    const raceGrid = await prisma.raceResult.count({
      where: { raceId: fixture.raceId, grid: { not: null } },
    });
    expect(raceGrid).toBe(0);
    const sqRows = await prisma.raceSessionResult.findMany({
      where: { raceId: fixture.raceId, session: "SPRINT_QUALIFYING" },
    });
    expect(sqRows).toHaveLength(4);

    const qualifying = await runSession(app, user, fixture.raceId, "SPRINT");
    expect(qualifying.statusCode).toBe(200);
    const sprintRows = await prisma.raceSessionResult.findMany({
      where: { raceId: fixture.raceId, session: "SPRINT" },
    });
    expect(sprintRows).toHaveLength(4);

    await app.close();
  });

  it("calcula pontos de Sprint com elegibilidade, dead heat e sem tabela de Race", async () => {
    expect(pointsForPosition(1)).toBe(25);
    expect(sprintPointsForPosition(1)).toBe(8);
    expect(sprintPointsForPosition(8)).toBe(1);
    expect(sprintPointsForPosition(9)).toBe(0);

    expect(isSprintEligible({ neutralizedStart: false, distancePct: 100 })).toBe(
      true,
    );
    expect(isSprintEligible({ neutralizedStart: true, distancePct: 100 })).toBe(
      false,
    );
    expect(isSprintEligible({ neutralizedStart: false, distancePct: 40 })).toBe(
      false,
    );
    expect(isSprintEligible({ neutralizedStart: false, distancePct: 50 })).toBe(
      true,
    );

    const eligible = { neutralizedStart: false, distancePct: 100 };
    const points = sprintPointsByDriver([
      { driverProfileId: "a", position: 1, eligibility: eligible },
      { driverProfileId: "b", position: 1, eligibility: eligible },
      { driverProfileId: "c", position: 3, eligibility: eligible },
      { driverProfileId: "d", position: 4, eligibility: null },
    ]);
    expect(points.get("a")).toBe(7.5);
    expect(points.get("b")).toBe(7.5);
    expect(points.get("c")).toBe(6);
    expect(points.has("d")).toBe(false);

    const ineligible = sprintPointsByDriver([
      {
        driverProfileId: "x",
        position: 1,
        eligibility: { neutralizedStart: true, distancePct: 100 },
      },
    ]);
    expect(ineligible.has("x")).toBe(false);
  });

  it("zera pontos de Sprint sem elegibilidade no recompute", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("ineligible");
    const fixture = await createFixture(user, { sprintOverride: true });
    await runSession(app, user, fixture.raceId, "PRACTICE");
    await runSession(app, user, fixture.raceId, "SPRINT_QUALIFYING");
    await runSession(app, user, fixture.raceId, "SPRINT");

    await prisma.raceSessionResult.updateMany({
      where: { raceId: fixture.raceId, session: "SPRINT" },
      data: { metadata: { eligibility: { neutralizedStart: true, distancePct: 100 } } },
    });
    await prisma.$transaction((tx) =>
      recomputeSeasonStandings(tx, fixture.seasonId),
    );

    const rows = await prisma.raceSessionResult.findMany({
      where: { raceId: fixture.raceId, session: "SPRINT" },
    });
    expect(rows.every((row) => row.points === 0)).toBe(true);
    const standings = await prisma.championshipStanding.findMany({
      where: { seasonId: fixture.seasonId },
    });
    expect(standings.every((row) => row.points === 0)).toBe(true);

    await app.close();
  });

  it("mantém Timeline determinística sem contaminar o recompute", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("timeline");
    const fixture = await createFixture(user, { sprintOverride: true });
    await runFullSprintWeekend(app, user, fixture.raceId);

    const events = await prisma.timelineEvent.findMany({
      where: { universeId: fixture.universeId, kind: "SESSION_COMPLETED" },
    });
    expect(events).toHaveLength(5);

    const before = await prisma.raceSessionResult.findMany({
      where: { raceId: fixture.raceId },
      orderBy: [{ session: "asc" }, { driverProfileId: "asc" }],
    });
    const recompute = await app.inject({
      method: "POST",
      url: "/api/timeline/recompute",
      headers: { cookie: user.cookie },
      payload: {},
      remoteAddress: "10.133.4.1",
    });
    expect([200, 400, 409]).toContain(recompute.statusCode);
    const after = await prisma.raceSessionResult.findMany({
      where: { raceId: fixture.raceId },
      orderBy: [{ session: "asc" }, { driverProfileId: "asc" }],
    });
    expect(after.map((row) => row.points)).toEqual(before.map((row) => row.points));

    const weekendAgain = await getWeekend(app, user, fixture.raceId);
    expect(weekendAgain.json().weekend.sessions[2].results[0].points).toBe(8);

    await app.close();
  });

  it("isola universos, espelho externo e automações", async () => {
    const app = buildApp();
    await app.ready();
    const userA = await createDbUser("iso-a");
    const userB = await createDbUser("iso-b");
    const fixtureA = await createFixture(userA, {
      sprintExternal: true,
    });
    const fixtureB = await createFixture(userB, {
      sprintExternal: true,
    });

    await runSession(app, userA, fixtureA.raceId, "PRACTICE");
    expect(
      await prisma.raceSessionResult.count({
        where: { race: { seasonId: fixtureB.seasonId } },
      }),
    ).toBe(0);

    const cross = await getWeekend(app, userB, fixtureA.raceId);
    expect(cross.statusCode).toBe(403);
    expect(cross.json().code).toBe("RACE_NOT_IN_UNIVERSE");

    const externalBefore = await prisma.externalRace.findUniqueOrThrow({
      where: { id: fixtureA.externalRaceId as string },
    });
    const aiBefore = await prisma.aiDecision.count();
    const evolutionBefore = await prisma.timelineEvent.count({
      where: { universeId: fixtureA.universeId, kind: "ATTRIBUTE_EVOLVED" },
    });

    for (const session of [
      "SPRINT_QUALIFYING",
      "SPRINT",
      "QUALIFYING",
      "RACE",
    ]) {
      const response = await runSession(app, userA, fixtureA.raceId, session);
      expect(response.statusCode, session).toBe(200);
    }

    const externalAfter = await prisma.externalRace.findUniqueOrThrow({
      where: { id: fixtureA.externalRaceId as string },
    });
    expect(externalAfter.hasSprint).toBe(externalBefore.hasSprint);
    expect(externalAfter.contentHash).toBe(externalBefore.contentHash);
    expect(await prisma.externalResult.count()).toBe(0);
    expect(await prisma.aiDecision.count()).toBe(aiBefore);
    expect(
      await prisma.timelineEvent.count({
        where: { universeId: fixtureA.universeId, kind: "ATTRIBUTE_EVOLVED" },
      }),
    ).toBe(evolutionBefore);

    await app.close();
  });

  it("expõe contrato da API, estado do Next Race e erros semânticos", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("contract");
    const fixture = await createFixture(user, { sprintOverride: true });

    const unauthenticated = await app.inject({
      method: "GET",
      url: `/api/races/${fixture.raceId}/weekend`,
    });
    expect(unauthenticated.statusCode).toBe(401);

    const missing = await getWeekend(
      app,
      user,
      "00000000-0000-4000-8000-000000000000",
    );
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe("RACE_NOT_FOUND");

    const invalidSession = await runSession(
      app,
      user,
      fixture.raceId,
      "SPRINT_SHOOTOUT",
    );
    expect(invalidSession.statusCode).toBe(400);

    await runSession(app, user, fixture.raceId, "PRACTICE");

    const nextRace = await app.inject({
      method: "GET",
      url: "/api/next-race",
      headers: { cookie: user.cookie },
      remoteAddress: "10.133.5.1",
    });
    expect(nextRace.statusCode).toBe(200);
    expect(nextRace.json().nextRace.current.raceId).toBe(fixture.raceId);
    expect(nextRace.json().nextRace.current.hasSprint).toBe(true);
    expect(nextRace.json().nextRace.current.status).toBe("PRACTICE");

    for (const session of [
      "SPRINT_QUALIFYING",
      "SPRINT",
      "QUALIFYING",
      "RACE",
    ]) {
      const response = await runSession(app, user, fixture.raceId, session);
      expect(response.statusCode, session).toBe(200);
    }
    await applyChampionship(app, user, fixture.raceId);
    const afterFinish = await runSession(
      app,
      user,
      fixture.raceId,
      "PRACTICE",
    );
    expect(afterFinish.statusCode).toBe(409);
    expect(afterFinish.json().code).toBe("SESSION_NOT_AVAILABLE");

    await app.close();
  });
});
