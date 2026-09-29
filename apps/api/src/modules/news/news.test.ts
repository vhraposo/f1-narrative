import { createHmac, randomBytes } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { deleteUniverseDataForUsers } from "../../test-utils/universe-cleanup.js";
import type { JolpicaClient } from "../external-sync/jolpica.client.js";
import { JOLPICA_SOURCE } from "../external-sync/jolpica.service.js";
import { processRaceNarrative } from "../narrative/race-narrative.service.js";

const REFRESH_YEAR = 2077;

type UserFixture = { cookie: string; userId: string };
type UniverseFixture = {
  universeId: string;
  seasonId: string;
  raceAId: string;
  raceBId: string;
  driverProfileIds: string[];
};

const createdUserIds: string[] = [];

async function createDbUser(
  suffix: string,
  role: "ADMIN" | "USER" = "USER",
): Promise<UserFixture> {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET not set");
  const user = await prisma.user.create({
    data: {
      email: `news-${suffix}-${Date.now()}@f1nw.test`,
      name: `News ${suffix}`,
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

async function createUniverseFixture(
  userId: string,
  year: number,
): Promise<UniverseFixture> {
  const universe = await prisma.universe.create({
    data: { userId, status: "READY" },
  });
  const season = await prisma.season.create({
    data: { universeId: universe.id, year, name: String(year) },
  });
  const team = await prisma.team.create({
    data: { name: `Equipe ${year}-${universe.id.slice(0, 4)}`, userId, universeId: universe.id },
  });

  const driverProfileIds: string[] = [];
  for (const [index, name] of ["Alfa", "Beta"].entries()) {
    const character = await prisma.character.create({
      data: {
        name: `Piloto ${name} ${universe.id.slice(0, 4)}`,
        nationality: "Brazil",
        birthDate: new Date("2000-01-01"),
        userId,
        universeId: universe.id,
      },
    });
    const driver = await prisma.driverProfile.create({
      data: { characterId: character.id, teamId: team.id },
    });
    driverProfileIds.push(driver.id);
    await prisma.seasonDriverEntry.create({
      data: {
        driverProfileId: driver.id,
        seasonId: season.id,
        teamId: team.id,
        role: "RACE_SEAT",
        seat: index + 1,
        number: index + 1,
      },
    });
  }

  const raceA = await prisma.race.create({
    data: {
      seasonId: season.id,
      name: `GP Alfa ${year}`,
      circuit: "Circuito A",
      country: "Brazil",
      round: 1,
      date: new Date(`${year}-03-08T00:00:00.000Z`),
      status: "FINISHED",
    },
  });
  const raceB = await prisma.race.create({
    data: {
      seasonId: season.id,
      name: `GP Beta ${year}`,
      circuit: "Circuito B",
      country: "Brazil",
      round: 2,
      date: new Date(`${year}-04-12T00:00:00.000Z`),
      status: "FINISHED",
    },
  });

  await prisma.raceResult.create({
    data: {
      raceId: raceA.id,
      driverProfileId: driverProfileIds[0],
      position: 1,
      grid: 1,
      status: "Finished",
      points: 25,
    },
  });
  await prisma.raceResult.create({
    data: {
      raceId: raceA.id,
      driverProfileId: driverProfileIds[1],
      position: null,
      grid: 2,
      status: "Retired",
      points: 0,
    },
  });
  await prisma.worldState.create({
    data: {
      universeId: universe.id,
      key: "default",
      currentSeasonId: season.id,
      currentRaceId: raceA.id,
    },
  });

  return {
    universeId: universe.id,
    seasonId: season.id,
    raceAId: raceA.id,
    raceBId: raceB.id,
    driverProfileIds,
  };
}

async function createGlobalEvent(
  app: FastifyInstance,
  user: UserFixture,
  title: string,
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/events",
    headers: { cookie: user.cookie },
    payload: { type: "WORLD", title },
    remoteAddress: `10.88.1.${Math.floor(Math.random() * 200) + 1}`,
  });
  expect(response.statusCode).toBe(201);
  return response.json().event.id as string;
}

async function listNews(
  app: FastifyInstance,
  user: UserFixture,
  query = "",
) {
  return app.inject({
    method: "GET",
    url: `/api/news${query}`,
    headers: { cookie: user.cookie },
    remoteAddress: `10.88.2.${Math.floor(Math.random() * 200) + 1}`,
  });
}

describe("News × temporada (Fase 7)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
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
        throw new Error("getRaceResults não deveria ser chamado");
      },
      getCircuits: async () => [],
    } as unknown as JolpicaClient;
    app = buildApp(undefined, undefined, emptyClient);
    await app.ready();
  });

  afterAll(async () => {
    await deleteUniverseDataForUsers(prisma, createdUserIds);
    await prisma.externalSyncRun.deleteMany({
      where: { source: JOLPICA_SOURCE, seasonYear: REFRESH_YEAR },
    });
    await prisma.externalSeason.deleteMany({
      where: { source: JOLPICA_SOURCE, year: REFRESH_YEAR },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  it("degrada Event de corrida em NewsItem com contexto de temporada e corrida", async () => {
    const user = await createDbUser("narr");
    const fixture = await createUniverseFixture(user.userId, 2044);

    const result = await processRaceNarrative(prisma, fixture.raceAId);
    expect(result).not.toBeNull();
    expect(result?.created.length).toBeGreaterThan(0);

    const events = await prisma.event.findMany({
      where: {
        payload: { path: ["raceId"], equals: fixture.raceAId },
      },
      select: { id: true },
    });
    expect(events.length).toBe(result?.created.length);
    for (const event of events) {
      const count = await prisma.newsItem.count({
        where: { eventId: event.id },
      });
      expect(count).toBe(1);
    }

    const response = await listNews(app, user, `?seasonId=${fixture.seasonId}`);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.context.season.id).toBe(fixture.seasonId);
    expect(body.context.race).toBeNull();
    expect(body.news.length).toBe(events.length);
    for (const item of body.news) {
      expect(item.eventId).toBeTruthy();
      expect(item.title).toBeTruthy();
      expect(item.source).toBe("GENERATED_EVENT");
      expect(item.context.season.year).toBe(2044);
      expect(item.context.race.id).toBe(fixture.raceAId);
      expect(item.context.race.round).toBe(1);
    }
  });

  it("filtra por corrida e exclui notícias de outra corrida", async () => {
    const user = await createDbUser("race");
    const fixture = await createUniverseFixture(user.userId, 2045);
    await processRaceNarrative(prisma, fixture.raceAId);

    await prisma.raceResult.create({
      data: {
        raceId: fixture.raceBId,
        driverProfileId: fixture.driverProfileIds[0],
        position: 1,
        grid: 1,
        status: "Finished",
        points: 25,
      },
    });
    await processRaceNarrative(prisma, fixture.raceBId);

    const response = await listNews(app, user, `?raceId=${fixture.raceBId}`);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.context.race.id).toBe(fixture.raceBId);
    expect(body.context.season.id).toBe(fixture.seasonId);
    expect(body.news.length).toBeGreaterThan(0);
    for (const item of body.news) {
      expect(item.context.race.id).toBe(fixture.raceBId);
      expect(item.context.season.year).toBe(2045);
    }
  });

  it("filtra por temporada com várias temporadas no mesmo Universe", async () => {
    const user = await createDbUser("multi");
    const first = await createUniverseFixture(user.userId, 2046);
    await processRaceNarrative(prisma, first.raceAId);

    const secondSeason = await prisma.season.create({
      data: { universeId: first.universeId, year: 2047, name: "2047" },
    });
    const secondRace = await prisma.race.create({
      data: {
        seasonId: secondSeason.id,
        name: "GP Gama 2047",
        round: 1,
        date: new Date("2047-03-10T00:00:00.000Z"),
        status: "FINISHED",
      },
    });
    await prisma.raceResult.create({
      data: {
        raceId: secondRace.id,
        driverProfileId: first.driverProfileIds[0],
        position: 1,
        grid: 1,
        status: "Finished",
        points: 25,
      },
    });
    await processRaceNarrative(prisma, secondRace.id);

    const firstFeed = await listNews(app, user, `?seasonId=${first.seasonId}`);
    const secondFeed = await listNews(
      app,
      user,
      `?seasonId=${secondSeason.id}`,
    );
    expect(firstFeed.statusCode).toBe(200);
    expect(secondFeed.statusCode).toBe(200);
    for (const item of firstFeed.json().news) {
      expect(item.context.season.year).toBe(2046);
    }
    for (const item of secondFeed.json().news) {
      expect(item.context.season.year).toBe(2047);
    }
    expect(firstFeed.json().news.length).toBeGreaterThan(0);
    expect(secondFeed.json().news.length).toBeGreaterThan(0);
    const firstFestivalIds = new Set(
      firstFeed.json().news.map((item: { id: string }) => item.id),
    );
    for (const item of secondFeed.json().news) {
      expect(firstFestivalIds.has(item.id)).toBe(false);
    }
  });

  it("usa a temporada corrente do WorldState quando não há filtro", async () => {
    const user = await createDbUser("current");
    const fixture = await createUniverseFixture(user.userId, 2048);
    await processRaceNarrative(prisma, fixture.raceAId);

    const response = await listNews(app, user);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.context.season.id).toBe(fixture.seasonId);
    expect(body.news.length).toBeGreaterThan(0);
  });

  it("isola temporadas e corridas de outro Universe", async () => {
    const userA = await createDbUser("iso-a");
    const userB = await createDbUser("iso-b");
    const fixtureA = await createUniverseFixture(userA.userId, 2049);
    const fixtureB = await createUniverseFixture(userB.userId, 2049);
    await processRaceNarrative(prisma, fixtureA.raceAId);
    await processRaceNarrative(prisma, fixtureB.raceAId);

    const feedA = await listNews(app, userA, `?seasonId=${fixtureA.seasonId}`);
    const feedB = await listNews(app, userB, `?seasonId=${fixtureB.seasonId}`);
    expect(feedA.statusCode).toBe(200);
    expect(feedB.statusCode).toBe(200);
    expect(feedA.json().news.length).toBeGreaterThan(0);
    expect(feedB.json().news.length).toBeGreaterThan(0);

    const idsA = new Set(
      feedA.json().news.map((item: { id: string }) => item.id),
    );
    for (const item of feedB.json().news) {
      expect(idsA.has(item.id)).toBe(false);
    }

    const crossSeason = await listNews(app, userA, `?seasonId=${fixtureB.seasonId}`);
    expect(crossSeason.statusCode).toBe(403);
    expect(crossSeason.json().code).toBe("SEASON_NOT_IN_UNIVERSE");

    const crossRace = await listNews(app, userA, `?raceId=${fixtureB.raceAId}`);
    expect(crossRace.statusCode).toBe(403);
    expect(crossRace.json().code).toBe("RACE_NOT_IN_UNIVERSE");
  });

  it("retorna 404 para temporada/corrida inexistente e 401 sem sessão", async () => {
    const user = await createDbUser("errors");
    const missingSeason = await listNews(
      app,
      user,
      "?seasonId=00000000-0000-4000-8000-000000000000",
    );
    expect(missingSeason.statusCode).toBe(404);
    expect(missingSeason.json().code).toBe("SEASON_NOT_FOUND");

    const missingRace = await listNews(
      app,
      user,
      "?raceId=00000000-0000-4000-8000-000000000000",
    );
    expect(missingRace.statusCode).toBe(404);
    expect(missingRace.json().code).toBe("RACE_NOT_FOUND");

    const invalid = await listNews(app, user, "?seasonId=not-a-uuid");
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe("VALIDATION_ERROR");

    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/news",
    });
    expect(unauthenticated.statusCode).toBe(401);
  });

  it("mantém notícias sem temporada determinável fora dos feeds", async () => {
    const user = await createDbUser("nocontext");
    const fixture = await createUniverseFixture(user.userId, 2050);
    await processRaceNarrative(prisma, fixture.raceAId);
    const globalEventId = await createGlobalEvent(app, user, "Evento global");

    const news = await prisma.newsItem.findFirstOrThrow({
      where: { eventId: globalEventId },
    });
    expect(news).toBeTruthy();

    const seasonFeed = await listNews(app, user, `?seasonId=${fixture.seasonId}`);
    expect(
      seasonFeed
        .json()
        .news.some((item: { eventId: string }) => item.eventId === globalEventId),
    ).toBe(false);

    const raceFeed = await listNews(app, user, `?raceId=${fixture.raceAId}`);
    expect(
      raceFeed
        .json()
        .news.some((item: { eventId: string }) => item.eventId === globalEventId),
    ).toBe(false);

    const eventNews = await app.inject({
      method: "GET",
      url: `/api/events/${globalEventId}/news`,
      headers: { cookie: user.cookie },
      remoteAddress: "10.88.3.3",
    });
    expect(eventNews.statusCode).toBe(200);
    expect(eventNews.json().news.id).toBe(news.id);
  });

  it("valida contexto de payload contra o Universe do usuário", async () => {
    const userA = await createDbUser("ctx-a");
    const userB = await createDbUser("ctx-b");
    const fixtureA = await createUniverseFixture(userA.userId, 2051);
    const fixtureB = await createUniverseFixture(userB.userId, 2051);

    const wrongRace = await app.inject({
      method: "POST",
      url: "/api/events",
      headers: { cookie: userA.cookie },
      payload: {
        type: "RACE",
        title: "Contexto cruzado",
        payload: { raceId: fixtureB.raceAId },
      },
      remoteAddress: "10.88.4.1",
    });
    expect(wrongRace.statusCode).toBe(403);
    expect(wrongRace.json().code).toBe("RACE_NOT_IN_UNIVERSE");

    const wrongSeason = await app.inject({
      method: "POST",
      url: "/api/events",
      headers: { cookie: userA.cookie },
      payload: {
        type: "NEWS",
        title: "Temporada cruzada",
        payload: { seasonId: fixtureB.seasonId },
      },
      remoteAddress: "10.88.4.2",
    });
    expect(wrongSeason.statusCode).toBe(403);
    expect(wrongSeason.json().code).toBe("SEASON_NOT_IN_UNIVERSE");

    const mismatch = await app.inject({
      method: "POST",
      url: "/api/events",
      headers: { cookie: userA.cookie },
      payload: {
        type: "RACE",
        title: "Contexto inconsistente",
        payload: { raceId: fixtureA.raceAId, seasonId: fixtureB.seasonId },
      },
      remoteAddress: "10.88.4.3",
    });
    expect(mismatch.statusCode).toBe(403);

    const valid = await app.inject({
      method: "POST",
      url: "/api/events",
      headers: { cookie: userA.cookie },
      payload: {
        type: "RACE",
        title: "Contexto válido",
        payload: { raceId: fixtureA.raceAId, seasonId: fixtureA.seasonId },
      },
      remoteAddress: "10.88.4.4",
    });
    expect(valid.statusCode).toBe(201);

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/events/${valid.json().event.id}`,
      headers: { cookie: userA.cookie },
      payload: { payload: { raceId: fixtureB.raceAId } },
      remoteAddress: "10.88.4.5",
    });
    expect(patch.statusCode).toBe(403);
    expect(patch.json().code).toBe("RACE_NOT_IN_UNIVERSE");
  });

  it("é idempotente: reprocessar a corrida não duplica eventos nem notícias", async () => {
    const user = await createDbUser("dedup");
    const fixture = await createUniverseFixture(user.userId, 2052);

    await processRaceNarrative(prisma, fixture.raceAId);
    const newsBefore = await prisma.newsItem.count();
    const eventsBefore = await prisma.event.count();

    await processRaceNarrative(prisma, fixture.raceAId);
    const newsAfter = await prisma.newsItem.count();
    const eventsAfter = await prisma.event.count();

    expect(newsAfter).toBe(newsBefore);
    expect(eventsAfter).toBe(eventsBefore);

    const feed = await listNews(app, user, `?seasonId=${fixture.seasonId}`);
    expect(feed.json().news.length).toBeGreaterThan(0);
  });

  it("ordena de forma determinística e pagina com hasMore", async () => {
    const user = await createDbUser("sort");
    const fixture = await createUniverseFixture(user.userId, 2053);
    await processRaceNarrative(prisma, fixture.raceAId);

    const response = await listNews(
      app,
      user,
      `?seasonId=${fixture.seasonId}&limit=2`,
    );
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.news).toHaveLength(2);
    expect(body.hasMore).toBe(true);
    expect(body.nextOffset).toBe(2);

    const expected = [...body.news].sort((a, b) => {
      const worldDateA = a.worldDate ?? "";
      const worldDateB = b.worldDate ?? "";
      if (worldDateA !== worldDateB) return worldDateA < worldDateB ? 1 : -1;
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
      return a.id < b.id ? 1 : -1;
    });
    expect(body.news).toEqual(expected);

    const secondPage = await listNews(
      app,
      user,
      `?seasonId=${fixture.seasonId}&limit=2&offset=2`,
    );
    expect(secondPage.statusCode).toBe(200);
    for (const item of secondPage.json().news) {
      expect(
        body.news.some((first: { id: string }) => first.id === item.id),
      ).toBe(false);
    }
  });

  it("retorna feed vazio quando não há temporada corrente nem notícias", async () => {
    const user = await createDbUser("empty");
    const response = await listNews(app, user);
    expect(response.statusCode).toBe(200);
    expect(response.json().news).toEqual([]);
    expect(response.json().context.season).toBeNull();
    expect(response.json().hasMore).toBe(false);
  });

  it("não contamina a Timeline e não cria notícia no external refresh", async () => {
    const user = await createDbUser("timeline");
    const fixture = await createUniverseFixture(user.userId, 2054);

    const timelineBefore = await prisma.timelineEvent.count({
      where: { universeId: fixture.universeId },
    });
    const newsBefore = await prisma.newsItem.count();

    await processRaceNarrative(prisma, fixture.raceAId);

    const timelineAfter = await prisma.timelineEvent.count({
      where: { universeId: fixture.universeId },
    });
    expect(timelineAfter).toBe(timelineBefore);

    const admin = await createDbUser("sync-admin", "ADMIN");
    const newsBeforeRefresh = await prisma.newsItem.count();
    const refresh = await app.inject({
      method: "POST",
      url: "/api/external-sync/refresh",
      headers: { cookie: admin.cookie },
      payload: { seasonYear: REFRESH_YEAR },
      remoteAddress: "10.88.5.1",
    });
    expect([200, 502]).toContain(refresh.statusCode);
    const newsAfterRefresh = await prisma.newsItem.count();
    expect(newsAfterRefresh).toBe(newsBeforeRefresh);
    expect(newsAfterRefresh).toBeGreaterThan(newsBefore);
  });
});
