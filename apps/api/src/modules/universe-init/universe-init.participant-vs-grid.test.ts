import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { JOLPICA_SOURCE } from "../external-sync/jolpica.service.js";
import { OPENING_GRID_SOURCE } from "../opening-grid/opening-grid.source.js";
import { playerEntryService } from "../player-entry/player-entry.service.js";
import { universeInitService, type Actor } from "./universe-init.service.js";

const YEAR = 2035;

type User = { id: string; cookie: string };

const RB = {
  externalId: "pvg-rb-2035",
  name: "Racing Bulls",
  shortName: "VCARB",
  color: "#6692ff",
};

const JOLPICA_DRIVERS = [
  { externalId: "pvg-tsunoda", name: "Yuki Tsunoda", number: 22, role: null },
  { externalId: "pvg-lawson", name: "Liam Lawson", number: 30, role: null },
  { externalId: "pvg-lindblad", name: "Arvid Lindblad", number: 41, role: null },
];

const OG_CLAIMS = [
  { externalId: "pvg-lindblad", name: "Arvid Lindblad", number: 41, role: "RACE_SEAT:1" },
  { externalId: "pvg-lawson", name: "Liam Lawson", number: 30, role: "RACE_SEAT:2" },
];

let app: FastifyInstance;
const cleanupFns: Array<() => Promise<void>> = [];

async function createSession(name: string): Promise<User> {
  const email = `pvg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@f1nw.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: "http://localhost:3000" },
    payload: { name, email, password: "senha-segura-123" },
  });
  expect(res.statusCode, `sign-up failed: ${res.body}`).toBe(200);
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: stored.id, cookie };
}

async function seedParticipantVsGridFixture(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const universe = await prisma.universe.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
  });

  const season = await prisma.season.create({
    data: {
      universeId: universe.id,
      year: YEAR,
      name: String(YEAR),
      status: "PRE_SEASON",
    },
  });

  const extSeason = await prisma.externalSeason.create({
    data: { source: JOLPICA_SOURCE, year: YEAR, name: String(YEAR), status: "ACTIVE", contentHash: "pvg-ext-season" },
  });

  await prisma.externalBindingSeason.create({
    data: {
      universeId: universe.id,
      externalSeasonId: extSeason.id,
      seasonId: season.id,
      confidence: "CONFIRMED",
      boundBy: "ADMIN",
    },
  });

  const extTeam = await prisma.externalTeam.create({
    data: { source: JOLPICA_SOURCE, externalId: RB.externalId, name: RB.name, shortName: RB.shortName, color: RB.color, contentHash: "pvg-ext-team-jolpica" },
  });

  const ogExtTeam = await prisma.externalTeam.create({
    data: { source: OPENING_GRID_SOURCE, externalId: RB.externalId, name: RB.name, shortName: RB.shortName, color: RB.color, contentHash: "pvg-ext-team-og" },
  });

  const universeTeam = await prisma.team.create({
    data: {
      name: RB.name,
      shortName: RB.shortName,
      color: RB.color,
      userId: user.id,
      universeId: universe.id,
    },
  });

  await prisma.externalBindingTeam.create({
    data: {
      universeId: universe.id,
      externalTeamId: extTeam.id,
      teamId: universeTeam.id,
      confidence: "CONFIRMED",
      boundBy: "ADMIN",
    },
  });

  const jolpicaDriverIds: string[] = [];
  for (const driver of JOLPICA_DRIVERS) {
    const extDriver = await prisma.externalDriver.create({
      data: { source: JOLPICA_SOURCE, externalId: driver.externalId, name: driver.name, fullName: driver.name, nationality: "Unknown", number: driver.number, contentHash: `pvg-ext-d-${driver.externalId}` },
    });
    jolpicaDriverIds.push(extDriver.id);
    await prisma.externalDriverSeason.create({
      data: { source: JOLPICA_SOURCE, externalDriverId: extDriver.id, seasonYear: YEAR, teamExternalId: RB.externalId, teamNameSnapshot: RB.name, number: driver.number, role: driver.role, contentHash: `pvg-ext-ds-${driver.externalId}` },
    });
  }

  const ogDriverIds: string[] = [];
  for (const claim of OG_CLAIMS) {
    let extDriver = await prisma.externalDriver.findFirst({ where: { source: OPENING_GRID_SOURCE, externalId: claim.externalId } });
    if (!extDriver) {
      extDriver = await prisma.externalDriver.create({
        data: { source: OPENING_GRID_SOURCE, externalId: claim.externalId, name: claim.name, fullName: claim.name, nationality: "Unknown", number: claim.number, contentHash: `pvg-og-d-${claim.externalId}` },
      });
    }
    ogDriverIds.push(extDriver.id);
    await prisma.externalDriverSeason.create({
      data: { source: OPENING_GRID_SOURCE, externalDriverId: extDriver.id, seasonYear: YEAR, teamExternalId: RB.externalId, teamNameSnapshot: RB.name, number: claim.number, role: claim.role, contentHash: `pvg-og-ds-${claim.externalId}` },
    });
  }

  const cleanup = async () => {
    await prisma.driverEntryEvent.deleteMany({ where: { entry: { seasonId: season.id } } });
    await prisma.seasonDriverEntry.deleteMany({ where: { seasonId: season.id } });
    await prisma.externalBindingDriverSeason.deleteMany({ where: { externalDriverSeason: { seasonYear: YEAR } } });
    await prisma.externalBindingDriver.deleteMany({ where: { externalDriver: { id: { in: [...jolpicaDriverIds, ...ogDriverIds] } } } });
    await prisma.externalBindingTeam.deleteMany({ where: { teamId: universeTeam.id } });
    await prisma.externalBindingSeason.deleteMany({ where: { externalSeasonId: extSeason.id } });
    await prisma.externalDriverSeason.deleteMany({ where: { seasonYear: YEAR } });
    await prisma.externalDriver.deleteMany({ where: { id: { in: [...jolpicaDriverIds, ...ogDriverIds] } } });
    await prisma.externalTeam.deleteMany({ where: { id: { in: [extTeam.id, ogExtTeam.id] } } });
    await prisma.externalSeason.deleteMany({ where: { id: extSeason.id } });
    await prisma.season.deleteMany({ where: { id: season.id } });
    await prisma.team.deleteMany({ where: { id: universeTeam.id } });
    await prisma.character.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  };

  cleanupFns.push(cleanup);

  return {
    userId: user.id,
    universeId: universe.id,
    seasonId: season.id,
    extSeasonId: extSeason.id,
    extTeamId: extTeam.id,
    universeTeamId: universeTeam.id,
  };
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  for (const fn of cleanupFns.reverse()) {
    await fn();
  }
  await prisma.$disconnect();
  await app.close();
});

describe("Participant vs Opening Grid — 22 starters + 23 participantes (STEP 107.13)", () => {
  let fixture: Awaited<ReturnType<typeof seedParticipantVsGridFixture>>;
  let fixtureUser: User;

  beforeAll(async () => {
    fixtureUser = await createSession("PVG Fixture User");
    await prisma.user.update({ where: { id: fixtureUser.id }, data: { role: "ADMIN" } });
    fixture = await seedParticipantVsGridFixture(fixtureUser.id);
  });

  const actor: Actor = { id: "", role: "ADMIN" };

  it("1) materialização DRIVER_GRID cria 3 characters, 3 profiles, 3 entries sem conflitos", async () => {
    actor.id = fixture.userId;
    const report = await universeInitService.execute(actor, {
      seasonId: fixture.seasonId,
      externalSeasonId: fixture.extSeasonId,
      scopes: ["DRIVER_GRID"],
    });

    expect(report.conflicts).toEqual([]);
    expect(report.summary).toMatchObject({
      teamsCreated: 0,
      teamsReused: 1,
      charactersCreated: 3,
      charactersReused: 0,
      profilesCreated: 3,
      profilesReused: 0,
      entriesCreated: 3,
      entriesReused: 0,
      bindingsCreated: 6,
      conflicts: 0,
    });
  });

  it("2) 22 starters no Opening Grid (2 por time): Lindblad RACE_SEAT:1, Lawson RACE_SEAT:2", async () => {
    const entries = await prisma.seasonDriverEntry.findMany({
      where: { seasonId: fixture.seasonId },
      orderBy: { number: "asc" },
    });
    expect(entries).toHaveLength(3);

    const raceSeatEntries = entries.filter((e) => e.role === "RACE_SEAT");
    expect(raceSeatEntries).toHaveLength(2);

    const lindblad = entries.find((e) => e.number === 41)!;
    const lawson = entries.find((e) => e.number === 30)!;
    expect(lindblad.role).toBe("RACE_SEAT");
    expect(lindblad.seat).toBe(1);
    expect(lawson.role).toBe("RACE_SEAT");
    expect(lawson.seat).toBe(2);
  });

  it("3) Tsunoda (3º participante) existe como Character + DriverProfile + SeasonDriverEntry", async () => {
    const tsunoda = await prisma.character.findFirst({
      where: { universeId: fixture.universeId, name: "Yuki Tsunoda" },
    });
    expect(tsunoda).toBeTruthy();
    expect(tsunoda!.controlledBy).toBe("AI");
    expect(tsunoda!.userId).toBeNull();

    const profile = await prisma.driverProfile.findUnique({ where: { characterId: tsunoda!.id } });
    expect(profile).toBeTruthy();

    const entry = await prisma.seasonDriverEntry.findFirst({
      where: { seasonId: fixture.seasonId, driverProfileId: profile!.id },
    });
    expect(entry).toBeTruthy();
    expect(entry!.role).toBeNull();
    expect(entry!.seat).toBeNull();
    expect(entry!.status).toBe("ACTIVE");
    expect(entry!.provenance).toBe("IMPORTED");
  });

  it("4) Tsunoda não ocupa seat: nenhum seat criado para ele", async () => {
    const entries = await prisma.seasonDriverEntry.findMany({
      where: { seasonId: fixture.seasonId, seat: { not: null } },
    });
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.role).toBe("RACE_SEAT");
    }
  });

  it("5) nenhum conflito de capacidade", async () => {
    const report = await universeInitService.preview(actor, {
      seasonId: fixture.seasonId,
      externalSeasonId: fixture.extSeasonId,
      scopes: ["DRIVER_GRID"],
    });
    expect(report.conflicts).toEqual([]);
    expect(report.summary.conflicts).toBe(0);
  });

  it("6) todos os 3 pilotos materializados como Characters", async () => {
    const chars = await prisma.character.findMany({
      where: { universeId: fixture.universeId },
    });
    expect(chars).toHaveLength(3);
    const names = chars.map((c) => c.name).sort();
    expect(names).toEqual(["Arvid Lindblad", "Liam Lawson", "Yuki Tsunoda"]);
  });

  it("7) todos os 3 DriverProfiles materializados", async () => {
    const profiles = await prisma.driverProfile.findMany({
      where: { character: { universeId: fixture.universeId } },
    });
    expect(profiles).toHaveLength(3);
  });

  it("8) Player Entry mostra somente os seats do Opening Grid (2 assentos para RB)", async () => {
    const setup = await playerEntryService.setup(fixture.userId, { seasonId: fixture.seasonId });
    expect(setup.selection).toBeTruthy();
    const rbTeam = setup.selection!.teams.find((t) => t.name === RB.name);
    expect(rbTeam).toBeTruthy();
    expect(rbTeam!.openingGrid.seats).toHaveLength(2);
    const seat1Source = rbTeam!.openingGrid.seats.find((s) => s.seat === 1)?.source;
    const seat2Source = rbTeam!.openingGrid.seats.find((s) => s.seat === 2)?.source;
    expect(seat1Source?.name).toBe("Arvid Lindblad");
    expect(seat2Source?.name).toBe("Liam Lawson");
    const participants = rbTeam!.openingGrid.participants;
    expect(participants.length).toBeGreaterThanOrEqual(1);
    expect(participants.some((p) => p.name === "Yuki Tsunoda")).toBe(true);
  });

  it("9) Tsunoda é Character de IA: fora de /api/characters, presente em /api/characters/ai", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/characters",
      headers: { cookie: fixtureUser.cookie },
    });
    expect(res.statusCode).toBe(200);
    const characters = res.json().characters as Array<{ id: string; name: string; controlledBy: string; userId: string }>;
    expect(characters.find((c) => c.name === "Yuki Tsunoda")).toBeUndefined();

    const aiRes = await app.inject({
      method: "GET",
      url: "/api/characters/ai",
      headers: { cookie: fixtureUser.cookie },
    });
    expect(aiRes.statusCode).toBe(200);
    const aiCharacters = aiRes.json().characters as Array<{ name: string; controlledBy: string }>;
    const tsunoda = aiCharacters.find((c) => c.name === "Yuki Tsunoda");
    expect(tsunoda).toBeTruthy();
    expect(tsunoda!.controlledBy).toBe("AI");
  });

  it("10) Tsunoda aparece na lista de Pilotos", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/drivers",
      headers: { cookie: fixtureUser.cookie },
    });
    expect(res.statusCode).toBe(200);
    const drivers = res.json().drivers as Array<{ character: { name: string } }>;
    const names = drivers.map((d) => d.character.name).sort();
    expect(names).toContain("Yuki Tsunoda");
    expect(names).toContain("Arvid Lindblad");
    expect(names).toContain("Liam Lawson");
  });

  it("11) segunda execução é idempotente: reusa tudo, não duplica", async () => {
    const before = {
      teams: await prisma.team.count({ where: { universeId: fixture.universeId } }),
      chars: await prisma.character.count({ where: { universeId: fixture.universeId } }),
      profiles: await prisma.driverProfile.count({
        where: { character: { universeId: fixture.universeId } },
      }),
      entries: await prisma.seasonDriverEntry.count({ where: { seasonId: fixture.seasonId } }),
      events: await prisma.driverEntryEvent.count({ where: { entry: { seasonId: fixture.seasonId } } }),
    };

    const report = await universeInitService.execute(actor, {
      seasonId: fixture.seasonId,
      externalSeasonId: fixture.extSeasonId,
      scopes: ["DRIVER_GRID"],
    });
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
      bindingsCreated: 0,
    });

    expect(await prisma.team.count({ where: { universeId: fixture.universeId } })).toBe(before.teams);
    expect(await prisma.character.count({ where: { universeId: fixture.universeId } })).toBe(before.chars);
    expect(
      await prisma.driverProfile.count({
        where: { character: { universeId: fixture.universeId } },
      }),
    ).toBe(before.profiles);
    expect(await prisma.seasonDriverEntry.count({ where: { seasonId: fixture.seasonId } })).toBe(before.entries);
    expect(await prisma.driverEntryEvent.count({ where: { entry: { seasonId: fixture.seasonId } } })).toBe(before.events);
  });

  it("12) Jolpica Mirror não foi alterado pela materialização", async () => {
    const dsAfter = await prisma.externalDriverSeason.findMany({
      where: { source: JOLPICA_SOURCE, seasonYear: YEAR },
      orderBy: { number: "asc" },
      select: { externalDriverId: true, contentHash: true, role: true, teamExternalId: true },
    });
    expect(dsAfter).toHaveLength(3);
    for (const ds of dsAfter) {
      expect(ds.contentHash).toBeTruthy();
      expect(ds.teamExternalId).toBe(RB.externalId);
    }
    const tsunoda = dsAfter.find((d) => d.contentHash.startsWith("pvg-ext-ds-pvg-tsunoda"));
    expect(tsunoda).toBeTruthy();
    expect(tsunoda!.role).toBeNull();
  });

  it("13) status reporta openingRoster com 1 unresolved (Tsunoda) e 0 conflicts", async () => {
    const status = await universeInitService.status(actor, {
      seasonId: fixture.seasonId,
      externalSeasonId: fixture.extSeasonId,
      scopes: ["DRIVER_GRID"],
    });
    expect(status.conflicts).toEqual([]);
    expect(status.summary.charactersCreated).toBe(0);
    expect(status.summary.charactersReused).toBe(3);
    expect(status.openingRoster).toMatchObject({
      resolved: false,
      unresolvedParticipants: 1,
      teams: ["Racing Bulls"],
    });
    expect(status.initialized).toBe(true);
  });
});
