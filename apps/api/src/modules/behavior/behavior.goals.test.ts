import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import { buildBehaviorContext } from "./behavior.context.js";
import {
  deriveGoalCandidates,
  goalFingerprint,
  reconcileCharacterGoals,
} from "./behavior.goals.js";
import type { BehaviorDecisionRequest } from "./behavior.types.js";

const PREFIX = "behavior-goals";
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdSeasonIds: string[] = [];
const createdRaceIds: string[] = [];

let universeId: string;
let seasonId: string;
let aiCharacterId: string;
let rivalCharacterId: string;
let teammateCharacterId: string;

async function createCharacter(input: {
  label: string;
  controller: "AI" | "USER";
  withDriverProfile?: boolean;
  number?: number;
}) {
  const character = await prisma.character.create({
    data: {
      universeId,
      controlledBy: input.controller,
      name: `${PREFIX}-${input.label}`,
      nationality: "BR",
      birthDate: new Date("1998-02-15T00:00:00.000Z"),
      ...(input.withDriverProfile
        ? { driverProfile: { create: { number: input.number ?? 1 } } }
        : {}),
    },
  });
  createdCharacterIds.push(character.id);
  return character;
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `${PREFIX}-${Date.now()}@f1nw.test`, name: "Goals Owner" },
  });
  createdUserIds.push(user.id);
  const universe = await prisma.universe.create({ data: { userId: user.id, status: "READY" } });
  createdUniverseIds.push(universe.id);
  universeId = universe.id;

  const season = await prisma.season.create({
    data: { universeId, year: 2026, status: "ACTIVE" },
  });
  seasonId = season.id;
  createdSeasonIds.push(season.id);

  const team = await prisma.team.create({
    data: { universeId, userId: user.id, name: `${PREFIX}-team` },
  });

  const ai = await createCharacter({ label: "ai", controller: "AI", withDriverProfile: true, number: 1 });
  const teammate = await createCharacter({
    label: "teammate",
    controller: "AI",
    withDriverProfile: true,
    number: 2,
  });
  const rival = await createCharacter({ label: "rival", controller: "AI", withDriverProfile: true, number: 3 });
  aiCharacterId = ai.id;
  teammateCharacterId = teammate.id;
  rivalCharacterId = rival.id;

  await prisma.driverProfile.update({
    where: { characterId: ai.id },
    data: { teamId: team.id },
  });
  await prisma.driverProfile.update({
    where: { characterId: teammate.id },
    data: { teamId: team.id },
  });

  const race = await prisma.race.create({
    data: { seasonId, name: `${PREFIX}-race`, round: 1, status: "RACE", date: new Date("2026-10-01T00:00:00.000Z") },
  });
  createdRaceIds.push(race.id);

  await prisma.worldState.create({
    data: {
      universeId,
      key: "default",
      currentDate: new Date("2026-10-01T00:00:00.000Z"),
      currentSeasonId: seasonId,
      currentRaceId: race.id,
      currentSession: "RACE",
    },
  });

  await prisma.relationship.create({
    data: {
      characterAId: ai.id,
      characterBId: rival.id,
      dimensions: { rivalry: 0.8, respect: 0.7 },
    },
  });
});

afterAll(async () => {
  await prisma.characterGoal.deleteMany({ where: { universeId } });
  await prisma.aiDecision.deleteMany({ where: { universeId } });
  if (createdCharacterIds.length > 0) {
    await prisma.relationship.deleteMany({
      where: {
        OR: [
          { characterAId: { in: createdCharacterIds } },
          { characterBId: { in: createdCharacterIds } },
        ],
      },
    });
    await prisma.memoryCharacter.deleteMany({
      where: { characterId: { in: createdCharacterIds } },
    });
    await prisma.memory.deleteMany({ where: { participants: { none: {} }, universeId } });
    await prisma.pilotExperience.deleteMany({
      where: { characterId: { in: createdCharacterIds } },
    });
    await prisma.championshipStanding.deleteMany({
      where: { driverProfile: { characterId: { in: createdCharacterIds } } },
    });
    await prisma.raceResult.deleteMany({
      where: { driverProfile: { characterId: { in: createdCharacterIds } } },
    });
    await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  }
  if (createdRaceIds.length > 0) {
    await prisma.race.deleteMany({ where: { id: { in: createdRaceIds } } });
  }
  if (createdSeasonIds.length > 0) {
    await prisma.season.deleteMany({ where: { id: { in: createdSeasonIds } } });
  }
  if (createdUniverseIds.length > 0) {
    await prisma.team.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
    await prisma.worldState.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
    await prisma.universe.deleteMany({ where: { id: { in: createdUniverseIds } } });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

function request(overrides: Partial<BehaviorDecisionRequest> = {}): BehaviorDecisionRequest {
  return {
    universeId,
    characterId: aiCharacterId,
    trigger: "AUTONOMOUS_TICK",
    worldDate: new Date("2026-10-01T00:00:00.000Z"),
    userInitiated: false,
    ...overrides,
  };
}

async function seedStanding(characterId: string, position: number, points: number) {
  const profile = await prisma.driverProfile.findUniqueOrThrow({ where: { characterId } });
  return prisma.championshipStanding.upsert({
    where: { seasonId_driverProfileId: { seasonId, driverProfileId: profile.id } },
    create: { seasonId, driverProfileId: profile.id, position, points },
    update: { position, points },
  });
}

async function seedSetback(characterId: string) {
  return prisma.pilotExperience.create({
    data: {
      universeId,
      characterId,
      experienceType: "SPORTING_DEFEAT",
      source: "RACE_RESULT",
      sourceKey: `${PREFIX}-setback-${Date.now()}`,
      title: "Derrota na última volta",
      salience: "HIGH",
      status: "ACTIVE",
      occurredAt: new Date("2026-09-30T00:00:00.000Z"),
    },
  });
}

describe("goal derivation and reconciliation (V4.1)", () => {
  it("1) corrida ativa deriva WIN_RACE com ruleCode determinístico", async () => {
    const context = await buildBehaviorContext(request());
    const derivations = deriveGoalCandidates(context, request());
    const winRace = derivations.find((derivation) => derivation.kind === "WIN_RACE");
    expect(winRace).toBeDefined();
    expect(winRace?.ruleCode).toBe("goal-rule.race-win.v1");
    expect(winRace?.priority).toBe(100);
    expect(winRace?.targetRaceId).not.toBeNull();
  });

  it("2) setback significativo deriva RECOVER_AFTER_SETBACK", async () => {
    await seedSetback(aiCharacterId);
    const context = await buildBehaviorContext(request());
    const derivations = deriveGoalCandidates(context, request());
    expect(derivations.map((derivation) => derivation.kind)).toContain("RECOVER_AFTER_SETBACK");
  });

  it("3) teammate à frente deriva OUTPERFORM_TEAMMATE", async () => {
    await seedStanding(aiCharacterId, 5, 100);
    await seedStanding(teammateCharacterId, 2, 150);
    const context = await buildBehaviorContext(request());
    const derivations = deriveGoalCandidates(context, request());
    const goal = derivations.find((derivation) => derivation.kind === "OUTPERFORM_TEAMMATE");
    expect(goal?.targetCharacterId).toBe(teammateCharacterId);
  });

  it("4) rivalidade alta deriva PROTECT_RELATIONSHIP para o rival", async () => {
    const context = await buildBehaviorContext(request());
    const derivations = deriveGoalCandidates(context, request());
    const goal = derivations.find((derivation) => derivation.kind === "PROTECT_RELATIONSHIP");
    expect(goal?.targetCharacterId).toBe(rivalCharacterId);
  });

  it("5) reconcile é idempotente e persiste goals derivados", async () => {
    const context = await buildBehaviorContext(request());
    const first = await reconcileCharacterGoals(context, request());
    expect(first.created).toBeGreaterThanOrEqual(3);
    const second = await reconcileCharacterGoals(context, request());
    expect(second.created).toBe(0);
    const persisted = await prisma.characterGoal.findMany({
      where: { universeId, characterId: aiCharacterId, source: "DERIVED" },
    });
    expect(persisted.length).toBe(first.goals.filter((goal) => goal.source === "DERIVED").length);
  });

  it("6) goal MANUAL prevalece sobre derivação conflitante", async () => {
    await prisma.characterGoal.create({
      data: {
        universeId,
        characterId: aiCharacterId,
        kind: "WIN_RACE",
        priority: 99,
        status: "ACTIVE",
        source: "MANUAL",
        targetRaceId: null,
      },
    });
    const context = await buildBehaviorContext(request());
    const report = await reconcileCharacterGoals(context, request());
    expect(report.manualConflicts).toBeGreaterThanOrEqual(1);
    const manual = await prisma.characterGoal.count({
      where: { universeId, characterId: aiCharacterId, kind: "WIN_RACE", source: "MANUAL" },
    });
    expect(manual).toBe(1);
  });

  it("7) goal derivado com validade vencida expira", async () => {
    await prisma.characterGoal.create({
      data: {
        universeId,
        characterId: aiCharacterId,
        kind: "BUILD_REPUTATION",
        priority: 40,
        status: "ACTIVE",
        source: "DERIVED",
        ruleCode: "goal-rule.test.v1",
        fingerprint: "expired-test-fingerprint",
        validTo: new Date("2026-09-01T00:00:00.000Z"),
      },
    });
    const context = await buildBehaviorContext(request());
    const report = await reconcileCharacterGoals(context, request());
    expect(report.expired).toBeGreaterThanOrEqual(1);
    const expired = await prisma.characterGoal.findFirstOrThrow({
      where: { fingerprint: "expired-test-fingerprint" },
    });
    expect(expired.status).toBe("EXPIRED");
  });

  it("8) RECOVER_AFTER_SETBACK completa quando não há mais setback ativo", async () => {
    await prisma.pilotExperience.updateMany({
      where: { characterId: aiCharacterId, experienceType: "SPORTING_DEFEAT" },
      data: { status: "INVALIDATED" },
    });
    const context = await buildBehaviorContext(request());
    const report = await reconcileCharacterGoals(context, request());
    expect(report.completed).toBeGreaterThanOrEqual(1);
    const completed = await prisma.characterGoal.findFirst({
      where: { characterId: aiCharacterId, kind: "RECOVER_AFTER_SETBACK", status: "COMPLETED" },
    });
    expect(completed).not.toBeNull();
  });

  it("9) WIN_RACE completa quando a corrida termina com vitória", async () => {
    const race = await prisma.race.findFirstOrThrow({ where: { seasonId } });
    await prisma.race.update({ where: { id: race.id }, data: { status: "FINISHED" } });
    const profile = await prisma.driverProfile.findUniqueOrThrow({
      where: { characterId: aiCharacterId },
    });
    await prisma.raceResult.create({
      data: { raceId: race.id, driverProfileId: profile.id, position: 1, points: 25 },
    });
    const context = await buildBehaviorContext(request());
    const report = await reconcileCharacterGoals(context, request());
    expect(report.completed).toBeGreaterThanOrEqual(1);
    const completed = await prisma.characterGoal.findFirst({
      where: { characterId: aiCharacterId, kind: "WIN_RACE", status: "COMPLETED" },
    });
    expect(completed).not.toBeNull();
  });

  it("10) goalFingerprint é estável e sensível ao alvo", () => {
    const base = {
      universeId,
      characterId: aiCharacterId,
      kind: "PROTECT_RELATIONSHIP" as const,
      targetCharacterId: rivalCharacterId,
      targetRaceId: null,
      seasonId,
      ruleCode: "goal-rule.protect-relationship.v1",
      validTo: null,
    };
    const first = goalFingerprint(base);
    const second = goalFingerprint(base);
    const changed = goalFingerprint({ ...base, targetCharacterId: teammateCharacterId });
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(changed).not.toBe(first);
  });
});
