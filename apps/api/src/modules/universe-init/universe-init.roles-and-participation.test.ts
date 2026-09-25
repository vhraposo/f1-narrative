import { describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import { JOLPICA_SOURCE } from "../external-sync/jolpica.service.js";
import { rosterService } from "../roster/roster.service.js";
import type { UniverseInitializationInput } from "./universe-init.schemas.js";
import { universeInitService, type Actor } from "./universe-init.service.js";

type DriverSeed = {
  externalId: string;
  name: string;
  number: number;
  role: string | null;
};

const RB_2026_TEAM = {
  externalId: "rb-2026",
  name: "Racing Bulls",
  shortName: "VCARB",
  color: "#6692ff",
};

const RB_2026_DRIVERS: DriverSeed[] = [
  { externalId: "rb-2026-tsunoda", name: "Yuki Tsunoda", number: 22, role: null },
  { externalId: "rb-2026-lawson", name: "Liam Lawson", number: 30, role: null },
  { externalId: "rb-2026-lindblad", name: "Arvid Lindblad", number: 41, role: null },
];

function conflictKinds(conflicts: { kind: string }[]): string[] {
  return conflicts.map((conflict) => conflict.kind);
}

async function getEvents(entryId: string): Promise<{ kind: string }[]> {
  return prisma.driverEntryEvent.findMany({
    where: { entryId },
    orderBy: { createdAt: "asc" },
    select: { kind: true },
  });
}

type RolesFixture = {
  ids: {
    userId: string;
    universeId: string;
    seasonId: string;
    extSeasonId: string;
    extTeamId: string;
  };
  cleanup: (extraUserIds?: string[]) => Promise<void>;
};

async function seedRolesFixture(
  year: number,
  team: typeof RB_2026_TEAM,
  drivers: DriverSeed[],
): Promise<RolesFixture> {
  const source = JOLPICA_SOURCE;
  const driverExternalIds = drivers.map((driver) => driver.externalId);

  await prisma.externalDriverSeason.deleteMany({ where: { source, seasonYear: year } });
  await prisma.externalRace.deleteMany({ where: { source, seasonYear: year } });
  await prisma.externalDriver.deleteMany({ where: { source, externalId: { in: driverExternalIds } } });
  await prisma.externalTeam.deleteMany({ where: { source, externalId: team.externalId } });
  await prisma.externalSeason.deleteMany({ where: { source, year } });

  const user = await prisma.user.create({
    data: {
      name: "Roles Admin",
      email: `roles-admin-${Date.now()}@f1nw.test`,
      password: "x",
      role: "ADMIN",
    },
  });
  const universe = await prisma.universe.create({ data: { userId: user.id } });
  const season = await prisma.season.create({
    data: { universeId: universe.id, year, name: String(year), status: "PRE_SEASON" },
  });
  const extSeason = await prisma.externalSeason.create({
    data: { source, year, name: String(year), status: "ACTIVE", contentHash: "roles-ext-season" },
  });
  const extTeam = await prisma.externalTeam.create({
    data: {
      source,
      externalId: team.externalId,
      name: team.name,
      shortName: team.shortName,
      color: team.color,
      contentHash: "roles-ext-team",
    },
  });

  for (const driver of drivers) {
    const extDriver = await prisma.externalDriver.create({
      data: {
        source,
        externalId: driver.externalId,
        name: driver.name,
        fullName: driver.name,
        nationality: "Unknown",
        number: driver.number,
        contentHash: `roles-ext-driver-${driver.externalId}`,
      },
    });
    await prisma.externalDriverSeason.create({
      data: {
        source,
        externalDriverId: extDriver.id,
        seasonYear: year,
        teamExternalId: team.externalId,
        teamNameSnapshot: team.name,
        number: driver.number,
        role: driver.role,
        contentHash: `roles-ext-ds-${driver.externalId}`,
      },
    });
  }

  const cleanup = async (extraUserIds: string[] = []) => {
    const userIds = [user.id, ...extraUserIds];
    await prisma.driverEntryEvent.deleteMany({ where: { entry: { seasonId: season.id } } });
    await prisma.seasonDriverEntry.deleteMany({ where: { seasonId: season.id } });
    await prisma.externalDriverSeason.deleteMany({ where: { source, seasonYear: year } });
    await prisma.externalRace.deleteMany({ where: { source, seasonYear: year } });
    await prisma.externalDriver.deleteMany({ where: { source, externalId: { in: driverExternalIds } } });
    await prisma.externalTeam.deleteMany({ where: { id: extTeam.id } });
    await prisma.externalSeason.deleteMany({ where: { id: extSeason.id } });
    await prisma.season.deleteMany({ where: { id: season.id } });
    await prisma.team.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.character.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  };

  return {
    ids: {
      userId: user.id,
      universeId: universe.id,
      seasonId: season.id,
      extSeasonId: extSeason.id,
      extTeamId: extTeam.id,
    },
    cleanup,
  };
}

function gridInput(ids: RolesFixture["ids"]): UniverseInitializationInput {
  return { seasonId: ids.seasonId, externalSeasonId: ids.extSeasonId, scopes: ["DRIVER_GRID"] };
}

async function createDriver(
  userId: string,
  universeId: string,
  name: string,
): Promise<{ driverProfileId: string }> {
  const character = await prisma.character.create({
    data: { userId, universeId, name, nationality: "Teste", birthDate: new Date("1995-05-10") },
  });
  const profile = await prisma.driverProfile.create({ data: { characterId: character.id } });
  return { driverProfileId: profile.id };
}

describe("STEP 107.7 — papéis temporais, participantes e pool de reservas", () => {
  it("1) Racing Bulls 2026: 3 participantes sem role não geram SEAT_CAPACITY nem inventam assento", async () => {
    const fixture = await seedRolesFixture(2026, RB_2026_TEAM, RB_2026_DRIVERS);
    const { ids } = fixture;
    const actor: Actor = { id: ids.userId, role: "ADMIN" };
    try {
      const preview = await universeInitService.preview(actor, gridInput(ids));
      expect(preview.conflicts).toEqual([]);
      expect(preview.summary).toMatchObject({
        teamsCreated: 1,
        charactersCreated: 3,
        profilesCreated: 3,
        entriesCreated: 3,
        conflicts: 0,
        openingRosterUnresolved: 3,
      });
      expect(preview.openingRoster).toMatchObject({
        resolved: false,
        unresolvedParticipants: 3,
        teams: ["Racing Bulls"],
      });

      const report = await universeInitService.execute(actor, gridInput(ids));
      expect(report.conflicts).toEqual([]);

      const entries = await prisma.seasonDriverEntry.findMany({
        where: { seasonId: ids.seasonId },
        orderBy: { number: "asc" },
      });
      expect(entries).toHaveLength(3);
      expect(entries.map((entry) => entry.number)).toEqual([22, 30, 41]);
      for (const entry of entries) {
        expect(entry.teamId).not.toBeNull();
        expect(entry.role).toBeNull();
        expect(entry.seat).toBeNull();
        expect(entry.status).toBe("ACTIVE");
        expect(entry.provenance).toBe("IMPORTED");
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("2) re-execução é idempotente e não recria eventos nem toca o External Mirror", async () => {
    const fixture = await seedRolesFixture(2026, RB_2026_TEAM, RB_2026_DRIVERS);
    const { ids } = fixture;
    const actor: Actor = { id: ids.userId, role: "ADMIN" };
    try {
      await universeInitService.execute(actor, gridInput(ids));

      const teamBefore = await prisma.externalTeam.findUniqueOrThrow({
        where: { id: ids.extTeamId },
        select: { contentHash: true, lastSyncedAt: true },
      });
      const dsBefore = await prisma.externalDriverSeason.findMany({
        where: { source: JOLPICA_SOURCE, seasonYear: 2026 },
        orderBy: { number: "asc" },
        select: { contentHash: true, lastSyncedAt: true },
      });

      const report = await universeInitService.execute(actor, gridInput(ids));
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
      });

      expect(
        await prisma.character.count({ where: { universeId: ids.universeId } }),
      ).toBe(3);
      expect(
        await prisma.driverProfile.count({
          where: { character: { universeId: ids.universeId } },
        }),
      ).toBe(3);
      expect(await prisma.seasonDriverEntry.count({ where: { seasonId: ids.seasonId } })).toBe(3);
      expect(
        await prisma.driverEntryEvent.count({ where: { entry: { seasonId: ids.seasonId } } }),
      ).toBe(3);

      const teamAfter = await prisma.externalTeam.findUniqueOrThrow({
        where: { id: ids.extTeamId },
        select: { contentHash: true, lastSyncedAt: true },
      });
      expect(teamAfter.contentHash).toBe(teamBefore.contentHash);
      expect(teamAfter.lastSyncedAt).toEqual(teamBefore.lastSyncedAt);
      const dsAfter = await prisma.externalDriverSeason.findMany({
        where: { source: JOLPICA_SOURCE, seasonYear: 2026 },
        orderBy: { number: "asc" },
        select: { contentHash: true, lastSyncedAt: true },
      });
      expect(dsAfter).toHaveLength(dsBefore.length);
      for (let i = 0; i < dsBefore.length; i++) {
        expect(dsAfter[i].contentHash).toBe(dsBefore[i].contentHash);
        expect(dsAfter[i].lastSyncedAt).toEqual(dsBefore[i].lastSyncedAt);
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("3) 3º piloto sem role convive com assentos explícitos sem virar 3º assento", async () => {
    const drivers: DriverSeed[] = [
      { externalId: "rb-2026-seat1", name: "Titular Um", number: 11, role: "RACE_SEAT" },
      { externalId: "rb-2026-seat2", name: "Titular Dois", number: 22, role: "RACE_SEAT" },
      { externalId: "rb-2026-part", name: "Participante Tres", number: 30, role: null },
    ];
    const fixture = await seedRolesFixture(2026, RB_2026_TEAM, drivers);
    const { ids } = fixture;
    const actor: Actor = { id: ids.userId, role: "ADMIN" };
    try {
      const report = await universeInitService.execute(actor, gridInput(ids));
      expect(report.conflicts).toEqual([]);

      const entries = await prisma.seasonDriverEntry.findMany({
        where: { seasonId: ids.seasonId },
        orderBy: { number: "asc" },
      });
      expect(entries).toHaveLength(3);
      const seat1 = entries.find((entry) => entry.seat === 1)!;
      const seat2 = entries.find((entry) => entry.seat === 2)!;
      const participant = entries.find((entry) => entry.role === null)!;
      expect(seat1.role).toBe("RACE_SEAT");
      expect(seat1.number).toBe(11);
      expect(seat2.role).toBe("RACE_SEAT");
      expect(seat2.number).toBe(22);
      expect(participant.number).toBe(30);
      expect(participant.role).toBeNull();
      expect(participant.seat).toBeNull();
      expect(report.openingRoster).toMatchObject({
        resolved: false,
        unresolvedParticipants: 1,
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("4) pool de reservas 0..N: dois reservas explícitos materializam sem RESERVE_LIMIT", async () => {
    const drivers: DriverSeed[] = [
      { externalId: "rb-2026-res1", name: "Reserva Um", number: 91, role: "RESERVE" },
      { externalId: "rb-2026-res2", name: "Reserva Dois", number: 92, role: "RESERVE" },
    ];
    const fixture = await seedRolesFixture(2026, RB_2026_TEAM, drivers);
    const { ids } = fixture;
    const actor: Actor = { id: ids.userId, role: "ADMIN" };
    try {
      const report = await universeInitService.execute(actor, gridInput(ids));
      expect(report.conflicts).toEqual([]);

      const entries = await prisma.seasonDriverEntry.findMany({
        where: { seasonId: ids.seasonId },
        orderBy: { number: "asc" },
      });
      expect(entries).toHaveLength(2);
      for (const entry of entries) {
        expect(entry.role).toBe("RESERVE");
        expect(entry.seat).toBeNull();
        expect(entry.teamId).not.toBeNull();
        expect(entry.status).toBe("ACTIVE");
      }
      expect(report.openingRoster).toMatchObject({ resolved: true, unresolvedParticipants: 0 });
    } finally {
      await fixture.cleanup();
    }
  });

  it("5) RACE_SEAT explícito colidindo com assento ocupado no universo → SEAT_OCCUPIED (sem sobrescrever)", async () => {
    const drivers: DriverSeed[] = [
      { externalId: "rb-2026-occ1", name: "Novo Titular Um", number: 11, role: "RACE_SEAT" },
      { externalId: "rb-2026-occ2", name: "Novo Titular Dois", number: 22, role: "RACE_SEAT" },
    ];
    const fixture = await seedRolesFixture(2026, RB_2026_TEAM, drivers);
    const { ids } = fixture;
    const actor: Actor = { id: ids.userId, role: "ADMIN" };
    try {
      const team = await prisma.team.create({
        data: {
          name: "Racing Bulls",
          shortName: "VCARB",
          color: "#6692ff",
          userId: ids.userId,
          universeId: ids.universeId,
        },
      });
      await prisma.externalBindingTeam.create({
        data: {
          universeId: ids.universeId,
          externalTeamId: ids.extTeamId,
          teamId: team.id,
          confidence: "CONFIRMED",
          boundBy: "ADMIN",
        },
      });
      const occupantChar = await prisma.character.create({
        data: {
          name: "Titular Existente",
          nationality: "Unknown",
          birthDate: new Date("1997-01-01"),
          userId: ids.userId,
          universeId: ids.universeId,
        },
      });
      const occupantProfile = await prisma.driverProfile.create({
        data: { characterId: occupantChar.id, number: 99 },
      });
      await prisma.seasonDriverEntry.create({
        data: {
          seasonId: ids.seasonId,
          driverProfileId: occupantProfile.id,
          teamId: team.id,
          role: "RACE_SEAT",
          seat: 1,
          number: 99,
          status: "ACTIVE",
        },
      });

      const preview = await universeInitService.preview(actor, gridInput(ids));
      expect(conflictKinds(preview.conflicts)).toContain("SEAT_OCCUPIED");

      await expect(universeInitService.execute(actor, gridInput(ids))).rejects.toMatchObject({
        code: "CONFLICT",
        statusCode: 409,
      });

      const right = await prisma.seasonDriverEntry.findUnique({
        where: {
          seasonId_teamId_seat: { seasonId: ids.seasonId, teamId: team.id, seat: 1 },
        },
      });
      expect(right?.driverProfileId).toBe(occupantProfile.id);
      expect(right?.status).toBe("ACTIVE");
    } finally {
      await fixture.cleanup();
    }
  });

  it("6) substituição temporal preserva histórico (CREATED → DISPLACED → HIRED → PROMOTED → RELEASED)", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Temporal Admin",
        email: `temporal-admin-${Date.now()}@f1nw.test`,
        password: "x",
        role: "ADMIN",
      },
    });
    try {
      const universe = await prisma.universe.create({ data: { userId: user.id } });
      const season = await prisma.season.create({
        data: { universeId: universe.id, year: 2030 },
      });
      const team = await prisma.team.create({
        data: { name: "Alpha", userId: user.id, universeId: universe.id },
      });
      const driver1 = await createDriver(user.id, universe.id, "Piloto Um");
      const driver2 = await createDriver(user.id, universe.id, "Piloto Dois");

      await rosterService.assignDriverToSeat(user.id, {
        seasonId: season.id,
        teamId: team.id,
        driverProfileId: driver1.driverProfileId,
        seat: 1,
      });
      await rosterService.assignDriverToSeat(user.id, {
        seasonId: season.id,
        teamId: team.id,
        driverProfileId: driver2.driverProfileId,
        seat: 1,
      });
      await rosterService.assignReserve(user.id, {
        seasonId: season.id,
        teamId: team.id,
        driverProfileId: driver1.driverProfileId,
      });
      await rosterService.promoteReserve(user.id, {
        seasonId: season.id,
        teamId: team.id,
        driverProfileId: driver1.driverProfileId,
        seat: 2,
      });
      await rosterService.releaseDriver(user.id, {
        seasonId: season.id,
        teamId: team.id,
        driverProfileId: driver2.driverProfileId,
      });

      const entry1 = await prisma.seasonDriverEntry.findUniqueOrThrow({
        where: {
          seasonId_driverProfileId: {
            seasonId: season.id,
            driverProfileId: driver1.driverProfileId,
          },
        },
      });
      const kinds1 = (await getEvents(entry1.id)).map((event) => event.kind);
      expect(kinds1).toEqual(["CREATED", "DISPLACED", "HIRED", "PROMOTED"]);
      expect(entry1.status).toBe("ACTIVE");
      expect(entry1.role).toBe("RACE_SEAT");
      expect(entry1.seat).toBe(2);

      const entry2 = await prisma.seasonDriverEntry.findUniqueOrThrow({
        where: {
          seasonId_driverProfileId: {
            seasonId: season.id,
            driverProfileId: driver2.driverProfileId,
          },
        },
      });
      const kinds2 = (await getEvents(entry2.id)).map((event) => event.kind);
      expect(kinds2).toEqual(["CREATED", "RELEASED"]);
      expect(entry2.status).toBe("AVAILABLE");
      expect(entry2.teamId).toBeNull();
      expect(entry2.role).toBeNull();
      expect(entry2.seat).toBeNull();

      const displaced = await prisma.driverEntryEvent.findFirst({
        where: { entryId: entry1.id, kind: "DISPLACED" },
      });
      expect(displaced?.from).toBeTruthy();
      expect(displaced?.to).toMatchObject({ role: null, seat: null, status: "AVAILABLE" });

      await prisma.driverEntryEvent.deleteMany({ where: { entryId: { in: [entry1.id, entry2.id] } } });
      await prisma.seasonDriverEntry.deleteMany({ where: { seasonId: season.id } });
      await prisma.season.deleteMany({ where: { id: season.id } });
      await prisma.team.deleteMany({ where: { id: team.id } });
      await prisma.character.deleteMany({ where: { userId: user.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    } finally {
      await prisma.character.deleteMany({ where: { userId: user.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    }
  });

  it("7) AVAILABLE é distinto de LEFT e nunca é produzido automaticamente", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Status Admin",
        email: `status-admin-${Date.now()}@f1nw.test`,
        password: "x",
        role: "ADMIN",
      },
    });
    try {
      const universe = await prisma.universe.create({ data: { userId: user.id } });
      const season = await prisma.season.create({
        data: { universeId: universe.id, year: 2031 },
      });
      const team = await prisma.team.create({
        data: { name: "Beta", userId: user.id, universeId: universe.id },
      });
      const driver = await createDriver(user.id, universe.id, "Piloto Status");

      await rosterService.assignDriverToSeat(user.id, {
        seasonId: season.id,
        teamId: team.id,
        driverProfileId: driver.driverProfileId,
        seat: 1,
      });
      await rosterService.releaseDriver(user.id, {
        seasonId: season.id,
        teamId: team.id,
        driverProfileId: driver.driverProfileId,
      });

      const entry = await prisma.seasonDriverEntry.findUniqueOrThrow({
        where: {
          seasonId_driverProfileId: {
            seasonId: season.id,
            driverProfileId: driver.driverProfileId,
          },
        },
      });
      expect(entry.status).toBe("AVAILABLE");
      expect(entry.status).not.toBe("LEFT");

      const narrativeLeft = await prisma.seasonDriverEntry.update({
        where: { id: entry.id },
        data: { status: "LEFT" },
      });
      expect(narrativeLeft.status).toBe("LEFT");
      expect(narrativeLeft.status).not.toBe("AVAILABLE");

      const statuses = await prisma.seasonDriverEntry.findMany({
        where: { seasonId: season.id },
        select: { status: true },
      });
      expect(statuses).toContainEqual({ status: "LEFT" });

      await prisma.driverEntryEvent.deleteMany({ where: { entryId: entry.id } });
      await prisma.seasonDriverEntry.deleteMany({ where: { seasonId: season.id } });
      await prisma.season.deleteMany({ where: { id: season.id } });
      await prisma.team.deleteMany({ where: { id: team.id } });
      await prisma.character.deleteMany({ where: { userId: user.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    } finally {
      await prisma.character.deleteMany({ where: { userId: user.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    }
  });

  it("8) re-execução tolera assento resolvido manualmente após materialização (participante tolerante)", async () => {
    const fixture = await seedRolesFixture(2026, RB_2026_TEAM, RB_2026_DRIVERS);
    const { ids } = fixture;
    const actor: Actor = { id: ids.userId, role: "ADMIN" };
    try {
      await universeInitService.execute(actor, gridInput(ids));

      const team = await prisma.team.findFirstOrThrow({
        where: { universeId: ids.universeId },
      });
      const tsunoda = await prisma.character.findFirstOrThrow({
        where: { universeId: ids.universeId, name: "Yuki Tsunoda" },
      });
      const tsunodaProfile = await prisma.driverProfile.findUniqueOrThrow({
        where: { characterId: tsunoda.id },
      });
      await rosterService.assignDriverToSeat(actor.id, {
        seasonId: ids.seasonId,
        teamId: team.id,
        driverProfileId: tsunodaProfile.id,
        seat: 1,
      });

      const report = await universeInitService.execute(actor, gridInput(ids));
      expect(report.conflicts).toEqual([]);
      expect(report.summary).toMatchObject({ entriesReused: 3, entriesCreated: 0 });

      const tsunodaEntry = await prisma.seasonDriverEntry.findUniqueOrThrow({
        where: {
          seasonId_driverProfileId: {
            seasonId: ids.seasonId,
            driverProfileId: tsunodaProfile.id,
          },
        },
      });
      expect(tsunodaEntry.status).toBe("ACTIVE");
      expect(tsunodaEntry.role).toBe("RACE_SEAT");
      expect(tsunodaEntry.seat).toBe(1);
    } finally {
      await fixture.cleanup();
    }
  });
});