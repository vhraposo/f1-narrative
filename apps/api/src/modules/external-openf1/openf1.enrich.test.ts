import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { OpenF1Client, type OpenF1DriverRaw } from "./openf1.client.js";
import { OpenF1EnrichmentService } from "./openf1.enrich.js";

const PREFIX = "openf1-enrich";

type FetchMode = "ok" | "network" | "http" | "malformed";

class OpenF1FixtureServer {
  calls = 0;
  mode: FetchMode = "ok";
  readonly drivers: OpenF1DriverRaw[] = [
    {
      driver_number: 1,
      full_name: "Max Verstappen",
      first_name: "Max",
      last_name: "Verstappen",
      headshot_url: "https://cdn.openf1.org/1.png",
      team_name: "Red Bull",
      team_colour: "3671C6",
    },
    {
      driver_number: 11,
      full_name: "Sergio Perez",
      first_name: "Sergio",
      last_name: "Perez",
      headshot_url: "https://cdn.openf1.org/11.png",
      team_name: "Red Bull",
      team_colour: "3671C6",
    },
    {
      driver_number: 44,
      full_name: "Lewis Hamilton",
      first_name: "Lewis",
      last_name: "Hamilton",
      headshot_url: null,
      team_name: "Ferrari",
      team_colour: "E80020",
    },
  ];

  readonly fetch: typeof fetch = async (): Promise<Response> => {
    this.calls += 1;
    if (this.mode === "network") {
      throw new Error("network down");
    }
    if (this.mode === "http") {
      return new Response("nope", { status: 500 });
    }
    if (this.mode === "malformed") {
      return new Response("not-json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(this.drivers), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

function makeClient(server: OpenF1FixtureServer): OpenF1Client {
  return new OpenF1Client({
    baseUrl: "https://mock.openf1.invalid/v1/",
    timeoutMs: 5_000,
    maxRetries: 0,
    fetchImpl: server.fetch,
  });
}

async function seedDriver(
  externalId: string,
  number: number | null,
  headshotUrl: string | null = null,
) {
  const fullExternalId = `${PREFIX}-${externalId}`;
  await prisma.externalDriver.deleteMany({
    where: { source: "jolpica", externalId: fullExternalId },
  });
  return prisma.externalDriver.create({
    data: {
      source: "jolpica",
      externalId: fullExternalId,
      name: `Driver ${externalId}`,
      number,
      headshotUrl,
      contentHash: "seed",
    },
    select: { id: true, externalId: true, headshotUrl: true },
  });
}

describe("OpenF1EnrichmentService", () => {
  const server = new OpenF1FixtureServer();

  afterAll(async () => {
    await prisma.externalDriver.deleteMany({
      where: { externalId: { startsWith: `${PREFIX}-` } },
    });
    await prisma.$disconnect();
  });

  async function seedFixtures() {
    const one = await seedDriver("one", 1);
    const eleven = await seedDriver("eleven", 11);
    const withoutHeadshot = await seedDriver("fortyfour", 44);
    const notInSource = await seedDriver("ninety", 99);
    const noNumber = await seedDriver("nonum", null);
    return { one, eleven, withoutHeadshot, notInSource, noNumber };
  }

  async function readHeadshots(rows: { id: string }[]) {
    return prisma.externalDriver.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      select: { id: true, headshotUrl: true },
      orderBy: { id: "asc" },
    });
  }

  it("materializa headshot_url das linhas pelo number (associação estável)", async () => {
    server.mode = "ok";
    const rows = await seedFixtures();
    const service = new OpenF1EnrichmentService(makeClient(server));

    const report = await service.enrich();

    expect(server.calls).toBe(1);
    expect(report.source).toBe("openf1");
    expect(report.counts.matchedDrivers).toBe(2);
    expect(report.counts.rowsUpdated).toBe(2);
    expect(report.counts.rowsWithoutHeadshot).toBe(2);

    const updated = await readHeadshots(Object.values(rows));
    const byExternalIdId: Record<string, { headshotUrl: string | null }> = {};
    for (const row of updated) {
      for (const key of Object.keys(rows) as (keyof typeof rows)[]) {
        if (rows[key].id === row.id) byExternalIdId[key] = row;
      }
    }
    expect(byExternalIdId.one.headshotUrl).toBe("https://cdn.openf1.org/1.png");
    expect(byExternalIdId.eleven.headshotUrl).toBe(
      "https://cdn.openf1.org/11.png",
    );
    expect(byExternalIdId.withoutHeadshot.headshotUrl).toBeNull();
    expect(byExternalIdId.notInSource.headshotUrl).toBeNull();
    expect(byExternalIdId.noNumber.headshotUrl).toBeNull();
  });

  it("é idempotente: segunda execução não escreve nada", async () => {
    server.mode = "ok";
    await seedFixtures();
    const service = new OpenF1EnrichmentService(makeClient(server));

    const first = await service.enrich();
    expect(first.counts.rowsUpdated).toBe(2);

    const second = await service.enrich();
    expect(second.counts.rowsUpdated).toBe(0);
    expect(second.counts.rowsUnchanged).toBe(2);
    expect(second.counts.matchedDrivers).toBe(2);
  });

  it("recalcula apenas quando a URL muda (update, sem duplicar)", async () => {
    server.mode = "ok";
    const rows = await seedFixtures();
    const service = new OpenF1EnrichmentService(makeClient(server));

    await service.enrich();
    await prisma.externalDriver.update({
      where: { id: rows.one.id },
      data: { headshotUrl: "https://old.png" },
    });

    const report = await service.enrich();
    expect(report.counts.rowsUpdated).toBe(1);
    expect(report.counts.rowsUnchanged).toBe(1);

    const one = await prisma.externalDriver.findUniqueOrThrow({
      where: { id: rows.one.id },
      select: { headshotUrl: true },
    });
    expect(one.headshotUrl).toBe("https://cdn.openf1.org/1.png");
  });

  it("falha de rede rejeita sem alterar o banco", async () => {
    server.mode = "network";
    const rows = await seedFixtures();
    const service = new OpenF1EnrichmentService(makeClient(server));

    await expect(service.enrich()).rejects.toMatchObject({ code: "NETWORK" });

    const stored = await readHeadshots(Object.values(rows));
    expect(stored.every((r) => r.headshotUrl === null)).toBe(true);
  });

  it("resposta malformada rejeita com OpenF1Error MALFORMED", async () => {
    server.mode = "malformed";
    await seedFixtures();
    const service = new OpenF1EnrichmentService(makeClient(server));

    await expect(service.enrich()).rejects.toMatchObject({ code: "MALFORMED" });
  });
});

describe("OpenF1Enrichment routes — endpoint admin-only", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let userCookie: string;
  const server = new OpenF1FixtureServer();

  beforeAll(async () => {
    app = buildApp(undefined, undefined, undefined, undefined, makeClient(server));
    await app.ready();

    const adminEmail = `${PREFIX}-admin-${Date.now()}@f1nw.test`;
    const userEmail = `${PREFIX}-user-${Date.now()}@f1nw.test`;
    adminCookie = await signUpGetCookie(app, adminEmail, "OpenF1 Admin");
    userCookie = await signUpGetCookie(app, userEmail, "OpenF1 User");

    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: adminEmail },
    });
    await prisma.user.update({
      where: { id: admin.id },
      data: { role: "ADMIN" },
    });
  });

  afterAll(async () => {
    await prisma.externalDriver.deleteMany({
      where: { externalId: { startsWith: `${PREFIX}-` } },
    });
    await prisma.user.deleteMany({ where: { email: { startsWith: `${PREFIX}-` } } });
    await app.close();
    await prisma.$disconnect();
  });

  it("sem sessão → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/enrichment/openf1/drivers",
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHENTICATED");
  });

  it("usuário comum → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/enrichment/openf1/drivers",
      headers: { cookie: userCookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("admin enriquece → 200 com relatório", async () => {
    server.mode = "ok";
    await seedDriver("route", 1);
    const res = await app.inject({
      method: "POST",
      url: "/api/enrichment/openf1/drivers",
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.report.source).toBe("openf1");
    expect(body.report.counts.matchedDrivers).toBe(1);
    expect(body.report.counts.rowsUpdated).toBe(1);
  });

  it("fonte externa indisponível → 502 SOURCE_UNAVAILABLE", async () => {
    server.mode = "http";
    const res = await app.inject({
      method: "POST",
      url: "/api/enrichment/openf1/drivers",
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe("SOURCE_UNAVAILABLE");
  });

  it("resposta malformada → 502 SOURCE_MALFORMED", async () => {
    server.mode = "malformed";
    const res = await app.inject({
      method: "POST",
      url: "/api/enrichment/openf1/drivers",
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe("SOURCE_MALFORMED");
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
  return (res.cookies ?? [])
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}