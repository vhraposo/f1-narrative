import { createHmac, randomBytes } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { deleteUniverseDataForUsers } from "../../test-utils/universe-cleanup.js";
import {
  getActiveSyncKeys,
  runWithSyncLock,
} from "./external-sync-run.js";
import { JolpicaClient } from "./jolpica.client.js";
import { JOLPICA_SOURCE } from "./jolpica.service.js";
import { JolpicaTransport } from "./jolpica.transport.js";

const BASE_URL = "https://mock.invalid/f1/";
const YEAR = 2046;
const ID_PREFIX = "sync2046";

type FailMode = "none" | "http404" | "http500" | "rate429" | "malformed" | "timeout";

class RefreshFixtureServer {
  raceName = "Australian Grand Prix";
  raceDate = "2046-03-08";
  failMode: FailMode = "none";
  failOn = "";
  requests: string[] = [];

  readonly constructors = [
    {
      constructorId: `${ID_PREFIX}-mclaren`,
      name: "McLaren",
      nationality: "British",
    },
  ];
  readonly drivers = [
    {
      driverId: `${ID_PREFIX}-norris`,
      permanentNumber: "4",
      code: "NOR",
      givenName: "Lando",
      familyName: "Norris",
      nationality: "British",
    },
  ];
  readonly standings = [
    {
      position: "1",
      points: "25",
      wins: "1",
      Driver: this.drivers[0],
      Constructors: this.constructors,
    },
  ];

  private race(round: number) {
    return {
      season: String(YEAR),
      round: String(round),
      raceName: this.raceName,
      Circuit: {
        circuitId: `${ID_PREFIX}-albert_park`,
        circuitName: "Albert Park",
        Location: { locality: "Melbourne", country: "Australia" },
      },
      date: this.raceDate,
    };
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const parts = url.pathname.split("/").filter(Boolean);
    const filename = parts[parts.length - 1] ?? "";
    this.requests.push(url.pathname);

    if (this.failMode === "timeout" && filename.includes(this.failOn)) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    }
    if (this.failOn && filename.includes(this.failOn)) {
      if (this.failMode === "http500") {
        return new Response("boom", { status: 500 });
      }
      if (this.failMode === "rate429") {
        return new Response("slow down", { status: 429 });
      }
      if (this.failMode === "http404") {
        return new Response("not found", { status: 404 });
      }
      if (this.failMode === "malformed") {
        return this.json({});
      }
    }

    const body = (table: Record<string, unknown>) => ({
      MRData: {
        series: "f1",
        url: url.toString(),
        limit: "100",
        offset: "0",
        total: "1",
        ...table,
      },
    });

    if (filename === "constructors.json") {
      return this.json(body({ ConstructorTable: { Constructors: this.constructors } }));
    }
    if (filename === "drivers.json") {
      return this.json(body({ DriverTable: { Drivers: this.drivers } }));
    }
    if (filename === "driverStandings.json") {
      return this.json(
        body({
          StandingsTable: {
            StandingsLists: [
              {
                season: String(YEAR),
                round: "1",
                DriverStandings: this.standings,
              },
            ],
          },
        }),
      );
    }
    if (filename === "results.json") {
      const round = Number(parts[parts.length - 2]);
      return this.json(
        body({
          RaceTable: {
            season: String(YEAR),
            round: String(round),
            Races: [
              {
                ...this.race(round),
                Results: [
                  {
                    number: "4",
                    position: "1",
                    positionText: "1",
                    points: this.standings[0].points,
                    grid: "1",
                    status: "Finished",
                    Driver: this.drivers[0],
                    Constructor: this.constructors[0],
                  },
                ],
              },
            ],
          },
        }),
      );
    }
    return this.json(
      body({
        RaceTable: { season: String(YEAR), round: "1", Races: [this.race(1)] },
      }),
    );
  };
}

async function createDbUser(
  suffix: string,
  role: "ADMIN" | "USER",
): Promise<{ cookie: string; userId: string }> {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET not set");
  const user = await prisma.user.create({
    data: {
      email: `refresh-${suffix}-${Date.now()}@f1nw.test`,
      name: `Refresh ${suffix}`,
      role,
      password: null,
      emailVerified: false,
    },
    select: { id: true },
  });
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

async function cleanMirror() {
  await prisma.externalResult.deleteMany({
    where: { source: JOLPICA_SOURCE, externalRace: { seasonYear: YEAR } },
  });
  await prisma.externalStanding.deleteMany({
    where: { source: JOLPICA_SOURCE, seasonYear: YEAR },
  });
  await prisma.externalDriverSeason.deleteMany({
    where: { source: JOLPICA_SOURCE, seasonYear: YEAR },
  });
  await prisma.externalRace.deleteMany({
    where: { source: JOLPICA_SOURCE, seasonYear: YEAR },
  });
  await prisma.externalCircuit.deleteMany({
    where: { source: JOLPICA_SOURCE, externalId: { startsWith: ID_PREFIX } },
  });
  await prisma.externalDriver.deleteMany({
    where: { source: JOLPICA_SOURCE, externalId: { startsWith: ID_PREFIX } },
  });
  await prisma.externalTeam.deleteMany({
    where: { source: JOLPICA_SOURCE, externalId: { startsWith: ID_PREFIX } },
  });
  await prisma.externalSeason.deleteMany({
    where: { source: JOLPICA_SOURCE, year: YEAR },
  });
  await prisma.externalSyncRun.deleteMany({
    where: { source: JOLPICA_SOURCE, seasonYear: YEAR },
  });
}

describe("External data refresh (Fase 6)", () => {
  let app: FastifyInstance;
  let server: RefreshFixtureServer;
  let admin: { cookie: string; userId: string };
  let plainUser: { cookie: string; userId: string };
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    server = new RefreshFixtureServer();
    const client = new JolpicaClient({
      transport: new JolpicaTransport({
        baseUrl: BASE_URL,
        timeoutMs: 500,
        maxRetries: 0,
        fetchImpl: server.fetch,
      }),
    });
    app = buildApp(undefined, undefined, client);
    await app.ready();
    admin = await createDbUser("admin", "ADMIN");
    plainUser = await createDbUser("user", "USER");
    createdUserIds.push(admin.userId, plainUser.userId);
  });

  beforeEach(() => {
    server.failMode = "none";
    server.failOn = "";
    server.raceName = "Australian Grand Prix";
    server.raceDate = "2046-03-08";
    server.standings[0].points = "25";
  });

  afterAll(async () => {
    await cleanMirror();
    await deleteUniverseDataForUsers(prisma, createdUserIds);
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  function refresh(cookie?: string) {
    return app.inject({
      method: "POST",
      url: "/api/external-sync/refresh",
      headers: cookie ? { cookie } : {},
      payload: { seasonYear: YEAR },
      remoteAddress: `10.77.0.${Math.floor(Math.random() * 200) + 1}`,
    });
  }

  it("executa o refresh autorizado na ordem dos scopes e registra os runs", async () => {
    const response = await refresh(admin.cookie);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.source).toBe(JOLPICA_SOURCE);
    expect(body.year).toBe(YEAR);
    expect(body.failedScope).toBeNull();
    expect(body.scopes.map((item: { scope: string }) => item.scope)).toEqual([
      "SEASON",
      "TEAMS",
      "DRIVERS",
      "DRIVER_SEASONS",
      "RACES",
      "RESULTS",
      "STANDINGS",
    ]);
    expect(body.durationMs).toBeGreaterThanOrEqual(0);

    const runs = await prisma.externalSyncRun.findMany({
      where: { source: JOLPICA_SOURCE, seasonYear: YEAR, scope: { not: "REFRESH" } },
      orderBy: { startedAt: "asc" },
    });
    expect(runs).toHaveLength(7);
    for (const run of runs) {
      expect(run.status).toBe("SUCCESS");
      expect(run.triggeredById).toBe(admin.userId);
      expect(run.finishedAt).not.toBeNull();
      expect(run.lastSyncedAt).not.toBeNull();
      expect(run.statistics).not.toBeNull();
      expect(run.error).toBeNull();
    }

    const driver = await prisma.externalDriver.findUniqueOrThrow({
      where: {
        source_externalId: {
          source: JOLPICA_SOURCE,
          externalId: `${ID_PREFIX}-norris`,
        },
      },
    });
    expect(driver.contentHash).toBeTruthy();
  });

  it("rejeita refresh sem autenticação e sem autorização de admin", async () => {
    const before = await prisma.externalSyncRun.count({
      where: { source: JOLPICA_SOURCE, seasonYear: YEAR },
    });

    const unauthenticated = await refresh();
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json().code).toBe("UNAUTHENTICATED");

    const forbidden = await refresh(plainUser.cookie);
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().code).toBe("FORBIDDEN");

    const after = await prisma.externalSyncRun.count({
      where: { source: JOLPICA_SOURCE, seasonYear: YEAR },
    });
    expect(after).toBe(before);
  });

  it("valida o corpo da requisição", async () => {
    const missing = await app.inject({
      method: "POST",
      url: "/api/external-sync/refresh",
      headers: { cookie: admin.cookie },
      payload: {},
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/api/external-sync/refresh",
      headers: { cookie: admin.cookie },
      payload: { seasonYear: 1000 },
    });
    expect(missing.statusCode).toBe(400);
    expect(invalid.statusCode).toBe(400);
  });

  it("é idempotente e mantém contentHash quando a fonte não muda", async () => {
    const first = await refresh(admin.cookie);
    expect(first.statusCode).toBe(200);
    const raceBefore = await prisma.externalRace.findFirstOrThrow({
      where: { source: JOLPICA_SOURCE, seasonYear: YEAR },
    });

    const second = await refresh(admin.cookie);
    expect(second.statusCode).toBe(200);
    const scopes = second.json().scopes as Array<{
      scope: string;
      counts: { created: number; updated: number; unchanged: number; skipped: number };
    }>;
    for (const item of scopes) {
      expect(item.counts.created, item.scope).toBe(0);
      expect(item.counts.updated, item.scope).toBe(0);
      expect(item.counts.unchanged, item.scope).toBeGreaterThan(0);
    }

    const raceAfter = await prisma.externalRace.findFirstOrThrow({
      where: { source: JOLPICA_SOURCE, seasonYear: YEAR },
    });
    expect(raceAfter.id).toBe(raceBefore.id);
    expect(raceAfter.contentHash).toBe(raceBefore.contentHash);
  });

  it("atualiza apenas o Mirror quando a fonte muda", async () => {
    await refresh(admin.cookie);
    server.raceName = "Australian Grand Prix (revisado)";

    const response = await refresh(admin.cookie);
    expect(response.statusCode).toBe(200);
    const racesScope = (
      response.json().scopes as Array<{
        scope: string;
        counts: { updated: number };
      }>
    ).find((item) => item.scope === "RACES");
    expect(racesScope?.counts.updated).toBeGreaterThan(0);

    const race = await prisma.externalRace.findFirstOrThrow({
      where: { source: JOLPICA_SOURCE, seasonYear: YEAR },
    });
    expect(race.name).toContain("revisado");
  });

  it("coalesce refreshes concorrentes sem duplicar fetches nem runs", async () => {
    server.requests = [];
    const solo = await refresh(admin.cookie);
    expect(solo.statusCode).toBe(200);
    const soloRequestCount = server.requests.length;

    const beforeSeason = await prisma.externalSyncRun.count({
      where: { source: JOLPICA_SOURCE, scope: "SEASON", seasonYear: YEAR },
    });

    server.requests = [];
    const [first, second] = await Promise.all([
      refresh(admin.cookie),
      refresh(admin.cookie),
    ]);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().scopes).toEqual(second.json().scopes);
    expect(server.requests.length).toBe(soloRequestCount);

    const seasonRuns = await prisma.externalSyncRun.count({
      where: { source: JOLPICA_SOURCE, scope: "SEASON", seasonYear: YEAR },
    });
    expect(seasonRuns).toBe(beforeSeason + 1);
  });

  it("expõe locks ativos enquanto a execução está pendente", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = runWithSyncLock("jolpica:TEST:2046", async () => {
      await gate;
      return "ok";
    });
    expect(getActiveSyncKeys()).toContain("jolpica:TEST:2046");
    release();
    await expect(pending).resolves.toBe("ok");
    expect(getActiveSyncKeys()).not.toContain("jolpica:TEST:2046");
  });

  it("registra falha HTTP externa sem vazar detalhes e termina o run", async () => {
    server.failMode = "http500";
    server.failOn = "constructors";

    const response = await refresh(admin.cookie);
    expect(response.statusCode).toBe(502);
    const body = response.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("SOURCE_UNAVAILABLE");
    expect(body.failedScope).toBe("TEAMS");
    expect(body.error).not.toContain("boom");
    expect(response.body).not.toContain("stack");

    const failed = await prisma.externalSyncRun.findFirstOrThrow({
      where: { source: JOLPICA_SOURCE, scope: "TEAMS", seasonYear: YEAR },
      orderBy: { startedAt: "desc" },
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.finishedAt).not.toBeNull();
    expect(failed.error).toBeTruthy();
    expect(failed.error).not.toContain("at ");
    const stillRunning = await prisma.externalSyncRun.count({
      where: { source: JOLPICA_SOURCE, seasonYear: YEAR, status: "RUNNING" },
    });
    expect(stillRunning).toBe(0);
  });

  it("mapeia rate limit (429) com erro semântico", async () => {
    server.failMode = "rate429";
    server.failOn = "constructors";

    const response = await refresh(admin.cookie);
    expect(response.statusCode).toBe(429);
    expect(response.json().code).toBe("SOURCE_RATE_LIMITED");
  });

  it("mapeia timeout com erro semântico", async () => {
    server.failMode = "timeout";
    server.failOn = "constructors";

    const response = await refresh(admin.cookie);
    expect(response.statusCode).toBe(504);
    expect(response.json().code).toBe("SOURCE_TIMEOUT");
  });

  it("mapeia payload inválido e 404 da fonte", async () => {
    server.failMode = "malformed";
    server.failOn = "constructors";
    const malformed = await refresh(admin.cookie);
    expect(malformed.statusCode).toBe(502);
    expect(malformed.json().code).toBe("SOURCE_MALFORMED");

    server.failMode = "http404";
    const notFound = await refresh(admin.cookie);
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json().code).toBe("SOURCE_NOT_FOUND");
  });

  it("não altera dados customizados do Universe nem cria timeline", async () => {
    const universe = await prisma.universe.create({
      data: { userId: admin.userId, status: "READY" },
    });
    const season = await prisma.season.create({
      data: { universeId: universe.id, year: YEAR, name: "Temporada custom" },
    });
    const team = await prisma.team.create({
      data: {
        name: "Equipe Customizada",
        universeId: universe.id,
        userId: admin.userId,
      },
    });
    const character = await prisma.character.create({
      data: {
        name: "Piloto Customizado",
        nationality: "Brazil",
        birthDate: new Date("2000-01-01"),
        userId: admin.userId,
        universeId: universe.id,
      },
    });
    const driver = await prisma.driverProfile.create({
      data: { characterId: character.id, teamId: team.id, number: 99 },
    });
    const entry = await prisma.seasonDriverEntry.create({
      data: {
        driverProfileId: driver.id,
        seasonId: season.id,
        teamId: team.id,
        role: "RACE_SEAT",
        seat: 1,
        number: 99,
      },
    });
    const customDate = new Date("2046-06-01T00:00:00.000Z");
    const world = await prisma.worldState.create({
      data: {
        universeId: universe.id,
        currentDate: customDate,
        currentSeasonId: season.id,
      },
    });
    const race = await prisma.race.create({
      data: {
        seasonId: season.id,
        name: "GP Customizado",
        round: 1,
        date: new Date("2046-03-08"),
      },
    });

    await refresh(admin.cookie);
    const externalRace = await prisma.externalRace.findFirstOrThrow({
      where: { source: JOLPICA_SOURCE, seasonYear: YEAR },
    });
    await prisma.externalBindingRace.create({
      data: {
        universeId: universe.id,
        externalRaceId: externalRace.id,
        raceId: race.id,
        contentHash: "hash-custom",
        externalSnapshot: { name: "GP Customizado" },
      },
    });

    server.raceName = "Nome Externo Diferente";
    server.standings[0].points = "99";
    const response = await refresh(admin.cookie);
    expect(response.statusCode).toBe(200);

    const teamAfter = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
    expect(teamAfter.name).toBe("Equipe Customizada");
    const characterAfter = await prisma.character.findUniqueOrThrow({
      where: { id: character.id },
    });
    expect(characterAfter.name).toBe("Piloto Customizado");
    const driverAfter = await prisma.driverProfile.findUniqueOrThrow({
      where: { id: driver.id },
    });
    expect(driverAfter.number).toBe(99);
    expect(driverAfter.teamId).toBe(team.id);
    const entryAfter = await prisma.seasonDriverEntry.findUniqueOrThrow({
      where: { id: entry.id },
    });
    expect(entryAfter.number).toBe(99);
    const worldAfter = await prisma.worldState.findUniqueOrThrow({
      where: { id: world.id },
    });
    expect(worldAfter.currentDate.toISOString()).toBe(customDate.toISOString());
    expect(worldAfter.currentSeasonId).toBe(season.id);
    const raceAfter = await prisma.race.findUniqueOrThrow({ where: { id: race.id } });
    expect(raceAfter.name).toBe("GP Customizado");
    expect(raceAfter.date?.toISOString()).toBe(
      new Date("2046-03-08").toISOString(),
    );
    const bindingAfter = await prisma.externalBindingRace.findFirstOrThrow({
      where: { universeId: universe.id, raceId: race.id },
    });
    expect(bindingAfter.contentHash).toBe("hash-custom");
    expect(bindingAfter.externalSnapshot).toEqual({ name: "GP Customizado" });

    const timeline = await prisma.timelineEvent.count({
      where: { universeId: universe.id },
    });
    expect(timeline).toBe(0);
  });

  it("mantém universos independentes após o refresh global", async () => {
    const other = await createDbUser("iso", "USER");
    createdUserIds.push(other.userId);
    const universe = await prisma.universe.create({
      data: { userId: other.userId, status: "READY" },
    });
    const team = await prisma.team.create({
      data: {
        name: "Equipe do Outro Universo",
        universeId: universe.id,
        userId: other.userId,
      },
    });

    const response = await refresh(admin.cookie);
    expect(response.statusCode).toBe(200);

    const teamAfter = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
    expect(teamAfter.name).toBe("Equipe do Outro Universo");
    const bindings = await prisma.externalBindingRace.count({
      where: { universeId: universe.id },
    });
    expect(bindings).toBe(0);
  });

  it("expõe status com último run, último sucesso e erro sanitizado", async () => {
    const noAuth = await app.inject({
      method: "GET",
      url: "/api/external-sync/status",
    });
    expect(noAuth.statusCode).toBe(401);

    const refreshResponse = await refresh(admin.cookie);
    expect(refreshResponse.statusCode).toBe(200);

    const failedWithUrl = await prisma.externalSyncRun.create({
      data: {
        source: JOLPICA_SOURCE,
        scope: "TEAMS",
        seasonYear: YEAR,
        status: "FAILED",
        finishedAt: new Date(Date.now() + 10),
        error: "Timeout ao consultar https://api.jolpi.ca/ergast/f1/secret",
      },
    });

    const status = await app.inject({
      method: "GET",
      url: `/api/external-sync/status?source=${JOLPICA_SOURCE}&limit=5`,
      headers: { cookie: plainUser.cookie },
      remoteAddress: "10.77.9.9",
    });
    expect(status.statusCode).toBe(200);
    const body = status.json();
    expect(body.source).toBe(JOLPICA_SOURCE);
    expect(Array.isArray(body.active)).toBe(true);
    expect(body.lastRun.id).toBe(failedWithUrl.id);
    expect(body.lastSuccess.status).toBe("SUCCESS");
    expect(body.recent).toHaveLength(5);
    const failedView = body.recent.find(
      (run: { id: string }) => run.id === failedWithUrl.id,
    );
    expect(failedView.error).toContain("[fonte externa]");
    expect(failedView.error).not.toContain("http");
    expect(failedView.durationMs).toBeGreaterThanOrEqual(0);
    expect(status.body).not.toContain("stack");

    await prisma.externalSyncRun.delete({ where: { id: failedWithUrl.id } });
  });
});
