import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { JolpicaClient } from "../external-sync/jolpica.client.js";
import { JolpicaTransport } from "../external-sync/jolpica.transport.js";
import { seedUniverseInitFixture, type InitFixtureIds } from "./universe-init.fixtures.js";

function makeDummyClient(): JolpicaClient {
  return new JolpicaClient({
    transport: new JolpicaTransport({
      baseUrl: "https://mock.invalid/f1/",
      timeoutMs: 5000,
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts[parts.length - 1] === "drivers.json") {
          return new Response(JSON.stringify({ MRData: { DriverTable: { Drivers: [] } } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ MRData: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    }),
  });
}

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

describe("UniverseInit routes — endpoints e autorização (2032)", () => {
  let app: FastifyInstance;
  let ids: InitFixtureIds;
  let adminCookie: string;
  let userCookie: string;
  let adminId: string;
  let userId: string;
  let cleanup: (extraUserIds?: string[]) => Promise<void>;

  beforeAll(async () => {
    const fixture = await seedUniverseInitFixture(2032);
    ids = fixture.ids;
    cleanup = fixture.cleanup;

    app = buildApp(undefined, undefined, makeDummyClient());
    await app.ready();

    const adminEmail = `universe-admin-${Date.now()}@f1nw.test`;
    adminCookie = await signUpGetCookie(app, adminEmail, "Universe Admin");
    adminId = (await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })).id;
    await prisma.user.update({ where: { id: adminId }, data: { role: "ADMIN" } });

    const userEmail = `universe-user-${Date.now()}@f1nw.test`;
    userCookie = await signUpGetCookie(app, userEmail, "Universe User");
    userId = (await prisma.user.findUniqueOrThrow({ where: { email: userEmail } })).id;
  });

  afterAll(async () => {
    await app.close();
    await cleanup([adminId, userId]);
    await prisma.$disconnect();
  });

  function body(scopes?: string[]) {
    return {
      seasonId: ids.seasonId,
      externalSeasonId: ids.extSeasonId,
      ...(scopes ? { scopes } : {}),
    };
  }

  it("POST preview sem sessão → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/universe/initialization/preview",
      payload: body(),
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST preview como usuário comum → 403 FORBIDDEN", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/universe/initialization/preview",
      headers: { cookie: userCookie },
      payload: body(),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("POST execute como usuário comum → 403 FORBIDDEN", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/universe/initialization",
      headers: { cookie: userCookie },
      payload: body(),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("GET status como usuário comum → 403 FORBIDDEN", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/universe/initialization/status",
      headers: { cookie: userCookie },
      query: { seasonId: ids.seasonId, externalSeasonId: ids.extSeasonId },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("POST execute com body inválido → 400 VALIDATION_ERROR", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/universe/initialization",
      headers: { cookie: adminCookie },
      payload: { seasonId: "nao-e-uuid", externalSeasonId: ids.extSeasonId },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("GET status com escopos inválidos → 400 VALIDATION_ERROR", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/universe/initialization/status",
      headers: { cookie: adminCookie },
      query: { seasonId: ids.seasonId, externalSeasonId: ids.extSeasonId, scopes: "INVALIDO" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("POST preview admin → 200 com report de materialização", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/universe/initialization/preview",
      headers: { cookie: adminCookie },
      payload: body(),
    });
    expect(res.statusCode).toBe(200);
    const report = res.json().report;
    expect(report.conflicts).toEqual([]);
    expect(report.summary).toMatchObject({
      teamsCreated: 1,
      charactersCreated: 3,
      profilesCreated: 3,
      entriesCreated: 3,
      racesCreated: 2,
      resultsCreated: 4,
      standingsCreated: 2,
      bindingsCreated: 16,
    });
  });

  it("POST execute admin → 200 e materializa no universo", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/universe/initialization",
      headers: { cookie: adminCookie },
      payload: body(),
    });
    expect(res.statusCode).toBe(200);
    const report = res.json().report;
    expect(report.conflicts).toEqual([]);
    expect(report.seasonBindingCreated).toBe(true);

    expect(await prisma.team.count({ where: { userId: adminId } })).toBe(1);
    expect(await prisma.character.count({ where: { userId: adminId } })).toBe(3);
    expect(await prisma.race.count({ where: { seasonId: ids.seasonId } })).toBe(2);
    expect(
      await prisma.raceResult.count({ where: { race: { seasonId: ids.seasonId } } }),
    ).toBe(4);
    expect(await prisma.championshipStanding.count({ where: { seasonId: ids.seasonId } })).toBe(
      2,
    );
    expect(
      await prisma.externalBindingSeason.count({ where: { externalSeasonId: ids.extSeasonId } }),
    ).toBe(1);
  });

  it("GET status admin após inicialização → 200 initialized true", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/universe/initialization/status",
      headers: { cookie: adminCookie },
      query: { seasonId: ids.seasonId, externalSeasonId: ids.extSeasonId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toMatchObject({
      initialized: true,
      seasonBindingCreated: false,
    });
  });

  it("POST execute admin novamente → 200 idempotente (reutiliza)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/universe/initialization",
      headers: { cookie: adminCookie },
      payload: body(),
    });
    expect(res.statusCode).toBe(200);
    const report = res.json().report;
    expect(report.conflicts).toEqual([]);
    expect(report.summary).toMatchObject({
      teamsCreated: 0,
      teamsReused: 1,
      charactersCreated: 0,
      charactersReused: 3,
      profilesCreated: 0,
      profilesReused: 3,
      entriesCreated: 0,
      entriesReused: 3,
      racesCreated: 0,
      racesReused: 2,
      resultsCreated: 0,
      resultsReused: 4,
      standingsCreated: 0,
      standingsReused: 2,
      bindingsCreated: 0,
      conflicts: 0,
    });
  });
});