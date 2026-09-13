import { randomUUID } from "node:crypto";
import { afterEach, afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { JolpicaClient } from "../external-sync/jolpica.client.js";
import { JolpicaTransport } from "../external-sync/jolpica.transport.js";
import { JOLPICA_SOURCE } from "../external-sync/jolpica.service.js";
import { seedUniverseInitFixture, type InitFixtureIds } from "./universe-init.fixtures.js";
import { universeInitService, type Actor } from "./universe-init.service.js";

const WORLD_KEY = "default";

function actorFor(userId: string): Actor {
  return { id: userId, role: "ADMIN" };
}

async function readWorldSeason(): Promise<string | null> {
  const world = await prisma.worldState.findUnique({
    where: { key: WORLD_KEY },
    select: { currentSeasonId: true },
  });
  return world?.currentSeasonId ?? null;
}

function makeDummyClient(): JolpicaClient {
  return new JolpicaClient({
    transport: new JolpicaTransport({
      baseUrl: "https://mock.invalid/f1/",
      timeoutMs: 5000,
      fetchImpl: async () => {
        return new Response(JSON.stringify({ MRData: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    }),
  });
}

describe("UniverseInit bootstrap — temporada do universo a partir de ExternalSeason", () => {
  const seasonIds: string[] = [];
  const bindingIds: string[] = [];
  const extSeasonIds: string[] = [];
  const foreignWorldPointers: string[] = [];
  const extraCleanups: Array<() => Promise<void>> = [];
  let createdWorldRow = false;

  beforeAll(async () => {
    await prisma.worldState.deleteMany({});
  });

  async function captureWorldRowPresence() {
    const existing = await prisma.worldState.count({ where: { key: WORLD_KEY } });
    createdWorldRow = existing === 0;
  }

  async function createExtSeason(year: number, source = JOLPICA_SOURCE) {
    await prisma.externalSeason.deleteMany({ where: { source, year } });
    const extSeason = await prisma.externalSeason.create({
      data: {
        source,
        year,
        name: String(year),
        status: "ACTIVE",
        contentHash: `bootstrap-ext-${year}`,
      },
    });
    extSeasonIds.push(extSeason.id);
    return extSeason;
  }

  function recordBootstrap(report: { season: { universeSeasonId: string }; }) {
    seasonIds.push(report.season.universeSeasonId);
  }

  async function fixtureWithoutSeason(year: number) {
    const fixture = await seedUniverseInitFixture(year);
    await prisma.season.delete({ where: { id: fixture.ids.seasonId } });
    return fixture;
  }

  afterEach(async () => {
    if (seasonIds.length > 0) {
      await prisma.worldState.updateMany({
        where: { key: WORLD_KEY, currentSeasonId: { in: seasonIds } },
        data: { currentSeasonId: null },
      });
    }
    if (foreignWorldPointers.length > 0) {
      await prisma.worldState.updateMany({
        where: { key: WORLD_KEY, currentSeasonId: { in: foreignWorldPointers } },
        data: { currentSeasonId: null },
      });
    }
    if (seasonIds.length > 0) {
      await prisma.seasonDriverEntry.deleteMany({ where: { seasonId: { in: seasonIds } } });
      await prisma.championshipStanding.deleteMany({ where: { seasonId: { in: seasonIds } } });
      await prisma.raceResult.deleteMany({ where: { race: { seasonId: { in: seasonIds } } } });
      await prisma.race.deleteMany({ where: { seasonId: { in: seasonIds } } });
      await prisma.season.deleteMany({ where: { id: { in: seasonIds } } });
    }
    if (bindingIds.length > 0) {
      await prisma.externalBindingSeason.deleteMany({ where: { id: { in: bindingIds } } });
    }
    if (extSeasonIds.length > 0) {
      await prisma.externalSeason.deleteMany({ where: { id: { in: extSeasonIds } } });
    }
    if (createdWorldRow) {
      await prisma.worldState.deleteMany({ where: { key: WORLD_KEY } });
    }
    for (const cleanup of extraCleanups) {
      await cleanup();
    }
    seasonIds.length = 0;
    bindingIds.length = 0;
    extSeasonIds.length = 0;
    foreignWorldPointers.length = 0;
    extraCleanups.length = 0;
    createdWorldRow = false;
  });

  it("primeira temporada: cria Season + binding CONFIRMED e aponta WorldState sem tocar o Mirror", async () => {
    const fixture = await seedUniverseInitFixture(2061);
    extraCleanups.push(() => fixture.cleanup());
    await prisma.season.delete({ where: { id: fixture.ids.seasonId } });
    await captureWorldRowPresence();

    const report = await universeInitService.bootstrapSeason(
      actorFor(fixture.ids.userId),
      fixture.ids.extSeasonId,
    );

    recordBootstrap(report);
    const seasonId = report.season.universeSeasonId;
    const binding = await prisma.externalBindingSeason.findUnique({
      where: { externalSeasonId: fixture.ids.extSeasonId },
    });
    bindingIds.push(binding!.id);

    expect(report.season).toEqual({
      universeSeasonId: seasonId,
      externalSeasonId: fixture.ids.extSeasonId,
      year: 2061,
      source: JOLPICA_SOURCE,
      action: "CREATED",
    });
    expect(report.binding).toEqual({ created: true, reused: false, confidence: "CONFIRMED" });
    expect(report.worldState).toEqual({
      previousSeasonId: null,
      currentSeasonId: seasonId,
      changed: true,
    });

    const season = await prisma.season.findUnique({ where: { id: seasonId } });
    expect(season?.year).toBe(2061);
    expect(season?.status).toBe("PRE_SEASON");
    expect(binding?.seasonId).toBe(seasonId);
    expect(binding?.confidence).toBe("CONFIRMED");
    expect(binding?.boundBy).toBe("ADMIN");
    expect(await readWorldSeason()).toBe(seasonId);

    expect(await prisma.externalSeason.count({ where: { id: fixture.ids.extSeasonId } })).toBe(1);
    expect(await prisma.externalTeam.count({ where: { id: fixture.ids.extTeamId } })).toBe(1);
    expect(
      await prisma.externalDriverSeason.count({ where: { seasonYear: 2061 } }),
    ).toBe(3);
  });

  it("segunda temporada (S2) diferente não substitui a temporada atual", async () => {
    const fixture = await seedUniverseInitFixture(2062);
    extraCleanups.push(() => fixture.cleanup());
    await prisma.season.delete({ where: { id: fixture.ids.seasonId } });
    await captureWorldRowPresence();

    const first = await universeInitService.bootstrapSeason(
      actorFor(fixture.ids.userId),
      fixture.ids.extSeasonId,
    );
    recordBootstrap(first);

    const secondExt = await createExtSeason(2063);
    const second = await universeInitService.bootstrapSeason(
      actorFor(fixture.ids.userId),
      secondExt.id,
    );
    recordBootstrap(second);

    expect(second.season.action).toBe("CREATED");
    expect(second.worldState.changed).toBe(false);
    expect(second.worldState.currentSeasonId).toBe(first.season.universeSeasonId);
    expect(await readWorldSeason()).toBe(first.season.universeSeasonId);
    expect(await prisma.season.count({ where: { year: 2063 } })).toBe(1);
  });

  it("reusa binding CONFIRMED existente sem duplicar quando WorldState ainda não apontava", async () => {
    const fixture = await seedUniverseInitFixture(2064);
    extraCleanups.push(() => fixture.cleanup());
    await captureWorldRowPresence();

    const binding = await prisma.externalBindingSeason.create({
      data: {
        externalSeasonId: fixture.ids.extSeasonId,
        seasonId: fixture.ids.seasonId,
        confidence: "CONFIRMED",
        boundBy: "ADMIN",
      },
    });
    bindingIds.push(binding.id);

    const report = await universeInitService.bootstrapSeason(
      actorFor(fixture.ids.userId),
      fixture.ids.extSeasonId,
    );

    recordBootstrap(report);
    expect(report.season.universeSeasonId).toBe(fixture.ids.seasonId);
    expect(report.season.action).toBe("REUSED");
    expect(report.binding).toEqual({ created: false, reused: true, confidence: "CONFIRMED" });
    expect(report.worldState.changed).toBe(true);
    expect(report.worldState.currentSeasonId).toBe(fixture.ids.seasonId);
    expect(
      await prisma.externalBindingSeason.count({
        where: { externalSeasonId: fixture.ids.extSeasonId },
      }),
    ).toBe(1);
    expect(await prisma.season.count({ where: { year: 2064 } })).toBe(1);
    expect(await readWorldSeason()).toBe(fixture.ids.seasonId);
  });

  it("múltiplas temporadas do mesmo ano → conflito sem nenhuma escrita", async () => {
    const fixture = await seedUniverseInitFixture(2065);
    extraCleanups.push(() => fixture.cleanup());
    const worldBefore = await readWorldSeason();
    await captureWorldRowPresence();

    const secondSeason = await prisma.season.create({
      data: { year: 2065, name: "2065B", status: "PRE_SEASON" },
    });
    seasonIds.push(secondSeason.id);

    await expect(
      universeInitService.bootstrapSeason(
        actorFor(fixture.ids.userId),
        fixture.ids.extSeasonId,
      ),
    ).rejects.toMatchObject({ code: "MULTIPLE_SEASONS_SAME_YEAR" });

    expect(
      await prisma.externalBindingSeason.count({
        where: { externalSeasonId: fixture.ids.extSeasonId },
      }),
    ).toBe(0);
    expect(await prisma.season.count({ where: { year: 2065 } })).toBe(2);
    expect(await readWorldSeason()).toBe(worldBefore);
  });

  it("binding sugerido → conflito sem escrita", async () => {
    const fixture = await seedUniverseInitFixture(2066);
    extraCleanups.push(() => fixture.cleanup());

    const binding = await prisma.externalBindingSeason.create({
      data: {
        externalSeasonId: fixture.ids.extSeasonId,
        seasonId: fixture.ids.seasonId,
        confidence: "SUGGESTED",
      },
    });
    bindingIds.push(binding.id);

    await expect(
      universeInitService.bootstrapSeason(
        actorFor(fixture.ids.userId),
        fixture.ids.extSeasonId,
      ),
    ).rejects.toMatchObject({ code: "SEASON_BINDING_SUGGESTED" });

    const bindingAfter = await prisma.externalBindingSeason.findUnique({
      where: { externalSeasonId: fixture.ids.extSeasonId },
      select: { confidence: true },
    });
    expect(bindingAfter?.confidence).toBe("SUGGESTED");
    expect(
      await prisma.externalBindingSeason.count({
        where: { externalSeasonId: fixture.ids.extSeasonId },
      }),
    ).toBe(1);
  });

  it("Season do mesmo ano já existe sem vínculo → reutilizada com binding confirmado sem duplicata", async () => {
    const fixture = await seedUniverseInitFixture(2067);
    extraCleanups.push(() => fixture.cleanup());
    await captureWorldRowPresence();

    const report = await universeInitService.bootstrapSeason(
      actorFor(fixture.ids.userId),
      fixture.ids.extSeasonId,
    );

    expect(report.season.universeSeasonId).toBe(fixture.ids.seasonId);
    expect(report.season.action).toBe("REUSED");
    expect(report.binding.created).toBe(true);
    recordBootstrap(report);

    const binding = await prisma.externalBindingSeason.findUnique({
      where: { externalSeasonId: fixture.ids.extSeasonId },
    });
    bindingIds.push(binding!.id);
    expect(binding?.seasonId).toBe(fixture.ids.seasonId);
    expect(binding?.confidence).toBe("CONFIRMED");
    expect(report.worldState.changed).toBe(true);
    expect(report.worldState.currentSeasonId).toBe(fixture.ids.seasonId);
    expect(await prisma.season.count({ where: { year: 2067 } })).toBe(1);
    expect(
      await prisma.externalBindingSeason.count({
        where: { externalSeasonId: fixture.ids.extSeasonId },
      }),
    ).toBe(1);
    expect(await readWorldSeason()).toBe(fixture.ids.seasonId);
  });

  it("ExternalSeason inexistente → NOT_FOUND sem nenhuma escrita", async () => {
    const fixture = await seedUniverseInitFixture(2068);
    extraCleanups.push(() => fixture.cleanup());
    const extCountBefore = await prisma.externalSeason.count();
    const worldBefore = await readWorldSeason();

    await expect(
      universeInitService.bootstrapSeason(actorFor(fixture.ids.userId), randomUUID()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(await prisma.externalSeason.count()).toBe(extCountBefore);
    expect(await prisma.externalBindingSeason.count()).toBe(0);
    expect(await readWorldSeason()).toBe(worldBefore);
  });

  it("WorldState inconsistente (currentSeasonId sem Season) → conflito sem escrita", async () => {
    const fixture = await seedUniverseInitFixture(2069);
    extraCleanups.push(() => fixture.cleanup());
    await prisma.season.delete({ where: { id: fixture.ids.seasonId } });
    await captureWorldRowPresence();

    const bogus = randomUUID();
    foreignWorldPointers.push(bogus);
    await prisma.worldState.upsert({
      where: { key: WORLD_KEY },
      update: { currentSeasonId: bogus },
      create: { key: WORLD_KEY, currentSeasonId: bogus },
    });

    await expect(
      universeInitService.bootstrapSeason(
        actorFor(fixture.ids.userId),
        fixture.ids.extSeasonId,
      ),
    ).rejects.toMatchObject({ code: "WORLD_SEASON_MISSING" });

    expect(
      await prisma.externalBindingSeason.count({
        where: { externalSeasonId: fixture.ids.extSeasonId },
      }),
    ).toBe(0);
    expect(await prisma.season.count({ where: { year: 2069 } })).toBe(0);
  });

  it("fonte incompatível (não-Jolpica) → conflito sem escrita", async () => {
    const fixture = await seedUniverseInitFixture(2070);
    extraCleanups.push(() => fixture.cleanup());
    await prisma.season.delete({ where: { id: fixture.ids.seasonId } });
    const worldBefore = await readWorldSeason();

    const otherExt = await createExtSeason(2070, "other-feed");
    await expect(
      universeInitService.bootstrapSeason(actorFor(fixture.ids.userId), otherExt.id),
    ).rejects.toMatchObject({ code: "SOURCE_INCOMPATIBLE" });

    expect(await prisma.season.count({ where: { year: 2070 } })).toBe(0);
    expect(
      await prisma.externalBindingSeason.count({ where: { externalSeasonId: otherExt.id } }),
    ).toBe(0);
    expect(await readWorldSeason()).toBe(worldBefore);
  });

  it("idempotente: executar duas vezes não cria duplicatas", async () => {
    const fixture = await seedUniverseInitFixture(2071);
    extraCleanups.push(() => fixture.cleanup());
    await prisma.season.delete({ where: { id: fixture.ids.seasonId } });
    await captureWorldRowPresence();

    const first = await universeInitService.bootstrapSeason(
      actorFor(fixture.ids.userId),
      fixture.ids.extSeasonId,
    );
    recordBootstrap(first);

    const second = await universeInitService.bootstrapSeason(
      actorFor(fixture.ids.userId),
      fixture.ids.extSeasonId,
    );

    expect(second.season.universeSeasonId).toBe(first.season.universeSeasonId);
    expect(second.season.action).toBe("REUSED");
    expect(second.binding.created).toBe(false);
    expect(second.worldState.changed).toBe(false);
    expect(await prisma.season.count({ where: { year: 2071 } })).toBe(1);
    expect(
      await prisma.externalBindingSeason.count({
        where: { externalSeasonId: fixture.ids.extSeasonId },
      }),
    ).toBe(1);
    expect(await readWorldSeason()).toBe(first.season.universeSeasonId);
  });

  it("dados existentes do universo (Team/Character/DriverProfile) não são alterados nem absorvidos", async () => {
    const fixture = await seedUniverseInitFixture(2072);
    extraCleanups.push(() => fixture.cleanup());
    await prisma.season.delete({ where: { id: fixture.ids.seasonId } });
    await captureWorldRowPresence();

    const existingTeam = await prisma.team.create({
      data: {
        userId: fixture.ids.userId,
        name: "Alpha Legacy",
        shortName: "ALP",
        color: "#00ff00",
      },
    });
    const existingCharacter = await prisma.character.create({
      data: {
        userId: fixture.ids.userId,
        controlledBy: "USER",
        name: "Legacy Person",
        nationality: "Brazilian",
        gender: null,
        birthDate: new Date("1990-01-01"),
        dna: {},
      },
    });
    const existingProfile = await prisma.driverProfile.create({
      data: {
        characterId: existingCharacter.id,
        number: 99,
        teamId: null,
      },
    });

    const report = await universeInitService.bootstrapSeason(
      actorFor(fixture.ids.userId),
      fixture.ids.extSeasonId,
    );
    recordBootstrap(report);

    const teamAfter = await prisma.team.findUniqueOrThrow({ where: { id: existingTeam.id } });
    const characterAfter = await prisma.character.findUniqueOrThrow({
      where: { id: existingCharacter.id },
    });
    const profileAfter = await prisma.driverProfile.findUniqueOrThrow({
      where: { id: existingProfile.id },
    });

    expect(teamAfter.name).toBe("Alpha Legacy");
    expect(teamAfter.color).toBe("#00ff00");
    expect(characterAfter.name).toBe("Legacy Person");
    expect(characterAfter.nationality).toBe("Brazilian");
    expect(profileAfter.number).toBe(99);

    expect(
      await prisma.externalBindingTeam.count({ where: { teamId: existingTeam.id } }),
    ).toBe(0);
    expect(
      await prisma.externalBindingDriver.count({ where: { characterId: existingCharacter.id } }),
    ).toBe(0);
    expect(
      await prisma.seasonDriverEntry.count({ where: { seasonId: report.season.universeSeasonId } }),
    ).toBe(0);
  });

  it("integração: UniverseInitService consome a Season criada pelo bootstrap (materialização completa)", async () => {
    const fixture = await seedUniverseInitFixture(2073);
    extraCleanups.push(() => fixture.cleanup());
    await prisma.season.delete({ where: { id: fixture.ids.seasonId } });
    await captureWorldRowPresence();

    const bootstrap = await universeInitService.bootstrapSeason(
      actorFor(fixture.ids.userId),
      fixture.ids.extSeasonId,
    );
    recordBootstrap(bootstrap);

    const report = await universeInitService.execute(
      actorFor(fixture.ids.userId),
      {
        seasonId: bootstrap.season.universeSeasonId,
        externalSeasonId: fixture.ids.extSeasonId,
      },
    );

    expect(report.conflicts).toEqual([]);
    expect(report.seasonBindingCreated).toBe(false);
    expect(report.summary.teamsCreated).toBe(1);
    expect(report.summary.charactersCreated).toBe(3);
    expect(report.summary.profilesCreated).toBe(3);
    expect(report.summary.entriesCreated).toBe(3);
    expect(report.summary.racesCreated).toBe(2);
    expect(report.summary.resultsCreated).toBe(4);
    expect(report.summary.standingsCreated).toBe(2);

    expect(
      await prisma.seasonDriverEntry.count({
        where: { seasonId: bootstrap.season.universeSeasonId },
      }),
    ).toBe(3);
    expect(
      await prisma.externalBindingSeason.count({
        where: { externalSeasonId: fixture.ids.extSeasonId },
      }),
    ).toBe(1);

    const world = await prisma.worldState.findUnique({ where: { key: WORLD_KEY } });
    expect(world?.currentSeasonId).toBe(bootstrap.season.universeSeasonId);
  });
});

describe("UniverseInit bootstrap routes — endpoints e autorização", () => {
  let app: FastifyInstance;
  let ids: InitFixtureIds;
  let cleanup: (extraUserIds?: string[]) => Promise<void>;
  let adminCookie: string;
  let userCookie: string;
  let adminId: string;
  let userId: string;
  let bootstrappedSeasonId: string | null = null;

  async function signUpGetCookie(
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

  beforeAll(async () => {
    const fixture = await seedUniverseInitFixture(2074);
    ids = fixture.ids;
    cleanup = fixture.cleanup;
    await prisma.season.delete({ where: { id: fixture.ids.seasonId } });

    app = buildApp(undefined, undefined, makeDummyClient());
    await app.ready();

    const adminEmail = `bootstrap-admin-${Date.now()}@f1nw.test`;
    adminCookie = await signUpGetCookie(adminEmail, "Bootstrap Admin");
    adminId = (await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })).id;
    await prisma.user.update({ where: { id: adminId }, data: { role: "ADMIN" } });

    const userEmail = `bootstrap-user-${Date.now()}@f1nw.test`;
    userCookie = await signUpGetCookie(userEmail, "Bootstrap User");
    userId = (await prisma.user.findUniqueOrThrow({ where: { email: userEmail } })).id;
  });

  afterAll(async () => {
    if (bootstrappedSeasonId) {
      await prisma.worldState.updateMany({
        where: { key: WORLD_KEY, currentSeasonId: bootstrappedSeasonId },
        data: { currentSeasonId: null },
      });
      await prisma.externalBindingSeason.deleteMany({
        where: { seasonId: bootstrappedSeasonId },
      });
      await prisma.season.deleteMany({ where: { id: bootstrappedSeasonId } });
    }
    if (app) {
      await app.close();
    }
    await cleanup([adminId, userId]);
    await prisma.$disconnect();
  });

  it("POST bootstrap sem sessão → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/universe/initialization/bootstrap",
      payload: { externalSeasonId: ids.extSeasonId },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST bootstrap como usuário comum → 403 FORBIDDEN", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/universe/initialization/bootstrap",
      headers: { cookie: userCookie },
      payload: { externalSeasonId: ids.extSeasonId },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("POST bootstrap com externalSeasonId inválido → 400 VALIDATION_ERROR", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/universe/initialization/bootstrap",
      headers: { cookie: adminCookie },
      payload: { externalSeasonId: "nao-e-uuid" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("POST bootstrap como admin cria a primeira temporada do universo", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/universe/initialization/bootstrap",
      headers: { cookie: adminCookie },
      payload: { externalSeasonId: ids.extSeasonId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.bootstrap.season.action).toBe("CREATED");
    expect(body.bootstrap.season.year).toBe(2074);
    expect(body.bootstrap.binding.confidence).toBe("CONFIRMED");
    expect(body.bootstrap.worldState.changed).toBe(true);
    bootstrappedSeasonId = body.bootstrap.season.universeSeasonId;
  });
});