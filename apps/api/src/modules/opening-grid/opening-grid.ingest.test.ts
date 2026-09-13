import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { JOLPICA_SOURCE } from "../external-sync/jolpica.service.js";
import { OpeningGridClient } from "./opening-grid.client.js";
import { OpeningGridTransport } from "./opening-grid.transport.js";
import { resolveOpeningGrid } from "./opening-grid.resolver.js";
import {
  OPENING_GRID_SOURCE,
  type OpeningGridEntryListSeason,
} from "./opening-grid.source.js";

const YEAR = 2085;
const BASE_URL = "https://mock.invalid/og/";
const ORIGIN = "http://localhost:3000";

const BASE_PAYLOAD: OpeningGridEntryListSeason = {
  year: YEAR,
  teams: [
    {
      teamExternalId: "og-atlas",
      name: "Atlas Racing",
      shortName: "ATL",
      color: "#1262db",
      drivers: [
        { externalId: "og-la", name: "Ada", fullName: "Ada Lovelace", number: 1, seat: 1 },
        { externalId: "og-gr", name: "Grace", fullName: "Grace Hopper", number: 11, seat: 2 },
      ],
    },
    {
      teamExternalId: "og-orion",
      name: "Orion GP",
      shortName: "ORI",
      color: "#db3f12",
      drivers: [
        { externalId: "og-cd", name: "Claire", fullName: "Claire De Luca", number: 88, seat: 1 },
        { externalId: "og-hir", name: "Hira", fullName: "Hira Tanaka", number: 7, reserve: true },
        { externalId: "og-oup", name: "Ume", fullName: "Ume Oka", number: 47, reserve: true },
      ],
    },
  ],
};

type FixtureMode = "ok" | "http-error" | "non-json" | "invalid-payload";

class OpeningGridFixtureServer {
  payload: unknown = BASE_PAYLOAD;
  mode: FixtureMode = "ok";
  errorStatus = 500;
  failTimes = 0;
  reads = 0;

  reset(): void {
    this.payload = BASE_PAYLOAD;
    this.mode = "ok";
    this.errorStatus = 500;
    this.failTimes = 0;
    this.reads = 0;
  }

  readonly fetch: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (!url.pathname.endsWith(`/${YEAR}/opening-grid.json`)) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    this.reads += 1;
    if (this.mode === "http-error" && this.reads <= this.failTimes) {
      return new Response(JSON.stringify({ error: "boom" }), {
        status: this.errorStatus,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (this.mode === "non-json") {
      return new Response("isto não é json", { status: 200 });
    }
    if (this.mode === "invalid-payload") {
      return new Response(JSON.stringify({ wtf: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(this.payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

function makeClient(server: OpeningGridFixtureServer): OpeningGridClient {
  return new OpeningGridClient({
    transport: new OpeningGridTransport({
      baseUrl: BASE_URL,
      timeoutMs: 5000,
      maxRetries: 2,
      fetchImpl: server.fetch,
    }),
  });
}

interface IngestBody {
  ok?: boolean;
  report?: {
    source: string;
    year: number;
    fetchedUrl: string;
    ingested: boolean;
    claims: number;
    counts: { created: number; updated: number; unchanged: number };
    conflicts: Array<{ kind: string; teamExternalId: string | null; externalId: string | null }>;
  };
  error?: string;
  code?: string;
}

let app: FastifyInstance;
let server: OpeningGridFixtureServer;
let admin: { id: string; cookie: string };
let plain: { id: string; cookie: string };

async function createSession(name: string): Promise<{ id: string; cookie: string }> {
  const email = `auto-og-${Date.now()}-${Math.random()}@f1nw.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: ORIGIN },
    payload: { name, email, password: "senha-segura-123" },
  });
  expect(res.statusCode, `sign-up body: ${res.body}`).toBe(200);
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: stored.id, cookie };
}

async function ingest(cookie = admin.cookie): Promise<{ statusCode: number; body: IngestBody }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/external-sync/opening-grid/opening-grid",
    headers: { cookie },
    payload: { seasonYear: YEAR },
  });
  return { statusCode: res.statusCode, body: res.json() as IngestBody };
}

function seedParticipants(
  payload: OpeningGridEntryListSeason,
  onlyIds?: string[],
): Promise<void> {
  return prisma.$transaction(async (tx) => {
    await tx.externalSeason.create({
      data: {
        source: JOLPICA_SOURCE,
        year: YEAR,
        name: String(YEAR),
        status: "ACTIVE",
        contentHash: "ingest-jolpica-season",
      },
    });
    const teamIds = new Set(payload.teams.map((team) => team.teamExternalId));
    for (const teamId of teamIds) {
      await tx.externalTeam.create({
        data: {
          source: JOLPICA_SOURCE,
          externalId: teamId,
          name: teamId,
          shortName: teamId,
          color: "#000000",
          contentHash: `ingest-jolpica-team-${teamId}`,
        },
      });
    }
    for (const team of payload.teams) {
      const candidates = team.drivers.filter(
        (driver) => (onlyIds ? onlyIds.includes(driver.externalId) : driver.seat != null),
      );
      for (const driver of candidates) {
        const extDriver = await tx.externalDriver.create({
          data: {
            source: JOLPICA_SOURCE,
            externalId: driver.externalId,
            name: driver.name,
            fullName: driver.fullName ?? driver.name,
            nationality: "Unknown",
            number: driver.number ?? null,
            contentHash: `ingest-jolpica-driver-${driver.externalId}`,
          },
        });
        await tx.externalDriverSeason.create({
          data: {
            source: JOLPICA_SOURCE,
            externalDriverId: extDriver.id,
            seasonYear: YEAR,
            teamExternalId: team.teamExternalId,
            teamNameSnapshot: team.name,
            number: driver.number ?? null,
            role: null,
            contentHash: `ingest-jolpica-ds-${driver.externalId}`,
          },
        });
      }
    }
  });
}

async function cleanIngest(): Promise<void> {
  const sources = [JOLPICA_SOURCE, OPENING_GRID_SOURCE];
  await prisma.externalDriverSeason.deleteMany({ where: { source: { in: sources } } });
  await prisma.externalDriver.deleteMany({ where: { source: { in: sources } } });
  await prisma.externalTeam.deleteMany({ where: { source: { in: sources } } });
  await prisma.externalSeason.deleteMany({ where: { source: { in: sources } } });
}

beforeAll(async () => {
  server = new OpeningGridFixtureServer();
  app = buildApp(undefined, undefined, undefined, makeClient(server));
  await app.ready();

  await cleanIngest();

  admin = await createSession("Ingest Admin");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
  plain = await createSession("Ingest Plain");
});

afterEach(async () => {
  server.reset();
  await cleanIngest();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, plain.id] } } });
  await prisma.$disconnect();
  await app.close();
});

describe("STEP 107.10 — Ingestão controlada da fonte Opening Grid", () => {
  it("1) ingest de uma temporada via endpoint produz relatório e grava claims", async () => {
    const res = await ingest();
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.report?.source).toBe(OPENING_GRID_SOURCE);
    expect(res.body.report?.year).toBe(YEAR);
    expect(res.body.report?.ingested).toBe(true);
    expect(res.body.report?.claims).toBe(5);
    expect(res.body.report?.conflicts).toEqual([]);
    expect(res.body.report?.counts.created).toBeGreaterThan(0);
    expect(res.body.report?.fetchedUrl).toBe(`https://mock.invalid/og/${YEAR}/opening-grid.json`);
  });

  it("2) payload válido persiste ExternalSeason/ExternalTeam/ExternalDriver/ExternalDriverSeason sob OPENING_GRID_SOURCE", async () => {
    await ingest();
    expect(
      await prisma.externalSeason.count({ where: { source: OPENING_GRID_SOURCE, year: YEAR } }),
    ).toBe(1);
    expect(
      await prisma.externalTeam.count({ where: { source: OPENING_GRID_SOURCE } }),
    ).toBe(2);
    expect(
      await prisma.externalDriverSeason.count({
        where: { source: OPENING_GRID_SOURCE, seasonYear: YEAR },
      }),
    ).toBe(5);
    const driverIds = await prisma.externalDriverSeason.findMany({
      where: { source: OPENING_GRID_SOURCE, seasonYear: YEAR },
      select: { externalDriverId: true },
    });
    const distinct = new Set(driverIds.map((row) => row.externalDriverId));
    expect(distinct.size).toBe(5);
  });

  it("3) normalização: seat 1/2 viram RACE_SEAT:1/:2; reserva vira RESERVE", async () => {
    await ingest();
    const rows = await prisma.externalDriverSeason.findMany({
      where: { source: OPENING_GRID_SOURCE, seasonYear: YEAR },
      select: { externalDriver: { select: { externalId: true } }, role: true, number: true },
    });
    const roleOf = (id: string) => rows.find((row) => row.externalDriver.externalId === id)?.role;
    expect(roleOf("og-la")).toBe("RACE_SEAT:1");
    expect(roleOf("og-gr")).toBe("RACE_SEAT:2");
    expect(roleOf("og-cd")).toBe("RACE_SEAT:1");
    expect(roleOf("og-hir")).toBe("RESERVE");
  });

  it("4) persistência preserva teamExternalId/número e mapeia claims à equipe declarada", async () => {
    await ingest();
    const atlas = await prisma.externalDriverSeason.findMany({
      where: { source: OPENING_GRID_SOURCE, seasonYear: YEAR, teamExternalId: "og-atlas" },
      select: { externalDriver: { select: { externalId: true } }, number: true },
    });
    expect(atlas.map((row) => row.externalDriver.externalId).sort()).toEqual(["og-gr", "og-la"]);
    const la = atlas.find((row) => row.externalDriver.externalId === "og-la");
    expect(la?.number).toBe(1);
  });

  it("5) idempotência: segunda ingestão é UNCHANGED, sem duplicar registros", async () => {
    await ingest();
    const before = await prisma.externalDriverSeason.count({
      where: { source: OPENING_GRID_SOURCE, seasonYear: YEAR },
    });
    const res = await ingest();
    expect(res.statusCode).toBe(200);
    expect(res.body.report?.counts.created).toBe(0);
    expect(res.body.report?.counts.updated).toBe(0);
    expect(res.body.report?.counts.unchanged).toBeGreaterThan(0);
    expect(
      await prisma.externalDriverSeason.count({
        where: { source: OPENING_GRID_SOURCE, seasonYear: YEAR },
      }),
    ).toBe(before);
  });

  it("6) seat 1/2 são honrados e não conflitam na mesma equipe", async () => {
    await ingest();
    const res = await ingest();
    expect(res.body.report?.conflicts).toEqual([]);
    const rows = await prisma.externalDriverSeason.findMany({
      where: { source: OPENING_GRID_SOURCE, seasonYear: YEAR, teamExternalId: "og-orion" },
      select: { externalDriver: { select: { externalId: true } }, role: true },
    });
    expect(rows.find((row) => row.externalDriver.externalId === "og-cd")?.role).toBe(
      "RACE_SEAT:1",
    );
  });

  it("7) múltiplos reservas são preservados (0..N) no pool de cada equipe", async () => {
    await ingest();
    const reserves = await prisma.externalDriverSeason.findMany({
      where: { source: OPENING_GRID_SOURCE, seasonYear: YEAR, role: "RESERVE" },
      select: { externalDriver: { select: { externalId: true } }, teamExternalId: true },
    });
    expect(reserves).toHaveLength(2);
    expect(reserves.map((row) => row.externalDriver.externalId).sort()).toEqual(["og-hir", "og-oup"]);
    expect(reserves.every((row) => row.teamExternalId === "og-orion")).toBe(true);
  });

  it("8) claim sem participante correspondente: ingerido, mas resolver informa UNRESOLVED sem materializar", async () => {
    const payload: OpeningGridEntryListSeason = {
      year: YEAR,
      teams: [
        {
          teamExternalId: "og-atlas",
          name: "Atlas Racing",
          drivers: [
            { externalId: "og-la", name: "Ada", number: 1, seat: 1 },
            { externalId: "og-gh", name: "Gustav", number: 22, seat: 2 },
          ],
        },
      ],
    };
    server.payload = payload;
    await seedParticipants(payload, ["og-la"]);
    const res = await ingest();
    expect(res.statusCode).toBe(200);
    expect(res.body.report?.ingested).toBe(true);

    const grid = await resolveOpeningGrid(prisma, {
      source: JOLPICA_SOURCE,
      year: YEAR,
      claimsSource: OPENING_GRID_SOURCE,
    });
    expect(grid.state).toBe("UNRESOLVED");
    const team = grid.teams.find((item) => item.externalTeamId === "og-atlas");
    expect(team?.state).toBe("UNRESOLVED");
    expect(team?.warnings.some((warning) => warning.includes("og-gh"))).toBe(true);

    expect(await prisma.team.count({ where: { userId: admin.id } })).toBe(0);
    expect(await prisma.character.count({ where: { userId: admin.id } })).toBe(0);
    expect(
      await prisma.externalDriverSeason.count({
        where: { source: OPENING_GRID_SOURCE, externalDriver: { externalId: "og-gh" } },
      }),
    ).toBe(1);
  });

  it("9) conflito de payload (seat duplicado): 409 OPENING_GRID_CONFLICT e nada é persistido", async () => {
    server.payload = {
      year: YEAR,
      teams: [
        {
          teamExternalId: "og-atlas",
          name: "Atlas Racing",
          drivers: [
            { externalId: "og-la", name: "Ada", seat: 1 },
            { externalId: "og-gh", name: "Gustav", seat: 1 },
          ],
        },
      ],
    };
    const res = await ingest();
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("OPENING_GRID_CONFLICT");
    expect(res.body.report?.ingested).toBe(false);
    expect(res.body.report?.conflicts.some((conflict) => conflict.kind === "DUPLICATE_SEAT")).toBe(
      true,
    );
    expect(
      await prisma.externalSeason.count({ where: { source: OPENING_GRID_SOURCE, year: YEAR } }),
    ).toBe(0);
  });

  it("10) identidade correta: tudo gravado sob opening-grid, nada sob jolpica", async () => {
    await ingest();
    expect(
      await prisma.externalDriverSeason.count({ where: { source: JOLPICA_SOURCE, seasonYear: YEAR } }),
    ).toBe(0);
    const drivers = await prisma.externalDriver.findMany({
      where: { externalId: { in: ["og-la", "og-gr"] } },
    });
    expect(drivers.every((driver) => driver.source === OPENING_GRID_SOURCE)).toBe(true);
  });

  it("11) espelho Jolpica permanece intacto após ingestão", async () => {
    await prisma.externalSeason.create({
      data: {
        source: JOLPICA_SOURCE,
        year: YEAR,
        name: String(YEAR),
        status: "ACTIVE",
        contentHash: "jolpica-intacta",
      },
    });
    await prisma.externalTeam.create({
      data: {
        source: JOLPICA_SOURCE,
        externalId: "jol-atlas",
        name: "Jol Atlas",
        shortName: "JAT",
        color: "#000000",
        contentHash: "jolpica-intacta-team",
      },
    });
    const jolDriver = await prisma.externalDriver.create({
      data: {
        source: JOLPICA_SOURCE,
        externalId: "jol-la",
        name: "Jol Launch",
        fullName: "Jol Launch",
        nationality: "French",
        number: 44,
        contentHash: "jolpica-intacta-driver",
      },
    });
    await prisma.externalDriverSeason.create({
      data: {
        source: JOLPICA_SOURCE,
        externalDriverId: jolDriver.id,
        seasonYear: YEAR,
        teamExternalId: "jol-atlas",
        teamNameSnapshot: "Jol Atlas",
        number: 44,
        role: null,
        contentHash: "jolpica-intacta-ds",
      },
    });

    await ingest();

    const jolRows = await prisma.externalDriverSeason.findMany({
      where: { source: JOLPICA_SOURCE, seasonYear: YEAR, teamExternalId: "jol-atlas" },
    });
    expect(jolRows).toHaveLength(1);
    expect(jolRows[0]?.number).toBe(44);
    const unchanged = await prisma.externalDriver.findUnique({
      where: { source_externalId: { source: JOLPICA_SOURCE, externalId: "jol-la" } },
    });
    expect(unchanged?.name).toBe("Jol Launch");
  });

  it("12) erro da fonte: HTTP 500 → 502 SOURCE_UNAVAILABLE; 404 → 404 SOURCE_NOT_FOUND", async () => {
    server.mode = "http-error";
    server.errorStatus = 500;
    server.failTimes = 3;
    let res = await ingest();
    expect(res.statusCode).toBe(502);
    expect(res.body.code).toBe("SOURCE_UNAVAILABLE");

    server.reset();
    server.mode = "http-error";
    server.errorStatus = 404;
    server.failTimes = 1;
    res = await ingest();
    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe("SOURCE_NOT_FOUND");
  });

  it("13) payload inválido e resposta não-JSON → 502 SOURCE_MALFORMED", async () => {
    server.mode = "invalid-payload";
    let res = await ingest();
    expect(res.statusCode).toBe(502);
    expect(res.body.code).toBe("SOURCE_MALFORMED");

    server.reset();
    server.mode = "non-json";
    res = await ingest();
    expect(res.statusCode).toBe(502);
    expect(res.body.code).toBe("SOURCE_MALFORMED");
  });

  it("14) transporte: retry recupera de 5xx transitório (500, 500, 200)", async () => {
    server.mode = "http-error";
    server.errorStatus = 500;
    server.failTimes = 2;
    const res = await ingest();
    expect(res.statusCode).toBe(200);
    expect(res.body.report?.ingested).toBe(true);
    expect(server.reads).toBe(3);
  });

  it("15) sem autenticação → 401 UNAUTHENTICATED", async () => {
    const res = await ingest("");
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });

  it("16) usuário comum → 403 FORBIDDEN", async () => {
    const res = await ingest(plain.cookie);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
    expect(
      await prisma.externalSeason.count({ where: { source: OPENING_GRID_SOURCE, year: YEAR } }),
    ).toBe(0);
  });
});