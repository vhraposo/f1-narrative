import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import { evaluateBehaviorDecision } from "./behavior.decision.js";
import { executeBehaviorDecision } from "./behavior.execution.js";
import type { BehaviorDecisionRequest } from "./behavior.types.js";

const PREFIX = "behavior-exec";
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];

let universeId: string;
let secondUniverseId: string;
let seasonId: string;
let aiCharacterId: string;
let rivalCharacterId: string;
let userCharacterId: string;
let conversationId: string;

async function createCharacter(input: {
  label: string;
  controller: "AI" | "USER";
  withDriverProfile?: boolean;
  universe?: string;
}) {
  const character = await prisma.character.create({
    data: {
      universeId: input.universe ?? universeId,
      controlledBy: input.controller,
      name: `${PREFIX}-${input.label}`,
      nationality: "BR",
      birthDate: new Date("1998-02-15T00:00:00.000Z"),
      ...(input.withDriverProfile ? { driverProfile: { create: { number: 1 } } } : {}),
    },
  });
  createdCharacterIds.push(character.id);
  return character;
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `${PREFIX}-${Date.now()}@f1nw.test`, name: "Exec Owner" },
  });
  createdUserIds.push(user.id);
  const universe = await prisma.universe.create({ data: { userId: user.id, status: "READY" } });
  createdUniverseIds.push(universe.id);
  universeId = universe.id;
  const secondUser = await prisma.user.create({
    data: { email: `${PREFIX}-b-${Date.now()}@f1nw.test`, name: "Exec Owner B" },
  });
  createdUserIds.push(secondUser.id);
  const secondUniverse = await prisma.universe.create({
    data: { userId: secondUser.id, status: "READY" },
  });
  createdUniverseIds.push(secondUniverse.id);
  secondUniverseId = secondUniverse.id;

  const season = await prisma.season.create({
    data: { universeId, year: 2026, status: "ACTIVE" },
  });
  seasonId = season.id;
  const race = await prisma.race.create({
    data: {
      seasonId,
      name: `${PREFIX}-race`,
      round: 1,
      status: "RACE",
      date: new Date("2026-10-01T00:00:00.000Z"),
    },
  });
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

  const team = await prisma.team.create({
    data: { universeId, userId: user.id, name: `${PREFIX}-team` },
  });
  const ai = await createCharacter({ label: "ai", controller: "AI", withDriverProfile: true });
  const rival = await createCharacter({ label: "rival", controller: "AI", withDriverProfile: true });
  const userChar = await createCharacter({ label: "user", controller: "USER" });
  aiCharacterId = ai.id;
  rivalCharacterId = rival.id;
  userCharacterId = userChar.id;
  await prisma.driverProfile.update({ where: { characterId: ai.id }, data: { teamId: team.id } });
  await prisma.characterAvailability.create({
    data: { characterId: ai.id, status: "AVAILABLE" },
  });
  await prisma.relationship.create({
    data: {
      characterAId: ai.id,
      characterBId: rival.id,
      dimensions: { rivalry: 0.6, respect: 0.5 },
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      type: "DM",
      participants: { create: [{ characterId: ai.id }, { characterId: rival.id }] },
      messages: {
        create: [{ senderType: "AI_CHARACTER", characterId: rival.id, content: "Boa corrida." }],
      },
    },
  });
  conversationId = conversation.id;
});

afterAll(async () => {
  await prisma.characterGoal.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
  await prisma.aiDecision.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
  if (conversationId) {
    await prisma.message.deleteMany({ where: { conversationId } });
    await prisma.conversationParticipant.deleteMany({ where: { conversationId } });
    await prisma.conversation.deleteMany({ where: { id: conversationId } });
  }
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
    await prisma.memory.deleteMany({ where: { participants: { none: {} } } });
    await prisma.pilotExperience.deleteMany({
      where: { characterId: { in: createdCharacterIds } },
    });
    await prisma.characterAvailability.deleteMany({
      where: { characterId: { in: createdCharacterIds } },
    });
    await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  }
  if (seasonId) await prisma.race.deleteMany({ where: { seasonId } });
  if (seasonId) await prisma.season.deleteMany({ where: { id: seasonId } });
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
    trigger: "RACE_SESSION_COMPLETED",
    worldDate: new Date("2026-10-01T00:00:00.000Z"),
    conversationId,
    userInitiated: false,
    metadata: { targetCharacterId: rivalCharacterId },
    ...overrides,
  };
}

describe("behavior commands and execution (V4.1)", () => {
  it("1) golden: P2 atrás do rival seleciona SEND_MESSAGE com goal alignment e executa", async () => {
    const result = await evaluateBehaviorDecision(request());
    expect(result.selected.actionType).toBe("SEND_MESSAGE");
    expect(result.selected.targetCharacterId).toBe(rivalCharacterId);
    expect(result.selected.goalIds.length).toBeGreaterThanOrEqual(1);
    expect(result.selected.scoreBreakdown.total).toBe(result.selected.score);
    expect(result.actionFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.llmUsed).toBe(false);

    const execution = await executeBehaviorDecision(result.decisionId);
    expect(execution.status).toBe("EXECUTED");
    expect(execution.executedMessageId).not.toBeNull();

    const message = await prisma.message.findUniqueOrThrow({
      where: { id: execution.executedMessageId as string },
    });
    expect(message.conversationId).toBe(conversationId);
    expect(message.senderType).toBe("AI_CHARACTER");
    expect(message.characterId).toBe(aiCharacterId);

    const decision = await prisma.aiDecision.findUniqueOrThrow({
      where: { id: result.decisionId },
    });
    expect(decision.status).toBe("EXECUTED");
    expect(decision.executedMessageId).toBe(execution.executedMessageId);
    const metadata = decision.metadata as Record<string, unknown>;
    expect((metadata.execution as Record<string, unknown>).command).toBe("SEND_MESSAGE");
  });

  it("2) mesma decisão executada duas vezes é idempotente", async () => {
    await prisma.pilotExperience.create({
      data: {
        universeId,
        characterId: aiCharacterId,
        experienceType: "SPORTING_DEFEAT",
        source: "RACE_RESULT",
        sourceKey: `${PREFIX}-memory`,
        title: "Derrota",
        salience: "HIGH",
        status: "ACTIVE",
        occurredAt: new Date("2026-09-30T00:00:00.000Z"),
      },
    });
    const result = await evaluateBehaviorDecision(
      request({ trigger: "MEMORY_CREATED", conversationId: null }),
    );
    expect(result.selected.actionType).toBe("CREATE_MEMORY");
    const first = await executeBehaviorDecision(result.decisionId);
    expect(first.status).toBe("EXECUTED");
    const second = await executeBehaviorDecision(result.decisionId);
    expect(second.status).toBe("ALREADY_EXECUTED");
    const memories = await prisma.memory.count({
      where: { universeId, derivedKey: result.actionFingerprint },
    });
    expect(memories).toBe(1);
  });

  it("3) cooldown rejeita repetição da mesma ação/alvo no mesmo bucket", async () => {
    const result = await evaluateBehaviorDecision(request());
    expect(result.selected.actionType).not.toBe("SEND_MESSAGE");
    const send = result.candidates.find((candidate) => candidate.actionType === "SEND_MESSAGE");
    expect(send?.failedPreconditions).toContain("COOLDOWN_CLEAR");
    expect(send?.failedPreconditions.length).toBeGreaterThan(0);
    const execution = await executeBehaviorDecision(result.decisionId);
    expect(execution.status).toBe("REJECTED");
  });

  it("4) decisão stale não executa", async () => {
    const result = await evaluateBehaviorDecision(
      request({
        trigger: "MESSAGE_RECEIVED",
        userInitiated: true,
        conversationId,
      }),
    );
    expect(result.selected.actionType).toBe("RESPOND");
    await prisma.characterAvailability.update({
      where: { characterId: aiCharacterId },
      data: { status: "OFFLINE" },
    });
    const execution = await executeBehaviorDecision(result.decisionId);
    expect(execution.status).toBe("REJECTED");
    expect(execution.errorCode).toBe("STALE_CONTEXT");
    const decision = await prisma.aiDecision.findUniqueOrThrow({
      where: { id: result.decisionId },
    });
    expect(decision.status).toBe("REJECTED");
    await prisma.characterAvailability.update({
      where: { characterId: aiCharacterId },
      data: { status: "AVAILABLE" },
    });
  });

  it("5) character USER em trigger autônomo não executa nada", async () => {
    const result = await evaluateBehaviorDecision(
      request({
        characterId: userCharacterId,
        trigger: "AUTONOMOUS_TICK",
        conversationId,
        userInitiated: false,
        metadata: { targetCharacterId: rivalCharacterId },
      }),
    );
    expect(result.status).toBe("NO_ACTION");
    expect(result.selected.actionType).toBe("NO_ACTION");
    const execution = await executeBehaviorDecision(result.decisionId);
    expect(execution.status).toBe("REJECTED");
    expect(execution.errorCode).toBe("DECISION_NOT_EXECUTABLE");
  });

  it("6) scoring determinístico: mesma entrada, mesmo score e fingerprint", async () => {
    await prisma.characterAvailability.update({
      where: { characterId: aiCharacterId },
      data: { status: "AVAILABLE" },
    });
    const first = await evaluateBehaviorDecision(
      request({ trigger: "RACE_FINISHED", conversationId: null }),
    );
    const second = await evaluateBehaviorDecision(
      request({ trigger: "RACE_FINISHED", conversationId: null }),
    );
    expect(second.selected.score).toBe(first.selected.score);
    expect(second.selected.scoreBreakdown).toEqual(first.selected.scoreBreakdown);
    expect(second.actionFingerprint).toBe(first.actionFingerprint);
  });

  it("7) alvo movido para outro Universe é rejeitado no command", async () => {
    await prisma.pilotExperience.create({
      data: {
        universeId,
        characterId: aiCharacterId,
        experienceType: "SPORTING_DEFEAT",
        source: "RACE_RESULT",
        sourceKey: `${PREFIX}-defeat`,
        title: "Derrota",
        salience: "HIGH",
        status: "ACTIVE",
        occurredAt: new Date("2026-09-30T00:00:00.000Z"),
      },
    });
    const result = await evaluateBehaviorDecision(
      request({ trigger: "RACE_FINISHED", conversationId: null }),
    );
    expect(["CREATE_MEMORY", "UPDATE_RELATIONSHIP"]).toContain(result.selected.actionType);
    expect(result.selected.targetCharacterId).toBe(rivalCharacterId);
    const relationshipBefore = await prisma.relationship.findFirstOrThrow({
      where: { characterAId: aiCharacterId, characterBId: rivalCharacterId },
      select: { dimensions: true },
    });
    await prisma.character.update({
      where: { id: rivalCharacterId },
      data: { universeId: secondUniverseId },
    });
    const execution = await executeBehaviorDecision(result.decisionId);
    expect(execution.status).toBe("REJECTED");
    expect(execution.errorCode).toBe("UNIVERSE_MISMATCH");
    const relationshipAfter = await prisma.relationship.findFirstOrThrow({
      where: { characterAId: aiCharacterId, characterBId: rivalCharacterId },
      select: { dimensions: true },
    });
    expect(relationshipAfter.dimensions).toEqual(relationshipBefore.dimensions);
  });
});
