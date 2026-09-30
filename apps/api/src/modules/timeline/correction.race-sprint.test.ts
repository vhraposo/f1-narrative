import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import { applyCorrection } from "./correction.apply.js";
import { previewCorrection } from "./correction.preview.js";
import { queryTimelineItems } from "./timeline.read.js";
import {
  seedCorrectionFixture,
  type CorrectionFixture,
} from "./correction.fixtures.js";

let fixture: CorrectionFixture;

beforeAll(async () => {
  fixture = await seedCorrectionFixture("race-sprint", 2094);
  await prisma.raceSessionResult.create({
    data: {
      raceId: fixture.raceId,
      driverProfileId: fixture.driver1Id,
      session: "SPRINT",
      position: 1,
      status: "Finished",
      points: 8,
      metadata: { eligibility: { neutralizedStart: false, distancePct: 100 } },
    },
  });
});

afterAll(async () => {
  await fixture.cleanup();
  await prisma.$disconnect();
});

describe("race result corrections", () => {
  it("1) corrige posição, deriva pontos, recalcula standings e permite supersession", async () => {
    const command = {
      kind: "RACE_RESULT_CORRECTED" as const,
      worldDate: fixture.worldDate,
      raceId: fixture.raceId,
      driverProfileId: fixture.driver2Id,
      position: 4,
    };
    const preview = await previewCorrection(fixture.universeId, command);
    const resultChange = preview.changes.find(
      (change) => change.area === "RESULT" && change.field === "points",
    );
    expect(resultChange).toMatchObject({ before: 25, after: 12 });

    const first = await applyCorrection(
      fixture.universeId,
      command,
      preview.previewToken,
    );

    const result = await prisma.raceResult.findFirstOrThrow({
      where: { raceId: fixture.raceId, driverProfileId: fixture.driver2Id },
    });
    expect(result.position).toBe(4);
    expect(result.points).toBe(12);

    const nextPreview = await previewCorrection(fixture.universeId, {
      ...command,
      position: 1,
      supersedesId: first.id,
    });
    const second = await applyCorrection(
      fixture.universeId,
      { ...command, position: 1, supersedesId: first.id },
      nextPreview.previewToken,
    );
    expect(second.supersedesId).toBe(first.id);

    const items = await queryTimelineItems(fixture.universeId, {
      kind: "RACE_RESULT_CORRECTED",
    });
    expect(items.items).toHaveLength(2);
    const original = items.items.find((item) => item.id === first.id)!;
    expect(original.isSuperseded).toBe(true);
    expect(original.supersededById).toBe(second.id);
  });

  it("2) repetir a mesma correção é determinístico no estado efetivo", async () => {
    const result = await prisma.raceResult.findFirstOrThrow({
      where: { raceId: fixture.raceId, driverProfileId: fixture.driver2Id },
    });
    expect(result.position).toBe(1);
    const standings = await prisma.championshipStanding.findMany({
      where: { seasonId: fixture.seasonId },
      orderBy: { position: "asc" },
    });
    expect(standings).toHaveLength(2);
  });
});

describe("sprint corrections", () => {
  it("3) corrige posição de sprint e deriva pontos da tabela oficial", async () => {
    const command = {
      kind: "RACE_SESSION_RESULT_CORRECTED" as const,
      worldDate: fixture.worldDate,
      raceId: fixture.raceId,
      driverProfileId: fixture.driver1Id,
      position: 3,
    };
    const preview = await previewCorrection(fixture.universeId, command);
    const pointsChange = preview.changes.find(
      (change) => change.area === "RESULT" && change.field === "points",
    );
    expect(pointsChange).toMatchObject({ before: 8, after: 6 });

    await applyCorrection(fixture.universeId, command, preview.previewToken);

    const sprint = await prisma.raceSessionResult.findFirstOrThrow({
      where: {
        raceId: fixture.raceId,
        driverProfileId: fixture.driver1Id,
        session: "SPRINT",
      },
    });
    expect(sprint.position).toBe(3);
    expect(sprint.points).toBe(6);

    const standings = await prisma.championshipStanding.findMany({
      where: { seasonId: fixture.seasonId },
    });
    const driver1 = standings.find(
      (standing) => standing.driverProfileId === fixture.driver1Id,
    )!;
    expect(driver1.points).toBeGreaterThanOrEqual(6);
  });

  it("4) corrige elegibilidade e zera pontos inelegíveis", async () => {
    const command = {
      kind: "RACE_SESSION_RESULT_CORRECTED" as const,
      worldDate: fixture.worldDate,
      raceId: fixture.raceId,
      driverProfileId: fixture.driver1Id,
      eligibility: { neutralizedStart: false, distancePct: 40 },
    };
    const preview = await previewCorrection(fixture.universeId, command);
    await applyCorrection(fixture.universeId, command, preview.previewToken);

    const sprint = await prisma.raceSessionResult.findFirstOrThrow({
      where: {
        raceId: fixture.raceId,
        driverProfileId: fixture.driver1Id,
        session: "SPRINT",
      },
    });
    expect(sprint.points).toBe(0);
    expect(
      (sprint.metadata as { eligibility?: { distancePct?: number } }).eligibility
        ?.distancePct,
    ).toBe(40);
  });

  it("5) leitura expõe a correção de sprint com valores aplicados", async () => {
    const items = await queryTimelineItems(fixture.universeId, {
      kind: "RACE_SESSION_RESULT_CORRECTED",
    });
    expect(items.items.length).toBeGreaterThanOrEqual(2);
    expect(items.items[0]!.values).toMatchObject({ session: "SPRINT" });
    expect(items.items[0]!.race?.id).toBe(fixture.raceId);
  });
});
