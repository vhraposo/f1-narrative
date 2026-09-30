import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import { setDriverNumber } from "../drivers/driver-number.service.js";
import { applyCorrection } from "./correction.apply.js";
import { previewCorrection } from "./correction.preview.js";
import { queryTimelineItems, getTimelineEventDetail } from "./timeline.read.js";
import { buildDivergenceReport } from "./divergence.service.js";
import { recomputeUniverseState } from "./timeline.service.js";
import { submitCorrection } from "./correction.service.js";
import {
  seedCorrectionFixture,
  type CorrectionFixture,
} from "./correction.fixtures.js";

let fixture: CorrectionFixture;
let other: CorrectionFixture;

const CORRECTIONS = {
  leaderOut: (f: CorrectionFixture) =>
    ({
      kind: "RACE_RESULT_CORRECTED" as const,
      worldDate: f.worldDate,
      raceId: f.raceId,
      driverProfileId: f.driver2Id,
      position: 4,
    }),
  leaderBack: (f: CorrectionFixture) =>
    ({
      kind: "RACE_RESULT_CORRECTED" as const,
      worldDate: f.worldDate,
      raceId: f.raceId,
      driverProfileId: f.driver2Id,
      position: 1,
    }),
};

beforeAll(async () => {
  fixture = await seedCorrectionFixture("e2e", 2100);
  other = await seedCorrectionFixture("e2e-other", 2101);
});

afterAll(async () => {
  await fixture.cleanup();
  await other.cleanup();
  await prisma.$disconnect();
});

describe("V3.15 E2E — correction lifecycle", () => {
  it("1) preview sem escrita produz diff/impacto; apply atômico deriva standings e campeão", async () => {
    const before = {
      events: await prisma.timelineEvent.count({ where: { universeId: fixture.universeId } }),
      snapshots: await prisma.worldSnapshot.count({ where: { universeId: fixture.universeId } }),
      results: await prisma.raceResult.findMany({ where: { raceId: fixture.raceId }, orderBy: { position: "asc" } }),
      standings: await prisma.championshipStanding.count({ where: { seasonId: fixture.seasonId } }),
      world: await prisma.worldState.findFirstOrThrow({ where: { universeId: fixture.universeId } }),
    };

    const preview = await previewCorrection(fixture.universeId, CORRECTIONS.leaderOut(fixture));
    expect(preview.changes.some((change) => change.area === "RESULT" && change.field === "points" && change.before === 25 && change.after === 12)).toBe(true);
    expect(preview.championBefore).toBe(fixture.driver2Id);
    expect(preview.championAfter).toBe(fixture.driver1Id);
    expect(preview.numberImpact?.requiresAction).toBe(true);

    expect(await prisma.timelineEvent.count({ where: { universeId: fixture.universeId } })).toBe(before.events);
    expect(await prisma.worldSnapshot.count({ where: { universeId: fixture.universeId } })).toBe(before.snapshots);
    expect(await prisma.raceResult.findMany({ where: { raceId: fixture.raceId }, orderBy: { position: "asc" } })).toEqual(before.results);

    const event = await applyCorrection(fixture.universeId, CORRECTIONS.leaderOut(fixture), preview.previewToken);
    expect(event.kind).toBe("RACE_RESULT_CORRECTED");

    const standings = await prisma.championshipStanding.findMany({ where: { seasonId: fixture.seasonId }, orderBy: { position: "asc" } });
    expect(standings[0]!.driverProfileId).toBe(fixture.driver1Id);

    const snapshotsAfter = await prisma.worldSnapshot.count({ where: { universeId: fixture.universeId } });
    expect(snapshotsAfter).toBeGreaterThan(before.snapshots);

    const read = await queryTimelineItems(fixture.universeId, { kind: "RACE_RESULT_CORRECTED" });
    expect(read.items).toHaveLength(1);
    expect(read.items[0]!.isSuperseded).toBe(false);
  });

  it("2) número #1 é ação explícita após mudança de campeão (sem auto-cascade)", async () => {
    const holder = await prisma.seasonDriverEntry.findFirst({
      where: { seasonId: fixture.nextSeasonId, number: 1 },
    });
    expect(holder?.driverProfileId).toBe(fixture.driver2Id);

    await setDriverNumber(fixture.universeId, fixture.nextSeasonId, fixture.driver2Id, null);
    const assigned = await setDriverNumber(fixture.universeId, fixture.nextSeasonId, fixture.driver1Id, 1);
    expect(assigned.number).toBe(1);

    const events = await prisma.timelineEvent.findMany({ where: { universeId: fixture.universeId, kind: "NUMBER_CORRECTED" } });
    expect(events.every((event) => event.causedBy === "USER")).toBe(true);
  });

  it("3) supersession mantém o original imutável e o efetivo correto", async () => {
    const first = await prisma.timelineEvent.findFirstOrThrow({
      where: { universeId: fixture.universeId, kind: "RACE_RESULT_CORRECTED" },
    });
    const preview = await previewCorrection(fixture.universeId, {
      ...CORRECTIONS.leaderBack(fixture),
      supersedesId: first.id,
    });
    const second = await applyCorrection(
      fixture.universeId,
      { ...CORRECTIONS.leaderBack(fixture), supersedesId: first.id },
      preview.previewToken,
    );
    expect(second.supersedesId).toBe(first.id);

    const detail = await getTimelineEventDetail(fixture.universeId, second.id);
    expect(detail.supersedesChain.map((item) => item.id)).toEqual([first.id]);

    const result = await prisma.raceResult.findFirstOrThrow({
      where: { raceId: fixture.raceId, driverProfileId: fixture.driver2Id },
    });
    expect(result.position).toBe(1);

    const original = await prisma.timelineEvent.findUniqueOrThrow({ where: { id: first.id } });
    expect(original.supersedesId).toBeNull();
    expect((original.payload as { position?: number }).position).toBe(4);
  });

  it("4) preview obsoleto é rejeitado e nada é aplicado", async () => {
    const preview = await previewCorrection(fixture.universeId, CORRECTIONS.leaderOut(fixture));
    await submitCorrection(fixture.universeId, {
      kind: "NUMBER_CORRECTED",
      worldDate: fixture.worldDate,
      seasonId: fixture.seasonId,
      driverProfileId: fixture.driver2Id,
      number: 5,
    });
    const eventsBefore = await prisma.timelineEvent.count({ where: { universeId: fixture.universeId } });
    await expect(
      applyCorrection(fixture.universeId, CORRECTIONS.leaderOut(fixture), preview.previewToken),
    ).rejects.toMatchObject({ code: "PREVIEW_STALE", statusCode: 409 });
    expect(await prisma.timelineEvent.count({ where: { universeId: fixture.universeId } })).toBe(eventsBefore);
  });

  it("5) recompute repetido é determinístico", async () => {
    const stableStandings = () =>
      prisma.championshipStanding.findMany({
        where: { seasonId: fixture.seasonId },
        orderBy: { driverProfileId: "asc" },
        select: {
          driverProfileId: true,
          points: true,
          wins: true,
          podiums: true,
          position: true,
        },
      });
    const first = await prisma.$transaction((tx) => recomputeUniverseState(tx, fixture.universeId));
    const standingsFirst = await stableStandings();
    const second = await prisma.$transaction((tx) => recomputeUniverseState(tx, fixture.universeId));
    const standingsSecond = await stableStandings();
    expect(second.applied).toBe(first.applied);
    expect(standingsSecond).toEqual(standingsFirst);
  });

  it("6) correção não regenera narrativa nem evolução; EVOLUTION_STALE é sanitizado", async () => {
    const character = await prisma.character.create({
      data: {
        name: "e2e-narrativa",
        nationality: "BR",
        birthDate: new Date("1995-01-01"),
        controlledBy: "AI",
        universeId: fixture.universeId,
      },
    });
    const event = await prisma.event.create({
      data: {
        type: "RACE",
        title: "Narrativa E2E",
        payload: { raceId: fixture.raceId },
        participants: { create: [{ characterId: character.id }] },
      },
    });
    const memory = await prisma.memory.create({ data: { content: "Memória E2E" } });
    await prisma.memoryCharacter.create({ data: { memoryId: memory.id, characterId: character.id } });

    const preview = await previewCorrection(fixture.universeId, CORRECTIONS.leaderOut(fixture));
    expect(preview.narrativeStaleEventIds).toContain(event.id);
    await applyCorrection(fixture.universeId, CORRECTIONS.leaderOut(fixture), preview.previewToken);

    const eventAfter = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(eventAfter.title).toBe("Narrativa E2E");
    expect(await prisma.memory.findUniqueOrThrow({ where: { id: memory.id } })).toMatchObject({ content: "Memória E2E" });

    await prisma.timelineEvent.create({
      data: {
        universeId: fixture.universeId,
        sequence: 900,
        worldDate: fixture.worldDate,
        kind: "ATTRIBUTE_EVOLVED",
        payload: { seasonId: fixture.seasonId, fingerprint: "fp-e2e" },
        causedBy: "USER",
      },
    });
    const blocked = await previewCorrection(fixture.universeId, {
      ...CORRECTIONS.leaderBack(fixture),
    }).catch((error: unknown) => error);
    expect(blocked).toMatchObject({ code: "EVOLUTION_STALE", statusCode: 409 });
    expect(String(blocked)).not.toContain("SELECT");

    await prisma.eventCharacter.deleteMany({ where: { characterId: character.id } });
    await prisma.memory.deleteMany({ where: { id: memory.id } });
    await prisma.event.deleteMany({ where: { id: event.id } });
    await prisma.timelineEvent.deleteMany({ where: { universeId: fixture.universeId, kind: "ATTRIBUTE_EVOLVED" } });
    await prisma.character.deleteMany({ where: { id: character.id } });
  });
});

describe("V3.15 E2E — divergence e isolamento", () => {
  it("7) divergência externa é leitura pura; correção não toca o External Mirror", async () => {
    const externalBefore = await prisma.externalDriver.count();
    const report = await buildDivergenceReport(fixture.universeId, fixture.seasonId);
    expect(report.season.year).toBe(2100);
    expect(report.races.every((race) => race.classification === "UNIVERSE_ONLY")).toBe(true);
    expect(report.summary.universeOnly).toBeGreaterThan(0);
    expect(await prisma.externalDriver.count()).toBe(externalBefore);
  });

  it("8) universos isolados: correção em A não afeta B", async () => {
    const standingsOtherBefore = await prisma.championshipStanding.findMany({
      where: { seasonId: other.seasonId },
      orderBy: { driverProfileId: "asc" },
    });
    const preview = await previewCorrection(other.universeId, CORRECTIONS.leaderOut(other));
    await applyCorrection(other.universeId, CORRECTIONS.leaderOut(other), preview.previewToken);

    const fixtureResult = await prisma.raceResult.findFirstOrThrow({
      where: { raceId: fixture.raceId, driverProfileId: fixture.driver2Id },
    });
    expect(fixtureResult.position).toBe(4);

    const otherStandings = await prisma.championshipStanding.findMany({
      where: { seasonId: other.seasonId },
      orderBy: { driverProfileId: "asc" },
    });
    expect(otherStandings.find((standing) => standing.driverProfileId === other.driver1Id)!.position).toBe(1);
    expect(standingsOtherBefore).toHaveLength(otherStandings.length);
  });
});
