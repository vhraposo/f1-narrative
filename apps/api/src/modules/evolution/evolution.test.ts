import { createHmac, randomBytes } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { afterAll, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { deleteUniverseDataForUsers } from "../../test-utils/universe-cleanup.js";
import type { JolpicaClient } from "../external-sync/jolpica.client.js";
import { JOLPICA_SOURCE } from "../external-sync/jolpica.service.js";

const REFRESH_YEAR = 2091;
const YEAR = 2089;

type TestUser = { cookie: string; userId: string };

type Fixture = {
  universeId: string;
  seasonId: string;
  teamId: string;
  characterIds: string[];
  driverProfileIds: string[];
  raceIds: string[];
};

const createdUserIds: string[] = [];

async function createDbUser(
  suffix: string,
  role: "ADMIN" | "USER" = "USER",
): Promise<TestUser> {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET not set");
  const user = await prisma.user.create({
    data: {
      email: `evo-${suffix}-${Date.now()}${Math.random()}@f1nw.test`,
      name: `Evo ${suffix}`,
      role,
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

async function createSeasonFixture(
  userId: string,
  options: { withRace?: boolean } = { withRace: true },
): Promise<Fixture> {
  const universe = await prisma.universe.create({
    data: { userId, status: "READY" },
  });
  const season = await prisma.season.create({
    data: { universeId: universe.id, year: YEAR, name: String(YEAR) },
  });
  const team = await prisma.team.create({
    data: {
      name: `Equipe ${Math.random().toString(36).slice(2, 8)}`,
      userId,
      universeId: universe.id,
    },
  });

  const characterIds: string[] = [];
  const driverProfileIds: string[] = [];
  for (const [index, controlledBy] of (["USER", "AI"] as const).entries()) {
    const character = await prisma.character.create({
      data: {
        name: `Piloto ${controlledBy} ${Math.random().toString(36).slice(2, 6)}`,
        nationality: "Brazil",
        birthDate: new Date("2000-01-01"),
        userId,
        universeId: universe.id,
        controlledBy,
      },
    });
    const driver = await prisma.driverProfile.create({
      data: { characterId: character.id, teamId: team.id },
    });
    await prisma.seasonDriverEntry.create({
      data: {
        driverProfileId: driver.id,
        seasonId: season.id,
        teamId: team.id,
        role: "RACE_SEAT",
        seat: index + 1,
        number: index + 1,
        status: "ACTIVE",
      },
    });
    characterIds.push(character.id);
    driverProfileIds.push(driver.id);
  }

  const raceIds: string[] = [];
  if (options.withRace) {
    const race = await prisma.race.create({
      data: {
        seasonId: season.id,
        name: `GP ${YEAR}`,
        round: 1,
        date: new Date(`${YEAR}-03-01T00:00:00.000Z`),
        status: "FINISHED",
      },
    });
    raceIds.push(race.id);
    await prisma.raceResult.createMany({
      data: [
        {
          raceId: race.id,
          driverProfileId: driverProfileIds[0],
          position: 1,
          grid: 1,
          status: "Finished",
          points: 25,
        },
        {
          raceId: race.id,
          driverProfileId: driverProfileIds[1],
          position: null,
          grid: 2,
          status: "Retired",
          points: 0,
        },
      ],
    });
    await prisma.worldState.create({
      data: {
        universeId: universe.id,
        key: "default",
        currentSeasonId: season.id,
        currentDate: new Date(`${YEAR}-03-02T00:00:00.000Z`),
      },
    });
  }

  return {
    universeId: universe.id,
    seasonId: season.id,
    teamId: team.id,
    characterIds,
    driverProfileIds,
    raceIds,
  };
}

function evaluate(app: FastifyInstance, user: TestUser, seasonId: string) {
  return app.inject({
    method: "POST",
    url: `/api/evolution/seasons/${seasonId}/evaluate`,
    headers: { cookie: user.cookie },
    remoteAddress: `10.111.1.${Math.floor(Math.random() * 200) + 1}`,
  });
}

function apply(app: FastifyInstance, user: TestUser, seasonId: string) {
  return app.inject({
    method: "POST",
    url: `/api/evolution/seasons/${seasonId}/apply`,
    headers: { cookie: user.cookie },
    remoteAddress: `10.111.2.${Math.floor(Math.random() * 200) + 1}`,
  });
}

async function attributeSnapshot(seasonId: string) {
  const rows = await prisma.driverAttribute.findMany({
    where: { seasonId },
    orderBy: { driverProfileId: "asc" },
  });
  return rows.map((row) => ({
    driverProfileId: row.driverProfileId,
    speed: row.speed,
    consistency: row.consistency,
    racecraft: row.racecraft,
    aggression: row.aggression,
  }));
}

describe("Driver/Team evolution (Fase 10)", () => {
  afterAll(async () => {
    await prisma.externalSyncRun.deleteMany({
      where: { source: JOLPICA_SOURCE, seasonYear: REFRESH_YEAR },
    });
    await prisma.externalSeason.deleteMany({
      where: { source: JOLPICA_SOURCE, year: REFRESH_YEAR },
    });
    await deleteUniverseDataForUsers(prisma, createdUserIds);
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it("avalia sem escrever, de forma determinística e auditável", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("evaluate");
    const fixture = await createSeasonFixture(user.userId);

    const first = await evaluate(app, user, fixture.seasonId);
    const second = await evaluate(app, user, fixture.seasonId);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json()).toEqual(second.json());

    const changeSet = first.json().changeSet;
    expect(changeSet.changed).toBe(true);
    expect(changeSet.racesConsidered).toBe(1);
    expect(changeSet.fingerprint).toHaveLength(64);
    expect(changeSet.drivers).toHaveLength(2);
    expect(changeSet.teams).toHaveLength(1);
    const winnerChange = changeSet.drivers.find(
      (change: { driverProfileId: string }) =>
        change.driverProfileId === fixture.driverProfileIds[0],
    );
    expect(winnerChange.before.speed).toBe(50);
    expect(winnerChange.after.speed).toBe(52);
    expect(changeSet.teams[0].after.carSpeed).toBe(52);

    const attributes = await prisma.driverAttribute.count({
      where: { seasonId: fixture.seasonId },
    });
    const performance = await prisma.teamPerformance.count({
      where: { seasonId: fixture.seasonId },
    });
    expect(attributes).toBe(0);
    expect(performance).toBe(0);

    await app.close();
  });

  it("aplica deltas, materializa atributos e registra a Timeline", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("apply");
    const fixture = await createSeasonFixture(user.userId);

    const response = await apply(app, user, fixture.seasonId);
    expect(response.statusCode).toBe(200);
    const changeSet = response.json().changeSet;
    expect(changeSet.changed).toBe(true);

    const attributes = await prisma.driverAttribute.findMany({
      where: { seasonId: fixture.seasonId },
      orderBy: { driverProfileId: "asc" },
    });
    expect(attributes).toHaveLength(2);
    const winner = attributes.find(
      (row) => row.driverProfileId === fixture.driverProfileIds[0],
    );
    expect(winner?.speed).toBe(52);
    expect(winner?.consistency).toBe(52);

    const performance = await prisma.teamPerformance.findUniqueOrThrow({
      where: {
        seasonId_teamId: {
          seasonId: fixture.seasonId,
          teamId: fixture.teamId,
        },
      },
    });
    expect(performance.carSpeed).toBe(52);

    const event = await prisma.timelineEvent.findFirst({
      where: {
        universeId: fixture.universeId,
        kind: "ATTRIBUTE_EVOLVED",
        payload: { path: ["seasonId"], equals: fixture.seasonId },
      },
    });
    expect(event).not.toBeNull();
    const payload = event?.payload as Record<string, unknown>;
    expect(payload.fingerprint).toBe(changeSet.fingerprint);
    expect(payload.racesConsidered).toBe(1);

    const status = await app.inject({
      method: "GET",
      url: `/api/evolution/seasons/${fixture.seasonId}`,
      headers: { cookie: user.cookie },
      remoteAddress: "10.111.3.1",
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().lastRun.driverChanges).toBe(2);
    expect(status.json().lastRun.teamChanges).toBe(1);

    await app.close();
  });

  it("é idempotente: repetir a mesma evolução não duplica deltas", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("idempotent");
    const fixture = await createSeasonFixture(user.userId);

    expect((await apply(app, user, fixture.seasonId)).statusCode).toBe(200);
    const snapshot = await attributeSnapshot(fixture.seasonId);

    const repeated = await apply(app, user, fixture.seasonId);
    expect(repeated.statusCode).toBe(409);
    expect(repeated.json().code).toBe("ALREADY_APPLIED");
    expect(await attributeSnapshot(fixture.seasonId)).toEqual(snapshot);

    const evaluated = await evaluate(app, user, fixture.seasonId);
    expect(evaluated.statusCode).toBe(200);
    expect(evaluated.json().changeSet.changed).toBe(false);
    expect(evaluated.json().changeSet.alreadyApplied).toBe(true);

    await app.close();
  });

  it("aplica nova evolução quando surge corrida finalizada inédita", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("newrace");
    const fixture = await createSeasonFixture(user.userId);

    expect((await apply(app, user, fixture.seasonId)).statusCode).toBe(200);
    const before = await attributeSnapshot(fixture.seasonId);

    const race = await prisma.race.create({
      data: {
        seasonId: fixture.seasonId,
        name: `GP ${YEAR} 2`,
        round: 2,
        date: new Date(`${YEAR}-04-01T00:00:00.000Z`),
        status: "FINISHED",
      },
    });
    await prisma.raceResult.createMany({
      data: [
        {
          raceId: race.id,
          driverProfileId: fixture.driverProfileIds[0],
          position: 1,
          grid: 2,
          status: "Finished",
          points: 25,
        },
        {
          raceId: race.id,
          driverProfileId: fixture.driverProfileIds[1],
          position: 2,
          grid: 1,
          status: "Finished",
          points: 18,
        },
      ],
    });

    const evaluated = await evaluate(app, user, fixture.seasonId);
    expect(evaluated.json().changeSet.changed).toBe(true);

    const applied = await apply(app, user, fixture.seasonId);
    expect(applied.statusCode).toBe(200);
    const after = await attributeSnapshot(fixture.seasonId);
    const winnerBefore = before.find(
      (row) => row.driverProfileId === fixture.driverProfileIds[0],
    );
    const winnerAfter = after.find(
      (row) => row.driverProfileId === fixture.driverProfileIds[0],
    );
    expect(winnerAfter?.speed).toBeGreaterThan(winnerBefore?.speed ?? 0);
    expect(winnerAfter?.speed).toBeLessThanOrEqual(100);

    await app.close();
  });

  it("retorna NO_CHANGES sem corridas finalizadas e sem notícias de fonte externa", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("nochanges");
    const fixture = await createSeasonFixture(user.userId, {
      withRace: false,
    });

    const evaluated = await evaluate(app, user, fixture.seasonId);
    expect(evaluated.statusCode).toBe(200);
    expect(evaluated.json().changeSet.changed).toBe(false);
    expect(evaluated.json().changeSet.racesConsidered).toBe(0);

    const applied = await apply(app, user, fixture.seasonId);
    expect(applied.statusCode).toBe(409);
    expect(applied.json().code).toBe("NO_CHANGES");

    await app.close();
  });

  it("ignora corridas não finalizadas no fingerprint e nas mudanças", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("unfinished");
    const fixture = await createSeasonFixture(user.userId);

    const baseline = await evaluate(app, user, fixture.seasonId);
    const baselineFingerprint = baseline.json().changeSet.fingerprint;

    const race = await prisma.race.create({
      data: {
        seasonId: fixture.seasonId,
        name: `GP ${YEAR} em andamento`,
        round: 3,
        status: "RACE",
      },
    });
    await prisma.raceResult.create({
      data: {
        raceId: race.id,
        driverProfileId: fixture.driverProfileIds[0],
        position: 1,
        grid: 1,
        status: "Finished",
        points: 25,
      },
    });

    const evaluated = await evaluate(app, user, fixture.seasonId);
    expect(evaluated.json().changeSet.fingerprint).toBe(baselineFingerprint);
    expect(evaluated.json().changeSet.racesConsidered).toBe(1);

    await app.close();
  });

  it("mantém isolamento entre universos e evolui USER e AI", async () => {
    const app = buildApp();
    await app.ready();
    const userA = await createDbUser("iso-a");
    const userB = await createDbUser("iso-b");
    const fixtureA = await createSeasonFixture(userA.userId);
    const fixtureB = await createSeasonFixture(userB.userId);

    expect((await apply(app, userA, fixtureA.seasonId)).statusCode).toBe(200);
    expect(
      await prisma.driverAttribute.count({ where: { seasonId: fixtureB.seasonId } }),
    ).toBe(0);

    expect((await apply(app, userB, fixtureB.seasonId)).statusCode).toBe(200);
    const rowsA = await attributeSnapshot(fixtureA.seasonId);
    const rowsB = await attributeSnapshot(fixtureB.seasonId);
    expect(rowsA).toHaveLength(2);
    expect(rowsB).toHaveLength(2);
    expect(rowsA.map((row) => row.driverProfileId)).not.toEqual(
      rowsB.map((row) => row.driverProfileId),
    );

    await app.close();
  });

  it("protege ownership da temporada e exige autenticação", async () => {
    const app = buildApp();
    await app.ready();
    const owner = await createDbUser("owner");
    const intruder = await createDbUser("intruder");
    const fixture = await createSeasonFixture(owner.userId);

    const cross = await evaluate(app, intruder, fixture.seasonId);
    expect(cross.statusCode).toBe(403);
    expect(cross.json().code).toBe("SEASON_NOT_IN_UNIVERSE");

    const missing = await evaluate(
      app,
      owner,
      "00000000-0000-4000-8000-000000000000",
    );
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe("SEASON_NOT_FOUND");

    const unauthenticated = await app.inject({
      method: "POST",
      url: `/api/evolution/seasons/${fixture.seasonId}/evaluate`,
    });
    expect(unauthenticated.statusCode).toBe(401);

    await app.close();
  });

  it("respeita limites 0..100 ao aplicar deltas", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("clamp");
    const fixture = await createSeasonFixture(user.userId);

    const preset = await app.inject({
      method: "PUT",
      url: `/api/attributes/seasons/${fixture.seasonId}/drivers/${fixture.characterIds[0]}`,
      headers: { cookie: user.cookie },
      payload: { speed: 99, consistency: 99, racecraft: 99, aggression: 99 },
      remoteAddress: "10.111.4.1",
    });
    expect(preset.statusCode).toBe(200);

    const applied = await apply(app, user, fixture.seasonId);
    expect(applied.statusCode).toBe(200);

    const row = await prisma.driverAttribute.findUniqueOrThrow({
      where: {
        seasonId_driverProfileId: {
          seasonId: fixture.seasonId,
          driverProfileId: fixture.driverProfileIds[0],
        },
      },
    });
    expect(row.speed).toBe(100);
    expect(row.consistency).toBe(100);
    expect(row.racecraft).toBeLessThanOrEqual(100);
    expect(row.racecraft).toBeGreaterThanOrEqual(99);
    expect(row.aggression).toBeLessThanOrEqual(100);
    expect(row.aggression).toBeGreaterThanOrEqual(99);

    await app.close();
  });

  it("não é reescrito por external refresh nem por recompute da timeline", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("external");
    const fixture = await createSeasonFixture(user.userId);
    expect((await apply(app, user, fixture.seasonId)).statusCode).toBe(200);
    const snapshot = await attributeSnapshot(fixture.seasonId);

    const admin = await createDbUser("external-admin", "ADMIN");
    const emptyClient = {
      getSeasonRaces: async () => [],
      getConstructors: async () => [],
      getDrivers: async () => [],
      getDriverStandings: async () => ({
        season: String(REFRESH_YEAR),
        round: "1",
        DriverStandings: [],
      }),
      getRaceResults: async () => {
        throw new Error("não deve ser chamado");
      },
      getCircuits: async () => [],
    } as unknown as JolpicaClient;
    const refreshApp = buildApp(undefined, undefined, emptyClient);
    await refreshApp.ready();
    const refresh = await refreshApp.inject({
      method: "POST",
      url: "/api/external-sync/refresh",
      headers: { cookie: admin.cookie },
      payload: { seasonYear: REFRESH_YEAR },
      remoteAddress: "10.111.5.1",
    });
    expect([200, 502]).toContain(refresh.statusCode);
    expect(await attributeSnapshot(fixture.seasonId)).toEqual(snapshot);

    const recompute = await app.inject({
      method: "POST",
      url: "/api/timeline/recompute",
      headers: { cookie: user.cookie },
      payload: {},
      remoteAddress: "10.111.5.2",
    });
    expect([200, 400, 409]).toContain(recompute.statusCode);
    expect(await attributeSnapshot(fixture.seasonId)).toEqual(snapshot);

    await refreshApp.close();
    await app.close();
  });
});
