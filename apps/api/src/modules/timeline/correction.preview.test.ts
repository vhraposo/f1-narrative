import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import { submitCorrection } from "./correction.service.js";
import { previewCorrection } from "./correction.preview.js";
import { seedCorrectionFixture, type CorrectionFixture } from "./correction.fixtures.js";

let fixture: CorrectionFixture;
let otherUniverseId: string;
let narrativeEventId: string;

let otherFixture: CorrectionFixture;

beforeAll(async () => {
  fixture = await seedCorrectionFixture("preview", 2090);
  otherFixture = await seedCorrectionFixture("preview-other", 2091);
  otherUniverseId = otherFixture.universeId;
  const character = await prisma.character.create({
    data: {
      name: "corr-preview-narrativa",
      nationality: "BR",
      birthDate: new Date("1995-01-01"),
      controlledBy: "AI",
      universeId: fixture.universeId,
    },
  });
  const event = await prisma.event.create({
    data: {
      type: "RACE",
      title: "Vitória do GP (narrativa sintética)",
      payload: { raceId: fixture.raceId },
      participants: { create: [{ characterId: character.id }] },
    },
  });
  narrativeEventId = event.id;
});

afterAll(async () => {
  await prisma.event.deleteMany({ where: { id: narrativeEventId } });
  await fixture.cleanup();
  await otherFixture.cleanup();
  await prisma.$disconnect();
});

describe("correction preview", () => {
  it("1) retorna diff de resultado, standings, campeão, narrativa e impacto de número", async () => {
    const preview = await previewCorrection(fixture.universeId, {
      kind: "RACE_RESULT_CORRECTED",
      worldDate: fixture.worldDate,
      raceId: fixture.raceId,
      driverProfileId: fixture.driver2Id,
      position: 4,
    });

    expect(preview.previewToken).toMatch(/^sha256:/);
    const resultChange = preview.changes.find(
      (change) => change.area === "RESULT" && change.field === "position",
    );
    expect(resultChange).toMatchObject({ before: 1, after: 4 });
    expect(preview.championBefore).toBe(fixture.driver2Id);
    expect(preview.championAfter).toBe(fixture.driver1Id);
    expect(
      preview.changes.some((change) => change.area === "CHAMPION"),
    ).toBe(true);
    expect(preview.narrativeStaleEventIds).toContain(narrativeEventId);
    expect(preview.numberImpact).toMatchObject({
      seasonId: fixture.nextSeasonId,
      currentHolderId: fixture.driver2Id,
      expectedChampionId: fixture.driver1Id,
      requiresAction: true,
    });
  });

  it("2) preview não escreve nada (timeline, resultados, standings, snapshots, narrativa)", async () => {
    const before = {
      events: await prisma.timelineEvent.count({
        where: { universeId: fixture.universeId },
      }),
      snapshots: await prisma.worldSnapshot.count({
        where: { universeId: fixture.universeId },
      }),
      results: await prisma.raceResult.findMany({
        where: { raceId: fixture.raceId },
        orderBy: { driverProfileId: "asc" },
      }),
      standings: await prisma.championshipStanding.findMany({
        where: { seasonId: fixture.seasonId },
        orderBy: { driverProfileId: "asc" },
      }),
      eventsCount: await prisma.event.count(),
      memories: await prisma.memory.count(),
      personas: await prisma.characterPersona.count(),
      attribtues: await prisma.driverAttribute.count(),
    };

    await previewCorrection(fixture.universeId, {
      kind: "RACE_RESULT_CORRECTED",
      worldDate: fixture.worldDate,
      raceId: fixture.raceId,
      driverProfileId: fixture.driver2Id,
      position: 1,
    });

    expect(
      await prisma.timelineEvent.count({ where: { universeId: fixture.universeId } }),
    ).toBe(before.events);
    expect(
      await prisma.worldSnapshot.count({ where: { universeId: fixture.universeId } }),
    ).toBe(before.snapshots);
    expect(
      await prisma.raceResult.findMany({
        where: { raceId: fixture.raceId },
        orderBy: { driverProfileId: "asc" },
      }),
    ).toEqual(before.results);
    expect(
      await prisma.championshipStanding.findMany({
        where: { seasonId: fixture.seasonId },
        orderBy: { driverProfileId: "asc" },
      }),
    ).toEqual(before.standings);
    expect(await prisma.event.count()).toBe(before.eventsCount);
    expect(await prisma.memory.count()).toBe(before.memories);
    expect(await prisma.characterPersona.count()).toBe(before.personas);
    expect(await prisma.driverAttribute.count()).toBe(before.attribtues);
  });

  it("3) é determinístico para o mesmo estado e payload", async () => {
    const command = {
      kind: "RACE_RESULT_CORRECTED" as const,
      worldDate: fixture.worldDate,
      raceId: fixture.raceId,
      driverProfileId: fixture.driver2Id,
      position: 1,
    };
    const first = await previewCorrection(fixture.universeId, command);
    const second = await previewCorrection(fixture.universeId, command);
    expect(second.previewToken).toBe(first.previewToken);
    expect(second.changes).toEqual(first.changes);
  });

  it("4) token muda quando o estado muda", async () => {
    const command = {
      kind: "RACE_RESULT_CORRECTED" as const,
      worldDate: fixture.worldDate,
      raceId: fixture.raceId,
      driverProfileId: fixture.driver2Id,
      position: 1,
    };
    const beforeToken = (
      await previewCorrection(fixture.universeId, command)
    ).previewToken;

    await submitCorrection(fixture.universeId, {
      kind: "NUMBER_CORRECTED",
      worldDate: fixture.worldDate,
      seasonId: fixture.seasonId,
      driverProfileId: fixture.driver2Id,
      number: 5,
    });

    const afterToken = (
      await previewCorrection(fixture.universeId, command)
    ).previewToken;
    expect(afterToken).not.toBe(beforeToken);
  });

  it("5) EVOLUTION_STALE é propagado", async () => {
    await prisma.timelineEvent.create({
      data: {
        universeId: fixture.universeId,
        sequence: 500,
        worldDate: fixture.worldDate,
        kind: "ATTRIBUTE_EVOLVED",
        payload: { seasonId: fixture.seasonId, fingerprint: "fp-preview" },
        causedBy: "USER",
      },
    });
    await expect(
      previewCorrection(fixture.universeId, {
        kind: "RACE_RESULT_CORRECTED",
        worldDate: fixture.worldDate,
        raceId: fixture.raceId,
        driverProfileId: fixture.driver1Id,
        position: 2,
      }),
    ).rejects.toMatchObject({ code: "EVOLUTION_STALE", statusCode: 409 });
    await prisma.timelineEvent.deleteMany({
      where: { universeId: fixture.universeId, kind: "ATTRIBUTE_EVOLVED" },
    });
  });

  it("6) isolamento: alvo de outro universo é leak-safe", async () => {
    await expect(
      previewCorrection(otherUniverseId, {
        kind: "RACE_RESULT_CORRECTED",
        worldDate: fixture.worldDate,
        raceId: fixture.raceId,
        driverProfileId: fixture.driver1Id,
        position: 2,
      }),
    ).rejects.toMatchObject({ code: "RACE_NOT_FOUND", statusCode: 404 });
  });
});
