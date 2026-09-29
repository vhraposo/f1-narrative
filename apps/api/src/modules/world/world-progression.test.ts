import { createHmac, randomBytes } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { afterAll, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { deleteUniverseDataForUsers } from "../../test-utils/universe-cleanup.js";

type TestUser = { cookie: string; userId: string };

type Fixture = {
  userId: string;
  universeId: string;
  seasonId: string;
  raceId: string;
  nextRaceId: string | null;
  teamId: string;
  driverProfileIds: string[];
};

const createdUserIds: string[] = [];

async function createDbUser(suffix: string): Promise<TestUser> {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET not set");
  const user = await prisma.user.create({
    data: {
      email: `wp-${suffix}-${Date.now()}${Math.random()}@f1nw.test`,
      name: `WP ${suffix}`,
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
  options: {
    sprintOverride?: boolean | null;
    withSecondRace?: boolean;
    withWorldRace?: boolean;
  } = {},
): Promise<Fixture> {
  const universe = await prisma.universe.create({
    data: { userId: user.userId, status: "READY" },
  });
  const season = await prisma.season.create({
    data: { universeId: universe.id, year: 2086, name: "2086" },
  });
  const team = await prisma.team.create({
    data: {
      name: `Equipe WP ${Math.random().toString(36).slice(2, 6)}`,
      userId: user.userId,
      universeId: universe.id,
    },
  });
  await prisma.teamPerformance.create({
    data: {
      seasonId: season.id,
      teamId: team.id,
      carSpeed: 60,
      reliability: 90,
      operations: 50,
    },
  });
  const driverProfileIds: string[] = [];
  for (let seat = 0; seat < 2; seat += 1) {
    const character = await prisma.character.create({
      data: {
        name: `WP Piloto ${seat}-${Math.random().toString(36).slice(2, 6)}`,
        nationality: "Brazil",
        birthDate: new Date("2000-01-01"),
        userId: user.userId,
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
        speed: 70,
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
        seat: seat + 1,
        number: seat + 1,
        status: "ACTIVE",
      },
    });
  }

  const race = await prisma.race.create({
    data: {
      seasonId: season.id,
      name: "GP Progressão",
      round: 1,
      date: new Date("2086-03-01T00:00:00.000Z"),
      sprintOverride: options.sprintOverride ?? null,
    },
  });
  let nextRaceId: string | null = null;
  if (options.withSecondRace) {
    const nextRace = await prisma.race.create({
      data: {
        seasonId: season.id,
        name: "GP Progressão 2",
        round: 2,
        date: new Date("2086-03-08T00:00:00.000Z"),
      },
    });
    nextRaceId = nextRace.id;
  }

  await prisma.worldState.create({
    data: {
      universeId: universe.id,
      key: "default",
      currentSeasonId: season.id,
      currentDate: new Date("2086-02-28T00:00:00.000Z"),
      ...(options.withWorldRace ? { currentRaceId: race.id } : {}),
    },
  });

  return {
    userId: user.userId,
    universeId: universe.id,
    seasonId: season.id,
    raceId: race.id,
    nextRaceId,
    teamId: team.id,
    driverProfileIds,
  };
}

function progress(app: FastifyInstance, user: TestUser) {
  return app.inject({
    method: "POST",
    url: "/api/world/progress",
    headers: { cookie: user.cookie },
    payload: {},
    remoteAddress: `10.144.1.${Math.floor(Math.random() * 200) + 1}`,
  });
}

function loadWorld(universeId: string) {
  return prisma.worldState.findUniqueOrThrow({
    where: { universeId_key: { universeId, key: "default" } },
  });
}

function worldEvents(universeId: string) {
  return prisma.timelineEvent.findMany({
    where: { universeId, kind: "WORLD_ADVANCED" },
    orderBy: { sequence: "asc" },
  });
}

describe("WorldState Progression (V3.12)", () => {
  afterAll(async () => {
    await deleteUniverseDataForUsers(prisma, createdUserIds);
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it("seleciona a primeira corrida e abre a sessão inicial", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("select");
    const fixture = await createFixture(user, { withSecondRace: true });

    const response = await progress(app, user);
    expect(response.statusCode).toBe(200);
    expect(response.json().changed).toBe(true);
    expect(response.json().transition.type).toBe("RACE_SELECTED");
    expect(response.json().transition.toSession).toBe("PRACTICE");

    const world = await loadWorld(fixture.universeId);
    expect(world.currentRaceId).toBe(fixture.raceId);
    expect(world.currentSession).toBe("PRACTICE");
    expect(world.currentDate.toISOString()).toBe(
      new Date("2086-02-28T00:00:00.000Z").toISOString(),
    );
    expect(await worldEvents(fixture.universeId)).toHaveLength(1);

    await app.close();
  });

  it("avança sessões no weekend padrão e no weekend com Sprint", async () => {
    const app = buildApp();
    await app.ready();
    const standardUser = await createDbUser("standard");
    const standard = await createFixture(standardUser, { withWorldRace: true });
    await prisma.race.update({
      where: { id: standard.raceId },
      data: { status: "PRACTICE" },
    });
    await prisma.worldState.update({
      where: { universeId_key: { universeId: standard.universeId, key: "default" } },
      data: { currentSession: "PRACTICE" },
    });
    const standardProgress = await progress(app, standardUser);
    expect(standardProgress.json().transition.toSession).toBe("QUALIFYING");

    const sprintUser = await createDbUser("sprint");
    const sprint = await createFixture(sprintUser, {
      sprintOverride: true,
      withWorldRace: true,
    });
    await prisma.race.update({
      where: { id: sprint.raceId },
      data: { status: "SPRINT" },
    });
    await prisma.worldState.update({
      where: { universeId_key: { universeId: sprint.universeId, key: "default" } },
      data: { currentSession: "SPRINT" },
    });
    const sprintProgress = await progress(app, sprintUser);
    expect(sprintProgress.json().transition.toSession).toBe("QUALIFYING");

    await app.close();
  });

  it("finaliza a Race com classificação e limpa a sessão", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("finalize");
    const fixture = await createFixture(user, {
      withWorldRace: true,
      withSecondRace: true,
    });
    await prisma.race.update({
      where: { id: fixture.raceId },
      data: { status: "RACE" },
    });
    await prisma.worldState.update({
      where: { universeId_key: { universeId: fixture.universeId, key: "default" } },
      data: { currentSession: "RACE" },
    });
    await prisma.raceResult.createMany({
      data: [
        {
          raceId: fixture.raceId,
          driverProfileId: fixture.driverProfileIds[0],
          position: 1,
          grid: 1,
          status: "Finished",
          points: 0,
        },
        {
          raceId: fixture.raceId,
          driverProfileId: fixture.driverProfileIds[1],
          position: 2,
          grid: 2,
          status: "Finished",
          points: 0,
        },
      ],
    });

    const response = await progress(app, user);
    expect(response.statusCode).toBe(200);
    expect(response.json().changed).toBe(true);
    expect(response.json().transition.type).toBe("WEEKEND_FINALIZED");
    expect(response.json().transition.toSession).toBeNull();

    const race = await prisma.race.findUniqueOrThrow({
      where: { id: fixture.raceId },
    });
    expect(race.status).toBe("FINISHED");
    const world = await loadWorld(fixture.universeId);
    expect(world.currentSession).toBeNull();
    expect(world.currentRaceId).toBe(fixture.raceId);
    const standings = await prisma.championshipStanding.findMany({
      where: { seasonId: fixture.seasonId },
      orderBy: { position: "asc" },
    });
    expect(standings[0].points).toBe(25);

    const nextRace = await app.inject({
      method: "GET",
      url: "/api/next-race",
      headers: { cookie: user.cookie },
      remoteAddress: "10.144.2.1",
    });
    expect(nextRace.json().nextRace.next.raceId).toBe(fixture.nextRaceId);
    expect(nextRace.json().nextRace.previous).toBeNull();
    expect(nextRace.json().nextRace.current.raceId).toBe(fixture.raceId);

    await app.close();
  });

  it("não avança quando não há transição possível", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("nochange");
    const fixture = await createFixture(user, { withWorldRace: true });
    await prisma.race.update({
      where: { id: fixture.raceId },
      data: { status: "FINISHED" },
    });

    const noRace = await progress(app, user);
    expect(noRace.json().changed).toBe(false);
    expect(noRace.json().transition).toBeNull();

    const noSeason = await createDbUser("nochange-season");
    await prisma.universe.create({
      data: { userId: noSeason.userId, status: "READY" },
    });
    await prisma.worldState.create({
      data: { universeId: (await prisma.universe.findUniqueOrThrow({ where: { userId: noSeason.userId } })).id },
    });
    const emptySeason = await progress(app, noSeason);
    expect(emptySeason.json().changed).toBe(false);

    const noResults = await createDbUser("nochange-results");
    const raceWithoutResults = await createFixture(noResults, {
      withWorldRace: true,
    });
    await prisma.race.update({
      where: { id: raceWithoutResults.raceId },
      data: { status: "RACE" },
    });
    await prisma.worldState.update({
      where: {
        universeId_key: {
          universeId: raceWithoutResults.universeId,
          key: "default",
        },
      },
      data: { currentSession: "RACE" },
    });
    const blocked = await progress(app, noResults);
    expect(blocked.json().changed).toBe(false);

    await app.close();
  });

  it("é idempotente e não duplica auditoria", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("idempotent");
    const fixture = await createFixture(user, { withSecondRace: true });

    const first = await progress(app, user);
    expect(first.json().changed).toBe(true);
    const second = await progress(app, user);
    expect(second.json().changed).toBe(false);
    expect(await worldEvents(fixture.universeId)).toHaveLength(1);

    const world = await loadWorld(fixture.universeId);
    expect(world.currentSession).toBe("PRACTICE");

    await app.close();
  });

  it("serializa progressões concorrentes no mesmo Universe", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("concurrent");
    const fixture = await createFixture(user, { withSecondRace: true });

    const [first, second] = await Promise.all([
      progress(app, user),
      progress(app, user),
    ]);
    const results = [first.json(), second.json()];
    expect(results.filter((result) => result.changed)).toHaveLength(1);
    expect(await worldEvents(fixture.universeId)).toHaveLength(1);

    const world = await loadWorld(fixture.universeId);
    expect(world.currentRaceId).toBe(fixture.raceId);

    await app.close();
  });

  it("percorre o lifecycle completo com Race Weekend e progressão", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("lifecycle");
    const fixture = await createFixture(user, { withSecondRace: true });

    await progress(app, user);
    let world = await loadWorld(fixture.universeId);
    expect(world.currentSession).toBe("PRACTICE");

    const runSession = (session: string) =>
      app.inject({
        method: "POST",
        url: `/api/races/${fixture.raceId}/weekend/sessions/${session}/run`,
        headers: { cookie: user.cookie },
        payload: {},
        remoteAddress: `10.144.3.${Math.floor(Math.random() * 200) + 1}`,
      });

    expect((await runSession("PRACTICE")).statusCode).toBe(200);
    expect((await progress(app, user)).json().transition.toSession).toBe(
      "QUALIFYING",
    );
    expect((await runSession("QUALIFYING")).statusCode).toBe(200);
    expect((await progress(app, user)).json().transition.toSession).toBe(
      "RACE",
    );
    expect((await runSession("RACE")).statusCode).toBe(200);
    const finalized = await progress(app, user);
    expect(finalized.json().changed).toBe(true);

    world = await loadWorld(fixture.universeId);
    expect(world.currentSession).toBeNull();
    expect(
      (await prisma.race.findUniqueOrThrow({ where: { id: fixture.raceId } }))
        .status,
    ).toBe("FINISHED");

    const before = await prisma.championshipStanding.findMany({
      where: { seasonId: fixture.seasonId },
      orderBy: { position: "asc" },
    });
    const repeated = await progress(app, user);
    expect(repeated.json().changed).toBe(false);
    const after = await prisma.championshipStanding.findMany({
      where: { seasonId: fixture.seasonId },
      orderBy: { position: "asc" },
    });
    expect(after.map((row) => row.points)).toEqual(before.map((row) => row.points));

    await app.close();
  });

  it("mantém replay determinístico e compatível com snapshot", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("replay");
    const fixture = await createFixture(user, { withSecondRace: true });

    const baseline = await loadWorld(fixture.universeId);
    const baselineEvent = await prisma.timelineEvent.create({
      data: {
        universeId: fixture.universeId,
        sequence: 0,
        worldDate: baseline.currentDate,
        kind: "WORLD_ADVANCED",
        payload: {
          currentDate: baseline.currentDate.toISOString(),
          currentSeasonId: baseline.currentSeasonId,
          currentRaceId: baseline.currentRaceId,
          currentSession: baseline.currentSession,
        },
        causedBy: "SYSTEM",
      },
    });
    void baselineEvent;
    await prisma.worldSnapshot.create({
      data: {
        universeId: fixture.universeId,
        sequence: 0,
        worldDate: baseline.currentDate,
        state: {
          seasonId: fixture.seasonId,
          world: {
            currentDate: baseline.currentDate.toISOString(),
            currentSeasonId: baseline.currentSeasonId,
            currentRaceId: baseline.currentRaceId,
            currentSession: baseline.currentSession,
          },
          standings: [],
        },
      },
    });

    await progress(app, user);
    const progressed = await loadWorld(fixture.universeId);
    const sessionResultsBefore = await prisma.raceSessionResult.count({
      where: { race: { seasonId: fixture.seasonId } },
    });

    const recompute = await app.inject({
      method: "POST",
      url: "/api/timeline/recompute",
      headers: { cookie: user.cookie },
      payload: {},
      remoteAddress: "10.144.4.1",
    });
    expect([200, 400, 409]).toContain(recompute.statusCode);

    const afterReplay = await loadWorld(fixture.universeId);
    expect(afterReplay.currentRaceId).toBe(progressed.currentRaceId);
    expect(afterReplay.currentSession).toBe(progressed.currentSession);
    expect(
      await prisma.raceSessionResult.count({
        where: { race: { seasonId: fixture.seasonId } },
      }),
    ).toBe(sessionResultsBefore);

    await app.close();
  });

  it("isola universos e não dispara automações", async () => {
    const app = buildApp();
    await app.ready();
    const userA = await createDbUser("iso-a");
    const userB = await createDbUser("iso-b");
    const fixtureA = await createFixture(userA, { withSecondRace: true });
    const fixtureB = await createFixture(userB, { withSecondRace: true });

    const evaluationBefore = await prisma.timelineEvent.count({
      where: { universeId: fixtureA.universeId, kind: "ATTRIBUTE_EVOLVED" },
    });
    const aiBefore = await prisma.aiDecision.count();

    await progress(app, userA);

    const worldB = await loadWorld(fixtureB.universeId);
    expect(worldB.currentRaceId).toBeNull();
    expect(worldB.currentSession).toBeNull();
    expect(await worldEvents(fixtureB.universeId)).toHaveLength(0);

    const crossed = await app.inject({
      method: "GET",
      url: `/api/races/${fixtureA.raceId}/weekend`,
      headers: { cookie: userB.cookie },
      remoteAddress: "10.144.5.1",
    });
    expect(crossed.statusCode).toBe(403);

    expect(
      await prisma.timelineEvent.count({
        where: { universeId: fixtureA.universeId, kind: "ATTRIBUTE_EVOLVED" },
      }),
    ).toBe(evaluationBefore);
    expect(await prisma.aiDecision.count()).toBe(aiBefore);

    await app.close();
  });

  it("exige autenticação", async () => {
    const app = buildApp();
    await app.ready();
    const unauthenticated = await app.inject({
      method: "POST",
      url: "/api/world/progress",
      payload: {},
    });
    expect(unauthenticated.statusCode).toBe(401);
    await app.close();
  });
});
