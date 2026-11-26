import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import { runAutonomousTick, updateAutonomy } from "../autonomy/autonomy.service.js";
import {
  getDecisionTrace,
  getSimulationTrace,
  getUniverseActivity,
  getUniverseMetrics,
} from "./observability.service.js";

const PREFIX = "v4-e2e";
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];

let universeId: string;
let seasonId: string;
let raceId: string;
let aiCharacterId: string;
let secondAiCharacterId: string;
let userCharacterId: string;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `${PREFIX}-${Date.now()}@f1nw.test`, name: "V4 Owner" },
  });
  createdUserIds.push(user.id);
  const universe = await prisma.universe.create({ data: { userId: user.id, status: "READY" } });
  createdUniverseIds.push(universe.id);
  universeId = universe.id;
  const season = await prisma.season.create({
    data: { universeId, year: 2026, status: "ACTIVE" },
  });
  seasonId = season.id;
  await prisma.worldState.create({
    data: {
      universeId,
      key: "default",
      currentDate: new Date("2026-10-05T00:00:00.000Z"),
      currentSeasonId: seasonId,
    },
  });
  const race = await prisma.race.create({
    data: {
      seasonId,
      name: `${PREFIX}-gp`,
      round: 1,
      status: "FINISHED",
      date: new Date("2026-10-04T00:00:00.000Z"),
    },
  });
  raceId = race.id;
  await prisma.universe.update({
    where: { id: universeId },
    data: { lastSimulationAt: new Date("2026-10-03T00:00:00.000Z") },
  });

  const ai = await prisma.character.create({
    data: {
      universeId,
      userId: user.id,
      controlledBy: "AI",
      name: `${PREFIX}-ai`,
      nationality: "BR",
      birthDate: new Date("1998-02-15T00:00:00.000Z"),
      driverProfile: { create: { number: 1 } },
      availability: { create: { status: "AVAILABLE" } },
    },
  });
  const second = await prisma.character.create({
    data: {
      universeId,
      userId: user.id,
      controlledBy: "AI",
      name: `${PREFIX}-ai-2`,
      nationality: "BR",
      birthDate: new Date("1998-02-15T00:00:00.000Z"),
      driverProfile: { create: { number: 2 } },
      availability: { create: { status: "AVAILABLE" } },
    },
  });
  const userChar = await prisma.character.create({
    data: {
      universeId,
      userId: user.id,
      controlledBy: "USER",
      name: `${PREFIX}-user`,
      nationality: "BR",
      birthDate: new Date("1998-02-15T00:00:00.000Z"),
      driverProfile: { create: { number: 3 } },
      availability: { create: { status: "AVAILABLE" } },
    },
  });
  aiCharacterId = ai.id;
  secondAiCharacterId = second.id;
  userCharacterId = userChar.id;

  const [pairA, pairB] = [ai.id, second.id].sort();
  await prisma.relationship.create({
    data: { characterAId: pairA as string, characterBId: pairB as string, dimensions: { rivalry: 0.4 } },
  });
  const profiles = await prisma.driverProfile.findMany({
    where: { characterId: { in: [ai.id, second.id, userChar.id] } },
    select: { id: true, characterId: true },
  });
  const byCharacter = new Map(profiles.map((profile) => [profile.characterId, profile.id]));
  await prisma.raceResult.createMany({
    data: [
      { raceId, driverProfileId: byCharacter.get(ai.id) as string, position: 1, points: 25, status: "FINISHED" },
      { raceId, driverProfileId: byCharacter.get(second.id) as string, position: 2, points: 18, status: "FINISHED" },
      { raceId, driverProfileId: byCharacter.get(userChar.id) as string, position: 3, points: 15, status: "FINISHED" },
    ],
  });
  await prisma.championshipStanding.createMany({
    data: [
      { seasonId, driverProfileId: byCharacter.get(ai.id) as string, position: 1, points: 25 },
      { seasonId, driverProfileId: byCharacter.get(second.id) as string, position: 2, points: 18 },
      { seasonId, driverProfileId: byCharacter.get(userChar.id) as string, position: 3, points: 15 },
    ],
  });
  await prisma.characterSchedule.create({
    data: {
      characterId: ai.id,
      activity: "coletiva de imprensa",
      startsAt: new Date("2026-10-05T09:00:00.000Z"),
    },
  });
});

afterAll(async () => {
  await prisma.simulationTick.deleteMany({ where: { universeId } });
  await prisma.aiDecision.deleteMany({ where: { universeId } });
  await prisma.characterGoal.deleteMany({ where: { universeId } });
  await prisma.memoryCharacter.deleteMany({
    where: { characterId: { in: createdCharacterIds } },
  });
  await prisma.memory.deleteMany({ where: { participants: { none: {} }, universeId } });
  await prisma.pilotExperience.deleteMany({
    where: { characterId: { in: createdCharacterIds } },
  });
  await prisma.relationshipChange.deleteMany({
    where: {
      OR: [
        { characterAId: { in: createdCharacterIds } },
        { characterBId: { in: createdCharacterIds } },
      ],
    },
  });
  const events = await prisma.event.findMany({
    where: { title: { startsWith: PREFIX } },
    select: { id: true },
  });
  if (events.length > 0) {
    const eventIds = events.map((event) => event.id);
    await prisma.newsItem.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventCharacter.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  }
  await prisma.relationship.deleteMany({
    where: {
      OR: [
        { characterAId: { in: createdCharacterIds } },
        { characterBId: { in: createdCharacterIds } },
      ],
    },
  });
  await prisma.raceResult.deleteMany({ where: { raceId } });
  await prisma.championshipStanding.deleteMany({ where: { seasonId } });
  await prisma.race.deleteMany({ where: { id: raceId } });
  await prisma.season.deleteMany({ where: { id: seasonId } });
  if (createdCharacterIds.length > 0) {
    await prisma.characterAvailability.deleteMany({
      where: { characterId: { in: createdCharacterIds } },
    });
    await prisma.characterSchedule.deleteMany({
      where: { characterId: { in: createdCharacterIds } },
    });
    await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  }
  if (createdUniverseIds.length > 0) {
    await prisma.worldState.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
    await prisma.universe.deleteMany({ where: { id: { in: createdUniverseIds } } });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

describe("V4 end-to-end loop", () => {
  it("1) race weekend → consequences → decisions → traces → metrics", async () => {
    await updateAutonomy(universeId, { mode: "FULL", status: "ACTIVE" });
    const tick = await runAutonomousTick({
      universeId,
      toDate: new Date("2026-10-06T00:00:00.000Z"),
    });
    expect(tick.status).toBe("EXECUTED");
    expect(tick.decisionsEvaluated).toBeGreaterThanOrEqual(1);

    const experiences = await prisma.pilotExperience.count({ where: { universeId } });
    expect(experiences).toBeGreaterThanOrEqual(1);
    const memories = await prisma.memory.count({ where: { universeId } });
    expect(memories).toBeGreaterThanOrEqual(1);

    const trace = await getSimulationTrace(tick.tickId as string);
    expect(trace.tick.status).toBe("COMPLETED");
    expect(trace.events.length).toBeGreaterThanOrEqual(1);

    const metrics = await getUniverseMetrics(universeId);
    expect(metrics.decisions.total).toBeGreaterThanOrEqual(1);
    expect(metrics.experiences).toBeGreaterThanOrEqual(1);
    expect(metrics.memories).toBeGreaterThanOrEqual(1);

    const activity = await getUniverseActivity(universeId);
    expect(activity.ticks.length).toBeGreaterThanOrEqual(1);
    expect(activity.decisions.length).toBeGreaterThanOrEqual(1);

    const worldState = await prisma.worldState.findUniqueOrThrow({
      where: { universeId_key: { universeId, key: "default" } },
    });
    expect(worldState.currentDate.toISOString()).toBe("2026-10-05T00:00:00.000Z");
    const result = await prisma.raceResult.findFirstOrThrow({ where: { raceId, position: 1 } });
    expect(result.position).toBe(1);
  });

  it("2) decisão tem trace explicável e sanitizado", async () => {
    const decision = await prisma.aiDecision.findFirstOrThrow({
      where: { universeId },
      orderBy: { createdAt: "desc" },
    });
    const trace = await getDecisionTrace(decision.id);
    expect(trace.trace.fingerprint).not.toBeNull();
    expect(trace.trace.llmUsed).toBe(false);
    expect(Array.isArray(trace.trace.candidates)).toBe(true);
    expect(trace.trace.selected).not.toBeNull();
  });

  it("3) segundo tick é reutilizado (sem duplicar efeitos)", async () => {
    const decisionsBefore = await prisma.aiDecision.count({ where: { universeId } });
    const memoriesBefore = await prisma.memory.count({ where: { universeId } });
    const tick = await runAutonomousTick({
      universeId,
      toDate: new Date("2026-10-06T00:00:00.000Z"),
    });
    expect(["REUSED"]).toContain(tick.status);
    expect(await prisma.aiDecision.count({ where: { universeId } })).toBe(decisionsBefore);
    expect(await prisma.memory.count({ where: { universeId } })).toBe(memoriesBefore);
  });

  it("4) USER character permanece fora das decisões autônomas", async () => {
    const decisions = await prisma.aiDecision.findMany({
      where: { universeId },
      select: { characterId: true },
    });
    expect(decisions.every((decision) => decision.characterId !== userCharacterId)).toBe(true);
    expect(
      decisions.some(
        (decision) =>
          decision.characterId === aiCharacterId ||
          decision.characterId === secondAiCharacterId,
      ),
    ).toBe(true);
  });
});
