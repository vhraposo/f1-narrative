import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import { setDriverNumber } from "../drivers/driver-number.service.js";
import { applyCorrection } from "./correction.apply.js";
import { previewCorrection } from "./correction.preview.js";
import {
  seedCorrectionFixture,
  type CorrectionFixture,
} from "./correction.fixtures.js";

let fixture: CorrectionFixture;

const CHAMPION_FLIP = (f: CorrectionFixture) =>
  ({
    kind: "RACE_RESULT_CORRECTED" as const,
    worldDate: f.worldDate,
    raceId: f.raceId,
    driverProfileId: f.driver2Id,
    position: 4,
  });

beforeAll(async () => {
  fixture = await seedCorrectionFixture("champion", 2095);
});

afterAll(async () => {
  await fixture.cleanup();
  await prisma.$disconnect();
});

describe("historical champion and number impact", () => {
  it("1) preview mostra campeão antes/depois e ação necessária para o #1", async () => {
    const preview = await previewCorrection(fixture.universeId, CHAMPION_FLIP(fixture));
    expect(preview.championBefore).toBe(fixture.driver2Id);
    expect(preview.championAfter).toBe(fixture.driver1Id);
    expect(preview.numberImpact).toMatchObject({
      seasonId: fixture.nextSeasonId,
      currentHolderId: fixture.driver2Id,
      expectedChampionId: fixture.driver1Id,
      requiresAction: true,
    });
  });

  it("2) apply muda o campeão derivado mas NÃO reescreve números automaticamente", async () => {
    const preview = await previewCorrection(fixture.universeId, CHAMPION_FLIP(fixture));
    await applyCorrection(
      fixture.universeId,
      CHAMPION_FLIP(fixture),
      preview.previewToken,
    );

    const standings = await prisma.championshipStanding.findMany({
      where: { seasonId: fixture.seasonId },
      orderBy: { position: "asc" },
    });
    expect(standings[0]!.driverProfileId).toBe(fixture.driver1Id);

    const nextEntries = await prisma.seasonDriverEntry.findMany({
      where: { seasonId: fixture.nextSeasonId },
    });
    const holder = nextEntries.find((entry) => entry.number === 1);
    expect(holder?.driverProfileId).toBe(fixture.driver2Id);
  });

  it("3) reatribuição do #1 é ação explícita e respeita a regra do campeão", async () => {
    const nextEntries = await prisma.seasonDriverEntry.findMany({
      where: { seasonId: fixture.nextSeasonId },
    });
    const newChampionEntry = nextEntries.find(
      (entry) => entry.driverProfileId === fixture.driver1Id,
    )!;

    await expect(
      setDriverNumber(fixture.universeId, fixture.nextSeasonId, fixture.driver1Id, 1),
    ).rejects.toMatchObject({ code: "NUMBER_ALREADY_USED" });

    await setDriverNumber(
      fixture.universeId,
      fixture.nextSeasonId,
      fixture.driver2Id,
      null,
    );
    const result = await setDriverNumber(
      fixture.universeId,
      fixture.nextSeasonId,
      fixture.driver1Id,
      1,
    );
    expect(result.number).toBe(1);

    const reloaded = await prisma.seasonDriverEntry.findUniqueOrThrow({
      where: { id: newChampionEntry.id },
    });
    expect(reloaded.number).toBe(1);
  });

  it("4) os NUMBER_CORRECTED são apenas as ações explícitas de número", async () => {
    const numberEvents = await prisma.timelineEvent.findMany({
      where: { universeId: fixture.universeId, kind: "NUMBER_CORRECTED" },
      orderBy: { sequence: "asc" },
    });
    expect(numberEvents).toHaveLength(2);
    expect(
      (numberEvents[1]!.payload as { number?: number | null }).number,
    ).toBe(1);
    expect(numberEvents[1]!.causedBy).toBe("USER");
  });

  it("5) champion impact não afeta outro universo", async () => {
    const other = await seedCorrectionFixture("champion-other", 2096);
    try {
      const preview = await previewCorrection(other.universeId, CHAMPION_FLIP(other));
      expect(preview.numberImpact?.requiresAction).toBe(true);
      const originalHolder = await prisma.seasonDriverEntry.findFirst({
        where: { seasonId: fixture.nextSeasonId, number: 1 },
      });
      expect(originalHolder?.driverProfileId).toBe(fixture.driver1Id);
    } finally {
      await other.cleanup();
    }
  });
});
