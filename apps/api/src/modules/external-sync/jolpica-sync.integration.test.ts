import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { JolpicaClient } from "./jolpica.client.js";
import type {
  JolpicaConstructorRaw,
  JolpicaDriverRaw,
  JolpicaRaceRaw,
  JolpicaRaceWithResultsRaw,
  JolpicaResultRaw,
  JolpicaStandingRaw,
} from "./jolpica.client.js";
import { JolpicaSyncService, JOLPICA_SOURCE } from "./jolpica.service.js";
import { JolpicaTransport } from "./jolpica.transport.js";

const BASE_URL = "https://mock.invalid/f1/";

interface FixtureRound {
  round: number;
  race: JolpicaRaceWithResultsRaw;
  results: JolpicaResultRaw[];
}

class JolpicaFixtureServer {
  readonly year: number;
  readonly constructors: JolpicaConstructorRaw[] = [
    { constructorId: "ferrari", name: "Ferrari", nationality: "Italian" },
    { constructorId: "mclaren", name: "McLaren", nationality: "British" },
  ];
  readonly drivers: JolpicaDriverRaw[] = [
    {
      driverId: "lauda",
      permanentNumber: "1",
      code: "LAU",
      givenName: "Niki",
      familyName: "Lauda",
      nationality: "Austrian",
    },
    {
      driverId: "hunt",
      permanentNumber: "11",
      code: "HUN",
      givenName: "James",
      familyName: "Hunt",
      nationality: "British",
    },
    { driverId: "donnelly", givenName: "Martin", familyName: "Donnelly" },
  ];
  readonly standings: JolpicaStandingRaw[];
  rounds: FixtureRound[];

  constructor(year: number) {
    this.year = year;
    this.standings = [
      {
        position: "1",
        points: "64.5",
        wins: "5",
        Driver: this.drivers[0],
        Constructors: [this.constructors[0]],
      },
      {
        position: "2",
        points: "33",
        wins: "1",
        Driver: this.drivers[1],
        Constructors: [this.constructors[1]],
      },
      {
        position: "30",
        points: "0",
        wins: "0",
        Driver: this.drivers[2],
        Constructors: [this.constructors[1]],
      },
    ];
    this.rounds = [
      this.buildRound(
        1,
        "Argentine Grand Prix",
        "buenos_aires",
        "Autodromo Juan y Oscar Galvez",
        "Argentina",
        "Buenos Aires",
        "1975-01-12",
      ),
      this.buildRound(
        2,
        "Brazilian Grand Prix",
        "interlagos",
        "Autodromo Jose Carlos Pace",
        "Brazil",
        "Sao Paulo",
        "1975-01-26",
      ),
    ];
  }

  private buildRound(
    round: number,
    raceName: string,
    circuitId: string,
    circuitName: string,
    country: string,
    locality: string,
    date: string,
  ): FixtureRound {
    const [lauda, hunt, donnelly] = this.drivers;
    const [ferrari, mclaren] = this.constructors;
    const race: JolpicaRaceWithResultsRaw = {
      season: String(this.year),
      round: String(round),
      raceName,
      Circuit: { circuitId, circuitName, Location: { locality, country } },
      date,
    };
    if (round % 2 === 1) {
      race.Results = [
        this.result("1", "1", "1", "9", "1", "Finished", lauda, ferrari, "1"),
        this.result("11", "2", "2", "6", "3", "Finished", hunt, mclaren, "2"),
        this.result(undefined, "30", "R", "0", undefined, "Retired", donnelly, mclaren),
      ];
    } else {
      race.Results = [
        this.result("11", "1", "1", "9", "2", "Finished", hunt, mclaren, "1"),
        this.result("1", "2", "2", "6", "1", "Finished", lauda, ferrari, "2"),
        this.result(undefined, "30", "R", "0", undefined, "Engine", donnelly, mclaren),
      ];
    }
    return { round, race, results: race.Results };
  }

  private result(
    number: string | undefined,
    position: string,
    positionText: string,
    points: string,
    grid: string | undefined,
    status: string,
    driver: JolpicaDriverRaw,
    constructor: JolpicaConstructorRaw,
    fastestLapRank?: string,
  ): JolpicaResultRaw {
    return {
      number,
      position,
      positionText,
      points,
      grid,
      status,
      Driver: driver,
      Constructor: constructor,
      ...(fastestLapRank === undefined
        ? {}
        : { FastestLap: { rank: fastestLapRank, lap: "1" } }),
    };
  }

  get races(): JolpicaRaceRaw[] {
    return this.rounds.map((r) => r.race);
  }

  setResultPoints(round: number, driverId: string, points: string): void {
    const entry = this.rounds.find((r) => r.round === round);
    const result = entry?.results.find((r) => r.Driver?.driverId === driverId);
    if (result) result.points = points;
  }

  removeRound(round: number): void {
    this.rounds = this.rounds.filter((r) => r.round !== round);
  }

  readonly fetch: typeof fetch = async (input) => {
    const url = new URL(String(input));
    const parts = url.pathname.split("/").filter(Boolean);
    const filename = parts[parts.length - 1];
    const year = Number(parts[1].replace(/\.json$/, ""));
    if (year !== this.year || this.year === undefined) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const body = (table: Record<string, unknown>) => ({
      MRData: {
        series: "f1",
        url: url.toString(),
        limit: "100",
        offset: "0",
        total: String(this.rounds.length),
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
              { season: String(this.year), round: "2", DriverStandings: this.standings },
            ],
          },
        }),
      );
    }
    if (filename === "results.json") {
      const round = Number(parts[parts.length - 2]);
      const entry = this.rounds.find((r) => r.round === round);
      const races = entry ? [{ ...entry.race, Results: entry.results }] : [];
      return this.json(
        body({
          RaceTable: { season: String(this.year), round: String(round), Races: races },
        }),
      );
    }
    return this.json(
      body({
        RaceTable: { season: String(this.year), round: "2", Races: this.races },
      }),
    );
  };

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}

function makeClient(server: JolpicaFixtureServer): JolpicaClient {
  return new JolpicaClient({
    transport: new JolpicaTransport({
      baseUrl: BASE_URL,
      timeoutMs: 5000,
      fetchImpl: server.fetch,
    }),
  });
}

function makeService(server: JolpicaFixtureServer): JolpicaSyncService {
  return new JolpicaSyncService(makeClient(server));
}

const UNIVERSE_MODELS = [
  "character",
  "driverProfile",
  "team",
  "season",
  "race",
  "raceResult",
  "championshipStanding",
  "seasonDriverEntry",
  "driverEntryEvent",
  "worldState",
] as const;

const BINDING_MODELS = [
  "externalBindingDriver",
  "externalBindingTeam",
  "externalBindingSeason",
  "externalBindingRace",
  "externalBindingDriverSeason",
  "externalBindingResult",
  "externalBindingStanding",
] as const;

async function snapshotCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const model of [...UNIVERSE_MODELS, ...BINDING_MODELS]) {
    out[model] = await (prisma as unknown as Record<string, { count(): Promise<number> }>)[
      model
    ].count();
  }
  return out;
}

async function readResult(year: number, round: number, driverId: string) {
  return prisma.externalResult.findFirstOrThrow({
    where: {
      source: JOLPICA_SOURCE,
      externalRace: { seasonYear: year, round },
      externalDriver: { externalId: driverId },
    },
    select: {
      position: true,
      points: true,
      grid: true,
      fastestLap: true,
      status: true,
      contentHash: true,
      sourceRecord: true,
    },
  });
}

describe("JolpicaSyncService — sincronização determinística (f1_narrative_test)", () => {
  it("todas as disciplinas criam somente registros External* conforme o contrato", async () => {
    const year = 1975;
    const service = makeService(new JolpicaFixtureServer(year));

    await service.sync(year, "SEASON");
    await service.sync(year, "TEAMS");
    await service.sync(year, "DRIVERS");
    await service.sync(year, "DRIVER_SEASONS");
    await service.sync(year, "RACES");
    await service.sync(year, "RESULTS");
    await service.sync(year, "STANDINGS");

    expect(
      await prisma.externalSeason.count({ where: { source: JOLPICA_SOURCE, year } }),
    ).toBe(1);
    expect(
      await prisma.externalTeam.count({ where: { source: JOLPICA_SOURCE } }),
    ).toBe(2);
    expect(
      await prisma.externalDriver.count({ where: { source: JOLPICA_SOURCE } }),
    ).toBe(3);
    expect(
      await prisma.externalDriverSeason.count({
        where: { source: JOLPICA_SOURCE, seasonYear: year },
      }),
    ).toBe(3);
    expect(
      await prisma.externalRace.count({ where: { source: JOLPICA_SOURCE, seasonYear: year } }),
    ).toBe(2);
    expect(
      await prisma.externalResult.count({
        where: { source: JOLPICA_SOURCE, externalRace: { seasonYear: year } },
      }),
    ).toBe(6);
    expect(
      await prisma.externalStanding.count({
        where: { source: JOLPICA_SOURCE, seasonYear: year },
      }),
    ).toBe(3);

    const race = await prisma.externalRace.findFirstOrThrow({
      where: { source: JOLPICA_SOURCE, seasonYear: year, round: 1 },
      select: {
        grandPrix: true,
        name: true,
        circuitName: true,
        date: true,
        status: true,
        contentHash: true,
        sourceRecord: true,
      },
    });
    expect(race.grandPrix).toBe("Argentine Grand Prix");
    expect(race.date?.toISOString()).toBe("1975-01-12T00:00:00.000Z");
    expect(race.status).toBeNull();
    expect(race.contentHash).toBeTruthy();
    expect(race.sourceRecord).toBeTruthy();

    const result = await readResult(year, 1, "lauda");
    expect(result.position).toBe(1);
    expect(result.points).toBe(9);
    expect(result.grid).toBe(1);
    expect(result.fastestLap).toBe(true);
    expect(result.sourceRecord).toBeTruthy();

    const donnelly = await readResult(year, 2, "donnelly");
    expect(donnelly.position).toBe(30);
    expect(donnelly.fastestLap).toBeNull();

    const driverSeason = await prisma.externalDriverSeason.findFirstOrThrow({
      where: {
        source: JOLPICA_SOURCE,
        seasonYear: year,
        externalDriver: { externalId: "lauda" },
      },
      select: {
        teamExternalId: true,
        teamNameSnapshot: true,
        role: true,
        number: true,
      },
    });
    expect(driverSeason.role).toBeNull();
    expect(driverSeason.teamExternalId).toBe("ferrari");
    expect(driverSeason.teamNameSnapshot).toBe("Ferrari");
    expect(driverSeason.number).toBe(1);

    const standing = await prisma.externalStanding.findFirstOrThrow({
      where: {
        source: JOLPICA_SOURCE,
        seasonYear: year,
        externalDriver: { externalId: "lauda" },
      },
      select: { position: true, points: true, wins: true, podiums: true },
    });
    expect(standing.position).toBe(1);
    expect(standing.points).toBe(64.5);
    expect(standing.wins).toBe(5);
    expect(standing.podiums).toBeNull();
  });

  it("segunda execução é idempotente: nenhum registro novo, nenhum duplicado", async () => {
    const year = 1975;
    const service = makeService(new JolpicaFixtureServer(year));
    const beforeRaces = await prisma.externalRace.count({
      where: { source: JOLPICA_SOURCE, seasonYear: year },
    });

    const report = await service.sync(year, "RACES");
    expect(report.counts.created).toBe(0);
    expect(report.counts.updated).toBe(0);

    const afterRaces = await prisma.externalRace.count({
      where: { source: JOLPICA_SOURCE, seasonYear: year },
    });
    expect(afterRaces).toBe(beforeRaces);

    const seasonReport = await service.sync(year, "SEASON");
    expect(seasonReport.counts.created).toBe(0);
    expect(seasonReport.counts.updated).toBe(0);
  });

  it("mudança na fonte altera contentHash e campos persistidos", async () => {
    const year = 1976;
    const server = new JolpicaFixtureServer(year);
    const service = makeService(server);

    await service.sync(year, "RACES");
    await service.sync(year, "RESULTS");
    server.setResultPoints(1, "lauda", "9");
    await service.sync(year, "RESULTS");

    const before = await readResult(year, 1, "lauda");
    expect(before.points).toBe(9);

    server.setResultPoints(1, "lauda", "10");
    const report = await service.sync(year, "RESULTS");
    const after = await readResult(year, 1, "lauda");

    expect(after.points).toBe(10);
    expect(after.contentHash).not.toBe(before.contentHash);
    expect(report.counts.updated).toBeGreaterThan(0);
  });

  it("registro ausente do payload não é apagado do espelho", async () => {
    const year = 1977;
    const server = new JolpicaFixtureServer(year);
    const service = makeService(server);

    await service.sync(year, "RACES");
    server.removeRound(2);
    const report = await service.sync(year, "RACES");

    expect(report.counts.unchanged).toBe(1);
    expect(
      await prisma.externalRace.count({ where: { source: JOLPICA_SOURCE, seasonYear: year } }),
    ).toBe(2);
    const round2 = await prisma.externalRace.findUnique({
      where: {
        source_seasonYear_round: { source: JOLPICA_SOURCE, seasonYear: year, round: 2 },
      },
      select: { id: true },
    });
    expect(round2).toBeTruthy();
  });

  it("nunca escreve nem vincula nada no universo", async () => {
    const year = 1978;
    const service = makeService(new JolpicaFixtureServer(year));
    const before = await snapshotCounts();

    await service.sync(year, "SEASON");
    await service.sync(year, "TEAMS");
    await service.sync(year, "DRIVERS");
    await service.sync(year, "DRIVER_SEASONS");
    await service.sync(year, "RACES");
    await service.sync(year, "RESULTS");
    await service.sync(year, "STANDINGS");

    const after = await snapshotCounts();
    for (const model of UNIVERSE_MODELS) {
      expect(after[model]).toBe(before[model]);
    }
    for (const model of BINDING_MODELS) {
      expect(after[model]).toBe(before[model]);
    }
  });
});

describe("JolpicaSync routes — endpoint admin-only", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let userCookie: string;

  beforeAll(async () => {
    const server = new JolpicaFixtureServer(1975);
    app = buildApp(undefined, undefined, makeClient(server));
    await app.ready();

    const adminEmail = `sync-admin-${Date.now()}@f1nw.test`;
    const userEmail = `sync-user-${Date.now()}@f1nw.test`;
    adminCookie = await signUpGetCookie(app, adminEmail, "Sync Admin");
    userCookie = await signUpGetCookie(app, userEmail, "Sync User");

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    await prisma.user.update({
      where: { id: admin.id },
      data: { role: "ADMIN" },
    });
  });

  afterAll(async () => {
    const syncYears = [1975, 1978];
    const syncDriverIds = ["lauda", "hunt", "donnelly"];
    await prisma.externalResult.deleteMany({ where: { source: JOLPICA_SOURCE, externalDriver: { externalId: { in: syncDriverIds } } } });
    await prisma.externalResult.deleteMany({ where: { source: JOLPICA_SOURCE, externalRace: { seasonYear: { in: syncYears } } } });
    await prisma.externalStanding.deleteMany({ where: { source: JOLPICA_SOURCE, externalDriver: { externalId: { in: syncDriverIds } } } });
    await prisma.externalStanding.deleteMany({ where: { source: JOLPICA_SOURCE, seasonYear: { in: syncYears } } });
    await prisma.externalDriverSeason.deleteMany({ where: { source: JOLPICA_SOURCE, externalDriver: { externalId: { in: syncDriverIds } } } });
    await prisma.externalDriverSeason.deleteMany({ where: { source: JOLPICA_SOURCE, seasonYear: { in: syncYears } } });
    await prisma.externalRace.deleteMany({ where: { source: JOLPICA_SOURCE, seasonYear: { in: syncYears } } });
    await prisma.externalDriver.deleteMany({ where: { source: JOLPICA_SOURCE, externalId: { in: syncDriverIds } } });
    await prisma.externalTeam.deleteMany({ where: { source: JOLPICA_SOURCE, externalId: { in: ["mclaren", "ferrari"] } } });
    await prisma.externalSeason.deleteMany({ where: { source: JOLPICA_SOURCE, year: { in: syncYears } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "sync-" } } });
    await app.close();
    await prisma.$disconnect();
  });

  it("POST /api/external-sync/:source/:scope sem sessão → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/external-sync/jolpica/SEASON",
      payload: { seasonYear: 1975 },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHENTICATED");
  });

  it("usuário comum → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/external-sync/jolpica/SEASON",
      headers: { cookie: userCookie },
      payload: { seasonYear: 1975 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("admin sincroniza SEASON 1975 → 200 com relatório", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/external-sync/jolpica/SEASON",
      headers: { cookie: adminCookie },
      payload: { seasonYear: 1975 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.report.source).toBe("jolpica");
    expect(body.report.year).toBe(1975);
    expect(body.report.scope).toBe("SEASON");
    expect(body.report.counts.created + body.report.counts.updated).toBeGreaterThanOrEqual(0);
  });

  it("fonte não suportada → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/external-sync/openf1/SEASON",
      headers: { cookie: adminCookie },
      payload: { seasonYear: 1975 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("ano sem dados na fonte → 404 SOURCE_NOT_FOUND", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/external-sync/jolpica/SEASON",
      headers: { cookie: adminCookie },
      payload: { seasonYear: 1999 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("SOURCE_NOT_FOUND");
  });
});

async function signUpGetCookie(
  app: FastifyInstance,
  email: string,
  name: string,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name, email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  return (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
}