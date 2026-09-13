import { describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import { JOLPICA_SOURCE } from "../external-sync/jolpica.service.js";
import {
  parseSourceClaim,
  resolveOpeningGrid,
} from "./opening-grid.resolver.js";
import { playerEntryService } from "../player-entry/player-entry.service.js";
import type { UniverseInitializationInput } from "../universe-init/universe-init.schemas.js";
import { universeInitService, type Actor } from "../universe-init/universe-init.service.js";

type DriverSeed = {
  externalId: string;
  name: string;
  number: number;
  role: string | null;
};

const TEAM = {
  externalId: "og-2026",
  name: "Opening Grid",
  shortName: "OG",
  color: "#10a37f",
};

type GridFixture = {
  ids: {
    userId: string;
    seasonId: string;
    extSeasonId: string;
    extTeamId: string;
  };
  cleanup: (extraUserIds?: string[]) => Promise<void>;
};

async function seedFixture(
  year: number,
  team: typeof TEAM,
  drivers: DriverSeed[],
): Promise<GridFixture> {
  const source = JOLPICA_SOURCE;
  const driverExternalIds = drivers.map((driver) => driver.externalId);

  await prisma.externalDriverSeason.deleteMany({ where: { source, seasonYear: year } });
  await prisma.externalRace.deleteMany({ where: { source, seasonYear: year } });
  await prisma.externalDriver.deleteMany({ where: { source, externalId: { in: driverExternalIds } } });
  await prisma.externalTeam.deleteMany({ where: { source, externalId: team.externalId } });
  await prisma.externalSeason.deleteMany({ where: { source, year } });

  const user = await prisma.user.create({
    data: {
      name: "Opening Grid Admin",
      email: `opening-grid-${Date.now()}@f1nw.test`,
      password: "x",
      role: "ADMIN",
    },
  });
  const season = await prisma.season.create({
    data: { year, name: String(year), status: "PRE_SEASON" },
  });
  const extSeason = await prisma.externalSeason.create({
    data: { source, year, name: String(year), status: "ACTIVE", contentHash: "og-ext-season" },
  });
  const extTeam = await prisma.externalTeam.create({
    data: {
      source,
      externalId: team.externalId,
      name: team.name,
      shortName: team.shortName,
      color: team.color,
      contentHash: "og-ext-team",
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
        contentHash: `og-ext-driver-${driver.externalId}`,
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
        contentHash: `og-ext-ds-${driver.externalId}`,
      },
    });
  }

  const cleanup = async (extraUserIds: string[] = []) => {
    const userIds = [user.id, ...extraUserIds];
    await prisma.driverEntryEvent.deleteMany({ where: { entry: { seasonId: season.id } } });
    await prisma.seasonDriverEntry.deleteMany({ where: { seasonId: season.id } });
    await prisma.externalBindingSeason.deleteMany({ where: { seasonId: season.id } });
    await prisma.externalBindingTeam.deleteMany({ where: { team: { userId: { in: userIds } } } });
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
      seasonId: season.id,
      extSeasonId: extSeason.id,
      extTeamId: extTeam.id,
    },
    cleanup,
  };
}

function gridInput(ids: GridFixture["ids"]): UniverseInitializationInput {
  return { seasonId: ids.seasonId, externalSeasonId: ids.extSeasonId, scopes: ["DRIVER_GRID"] };
}

async function snapshotMirror(year: number) {
  const source = JOLPICA_SOURCE;
  return {
    seasons: await prisma.externalDriverSeason.findMany({
      where: { source, seasonYear: year },
      orderBy: { role: "asc" },
    }),
    teams: await prisma.externalTeam.findMany({ where: { source }, orderBy: { externalId: "asc" } }),
  };
}

describe("STEP 107.8 — Resolução do Opening Grid da Universe Season", () => {
  it("1) 2 RACE_SEAT explícitos → RESOLVED; materialização cria assentos 1 e 2 na ordem canônica", async () => {
    const fixture = await seedFixture(2026, TEAM, [
      { externalId: "og-2026-a", name: "Alpha Russo", number: 3, role: "RACE_SEAT" },
      { externalId: "og-2026-b", name: "Beto Marchi", number: 77, role: "RACE_SEAT" },
    ]);
    const { ids } = fixture;
    const actor: Actor = { id: ids.userId, role: "ADMIN" };
    try {
      const preview = await universeInitService.preview(actor, gridInput(ids));
      expect(preview.openingGrid.state).toBe("RESOLVED");
      expect(preview.openingGrid.teams).toHaveLength(1);
      expect(preview.openingGrid.teams[0].state).toBe("RESOLVED");
      expect(preview.openingGrid.teams[0].starters).toHaveLength(2);
      expect(preview.summary.openingGridState).toBe("RESOLVED");

      await universeInitService.execute(actor, gridInput(ids));
      const entries = await prisma.seasonDriverEntry.findMany({
        where: { seasonId: ids.seasonId },
        orderBy: { seat: "asc" },
      });
      expect(entries.map((entry) => entry.role)).toEqual(["RACE_SEAT", "RACE_SEAT"]);
      expect(entries.map((entry) => entry.seat)).toEqual([1, 2]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("2) Assentos declarados na fonte (RACE_SEAT:2/RACE_SEAT:1) são honrados, sem ordenação por número", async () => {
    const fixture = await seedFixture(2026, TEAM, [
      { externalId: "og-2026-x", name: "Xenia Lobo", number: 1, role: "RACE_SEAT:2" },
      { externalId: "og-2026-y", name: "Yuri Paz", number: 88, role: "RACE_SEAT:1" },
    ]);
    const { ids } = fixture;
    const actor: Actor = { id: ids.userId, role: "ADMIN" };
    try {
      const preview = await universeInitService.preview(actor, gridInput(ids));
      expect(preview.openingGrid.state).toBe("RESOLVED");
      const seats = preview.openingGrid.teams[0].seats;
      expect(seats[0].holder?.name).toBe("Yuri Paz");
      expect(seats[1].holder?.name).toBe("Xenia Lobo");

      await universeInitService.execute(actor, gridInput(ids));
      const entries = await prisma.seasonDriverEntry.findMany({
        where: { seasonId: ids.seasonId },
        include: { driverProfile: { include: { character: { select: { name: true } } } } },
        orderBy: { seat: "asc" },
      });
      expect(entries.find((e) => e.seat === 1)?.driverProfile.character.name).toBe("Yuri Paz");
      expect(entries.find((e) => e.seat === 2)?.driverProfile.character.name).toBe("Xenia Lobo");
    } finally {
      await fixture.cleanup();
    }
  });

  it("3) Participantes sem role → UNRESOLVED; materialização não cria titular; Player Entry bloqueado", async () => {
    const fixture = await seedFixture(2026, TEAM, [
      { externalId: "og-2026-p1", name: "Paula Novo", number: 21, role: null },
      { externalId: "og-2026-p2", name: "Pedro Vila", number: 32, role: null },
    ]);
    const { ids } = fixture;
    const actor: Actor = { id: ids.userId, role: "ADMIN" };
    try {
      const preview = await universeInitService.preview(actor, gridInput(ids));
      expect(preview.openingGrid.state).toBe("UNRESOLVED");
      expect(preview.openingGrid.unresolvedParticipants).toBe(2);
      const grid = await resolveOpeningGrid(prisma, {
        source: JOLPICA_SOURCE,
        year: 2026,
        seasonId: ids.seasonId,
      });
      expect(grid.teams[0].starters).toHaveLength(0);
      expect(grid.teams[0].reserves).toHaveLength(0);

      await universeInitService.execute(actor, gridInput(ids));
      const entries = await prisma.seasonDriverEntry.findMany({ where: { seasonId: ids.seasonId } });
      expect(entries).toHaveLength(2);
      expect(entries.every((entry) => entry.role === null && entry.seat === null)).toBe(true);

      const team = await prisma.team.findFirstOrThrow({ where: { userId: ids.userId } });
      await expect(
        playerEntryService.create(ids.userId, {
          seasonId: ids.seasonId,
          teamId: team.id,
          seat: 1,
          name: "Paula Bloqueada",
          nationality: "Teste",
          gender: null,
          birthDate: new Date("1998-02-02"),
        }),
      ).rejects.toMatchObject({ code: "OPENING_GRID_UNRESOLVED", statusCode: 409 });
    } finally {
      await fixture.cleanup();
    }
  });

  it("4) Dois pilotos reivindicando o mesmo assento → CONFLICTED; Player Entry bloqueado; materialização SEAT_CLAIM_CONFLICT", async () => {
    const fixture = await seedFixture(2026, TEAM, [
      { externalId: "og-2026-c1", name: "Carla Dupla", number: 4, role: "RACE_SEAT:1" },
      { externalId: "og-2026-c2", name: "Caio Duplo", number: 45, role: "RACE_SEAT:1" },
    ]);
    const { ids } = fixture;
    const actor: Actor = { id: ids.userId, role: "ADMIN" };
    try {
      const preview = await universeInitService.preview(actor, gridInput(ids));
      expect(preview.openingGrid.state).toBe("CONFLICTED");
      expect(
        preview.openingGrid.teams[0].reasons.some(
          (reason) => reason.includes("Carla Dupla") && reason.includes("Caio Duplo"),
        ),
      ).toBe(true);

      await expect(
        universeInitService.execute(actor, gridInput(ids)),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const conflicts = (await universeInitService.preview(actor, gridInput(ids))).conflicts;
      expect(conflicts.map((conflict) => conflict.kind)).toContain("SEAT_CLAIM_CONFLICT");
    } finally {
      await fixture.cleanup();
    }
  });

  it("5) Mais de dois titulares RACE_SEAT → CONFLICTED; materialização SEAT_CAPACITY", async () => {
    const fixture = await seedFixture(2026, TEAM, [
      { externalId: "og-2026-d1", name: "Danton Três", number: 9, role: "RACE_SEAT" },
      { externalId: "og-2026-d2", name: "Dora Três", number: 10, role: "RACE_SEAT" },
      { externalId: "og-2026-d3", name: "Diego Três", number: 11, role: "RACE_SEAT" },
    ]);
    const { ids } = fixture;
    const actor: Actor = { id: ids.userId, role: "ADMIN" };
    try {
      const preview = await universeInitService.preview(actor, gridInput(ids));
      expect(preview.openingGrid.state).toBe("CONFLICTED");
      expect(preview.conflicts.map((conflict) => conflict.kind)).toContain("SEAT_CAPACITY");
      await expect(
        universeInitService.execute(actor, gridInput(ids)),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("6) RESERVE explícito nunca conta como titular; grid continua RESOLVED com reserva no pool", async () => {
    const fixture = await seedFixture(2026, TEAM, [
      { externalId: "og-2026-a", name: "Alpha Russo", number: 3, role: "RACE_SEAT" },
      { externalId: "og-2026-b", name: "Beto Marchi", number: 77, role: "RACE_SEAT" },
      { externalId: "og-2026-r1", name: "Renata Res", number: 12, role: "RESERVE" },
      { externalId: "og-2026-r2", name: "Ramon Res", number: 13, role: "RESERVE" },
    ]);
    const { ids } = fixture;
    const actor: Actor = { id: ids.userId, role: "ADMIN" };
    try {
      const preview = await universeInitService.preview(actor, gridInput(ids));
      expect(preview.openingGrid.state).toBe("RESOLVED");
      expect(preview.openingGrid.teams[0].starters).toHaveLength(2);
      expect(preview.openingGrid.teams[0].reserves).toHaveLength(2);
      await universeInitService.execute(actor, gridInput(ids));
      const entries = await prisma.seasonDriverEntry.findMany({ where: { seasonId: ids.seasonId } });
      expect(entries.filter((entry) => entry.role === "RESERVE")).toHaveLength(2);
      expect(entries.filter((entry) => entry.role === "RACE_SEAT")).toHaveLength(2);
    } finally {
      await fixture.cleanup();
    }
  });

  it("7) Equipe sem evidência de grid → RESOLVED vazio; Player Entry permite o jogador estabelecer o próprio titular", async () => {
    const fixture = await seedFixture(2026, TEAM, []);
    const { ids } = fixture;
    const actor: Actor = { id: ids.userId, role: "ADMIN" };
    try {
      const preview = await universeInitService.preview(actor, gridInput(ids));
      expect(preview.openingGrid.state).toBe("RESOLVED");
      expect(preview.openingGrid.teams).toHaveLength(0);

      const team = await prisma.team.create({
        data: { name: "Meu Time", shortName: "MYT", color: "#000000", userId: ids.userId },
      });
      await prisma.externalBindingTeam.create({
        data: {
          externalTeamId: ids.extTeamId,
          teamId: team.id,
          confidence: "CONFIRMED",
          boundBy: "ADMIN",
        },
      });
      await prisma.externalBindingSeason.create({
        data: {
          externalSeasonId: ids.extSeasonId,
          seasonId: ids.seasonId,
          confidence: "CONFIRMED",
          boundBy: "ADMIN",
        },
      });

      const result = await playerEntryService.create(ids.userId, {
        seasonId: ids.seasonId,
        teamId: team.id,
        seat: 1,
        name: "Meu Piloto",
        nationality: "Brasileira",
        gender: null,
        birthDate: new Date("2001-06-14"),
      });
      expect(result.character.name).toBe("Meu Piloto");
      expect(result.entry.seat).toBe(1);
      expect(result.entry.role).toBe("RACE_SEAT");
    } finally {
      await fixture.cleanup();
    }
  });

  it("8) Ocupação materializada no universo resolve grid anteriormente UNRESOLVED (sem tocar a fonte)", async () => {
    const fixture = await seedFixture(2026, TEAM, [
      { externalId: "og-2026-a", name: "Alpha Russo", number: 3, role: "RACE_SEAT" },
      { externalId: "og-2026-p1", name: "Paula Novo", number: 21, role: null },
    ]);
    const { ids } = fixture;
    const actor: Actor = { id: ids.userId, role: "ADMIN" };
    try {
      const before = await resolveOpeningGrid(prisma, {
        source: JOLPICA_SOURCE,
        year: 2026,
        seasonId: ids.seasonId,
      });
      expect(before.state).toBe("UNRESOLVED");

      await universeInitService.execute(actor, gridInput(ids));
      const team = await prisma.team.findFirstOrThrow({ where: { userId: ids.userId } });
      const participant = await prisma.seasonDriverEntry.findFirstOrThrow({
        where: { seasonId: ids.seasonId, role: null },
        include: { driverProfile: true },
      });

      const resolved = await prisma.driverProfile.create({
        data: {
          character: {
            create: {
              userId: ids.userId,
              name: "Resolvido Manual",
              nationality: "Teste",
              birthDate: new Date("1997-07-07"),
            },
          },
        },
      });
      await prisma.seasonDriverEntry.create({
        data: {
          seasonId: ids.seasonId,
          teamId: team.id,
          driverProfileId: resolved.id,
          seat: 2,
          role: "RACE_SEAT",
          status: "ACTIVE",
          provenance: "IMPORTED",
        },
      });

      const after = await resolveOpeningGrid(prisma, {
        source: JOLPICA_SOURCE,
        year: 2026,
        seasonId: ids.seasonId,
      });
      expect(after.state).toBe("RESOLVED");
      expect(after.teams[0].seats[0]?.holder?.name).toBe("Alpha Russo");
      expect(after.teams[0].seats[1]?.holder?.name).toBe("Resolvido Manual");
      expect(participant.role).toBeNull();
      expect(participant.seat).toBeNull();
    } finally {
      await fixture.cleanup();
    }
  });

  it("9) Resolução não escreve nada no espelho externo", async () => {
    const fixture = await seedFixture(2026, TEAM, [
      { externalId: "og-2026-a", name: "Alpha Russo", number: 3, role: "RACE_SEAT" },
      { externalId: "og-2026-b", name: "Beto Marchi", number: 77, role: "RACE_SEAT" },
    ]);
    const { ids } = fixture;
    try {
      const before = await snapshotMirror(2026);
      await resolveOpeningGrid(prisma, {
        source: JOLPICA_SOURCE,
        year: 2026,
        seasonId: ids.seasonId,
      });
      const after = await snapshotMirror(2026);
      expect(after.seasons).toEqual(before.seasons);
      expect(after.teams).toEqual(before.teams);
    } finally {
      await fixture.cleanup();
    }
  });

  it("10) Resolução é idempotente: repetidas chamadas e re-materialização preservam o estado", async () => {
    const fixture = await seedFixture(2026, TEAM, [
      { externalId: "og-2026-a", name: "Alpha Russo", number: 3, role: "RACE_SEAT" },
      { externalId: "og-2026-b", name: "Beto Marchi", number: 77, role: "RACE_SEAT" },
    ]);
    const { ids } = fixture;
    const actor: Actor = { id: ids.userId, role: "ADMIN" };
    try {
      const first = await resolveOpeningGrid(prisma, {
        source: JOLPICA_SOURCE,
        year: 2026,
        seasonId: ids.seasonId,
      });
      const second = await resolveOpeningGrid(prisma, {
        source: JOLPICA_SOURCE,
        year: 2026,
        seasonId: ids.seasonId,
      });
      expect(second.state).toBe(first.state);
      expect(second.teams).toEqual(first.teams);

      await universeInitService.execute(actor, gridInput(ids));
      const reinit = await universeInitService.preview(actor, gridInput(ids));
      expect(reinit.openingGrid.state).toBe("RESOLVED");
      expect(reinit.summary.openingGridState).toBe("RESOLVED");
      expect(reinit.conflicts).toEqual([]);
      await universeInitService.execute(actor, gridInput(ids));
      const entries = await prisma.seasonDriverEntry.findMany({ where: { seasonId: ids.seasonId } });
      expect(entries).toHaveLength(2);
    } finally {
      await fixture.cleanup();
    }
  });

  it("11) Participante continua sem assento após materialização; grid segue UNRESOLVED enquanto não houver titulares", async () => {
    const fixture = await seedFixture(2026, TEAM, [
      { externalId: "og-2026-a", name: "Alpha Russo", number: 3, role: "RACE_SEAT" },
      { externalId: "og-2026-p1", name: "Paula Novo", number: 21, role: null },
    ]);
    const { ids } = fixture;
    const actor: Actor = { id: ids.userId, role: "ADMIN" };
    try {
      await universeInitService.execute(actor, gridInput(ids));
      const entries = await prisma.seasonDriverEntry.findMany({
        where: { seasonId: ids.seasonId },
        orderBy: { seat: "asc" },
      });
      const starter = entries.find((entry) => entry.role === "RACE_SEAT");
      const participant = entries.find((entry) => entry.role === null);
      expect(starter?.seat).toBe(1);
      expect(participant?.seat).toBeNull();
      expect(participant?.role).toBeNull();
      expect(entries).toHaveLength(2);

      const after = await resolveOpeningGrid(prisma, {
        source: JOLPICA_SOURCE,
        year: 2026,
        seasonId: ids.seasonId,
      });
      expect(after.state).toBe("UNRESOLVED");
      expect(after.unresolvedParticipants).toBe(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("12) Init report/status/summary refletem o opening grid (state, teams e compatibilidade com openingRoster)", async () => {
    const fixture = await seedFixture(2026, TEAM, [
      { externalId: "og-2026-a", name: "Alpha Russo", number: 3, role: "RACE_SEAT" },
      { externalId: "og-2026-b", name: "Beto Marchi", number: 77, role: "RACE_SEAT" },
    ]);
    const { ids } = fixture;
    const actor: Actor = { id: ids.userId, role: "ADMIN" };
    try {
      await universeInitService.execute(actor, gridInput(ids));
      const status = await universeInitService.status(actor, gridInput(ids));
      expect(status.initialized).toBe(true);
      expect(status.summary.openingGridState).toBe("RESOLVED");
      expect(status.openingGrid.state).toBe("RESOLVED");
      expect(status.openingGrid.resolvedTeams).toBe(1);
      expect(status.openingGrid.unresolvedTeams).toBe(0);
      expect(status.openingGrid.conflictedTeams).toBe(0);
      expect(typeof status.summary.openingRosterUnresolved).toBe("number");
    } finally {
      await fixture.cleanup();
    }
  });

  it("parseSourceClaim: convenção de role explícito (RACE_SEAT, RACE_SEAT:1...2, RESERVE e participante)", () => {
    expect(parseSourceClaim("RACE_SEAT")).toEqual({ kind: "RACE_SEAT", seat: null });
    expect(parseSourceClaim("RACE_SEAT:1")).toEqual({ kind: "RACE_SEAT", seat: 1 });
    expect(parseSourceClaim("RACE_SEAT:2")).toEqual({ kind: "RACE_SEAT", seat: 2 });
    expect(parseSourceClaim("RESERVE")).toEqual({ kind: "RESERVE", seat: null });
    expect(parseSourceClaim(null)).toBeNull();
    expect(parseSourceClaim("")).toBeNull();
  });
});