import { describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import { universeInitService, type Actor } from "./universe-init.service.js";
import {
  DRIVER_LANDO,
  seedUniverseInitFixture,
  type InitFixtureIds,
} from "./universe-init.fixtures.js";

const SNAPSHOT_MODELS = [
  "character",
  "driverProfile",
  "team",
  "race",
  "raceResult",
  "championshipStanding",
  "seasonDriverEntry",
  "driverEntryEvent",
  "externalBindingDriver",
  "externalBindingTeam",
  "externalBindingSeason",
  "externalBindingRace",
  "externalBindingDriverSeason",
  "externalBindingResult",
  "externalBindingStanding",
] as const;

async function snapshotCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const model of SNAPSHOT_MODELS) {
    out[model] = await (prisma as unknown as Record<string, { count(): Promise<number> }>)[
      model
    ].count();
  }
  return out;
}

async function snapshotWorldState() {
  return prisma.worldState.findUnique({ where: { key: "default" } });
}

function conflictKinds(conflicts: { kind: string }[]): string[] {
  return conflicts.map((conflict) => conflict.kind);
}

function input(ids: InitFixtureIds) {
  return {
    seasonId: ids.seasonId,
    externalSeasonId: ids.extSeasonId,
  };
}

describe("UniverseInitService — materialização controlada (2031)", () => {
  const actor: Actor = { id: "", role: "ADMIN" };

  it("A) inicialização limpa materializa equipe, grid, corridas, resultados e classificação", async () => {
    const fixture = await seedUniverseInitFixture(2031);
    const { ids, cleanup } = fixture;
    actor.id = ids.userId;
    try {
      const worldBefore = await snapshotWorldState();

      const preview = await universeInitService.preview(actor, input(ids));
      expect(preview.conflicts).toEqual([]);
      expect(preview.seasonBindingCreated).toBe(true);
      expect(preview.summary).toMatchObject({
        teamsCreated: 1,
        charactersCreated: 3,
        profilesCreated: 3,
        entriesCreated: 3,
        racesCreated: 2,
        resultsCreated: 4,
        standingsCreated: 2,
        bindingsCreated: 16,
        conflicts: 0,
      });

      const report = await universeInitService.execute(actor, input(ids));
      expect(report.conflicts).toEqual([]);
      expect(report.summary).toMatchObject({
        teamsCreated: 1,
        teamsReused: 0,
        charactersCreated: 3,
        profilesCreated: 3,
        entriesCreated: 3,
        racesCreated: 2,
        resultsCreated: 4,
        standingsCreated: 2,
        bindingsCreated: 16,
        conflicts: 0,
      });
      expect(report.worldState).toEqual({ changed: false });

      expect(await prisma.team.count({ where: { userId: ids.userId } })).toBe(1);
      expect(await prisma.character.count({ where: { userId: ids.userId } })).toBe(3);
      expect(await prisma.driverProfile.count({ where: { character: { userId: ids.userId } } })).toBe(3);

      const entries = await prisma.seasonDriverEntry.findMany({
        where: { seasonId: ids.seasonId },
        include: { driverProfile: { include: { character: { select: { name: true } } } } },
      });
      expect(entries).toHaveLength(3);
      const seat1 = entries.find((entry) => entry.seat === 1);
      expect(seat1?.driverProfile.character.name).toBe("Lando Norris");
      expect(seat1?.role).toBe("RACE_SEAT");
      expect(seat1?.number).toBe(2);
      const seat2 = entries.find((entry) => entry.seat === 2);
      expect(seat2?.driverProfile.character.name).toBe("Oscar Piastri");
      expect(seat2?.role).toBe("RACE_SEAT");
      expect(seat2?.number).toBe(4);
      const reserve = entries.find((entry) => entry.role === "RESERVE");
      expect(reserve?.driverProfile.character.name).toBe("Reserve X");
      expect(reserve?.seat).toBeNull();
      expect(reserve?.number).toBe(88);

      expect(await prisma.race.count({ where: { seasonId: ids.seasonId } })).toBe(2);
      const races = await prisma.race.findMany({ where: { seasonId: ids.seasonId } });
      expect(races.every((race) => race.status === "FINISHED")).toBe(true);
      expect(
        await prisma.raceResult.count({ where: { race: { seasonId: ids.seasonId } } }),
      ).toBe(4);
      expect(await prisma.championshipStanding.count({ where: { seasonId: ids.seasonId } })).toBe(
        2,
      );
      expect(
        await prisma.driverEntryEvent.count({ where: { entry: { seasonId: ids.seasonId } } }),
      ).toBe(3);
      expect(await prisma.externalBindingSeason.count()).toBe(1);

      const worldAfter = await snapshotWorldState();
      expect(worldAfter?.currentSeasonId).toBe(worldBefore?.currentSeasonId ?? null);
      expect(String(worldAfter?.currentDate)).toBe(String(worldBefore?.currentDate));
    } finally {
      await cleanup();
    }
  });

  it("B) segunda execução é idempotente e não duplica nada", async () => {
    const fixture = await seedUniverseInitFixture(2031);
    const { ids, cleanup } = fixture;
    actor.id = ids.userId;
    try {
      await universeInitService.execute(actor, input(ids));

      const status = await universeInitService.status(actor, input(ids));
      expect(status.initialized).toBe(true);

      const before = await snapshotCounts();

      const again = await universeInitService.execute(actor, input(ids));
      expect(again.conflicts).toEqual([]);
      expect(again.summary).toMatchObject({
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

      const after = await snapshotCounts();
      for (const model of Object.keys(before)) {
        expect(after[model]).toBe(before[model]);
      }
      expect(await prisma.character.count({ where: { userId: ids.userId } })).toBe(3);
      expect(await prisma.seasonDriverEntry.count({ where: { seasonId: ids.seasonId } })).toBe(3);
    } finally {
      await cleanup();
    }
  });

  it("C) character canônico sem vínculo é preservado: inicialização nunca confirma por nome", async () => {
    const fixture = await seedUniverseInitFixture(2031);
    const { ids, cleanup } = fixture;
    actor.id = ids.userId;
    try {
      const canonicalOscar = await prisma.character.create({
        data: {
          name: "Oscar Piastri",
          nationality: "Australian",
          birthDate: new Date("2001-04-06"),
          userId: ids.userId,
        },
      });

      const report = await universeInitService.execute(actor, input(ids));
      expect(report.conflicts).toEqual([]);
      expect(report.summary.charactersCreated).toBe(3);
      expect(report.summary.charactersReused).toBe(0);

      const binding = await prisma.externalBindingDriver.findUniqueOrThrow({
        where: { externalDriverId: ids.extOscarId },
      });
      expect(binding.characterId).not.toBe(canonicalOscar.id);

      const boundOscar = await prisma.character.findUniqueOrThrow({
        where: { id: binding.characterId },
      });
      expect(boundOscar.name).toBe("Oscar Piastri");
      expect(boundOscar.userId).toBe(ids.userId);

      const stillThere = await prisma.character.findUniqueOrThrow({
        where: { id: canonicalOscar.id },
      });
      expect(stillThere.name).toBe("Oscar Piastri");
      expect(String(stillThere.birthDate)).toBe(String(new Date("2001-04-06")));
      expect(await prisma.character.count({ where: { userId: ids.userId } })).toBe(4);
    } finally {
      await cleanup();
    }
  });

  it("D) equipe do universo sem vínculo → TEAM_NAME_CONFLICT (nunca confirma por nome)", async () => {
    const fixture = await seedUniverseInitFixture(2031);
    const { ids, cleanup } = fixture;
    actor.id = ids.userId;
    try {
      await prisma.team.create({
        data: { name: "McLaren", shortName: "MCL", color: "#ff8000", userId: ids.userId },
      });

      const preview = await universeInitService.preview(actor, input(ids));
      expect(conflictKinds(preview.conflicts)).toContain("TEAM_NAME_CONFLICT");

      await expect(universeInitService.execute(actor, input(ids))).rejects.toMatchObject({
        code: "CONFLICT",
        statusCode: 409,
      });

      expect(await prisma.team.count({ where: { userId: ids.userId } })).toBe(1);
      expect(await prisma.character.count({ where: { userId: ids.userId } })).toBe(0);
      expect(await prisma.externalBindingTeam.count()).toBe(0);
      expect(await prisma.externalBindingSeason.count()).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it("E) vínculo CONFIRMED reutiliza character e perfil existentes", async () => {
    const fixture = await seedUniverseInitFixture(2031);
    const { ids, cleanup } = fixture;
    actor.id = ids.userId;
    try {
      const character = await prisma.character.create({
        data: {
          name: "Lando Norris",
          nationality: "British",
          birthDate: new Date("1999-11-13"),
          userId: ids.userId,
        },
      });
      const profile = await prisma.driverProfile.create({
        data: { characterId: character.id, number: 2 },
      });
      await prisma.externalBindingDriver.create({
        data: {
          externalDriverId: ids.extLandoId,
          characterId: character.id,
          confidence: "CONFIRMED",
          boundBy: "ADMIN",
        },
      });

      const report = await universeInitService.execute(actor, input(ids));
      expect(report.conflicts).toEqual([]);
      const lando = report.drivers.find((driver) => driver.externalId === DRIVER_LANDO)!;
      expect(lando.charAction).toBe("REUSED");
      expect(lando.profileAction).toBe("REUSED");
      expect(lando.entryAction).toBe("CREATED");
      expect(lando.driverBindingCreate).toBe(false);

      expect(report.summary).toMatchObject({
        charactersCreated: 2,
        charactersReused: 1,
        profilesCreated: 2,
        profilesReused: 1,
      });

      const binding = await prisma.externalBindingDriver.findUniqueOrThrow({
        where: { externalDriverId: ids.extLandoId },
      });
      expect(binding.characterId).toBe(character.id);
      expect(binding.confidence).toBe("CONFIRMED");
      expect(await prisma.character.count({ where: { userId: ids.userId } })).toBe(3);

      const entry = await prisma.seasonDriverEntry.findUnique({
        where: { seasonId_driverProfileId: { seasonId: ids.seasonId, driverProfileId: profile.id } },
      });
      expect(entry).not.toBeNull();
      expect(entry!.teamId).not.toBeNull();
      expect(entry!.seat).toBe(1);
      expect(entry!.number).toBe(2);
    } finally {
      await cleanup();
    }
  });

  it("F) vínculo SUGGESTED aborta e nunca é promovido silenciosamente", async () => {
    const fixture = await seedUniverseInitFixture(2031);
    const { ids, cleanup } = fixture;
    actor.id = ids.userId;
    try {
      const character = await prisma.character.create({
        data: {
          name: "Lando Norris",
          nationality: "British",
          birthDate: new Date("1999-11-13"),
          userId: ids.userId,
        },
      });
      await prisma.driverProfile.create({ data: { characterId: character.id, number: 2 } });
      await prisma.externalBindingDriver.create({
        data: {
          externalDriverId: ids.extLandoId,
          characterId: character.id,
          confidence: "SUGGESTED",
          boundBy: "ADMIN",
        },
      });

      const preview = await universeInitService.preview(actor, input(ids));
      expect(conflictKinds(preview.conflicts)).toContain("DRIVER_BINDING_SUGGESTED");

      await expect(universeInitService.execute(actor, input(ids))).rejects.toMatchObject({
        code: "CONFLICT",
        statusCode: 409,
      });

      const binding = await prisma.externalBindingDriver.findUniqueOrThrow({
        where: { externalDriverId: ids.extLandoId },
      });
      expect(binding.confidence).toBe("SUGGESTED");
      expect(binding.characterId).toBe(character.id);
      expect(await prisma.seasonDriverEntry.count({ where: { seasonId: ids.seasonId } })).toBe(0);
      expect(await prisma.race.count({ where: { seasonId: ids.seasonId } })).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it("G) entrada divergente/assento ocupado → conflitos de grid sem materialização", async () => {
    const fixture = await seedUniverseInitFixture(2031);
    const { ids, cleanup } = fixture;
    actor.id = ids.userId;
    try {
      const team = await prisma.team.create({
        data: { name: "McLaren", shortName: "MCL", color: "#ff8000", userId: ids.userId },
      });
      await prisma.externalBindingTeam.create({
        data: {
          externalTeamId: ids.extTeamId,
          teamId: team.id,
          confidence: "CONFIRMED",
          boundBy: "ADMIN",
        },
      });
      const oscar = await prisma.character.create({
        data: {
          name: "Oscar Piastri",
          nationality: "Australian",
          birthDate: new Date("2001-04-06"),
          userId: ids.userId,
        },
      });
      const oscarProfile = await prisma.driverProfile.create({
        data: { characterId: oscar.id, number: 4 },
      });
      await prisma.externalBindingDriver.create({
        data: {
          externalDriverId: ids.extOscarId,
          characterId: oscar.id,
          confidence: "CONFIRMED",
          boundBy: "ADMIN",
        },
      });
      await prisma.seasonDriverEntry.create({
        data: {
          seasonId: ids.seasonId,
          driverProfileId: oscarProfile.id,
          teamId: team.id,
          role: "RACE_SEAT",
          seat: 1,
          number: 4,
          status: "ACTIVE",
        },
      });

      const preview = await universeInitService.preview(actor, input(ids));
      const kinds = conflictKinds(preview.conflicts);
      expect(kinds).toContain("SEAT_OCCUPIED");
      expect(kinds).toContain("ROSTER_CONFLICT");

      await expect(universeInitService.execute(actor, input(ids))).rejects.toMatchObject({
        code: "CONFLICT",
        statusCode: 409,
      });

      expect(await prisma.team.count({ where: { userId: ids.userId } })).toBe(1);
      expect(await prisma.seasonDriverEntry.count({ where: { seasonId: ids.seasonId } })).toBe(1);
      expect(await prisma.externalBindingDriver.count()).toBe(1);
      expect(await prisma.externalBindingSeason.count()).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it("H) RaceResult canônica sem vínculo → RESULT_CONFLICT (nunca sobrescreve)", async () => {
    const fixture = await seedUniverseInitFixture(2031);
    const { ids, cleanup } = fixture;
    actor.id = ids.userId;
    try {
      const team = await prisma.team.create({
        data: { name: "McLaren", shortName: "MCL", color: "#ff8000", userId: ids.userId },
      });
      await prisma.externalBindingTeam.create({
        data: {
          externalTeamId: ids.extTeamId,
          teamId: team.id,
          confidence: "CONFIRMED",
          boundBy: "ADMIN",
        },
      });
      const lando = await prisma.character.create({
        data: {
          name: "Lando Norris",
          nationality: "British",
          birthDate: new Date("1999-11-13"),
          userId: ids.userId,
        },
      });
      const landoProfile = await prisma.driverProfile.create({
        data: { characterId: lando.id, number: 2 },
      });
      await prisma.externalBindingDriver.create({
        data: {
          externalDriverId: ids.extLandoId,
          characterId: lando.id,
          confidence: "CONFIRMED",
          boundBy: "ADMIN",
        },
      });
      const race = await prisma.race.create({
        data: {
          seasonId: ids.seasonId,
          name: "Australian Grand Prix",
          circuit: "Albert Park",
          round: 1,
          status: "FINISHED",
        },
      });
      await prisma.raceResult.create({
        data: {
          raceId: race.id,
          driverProfileId: landoProfile.id,
          position: 9,
          points: 0,
          status: "Retired",
        },
      });

      const preview = await universeInitService.preview(actor, input(ids));
      expect(conflictKinds(preview.conflicts)).toContain("RESULT_CONFLICT");

      await expect(universeInitService.execute(actor, input(ids))).rejects.toMatchObject({
        code: "CONFLICT",
        statusCode: 409,
      });

      expect(
        await prisma.raceResult.count({ where: { race: { seasonId: ids.seasonId } } }),
      ).toBe(1);
      expect(await prisma.externalBindingRace.count()).toBe(0);
      expect(await prisma.championshipStanding.count({ where: { seasonId: ids.seasonId } })).toBe(
        0,
      );
      expect(await prisma.externalBindingSeason.count()).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it("I) classificação canônica sem vínculo → STANDING_CONFLICT (nunca sobrescreve)", async () => {
    const fixture = await seedUniverseInitFixture(2031);
    const { ids, cleanup } = fixture;
    actor.id = ids.userId;
    try {
      const oscar = await prisma.character.create({
        data: {
          name: "Oscar Piastri",
          nationality: "Australian",
          birthDate: new Date("2001-04-06"),
          userId: ids.userId,
        },
      });
      const oscarProfile = await prisma.driverProfile.create({
        data: { characterId: oscar.id, number: 4 },
      });
      await prisma.externalBindingDriver.create({
        data: {
          externalDriverId: ids.extOscarId,
          characterId: oscar.id,
          confidence: "CONFIRMED",
          boundBy: "ADMIN",
        },
      });
      await prisma.championshipStanding.create({
        data: {
          seasonId: ids.seasonId,
          driverProfileId: oscarProfile.id,
          position: 2,
          points: 33,
          wins: 0,
          podiums: 1,
        },
      });

      const preview = await universeInitService.preview(actor, input(ids));
      expect(conflictKinds(preview.conflicts)).toContain("STANDING_CONFLICT");

      await expect(universeInitService.execute(actor, input(ids))).rejects.toMatchObject({
        code: "CONFLICT",
        statusCode: 409,
      });

      expect(await prisma.championshipStanding.count({ where: { seasonId: ids.seasonId } })).toBe(
        1,
      );
      expect(await prisma.seasonDriverEntry.count({ where: { seasonId: ids.seasonId } })).toBe(0);
      expect(await prisma.externalBindingSeason.count()).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it("J) aborto por conflito é atômico: nada é gravado (rollback total da transação)", async () => {
    const fixture = await seedUniverseInitFixture(2031);
    const { ids, cleanup } = fixture;
    actor.id = ids.userId;
    const worldBefore = await snapshotWorldState();
    try {
      const team = await prisma.team.create({
        data: { name: "McLaren", shortName: "MCL", color: "#ff8000", userId: ids.userId },
      });
      await prisma.externalBindingTeam.create({
        data: {
          externalTeamId: ids.extTeamId,
          teamId: team.id,
          confidence: "CONFIRMED",
          boundBy: "ADMIN",
        },
      });
      const oscar = await prisma.character.create({
        data: {
          name: "Oscar Piastri",
          nationality: "Australian",
          birthDate: new Date("2001-04-06"),
          userId: ids.userId,
        },
      });
      const oscarProfile = await prisma.driverProfile.create({
        data: { characterId: oscar.id, number: 4 },
      });
      await prisma.externalBindingDriver.create({
        data: {
          externalDriverId: ids.extOscarId,
          characterId: oscar.id,
          confidence: "CONFIRMED",
          boundBy: "ADMIN",
        },
      });
      await prisma.seasonDriverEntry.create({
        data: {
          seasonId: ids.seasonId,
          driverProfileId: oscarProfile.id,
          teamId: team.id,
          role: "RACE_SEAT",
          seat: 1,
          number: 4,
          status: "ACTIVE",
        },
      });

      const before = await snapshotCounts();

      await expect(universeInitService.execute(actor, input(ids))).rejects.toMatchObject({
        code: "CONFLICT",
        statusCode: 409,
      });

      const after = await snapshotCounts();
      for (const model of Object.keys(before)) {
        expect(after[model]).toBe(before[model]);
      }
      const worldAfter = await snapshotWorldState();
      expect(worldAfter?.currentSeasonId).toBe(worldBefore?.currentSeasonId ?? null);
      expect(String(worldAfter?.currentDate)).toBe(String(worldBefore?.currentDate));
    } finally {
      await cleanup();
    }
  });
});