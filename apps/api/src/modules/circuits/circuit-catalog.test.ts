import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";

const PREFIX = "cat-circuit";
const SOURCE = "cat-synth";

let app: FastifyInstance;
let cookie: string;
let userId: string;

const createdUserIds: string[] = [];
const createdDriverIds: string[] = [];
const createdCircuitIds: string[] = [];

function remoteAddress(): string {
  return `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
}

async function createExternalDriver(label: string) {
  const driver = await prisma.externalDriver.create({
    data: {
      source: SOURCE,
      externalId: `${PREFIX}-${label}`,
      name: `Piloto ${label}`,
      contentHash: `hash-${label}`,
    },
  });
  createdDriverIds.push(driver.id);
  return driver;
}

async function createCircuit(label: string, data: {
  locality?: string;
  country?: string;
  lengthMeters?: number;
  turns?: number;
  layoutKey?: string;
}) {
  const circuit = await prisma.externalCircuit.create({
    data: {
      source: SOURCE,
      externalId: `${PREFIX}-${label}`,
      name: `Circuito ${label}`,
      url: `https://example.test/${label}`,
      locality: data.locality ?? null,
      country: data.country ?? null,
      lengthMeters: data.lengthMeters ?? null,
      turns: data.turns ?? null,
      layoutKey: data.layoutKey ?? null,
      contentHash: `circuit-${label}`,
    },
  });
  createdCircuitIds.push(circuit.id);
  return circuit;
}

async function seedResult(input: {
  circuitId: string;
  driverId: string;
  year: number;
  round: number;
  raceName: string;
  position: number;
  fastestLap?: boolean;
  fastestLapTime?: string;
}) {
  const race = await prisma.externalRace.create({
    data: {
      source: SOURCE,
      seasonYear: input.year,
      round: input.round,
      name: input.raceName,
      grandPrix: input.raceName,
      date: new Date(`${input.year}-04-01T00:00:00.000Z`),
      externalCircuitId: input.circuitId,
      contentHash: `race-${input.circuitId}-${input.year}-${input.round}`,
    },
  });
  await prisma.externalResult.create({
    data: {
      source: SOURCE,
      externalRaceId: race.id,
      externalDriverId: input.driverId,
      position: input.position,
      fastestLap: input.fastestLap ?? null,
      fastestLapTime: input.fastestLapTime ?? null,
      contentHash: `result-${race.id}-${input.driverId}`,
    },
  });
  return race;
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();

  const email = `${PREFIX}-${Date.now()}@f1nw.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: "Circuitos QA", email, password: "senha-segura-123" },
    remoteAddress: remoteAddress(),
  });
  expect(res.statusCode).toBe(200);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  userId = user.id;
  createdUserIds.push(user.id);
  cookie = (res.cookies ?? []).map((entry) => `${entry.name}=${entry.value}`).join("; ");

  const interlagos = await createCircuit("Interlagos", {
    locality: "São Paulo",
    country: "Brazil",
    lengthMeters: 4309,
    turns: 15,
    layoutKey: "interlagos-modern",
  });
  const monza = await createCircuit("Monza", {
    locality: "Monza",
    country: "Italy",
    lengthMeters: 5793,
    turns: 11,
  });

  const senna = await createExternalDriver("senna");
  const alicya = await createExternalDriver("alicya");
  const schumacher = await createExternalDriver("schumacher");

  await seedResult({ circuitId: interlagos.id, driverId: senna.id, year: 2091, round: 1, raceName: "GP São Paulo 2091", position: 1, fastestLap: true, fastestLapTime: "1:12.345" });
  await seedResult({ circuitId: interlagos.id, driverId: senna.id, year: 2092, round: 2, raceName: "GP São Paulo 2092", position: 1 });
  await seedResult({ circuitId: interlagos.id, driverId: alicya.id, year: 2093, round: 3, raceName: "GP São Paulo 2093", position: 1 });
  await seedResult({ circuitId: monza.id, driverId: schumacher.id, year: 2094, round: 4, raceName: "GP Itália 2094", position: 1 });
});

afterAll(async () => {
  await prisma.externalResult.deleteMany({
    where: { externalRace: { externalCircuitId: { in: createdCircuitIds } } },
  });
  await prisma.externalRace.deleteMany({ where: { externalCircuitId: { in: createdCircuitIds } } });
  await prisma.externalCircuit.deleteMany({ where: { id: { in: createdCircuitIds } } });
  await prisma.externalDriver.deleteMany({ where: { id: { in: createdDriverIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  void userId;
  await app.close();
  await prisma.$disconnect();
});

describe("catálogo externo de circuitos", () => {
  it("1) exige autenticação e lista com estatísticas e mídia honesta", async () => {
    const anonymous = await app.inject({
      method: "GET",
      url: "/api/external/circuits",
      remoteAddress: remoteAddress(),
    });
    expect(anonymous.statusCode).toBe(401);

    const res = await app.inject({
      method: "GET",
      url: `/api/external/circuits?search=${encodeURIComponent("Circuito Inter")}`,
      headers: { cookie },
      remoteAddress: remoteAddress(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      circuits: Array<{
        id: string;
        name: string;
        locality: string | null;
        country: string | null;
        lengthMeters: number | null;
        turns: number | null;
        firstRaceYear: number | null;
        lastRaceYear: number | null;
        raceCount: number;
        media: {
          layout: { key: string | null; available: boolean };
          photo: unknown;
        };
      }>;
      total: number;
    };
    expect(body.total).toBe(1);
    const circuit = body.circuits[0]!;
    expect(circuit.name).toBe("Circuito Interlagos");
    expect(circuit.country).toBe("Brazil");
    expect(circuit.locality).toBe("São Paulo");
    expect(circuit.lengthMeters).toBe(4309);
    expect(circuit.turns).toBe(15);
    expect(circuit.firstRaceYear).toBe(2091);
    expect(circuit.lastRaceYear).toBe(2093);
    expect(circuit.raceCount).toBe(3);
    expect(circuit.media.layout.key).toBe("interlagos-modern");
    expect(circuit.media.layout.available).toBe(false);
    expect(circuit.media.photo).toBeNull();
  });

  it("2) valida limite da consulta", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/external/circuits?limit=999",
      headers: { cookie },
      remoteAddress: remoteAddress(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("3) detalhe agrega vencedores, recentes e volta mais rápida da corrida", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/api/external/circuits?search=${encodeURIComponent("Circuito Inter")}`,
      headers: { cookie },
      remoteAddress: remoteAddress(),
    });
    const circuitId = (list.json() as { circuits: Array<{ id: string }> }).circuits[0]!.id;

    const res = await app.inject({
      method: "GET",
      url: `/api/external/circuits/${circuitId}`,
      headers: { cookie },
      remoteAddress: remoteAddress(),
    });
    expect(res.statusCode).toBe(200);
    const detail = (res.json() as {
      circuit: {
        name: string;
        source: string;
        sourceUrl: string | null;
        topWinners: Array<{ name: string; wins: number }>;
        recentWinners: Array<{ seasonYear: number; driverName: string }>;
        fastestRaceLap: { driverName: string; time: string; seasonYear: number } | null;
        officialLapRecord: { available: boolean; reason: string };
      };
    }).circuit;

    expect(detail.source).toBe(SOURCE);
    expect(detail.sourceUrl).toBe("https://example.test/Interlagos");
    expect(detail.topWinners).toHaveLength(2);
    expect(detail.topWinners[0]?.wins).toBe(2);
    expect(detail.topWinners[1]?.wins).toBe(1);
    expect(detail.recentWinners.map((winner) => winner.seasonYear)).toEqual([2093, 2092, 2091]);
    expect(detail.fastestRaceLap?.driverName).toBe("Piloto senna");
    expect(detail.fastestRaceLap?.time).toBe("1:12.345");
    expect(detail.officialLapRecord.available).toBe(false);
    expect(detail.officialLapRecord.reason).toBe("LAP_RECORD_SOURCE_UNAVAILABLE");
  });

  it("4) detalhe inexistente é 404 leak-safe", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/external/circuits/00000000-0000-0000-0000-000000000000",
      headers: { cookie },
      remoteAddress: remoteAddress(),
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { code: string }).code).toBe("CIRCUIT_NOT_FOUND");
  });

  it("5) enriquece com F1DB real e serve o layout SVG sanitizado", async () => {
    const circuit = await createCircuit("Interlagos-F1DB", {
      country: "Brazil",
    });
    await prisma.externalCircuit.update({
      where: { id: circuit.id },
      data: { externalId: "interlagos", name: "Autódromo José Carlos Pace" },
    });

    const list = await app.inject({
      method: "GET",
      url: `/api/external/circuits?search=${encodeURIComponent("José Carlos Pace")}`,
      headers: { cookie },
      remoteAddress: remoteAddress(),
    });
    expect(list.statusCode).toBe(200);
    const item = (
      list.json() as {
        circuits: Array<{
          id: string;
          lengthMeters: number | null;
          turns: number | null;
          type: string | null;
          locality: string | null;
          firstRaceYear: number | null;
          provenance: { source: string; sourceVersion: string | null };
          media: { layout: { available: boolean; url: string | null; attribution: string | null } };
        }>;
      }
    ).circuits.find((entry) => entry.id === circuit.id)!;
    expect(item.lengthMeters).toBe(4309);
    expect(item.turns).toBe(15);
    expect(item.type).toBe("RACE");
    expect(item.locality).toBe("São Paulo");
    expect(item.firstRaceYear).toBe(1973);
    expect(item.provenance.source).toBe("F1DB");
    expect(item.provenance.sourceVersion).toBe("v2026.15.1");
    expect(item.media.layout.available).toBe(true);
    expect(item.media.layout.url).toBe(`/api/external/circuits/${circuit.id}/layout.svg`);
    expect(item.media.layout.attribution).toContain("CC BY 4.0");

    const detail = await app.inject({
      method: "GET",
      url: `/api/external/circuits/${circuit.id}`,
      headers: { cookie },
      remoteAddress: remoteAddress(),
    });
    const detailBody = detail.json() as {
      circuit: { layouts: Array<{ id: string; effective: boolean; turns: number | null }> };
    };
    expect(detailBody.circuit.layouts.length).toBeGreaterThanOrEqual(2);
    expect(
      detailBody.circuit.layouts.find((layout) => layout.effective)?.id,
    ).toBe("interlagos-2");

    const svg = await app.inject({
      method: "GET",
      url: `/api/external/circuits/${circuit.id}/layout.svg`,
      headers: { cookie },
      remoteAddress: remoteAddress(),
    });
    expect(svg.statusCode).toBe(200);
    expect(svg.headers["content-type"]).toContain("image/svg+xml");
    expect(String(svg.headers["x-attribution"])).toContain("CC BY 4.0");
    expect(svg.body.startsWith("<svg")).toBe(true);
    expect(svg.body.includes("<script")).toBe(false);

    const byKey = await app.inject({
      method: "GET",
      url: "/api/external/circuits/f1db/interlagos/layout.svg",
      headers: { cookie },
      remoteAddress: remoteAddress(),
    });
    expect(byKey.statusCode).toBe(200);
    expect(byKey.headers["content-type"]).toContain("image/svg+xml");
    expect(String(byKey.headers["x-circuit-layout"])).toBe("interlagos-2");

    const unknown = await app.inject({
      method: "GET",
      url: "/api/external/circuits/f1db/circuito-inventado/layout.svg",
      headers: { cookie },
      remoteAddress: remoteAddress(),
    });
    expect(unknown.statusCode).toBe(404);
  });
});
