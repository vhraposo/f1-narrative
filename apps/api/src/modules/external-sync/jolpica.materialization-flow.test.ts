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
  JolpicaStandingRaw,
} from "./jolpica.client.js";
import { JOLPICA_SOURCE } from "./jolpica.service.js";
import { JolpicaTransport } from "./jolpica.transport.js";

const YEAR = 2055;
const BASE_URL = "https://mock.invalid/f1/";
const ORIGIN = "http://localhost:3000";

class JolpicaFixtureServer {
  readonly year: number;
  readonly constructors: JolpicaConstructorRaw[] = [
    { constructorId: "atlas", name: "Atlas Racing", nationality: "British" },
    { constructorId: "orion", name: "Orion GP", nationality: "Italian" },
  ];
  readonly drivers: JolpicaDriverRaw[] = [
    {
      driverId: "auto-la",
      permanentNumber: "1",
      code: "ALA",
      givenName: "Ada",
      familyName: "Lovelace",
      nationality: "British",
      dateOfBirth: "1946-04-01",
    },
    {
      driverId: "auto-gr",
      permanentNumber: "11",
      code: "AGR",
      givenName: "Grace",
      familyName: "Hopper",
      nationality: "American",
      dateOfBirth: "1947-05-02",
    },
    {
      driverId: "auto-cd",
      permanentNumber: "88",
      code: "ACD",
      givenName: "Claire",
      familyName: "De Luca",
      nationality: "Italian",
      dateOfBirth: "1948-06-03",
    },
  ];
  readonly standings: JolpicaStandingRaw[];
  rounds: number;

  constructor(year: number) {
    this.year = year;
    this.rounds = 2;
    this.standings = [
      {
        position: "1",
        points: "26",
        wins: "1",
        Driver: this.drivers[0],
        Constructors: [this.constructors[0]],
      },
      {
        position: "2",
        points: "18",
        wins: "0",
        Driver: this.drivers[1],
        Constructors: [this.constructors[1]],
      },
      {
        position: "3",
        points: "15",
        wins: "0",
        Driver: this.drivers[2],
        Constructors: [this.constructors[1]],
      },
    ];
  }

  readonly fetch: typeof fetch = async (input) => {
    const url = new URL(String(input));
    const parts = url.pathname.split("/").filter(Boolean);
    const filename = parts[parts.length - 1];
    const year = Number(parts[1].replace(/\.json$/, ""));
    if (year !== this.year) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const body = (table: Record<string, unknown>) => ({
      MRData: { series: "f1", url: url.toString(), limit: "100", offset: "0", total: "1", ...table },
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
              { season: String(this.year), round: "1", DriverStandings: this.standings },
            ],
          },
        }),
      );
    }
    if (filename === "results.json") {
      const round = Number(parts[parts.length - 2]);
      const lauda = this.drivers[0];
      const race: JolpicaRaceWithResultsRaw = {
        season: String(this.year),
        round: String(round),
        raceName: `Auto Grand Prix ${round}`,
        Circuit: {
          circuitId: `auto_circuit_${round}`,
          circuitName: `Auto Circuit ${round}`,
          Location: { locality: "Plainville", country: "USA" },
        },
        date: `${this.year}-05-0${round}`,
        Results: [
          {
            number: "1",
            position: Number(round) === 1 ? "1" : "2",
            positionText: "1",
            points: "9",
            grid: "1",
            status: "Finished",
            Driver: this.drivers[0],
            Constructor: this.constructors[0],
          },
        ],
      };
      return this.json(
        body({ RaceTable: { season: String(this.year), round: String(round), Races: [race] } }),
      );
    }
    const races: JolpicaRaceRaw[] = Array.from({ length: this.rounds }, (_, index) => ({
      season: String(this.year),
      round: String(index + 1),
      raceName: `Auto Grand Prix ${index + 1}`,
      Circuit: {
        circuitId: `auto_circuit_${index + 1}`,
        circuitName: `Auto Circuit ${index + 1}`,
        Location: { locality: "Plainville", country: "USA" },
      },
      date: `${this.year}-05-0${index + 1}`,
    }));
    return this.json(
      body({ RaceTable: { season: String(this.year), round: "2", Races: races } }),
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

type User = { id: string; cookie: string };

interface AutoMaterializeBody {
  ok: boolean;
  report: { scope: string; counts: { created: number; updated: number } };
  materialization?: {
    attempted: boolean;
    status: string;
    reason: string | null;
    report?: {
      summary: { teamsCreated: number; charactersCreated: number; entriesCreated: number };
      conflicts: unknown[];
    };
  };
}

interface SyncFixture {
  seasonId: string;
  extSeasonId: string;
  cleanup: () => Promise<void>;
}

let app: FastifyInstance;
let admin: User;
let fixture: SyncFixture;
const createdConversationIds: string[] = [];
let atlasTeamId = "";
let adaCharId = "";
let adaProfileId = "";
let graceCharId = "";

async function createSession(name: string): Promise<User> {
  const email = `auto-mat-${Date.now()}@f1nw.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: ORIGIN },
    payload: { name, email, password: "senha-segura-123" },
  });
  expect(res.statusCode, `body: ${res.body}`).toBe(200);
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: stored.id, cookie };
}

async function syncScope(scope: string): Promise<AutoMaterializeBody> {
  const res = await app.inject({
    method: "POST",
    url: `/api/external-sync/jolpica/${scope}`,
    headers: { cookie: admin.cookie },
    payload: { seasonYear: YEAR },
  });
  return res.json() as AutoMaterializeBody;
}

async function syncScopeRaw(scope: string): Promise<{ statusCode: number; body: AutoMaterializeBody }> {
  const res = await app.inject({
    method: "POST",
    url: `/api/external-sync/jolpica/${scope}`,
    headers: { cookie: admin.cookie },
    payload: { seasonYear: YEAR },
  });
  return { statusCode: res.statusCode, body: res.json() as AutoMaterializeBody };
}

async function setupUniverseFixture(year: number): Promise<SyncFixture> {
  const season = await prisma.season.create({
    data: { year, name: String(year), status: "PRE_SEASON" },
  });
  const externalIds = ["auto-la", "auto-gr", "auto-cd"];
  await prisma.externalResult.deleteMany({
    where: { source: JOLPICA_SOURCE, externalRace: { seasonYear: year } },
  });
  await prisma.externalStanding.deleteMany({ where: { source: JOLPICA_SOURCE, seasonYear: year } });
  await prisma.externalDriverSeason.deleteMany({ where: { source: JOLPICA_SOURCE, seasonYear: year } });
  await prisma.externalRace.deleteMany({ where: { source: JOLPICA_SOURCE, seasonYear: year } });
  await prisma.externalDriver.deleteMany({
    where: { source: JOLPICA_SOURCE, externalId: { in: externalIds } },
  });
  await prisma.externalTeam.deleteMany({ where: { source: JOLPICA_SOURCE } });
  await prisma.externalSeason.deleteMany({ where: { source: JOLPICA_SOURCE, year } });

  const extSeason = await prisma.externalSeason.create({
    data: {
      source: JOLPICA_SOURCE,
      year,
      name: String(year),
      status: "ACTIVE",
      contentHash: "flow-boot",
    },
  });

  const cleanup = async () => {
    await prisma.externalResult.deleteMany({
      where: { source: JOLPICA_SOURCE, externalRace: { seasonYear: year } },
    });
    await prisma.externalStanding.deleteMany({ where: { source: JOLPICA_SOURCE, seasonYear: year } });
    await prisma.externalDriverSeason.deleteMany({ where: { source: JOLPICA_SOURCE, seasonYear: year } });
    await prisma.externalRace.deleteMany({ where: { source: JOLPICA_SOURCE, seasonYear: year } });
    await prisma.externalDriver.deleteMany({
      where: { source: JOLPICA_SOURCE, externalId: { in: externalIds } },
    });
    await prisma.externalTeam.deleteMany({ where: { source: JOLPICA_SOURCE } });
    await prisma.externalSeason.deleteMany({ where: { source: JOLPICA_SOURCE, year } });

    await prisma.seasonDriverEntry.deleteMany({ where: { seasonId: season.id } });
    await prisma.championshipStanding.deleteMany({ where: { seasonId: season.id } });
    await prisma.raceResult.deleteMany({ where: { race: { seasonId: season.id } } });
    await prisma.race.deleteMany({ where: { seasonId: season.id } });
    await prisma.season.deleteMany({ where: { id: season.id } });

    await prisma.team.deleteMany({ where: { userId: { in: [admin.id] } } });
    await prisma.character.deleteMany({ where: { userId: { in: [admin.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id] } } });
  };

  return { seasonId: season.id, extSeasonId: extSeason.id, cleanup };
}

beforeAll(async () => {
  const server = new JolpicaFixtureServer(YEAR);
  app = buildApp(undefined, undefined, makeClient(server));
  await app.ready();

  admin = await createSession("Auto Mat Admin");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });

  fixture = await setupUniverseFixture(YEAR);
});

afterAll(async () => {
  if (createdConversationIds.length > 0) {
    await prisma.conversation.deleteMany({
      where: { id: { in: createdConversationIds } },
    });
  }
  await fixture.cleanup();
  await prisma.$disconnect();
  await app.close();
});

describe("External Sync -> Materialização automática (107.2)", () => {
  it("1) sync SEASON não dispara materialização (apenas após sync relevante)", async () => {
    const res = await syncScopeRaw("SEASON");
    expect(res.statusCode).toBe(200);
    expect(res.body.materialization).toBeUndefined();
    expect(await prisma.team.count({ where: { userId: admin.id } })).toBe(0);
    expect(await prisma.character.count({ where: { userId: admin.id } })).toBe(0);
  });

  it("2) sync DRIVER_SEASONS dispara materialização automática (status OK, removendo nenhuma fonte)", async () => {
    const teams = await syncScope("TEAMS");
    expect(teams.ok).toBe(true);
    expect(teams.materialization).toBeUndefined();

    const drivers = await syncScope("DRIVERS");
    expect(drivers.ok).toBe(true);
    expect(drivers.materialization).toBeUndefined();

    const res = await syncScopeRaw("DRIVER_SEASONS");
    expect(res.statusCode).toBe(200);
    expect(res.body.materialization).toBeDefined();
    expect(res.body.materialization!.status).toBe("OK");
    expect(res.body.materialization!.report!.summary).toMatchObject({
      teamsCreated: 2,
      charactersCreated: 3,
      entriesCreated: 3,
    });
  });

  it("3) equipes materializadas aparecem via GET /api/teams", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/teams",
      headers: { cookie: admin.cookie },
    });
    expect(res.statusCode).toBe(200);
    const teams = (res.json().teams as { name: string }[]).map((t) => t.name);
    expect(teams.sort()).toEqual(["Atlas Racing", "Orion GP"]);
  });

  it("4) pilotos materializados aparecem via GET /api/drivers", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/drivers",
      headers: { cookie: admin.cookie },
    });
    expect(res.statusCode).toBe(200);
    const names = (res.json().drivers as { character: { name: string } }[]).map(
      (d) => d.character.name,
    );
    expect(names.sort()).toEqual(["Ada Lovelace", "Claire De Luca", "Grace Hopper"]);
  });

  it("5) SeasonDriverEntry materializado: seat/role/número e provenance IMPORTED", async () => {
    const entries = await prisma.seasonDriverEntry.findMany({
      where: { seasonId: fixture.seasonId },
      include: { driverProfile: { include: { character: true } } },
    });
    expect(entries).toHaveLength(3);
    expect(entries.every((entry) => entry.status === "ACTIVE")).toBe(true);
    expect(entries.every((entry) => entry.provenance === "IMPORTED")).toBe(true);
    const ada = entries.find((entry) => entry.driverProfile.character.name === "Ada Lovelace")!;
    expect(ada.role).toBe("RACE_SEAT");
    expect(ada.number).toBe(1);
  });

  it("6) re-sync é idempotente: materialização OK, nenhum registro duplicado", async () => {
    const teamsBefore = await prisma.team.count({ where: { userId: admin.id } });
    const charsBefore = await prisma.character.count({ where: { userId: admin.id } });
    const entriesBefore = await prisma.seasonDriverEntry.count({
      where: { seasonId: fixture.seasonId },
    });

    const res = await syncScopeRaw("DRIVER_SEASONS");
    expect(res.statusCode).toBe(200);
    expect(res.body.materialization!.status).toBe("OK");
    expect(res.body.materialization!.report!.summary).toMatchObject({
      teamsCreated: 0,
      charactersCreated: 0,
      entriesCreated: 0,
    });
    expect(res.body.materialization!.report!.conflicts).toEqual([]);

    expect(await prisma.team.count({ where: { userId: admin.id } })).toBe(teamsBefore);
    expect(await prisma.character.count({ where: { userId: admin.id } })).toBe(charsBefore);
    expect(
      await prisma.seasonDriverEntry.count({ where: { seasonId: fixture.seasonId } }),
    ).toBe(entriesBefore);
  });

  it("7) DOB usa data real do espelho (sem inventar)", async () => {
    const ada = await prisma.character.findFirstOrThrow({
      where: { userId: admin.id, name: "Ada Lovelace" },
      select: { birthDate: true },
    });
    expect(ada.birthDate.toISOString().slice(0, 10)).toBe("1946-04-01");
  });

  it("8) Player Entry após materialização: desloca piloto materializado -> AVAILABLE", async () => {
    const atlas = await prisma.team.findFirstOrThrow({
      where: { userId: admin.id, name: "Atlas Racing" },
      select: { id: true },
    });
    const ada = await prisma.character.findFirstOrThrow({
      where: { userId: admin.id, name: "Ada Lovelace" },
      select: { id: true },
    });
    const adaProfile = await prisma.driverProfile.findUniqueOrThrow({
      where: { characterId: ada.id },
      select: { id: true },
    });
    atlasTeamId = atlas.id;
    adaCharId = ada.id;
    adaProfileId = adaProfile.id;

    const res = await app.inject({
      method: "POST",
      url: "/api/universe/player-entry",
      headers: { cookie: admin.cookie },
      payload: {
        seasonId: fixture.seasonId,
        teamId: atlasTeamId,
        seat: 1,
        name: "Alicya Auto",
        nationality: "Brasileira",
        birthDate: "2002-06-14",
      },
    });
    expect(res.statusCode).toBe(201);
    const result = res.json() as {
      character: { name: string; controlledBy: string };
      displaced: {
        entry: {
          driverProfile: { character: { name: string } };
          status: string;
          teamId: string | null;
          role: string | null;
          seat: number | null;
        };
      } | null;
    };
    expect(result.displaced).toBeTruthy();
    expect(result.displaced!.entry.driverProfile.character.name).toBe("Ada Lovelace");
    expect(result.displaced!.entry.status).toBe("AVAILABLE");
    expect(result.displaced!.entry.teamId).toBeNull();
    expect(result.displaced!.entry.role).toBeNull();
    expect(result.displaced!.entry.seat).toBeNull();

    const adaEntry = await prisma.seasonDriverEntry.findFirstOrThrow({
      where: { seasonId: fixture.seasonId, driverProfileId: adaProfileId },
    });
    expect(adaEntry.status).toBe("AVAILABLE");
    expect(adaEntry.number).toBeNull();
    const displacedEvent = await prisma.driverEntryEvent.findFirst({
      where: { entryId: adaEntry.id, kind: "DISPLACED" },
    });
    expect(displacedEvent).toBeTruthy();
  });

  it("9) piloto materializado é elegível ao chat: Character USER, sem tipo externo", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/characters",
      headers: { cookie: admin.cookie },
    });
    expect(res.statusCode).toBe(200);
    const characters = res.json().characters as {
      id: string;
      name: string;
      controlledBy: string;
      userId: string;
    }[];
    const grace = characters.find((character) => character.name === "Grace Hopper");
    expect(grace).toBeTruthy();
    expect(grace!.controlledBy).toBe("USER");
    expect(grace!.userId).toBe(admin.id);
    graceCharId = grace!.id;

    const created = await app.inject({
      method: "POST",
      url: "/api/conversations",
      headers: { cookie: admin.cookie },
      payload: { title: "Rádio automático", participantIds: [grace!.id] },
    });
    expect(created.statusCode, `body: ${created.body}`).toBe(201);
    const { conversation } = created.json();
    createdConversationIds.push(conversation.id as string);
    const participants = conversation.participants as {
      id: string;
      name: string;
      controlledBy: string;
    }[];
    const graceParticipant = participants.find((p) => p.name === "Grace Hopper");
    expect(graceParticipant).toBeTruthy();
    expect(graceParticipant!.controlledBy).toBe("USER");
    expect(Object.keys(graceParticipant!)).not.toContain("externalType");
  });

  it("10) Chat usa o mesmo mecanismo de Character (sem participant externo) e sem duplicação", async () => {
    const manual = await app.inject({
      method: "POST",
      url: "/api/characters",
      headers: { cookie: admin.cookie },
      payload: {
        name: "Neo Pit Lane",
        nationality: "Argentina",
        birthDate: "1998-03-15",
      },
    });
    expect(manual.statusCode).toBe(201);
    const manualId = (manual.json() as { character: { id: string } }).character.id;

    const listRes = await app.inject({
      method: "GET",
      url: "/api/characters",
      headers: { cookie: admin.cookie },
    });
    const characters = listRes.json().characters as { id: string; name: string }[];
    expect(characters.some((c) => c.name === "Neo Pit Lane")).toBe(true);
    expect(characters.some((c) => c.name === "Grace Hopper")).toBe(true);

    const res = await app.inject({
      method: "POST",
      url: "/api/conversations",
      headers: { cookie: admin.cookie },
      payload: {
        title: "Rádio misto",
        participantIds: [manualId, graceCharId, adaCharId, manualId],
      },
    });
    expect(res.statusCode, `body: ${res.body}`).toBe(201);
    const { conversation } = res.json();
    createdConversationIds.push(conversation.id as string);
    const participants = conversation.participants as {
      name: string;
      controlledBy: string;
      externalType?: string;
    }[];
    const names = participants.map((p) => p.name);
    expect(names.filter((n) => n === "Neo Pit Lane")).toHaveLength(1);
    expect(names.filter((n) => n === "Grace Hopper")).toHaveLength(1);
    expect(participants.every((p) => p.controlledBy === "USER")).toBe(true);
    expect(participants.every((p) => p.externalType === undefined)).toBe(true);

    const graceChar = await prisma.character.findFirstOrThrow({
      where: { userId: admin.id, name: "Grace Hopper" },
      select: { controlledBy: true },
    });
    expect(graceChar.controlledBy).toBe("USER");

    const cpCount = await prisma.conversationParticipant.count({
      where: { conversationId: conversation.id },
    });
    expect(cpCount).toBe(3);
  });

  it("11) divergência narrativa não é sobrescrita: sync continua 200, materialização vira CONFLICT", async () => {
    const redBull = await prisma.team.create({
      data: { name: "Red Smoke", shortName: "RSM", color: "#9400d3", userId: admin.id },
    });
    await prisma.seasonDriverEntry.update({
      where: { id: (await prisma.seasonDriverEntry.findFirstOrThrow({
        where: { seasonId: fixture.seasonId, driverProfileId: adaProfileId },
        select: { id: true },
      })).id },
      data: { teamId: redBull.id, seat: 1, status: "ACTIVE", provenance: "HYBRID" },
    });

    const res = await syncScopeRaw("DRIVER_SEASONS");
    expect(res.statusCode).toBe(200);
    expect(res.body.materialization!.status).toBe("CONFLICT");

    const adaEntry = await prisma.seasonDriverEntry.findFirstOrThrow({
      where: { seasonId: fixture.seasonId, driverProfileId: adaProfileId },
    });
    expect(adaEntry.teamId).toBe(redBull.id);
    expect(adaEntry.provenance).toBe("HYBRID");
    expect(await prisma.team.count({ where: { userId: admin.id } })).toBe(3);
    expect(await prisma.character.count({ where: { userId: admin.id } })).toBe(5);
  });

  it("12) fonte externa permanece intacta após sync + materialização", async () => {
    const pre = {
      teams: await prisma.externalTeam.count({ where: { source: JOLPICA_SOURCE } }),
      drivers: await prisma.externalDriver.count({ where: { source: JOLPICA_SOURCE } }),
      seasons: await prisma.externalSeason.count({ where: { source: JOLPICA_SOURCE, year: YEAR } }),
      driverSeasons: await prisma.externalDriverSeason.count({
        where: { source: JOLPICA_SOURCE, seasonYear: YEAR },
      }),
    };
    const lanHash = await prisma.externalDriver.findUniqueOrThrow({
      where: {
        source_externalId: { source: JOLPICA_SOURCE, externalId: "auto-la" },
      },
      select: { contentHash: true, sourceRecord: true },
    });

    const res = await syncScopeRaw("DRIVER_SEASONS");
    expect(res.statusCode).toBe(200);

    const post = {
      teams: await prisma.externalTeam.count({ where: { source: JOLPICA_SOURCE } }),
      drivers: await prisma.externalDriver.count({ where: { source: JOLPICA_SOURCE } }),
      seasons: await prisma.externalSeason.count({ where: { source: JOLPICA_SOURCE, year: YEAR } }),
      driverSeasons: await prisma.externalDriverSeason.count({
        where: { source: JOLPICA_SOURCE, seasonYear: YEAR },
      }),
    };
    expect(post).toEqual(pre);

    const lan = await prisma.externalDriver.findUniqueOrThrow({
      where: {
        source_externalId: { source: JOLPICA_SOURCE, externalId: "auto-la" },
      },
      select: { contentHash: true, sourceRecord: true },
    });
    expect(lan.contentHash).toBe(lanHash.contentHash);
    expect(JSON.stringify(lan.sourceRecord)).toBe(JSON.stringify(lanHash.sourceRecord));
  });
});