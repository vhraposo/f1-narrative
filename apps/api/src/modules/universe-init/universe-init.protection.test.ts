import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import { JolpicaClient } from "../external-sync/jolpica.client.js";
import { JolpicaTransport } from "../external-sync/jolpica.transport.js";
import { JolpicaSyncService, JOLPICA_SOURCE } from "../external-sync/jolpica.service.js";
import { reconciliationService } from "../reconciliation/reconciliation.service.js";
import { universeInitService, type Actor } from "./universe-init.service.js";
import {
  DRIVER_LANDO,
  SOURCE,
  TEAM_EXTERNAL_ID,
  seedUniverseInitFixture,
  type InitFixtureIds,
} from "./universe-init.fixtures.js";

function makeLandoSyncClient(): JolpicaClient {
  return new JolpicaClient({
    transport: new JolpicaTransport({
      baseUrl: "https://mock.invalid/f1/",
      timeoutMs: 5000,
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts[parts.length - 1] === "drivers.json") {
          return new Response(
            JSON.stringify({
              MRData: {
                DriverTable: {
                  Drivers: [
                    {
                      driverId: DRIVER_LANDO,
                      permanentNumber: "2",
                      code: "NOR",
                      givenName: "Lando",
                      familyName: "Sync",
                      nationality: "British",
                    },
                  ],
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ MRData: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    }),
  });
}

describe("UniverseInit — proteção do universo inicializado (2033)", () => {
  const actor: Actor = { id: "", role: "ADMIN" };
  let ids: InitFixtureIds;
  let cleanup: (extraUserIds?: string[]) => Promise<void>;
  let universeTeamId: string;
  let universeRaceId: string;
  let universeLandoCharId: string;

  function input() {
    return { seasonId: ids.seasonId, externalSeasonId: ids.extSeasonId };
  }

  async function saveUniverseRefs() {
    const team = await prisma.team.findFirstOrThrow({
      where: { userId: ids.userId },
      select: { id: true },
    });
    universeTeamId = team.id;
    const race = await prisma.race.findFirstOrThrow({
      where: { seasonId: ids.seasonId },
      orderBy: { round: "asc" },
      select: { id: true },
    });
    universeRaceId = race.id;
    universeLandoCharId = await prisma.character.findFirstOrThrow({
      where: { userId: ids.userId, name: "Lando Norris" },
      select: { id: true },
    }).then((char) => char.id);
  }

  beforeAll(async () => {
    const fixture = await seedUniverseInitFixture(2033);
    ids = fixture.ids;
    cleanup = fixture.cleanup;
    actor.id = ids.userId;

    const report = await universeInitService.execute(actor, input());
    expect(report.conflicts).toEqual([]);
    await saveUniverseRefs();

    await prisma.team.update({
      where: { id: universeTeamId },
      data: { name: "Grid Furacão" },
    });
    await prisma.character.update({
      where: { id: universeLandoCharId },
      data: { name: "Lando Inicial" },
    });
    const landoResult = await prisma.raceResult.findFirstOrThrow({
      where: {
        race: { seasonId: ids.seasonId },
        driverProfile: { characterId: universeLandoCharId },
      },
      select: { id: true },
    });
    await prisma.raceResult.update({
      where: { id: landoResult.id },
      data: { points: 30 },
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("K) Espelho muda após a inicialização → nova execução não sobrescreve os valores do universo", async () => {
    await prisma.externalTeam.update({
      where: { source_externalId: { source: SOURCE, externalId: TEAM_EXTERNAL_ID } },
      data: { name: "Mclaren Nova" },
    });
    await prisma.externalDriver.update({
      where: { source_externalId: { source: SOURCE, externalId: DRIVER_LANDO } },
      data: { name: "Lando Norris Segundo" },
    });
    await prisma.externalResult.update({
      where: { id: ids.extResultLando1Id },
      data: { position: 5, points: 12 },
    });
    await prisma.externalStanding.update({
      where: { id: ids.extStandingLandoId },
      data: { position: 3, points: 40 },
    });

    const report = await universeInitService.execute(actor, input());
    expect(report.conflicts).toEqual([]);
    expect(report.summary).toMatchObject({
      teamsCreated: 0,
      teamsReused: 1,
      charactersCreated: 0,
      charactersReused: 3,
      resultsCreated: 0,
      standingsCreated: 0,
      bindingsCreated: 0,
    });

    const team = await prisma.team.findUniqueOrThrow({ where: { id: universeTeamId } });
    expect(team.name).toBe("Grid Furacão");
    const char = await prisma.character.findUniqueOrThrow({
      where: { id: universeLandoCharId },
    });
    expect(char.name).toBe("Lando Inicial");
    const landoResult = await prisma.raceResult.findFirstOrThrow({
      where: {
        race: { seasonId: ids.seasonId },
        driverProfile: { characterId: universeLandoCharId },
      },
    });
    expect(landoResult.points).toBe(30);
    expect(landoResult.position).toBe(1);

    const status = await universeInitService.status(actor, input());
    expect(status.initialized).toBe(true);
  });

  it("L) Sync real após a inicialização grava só o espelho e não desfaz o override do universo", async () => {
    const syncService = new JolpicaSyncService(makeLandoSyncClient(), { requestDelayMs: 0 });
    const report = await syncService.syncDrivers(2033);
    expect(report.counts.updated + report.counts.unchanged).toBeGreaterThanOrEqual(1);

    const ext = await prisma.externalDriver.findUniqueOrThrow({
      where: { source_externalId: { source: JOLPICA_SOURCE, externalId: DRIVER_LANDO } },
    });
    expect(ext.name).toBe("Lando Sync");

    const char = await prisma.character.findUniqueOrThrow({
      where: { id: universeLandoCharId },
    });
    expect(char.name).toBe("Lando Inicial");
    const team = await prisma.team.findUniqueOrThrow({ where: { id: universeTeamId } });
    expect(team.name).toBe("Grid Furacão");
  });

  it("M) Reconciliação após a inicialização é apenas diff/vínculo e não desfaz o override", async () => {
    const roster = await reconciliationService.buildRosterDiff(ids.seasonId);
    expect(Array.isArray(roster.rows)).toBe(true);
    const champ = await reconciliationService.buildChampionshipDiff(ids.seasonId);
    expect(Array.isArray(champ.rows)).toBe(true);
    await reconciliationService.buildResultsDiff(universeRaceId);

    const listing = await reconciliationService.listCandidates(actor.id, "DRIVER", {
      source: SOURCE,
      externalId: DRIVER_LANDO,
    });
    expect(listing.external.label).toBe("Lando Sync");

    const char = await prisma.character.findUniqueOrThrow({
      where: { id: universeLandoCharId },
    });
    expect(char.name).toBe("Lando Inicial");
    const team = await prisma.team.findUniqueOrThrow({ where: { id: universeTeamId } });
    expect(team.name).toBe("Grid Furacão");

    const landoResult = await prisma.raceResult.findFirstOrThrow({
      where: {
        race: { seasonId: ids.seasonId },
        driverProfile: { characterId: universeLandoCharId },
      },
    });
    expect(landoResult.points).toBe(30);

    const oscarStanding = await prisma.championshipStanding.findFirstOrThrow({
      where: { seasonId: ids.seasonId },
      orderBy: { position: "asc" },
    });
    const extStandingLando = await prisma.externalStanding.findUniqueOrThrow({
      where: { id: ids.extStandingLandoId },
    });
    expect(oscarStanding.position).not.toBe(extStandingLando.position);
    expect(oscarStanding.points).not.toBe(extStandingLando.points);
  });
});