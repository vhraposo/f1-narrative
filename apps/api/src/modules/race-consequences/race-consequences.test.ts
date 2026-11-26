import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import {
  invalidateRaceConsequences,
  processRaceConsequences,
  RaceConsequencesError,
} from "./race-consequences.service.js";
import { runSimulationTick } from "../world-simulation/world-simulation.tick.js";

const PREFIX = "race-consequences";
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];

let universeId: string;
let seasonId: string;
let raceId: string;
let winnerCharacterId: string;
let loserCharacterId: string;

async function createPilot(label: string, number: number) {
  const character = await prisma.character.create({
    data: {
      universeId,
      controlledBy: "AI",
      name: `${PREFIX}-${label}`,
      nationality: "BR",
      birthDate: new Date("1998-02-15T00:00:00.000Z"),
      driverProfile: { create: { number } },
    },
  });
  createdCharacterIds.push(character.id);
  return character;
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `${PREFIX}-${Date.now()}@f1nw.test`, name: "Race Owner" },
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

  const winner = await createPilot("winner", 1);
  const loser = await createPilot("loser", 2);
  winnerCharacterId = winner.id;
  loserCharacterId = loser.id;
  const winnerProfile = await prisma.driverProfile.findUniqueOrThrow({
    where: { characterId: winner.id },
  });
  const loserProfile = await prisma.driverProfile.findUniqueOrThrow({
    where: { characterId: loser.id },
  });
  await prisma.raceResult.createMany({
    data: [
      { raceId, driverProfileId: winnerProfile.id, position: 1, points: 25, status: "FINISHED" },
      { raceId, driverProfileId: loserProfile.id, position: 2, points: 18, status: "FINISHED" },
    ],
  });
  await prisma.championshipStanding.createMany({
    data: [
      { seasonId, driverProfileId: winnerProfile.id, position: 1, points: 25 },
      { seasonId, driverProfileId: loserProfile.id, position: 2, points: 18 },
    ],
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
  await prisma.raceResult.deleteMany({ where: { raceId } });
  await prisma.championshipStanding.deleteMany({ where: { seasonId } });
  await prisma.race.deleteMany({ where: { id: raceId } });
  await prisma.season.deleteMany({ where: { id: seasonId } });
  if (createdCharacterIds.length > 0) {
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

describe("race weekend consequences (V4.6)", () => {
  it("1) processa consequências: experience, memory e behavior audit", async () => {
    const result = await processRaceConsequences({ universeId, raceId });
    expect(result.canonicalUntouched).toBe(true);
    expect(result.characters.length).toBe(2);
    const winner = result.characters.find((entry) => entry.characterId === winnerCharacterId);
    const loser = result.characters.find((entry) => entry.characterId === loserCharacterId);
    expect(winner?.position).toBe(1);
    expect(loser?.position).toBe(2);
    expect(winner?.experiences.created).toBeGreaterThanOrEqual(1);
    expect(winner?.memories.created).toBeGreaterThanOrEqual(1);
    expect(winner?.decisionCreated).toBe(true);

    const resultRow = await prisma.raceResult.findFirstOrThrow({
      where: { raceId, position: 1 },
      select: { driverProfileId: true, position: true },
    });
    expect(resultRow.position).toBe(1);
    const decisions = await prisma.aiDecision.count({
      where: {
        universeId,
        metadata: { path: ["requestPayload", "raceId"], equals: raceId },
      },
    });
    expect(decisions).toBe(2);
  });

  it("2) reprocessar é idempotente (sem novas experiences/memories/decisions)", async () => {
    const experiencesBefore = await prisma.pilotExperience.count({
      where: { characterId: { in: createdCharacterIds } },
    });
    const memoriesBefore = await prisma.memory.count({ where: { universeId } });
    const decisionsBefore = await prisma.aiDecision.count({ where: { universeId } });
    const result = await processRaceConsequences({ universeId, raceId });
    expect(result.characters.every((entry) => entry.experiences.created === 0)).toBe(true);
    expect(result.characters.every((entry) => entry.memories.created === 0)).toBe(true);
    expect(result.characters.every((entry) => entry.decisionCreated === false)).toBe(true);
    expect(
      await prisma.pilotExperience.count({ where: { characterId: { in: createdCharacterIds } } }),
    ).toBe(experiencesBefore);
    expect(await prisma.memory.count({ where: { universeId } })).toBe(memoriesBefore);
    expect(await prisma.aiDecision.count({ where: { universeId } })).toBe(decisionsBefore);
  });

  it("3) correção invalida consequences e permite recomputar", async () => {
    const invalidation = await invalidateRaceConsequences({
      universeId,
      raceId,
      reason: "resultado corrigido",
    });
    expect(invalidation.experiencesInvalidated).toBeGreaterThanOrEqual(1);
    expect(invalidation.memoriesInvalidated).toBeGreaterThanOrEqual(1);
    const invalidated = await prisma.pilotExperience.count({
      where: { characterId: { in: createdCharacterIds }, status: "INVALIDATED" },
    });
    expect(invalidated).toBeGreaterThanOrEqual(1);

    const recomputed = await processRaceConsequences({ universeId, raceId });
    const reactivated = recomputed.characters.reduce(
      (total, entry) =>
        total + entry.experiences.created + entry.experiences.updated + entry.experiences.reactivated,
      0,
    );
    expect(reactivated).toBeGreaterThanOrEqual(1);
  });

  it("4) corrida de outro Universe é rejeitada", async () => {
    await expect(
      processRaceConsequences({
        universeId: "00000000-0000-0000-0000-000000000000",
        raceId,
      }),
    ).rejects.toBeInstanceOf(RaceConsequencesError);
  });

  it("5) corrida não finalizada é rejeitada", async () => {
    await prisma.race.update({ where: { id: raceId }, data: { status: "RACE" } });
    await expect(processRaceConsequences({ universeId, raceId })).rejects.toMatchObject({
      code: "RACE_NOT_FINISHED",
    });
    await prisma.race.update({ where: { id: raceId }, data: { status: "FINISHED" } });
  });

  it("6) simulation tick processa corridas da janela", async () => {
    const tick = await runSimulationTick({
      universeId,
      fromDate: new Date("2026-10-03T00:00:00.000Z"),
      toDate: new Date("2026-10-06T00:00:00.000Z"),
    });
    expect(tick.summary?.racesDue).toBeGreaterThanOrEqual(1);
    expect(tick.summary?.racesProcessed).toBeGreaterThanOrEqual(1);
    expect(tick.summary?.raceDecisionsCreated).toBeGreaterThanOrEqual(0);

    const dry = await runSimulationTick({
      universeId,
      fromDate: new Date("2026-10-02T00:00:00.000Z"),
      toDate: new Date("2026-10-06T00:00:00.000Z"),
      dryRun: true,
    });
    expect(dry.summary?.racesDue).toBeGreaterThanOrEqual(1);
    expect(dry.summary?.racesProcessed).toBe(0);
  });
});
