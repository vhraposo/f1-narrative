import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import { JolpicaClient } from "./jolpica.client.js";
import { JolpicaTransport } from "./jolpica.transport.js";
import {
  createExternalDataProvider,
  JolpicaExternalDataProvider,
} from "./external-data-provider.js";
import {
  JOLPICA_SOURCE,
  JolpicaSyncService,
} from "./jolpica.service.js";

const RUN = Date.now().toString(36);
const YEAR = 2099;
const CIRCUIT_A = `itx-a-${RUN}`;
const CIRCUIT_B = `itx-b-${RUN}`;
const STARTED_AT = new Date();

type Routes = Record<string, unknown>;

function makeService(routes: Routes): JolpicaSyncService {
  const fetchImpl = (async (input: unknown) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/ergast\/f1\//, "");
    const payload = routes[path];
    if (payload === undefined) {
      return new Response("Not Found", { status: 404 });
    }
    const status =
      typeof payload === "object" && payload !== null && "status" in payload
        ? Number((payload as { status: unknown }).status)
        : 200;
    if (status !== 200) {
      return new Response("upstream error", { status });
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const transport = new JolpicaTransport({
    baseUrl: "https://api.jolpi.ca/ergast/f1/",
    maxRetries: 0,
    fetchImpl,
  });
  return new JolpicaSyncService(new JolpicaClient({ transport }));
}

function circuitPayload() {
  return {
    MRData: {
      limit: "100",
      offset: "0",
      total: "2",
      CircuitTable: {
        Circuits: [
          {
            circuitId: CIRCUIT_A,
            circuitName: `Circuit A ${RUN}`,
            Location: {
              lat: "-23.7036",
              long: "-46.6997",
              locality: "São Paulo",
              country: "Brazil",
            },
          },
          {
            circuitId: CIRCUIT_B,
            circuitName: `Circuit B ${RUN}`,
            Location: { locality: "Silverstone", country: "UK" },
          },
        ],
      },
    },
  };
}

function racesPayload() {
  return {
    MRData: {
      RaceTable: {
        season: String(YEAR),
        Races: [
          {
            season: String(YEAR),
            round: "1",
            raceName: `Race A ${RUN}`,
            Circuit: {
              circuitId: CIRCUIT_A,
              circuitName: `Circuit A ${RUN}`,
              Location: {
                lat: "-23.7036",
                long: "-46.6997",
                locality: "São Paulo",
                country: "Brazil",
              },
            },
            date: "2099-03-15",
            time: "15:00:00Z",
          },
          {
            season: String(YEAR),
            round: "2",
            raceName: `Race B ${RUN}`,
            Circuit: { circuitId: CIRCUIT_B, circuitName: `Circuit B ${RUN}` },
            date: "2099-07-05",
          },
        ],
      },
    },
  };
}

afterAll(async () => {
  await prisma.externalSyncRun.deleteMany({
    where: { source: JOLPICA_SOURCE, startedAt: { gte: STARTED_AT } },
  });
  await prisma.externalRace.deleteMany({
    where: { source: JOLPICA_SOURCE, seasonYear: YEAR },
  });
  await prisma.externalCircuit.deleteMany({
    where: { source: JOLPICA_SOURCE, externalId: { in: [CIRCUIT_A, CIRCUIT_B] } },
  });
  await prisma.$disconnect();
});

describe("CIRCUITS — sincronização idempotente e observável", () => {
  it("cria circuitos na primeira execução e não duplica na segunda", async () => {
    const service = makeService({ "circuits.json": circuitPayload() });

    const first = await service.sync(YEAR, "CIRCUITS");
    expect(first.counts.created).toBe(2);
    expect(first.counts.skipped).toBe(0);

    const second = await service.sync(YEAR, "CIRCUITS");
    expect(second.counts.created).toBe(0);
    expect(second.counts.unchanged).toBe(2);

    const count = await prisma.externalCircuit.count({
      where: { source: JOLPICA_SOURCE, externalId: { in: [CIRCUIT_A, CIRCUIT_B] } },
    });
    expect(count).toBe(2);

    const silverstone = await prisma.externalCircuit.findUniqueOrThrow({
      where: {
        source_externalId: { source: JOLPICA_SOURCE, externalId: CIRCUIT_B },
      },
      select: { country: true, locality: true },
    });
    expect(silverstone.country).toBe("United Kingdom");
    expect(silverstone.locality).toBe("Silverstone");

    const runs = await prisma.externalSyncRun.findMany({
      where: {
        source: JOLPICA_SOURCE,
        scope: "CIRCUITS",
        startedAt: { gte: STARTED_AT },
      },
      select: { status: true },
    });
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.status === "SUCCESS")).toBe(true);
  });

  it("coalesce execuções concorrentes do mesmo escopo em um único run", async () => {
    const service = makeService({ "circuits.json": circuitPayload() });
    const marker = new Date();

    const [a, b] = await Promise.all([
      service.sync(YEAR, "CIRCUITS"),
      service.sync(YEAR, "CIRCUITS"),
    ]);
    expect(a.counts).toEqual(b.counts);

    const runs = await prisma.externalSyncRun.count({
      where: {
        source: JOLPICA_SOURCE,
        scope: "CIRCUITS",
        startedAt: { gte: marker },
      },
    });
    expect(runs).toBe(1);
  });

  it("payload incompleto não cria registros inválidos", async () => {
    const unique = `itx-incomplete-${RUN}`;
    const service = makeService({
      "circuits.json": {
        MRData: {
          total: "3",
          CircuitTable: {
            Circuits: [
              { circuitId: unique, circuitName: `Válido ${RUN}` },
              { circuitId: `itx-sem-nome-${RUN}` },
              { circuitName: `Sem id ${RUN}` },
            ],
          },
        },
      },
    });

    const report = await service.sync(YEAR, "CIRCUITS");
    expect(report.counts.created).toBe(1);

    const invalid = await prisma.externalCircuit.count({
      where: {
        source: JOLPICA_SOURCE,
        externalId: `itx-sem-nome-${RUN}`,
      },
    });
    expect(invalid).toBe(0);

    await prisma.externalCircuit.deleteMany({
      where: { source: JOLPICA_SOURCE, externalId: unique },
    });
  });
});

describe("RACES — calendário com circuitos vinculados", () => {
  it("persiste corridas, cria circuitos e liga externalCircuitId", async () => {
    const service = makeService({ [`${YEAR}.json`]: racesPayload() });

    const report = await service.sync(YEAR, "RACES");
    expect(report.counts.created).toBeGreaterThanOrEqual(2);

    const race = await prisma.externalRace.findUniqueOrThrow({
      where: {
        source_seasonYear_round: {
          source: JOLPICA_SOURCE,
          seasonYear: YEAR,
          round: 1,
        },
      },
      select: {
        circuitExternalId: true,
        externalCircuitId: true,
        country: true,
        time: true,
      },
    });
    expect(race.circuitExternalId).toBe(CIRCUIT_A);
    expect(race.externalCircuitId).not.toBeNull();
    expect(race.country).toBe("Brazil");
    expect(race.time).toBe("15:00:00Z");

    const circuit = await prisma.externalCircuit.findUniqueOrThrow({
      where: { source_externalId: { source: JOLPICA_SOURCE, externalId: CIRCUIT_A } },
      select: { id: true },
    });
    expect(race.externalCircuitId).toBe(circuit.id);
  });
});

describe("Falhas externas — run registrado como FAILED", () => {
  it("HTTP 500 propaga erro e registra run FAILED sanitizado", async () => {
    const service = makeService({ "circuits.json": { status: 500 } });
    const marker = new Date();

    await expect(service.sync(YEAR, "CIRCUITS")).rejects.toThrow();

    const run = await prisma.externalSyncRun.findFirstOrThrow({
      where: {
        source: JOLPICA_SOURCE,
        scope: "CIRCUITS",
        startedAt: { gte: marker },
      },
      select: { status: true, error: true, finishedAt: true },
    });
    expect(run.status).toBe("FAILED");
    expect(run.error).toBeTruthy();
    expect(run.finishedAt).not.toBeNull();
  });

  it("rate limit (429) falha de forma controlada", async () => {
    const service = makeService({ "circuits.json": { status: 429 } });
    await expect(service.sync(YEAR, "CIRCUITS")).rejects.toThrow();
  });
});

describe("Provider — fonte desconhecida é rejeitada", () => {
  it("createExternalDataProvider lança para fonte não suportada", () => {
    const transport = new JolpicaTransport({
      baseUrl: "https://api.jolpi.ca/ergast/f1/",
      fetchImpl: (async () => new Response("{}", { status: 200 })) as typeof fetch,
    });
    const client = new JolpicaClient({ transport });
    expect(() => createExternalDataProvider("f1db", client)).toThrow(
      /não suportada/,
    );
    expect(
      createExternalDataProvider("jolpica", client),
    ).toBeInstanceOf(JolpicaExternalDataProvider);
  });
});
