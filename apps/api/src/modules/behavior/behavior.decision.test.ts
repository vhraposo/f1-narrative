import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import { buildBehaviorContext } from "./behavior.context.js";
import { evaluateBehaviorDecision } from "./behavior.decision.js";
import { createDeterministicLanguageEngine } from "./behavior.language.js";
import { BehaviorError, type BehaviorDecisionRequest } from "./behavior.types.js";

const PREFIX = "behavior-v40";
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];
const createdEventIds: string[] = [];

let universeId: string;
let seasonId: string;
let aiCharacterId: string;
let rivalCharacterId: string;
let userCharacterId: string;
let conversationId: string;
let eventId: string;

async function createCharacter(input: {
  label: string;
  controller: "AI" | "USER";
  withDriverProfile?: boolean;
}) {
  const character = await prisma.character.create({
    data: {
      universeId,
      controlledBy: input.controller,
      name: `${PREFIX}-${input.label}`,
      nationality: "BR",
      birthDate: new Date("1998-02-15T00:00:00.000Z"),
      ...(input.withDriverProfile ? { driverProfile: { create: { number: 7 } } } : {}),
    },
  });
  createdCharacterIds.push(character.id);
  return character;
}

async function setupFixtures() {
  const user = await prisma.user.create({
    data: {
      email: `${PREFIX}-${Date.now()}@f1nw.test`,
      name: "Behavior Owner",
      role: "USER",
    },
  });
  createdUserIds.push(user.id);
  const universe = await prisma.universe.create({
    data: { userId: user.id, status: "READY" },
  });
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
      currentDate: new Date("2026-10-01T00:00:00.000Z"),
      currentSeasonId: seasonId,
    },
  });

  const ai = await createCharacter({ label: "ai", controller: "AI", withDriverProfile: true });
  const rival = await createCharacter({
    label: "rival",
    controller: "AI",
    withDriverProfile: true,
  });
  const userChar = await createCharacter({ label: "user", controller: "USER" });
  aiCharacterId = ai.id;
  rivalCharacterId = rival.id;
  userCharacterId = userChar.id;

  const persona = await prisma.characterPersona.create({
    data: { characterId: ai.id, origin: "AI_CHARACTER", schemaVersion: "persona.v1" },
  });
  await prisma.personaTrait.createMany({
    data: [
      {
        personaId: persona.id,
        key: "competitiveness",
        value: "agressivo nas disputas",
        confidence: 0.8,
        sourceKind: "EVIDENCE",
        context: "ON_TRACK",
      },
      {
        personaId: persona.id,
        key: "interests",
        value: "golfe",
        confidence: 0.6,
        sourceKind: "EVIDENCE",
        context: "OFF_TRACK",
      },
    ],
  });

  await prisma.characterAvailability.create({
    data: { characterId: ai.id, status: "AVAILABLE" },
  });

  await prisma.relationship.create({
    data: {
      characterAId: ai.id,
      characterBId: rival.id,
      dimensions: { rivalry: 0.7, respect: 0.5 },
    },
  });

  await prisma.memory.create({
    data: {
      universeId,
      content: "Perdeu a liderança na última volta.",
      summary: "Derrota apertada",
      importance: "HIGH",
      status: "ACTIVE",
      participants: { create: [{ characterId: ai.id }] },
    },
  });
  await prisma.pilotExperience.create({
    data: {
      universeId,
      characterId: ai.id,
      experienceType: "SPORTING_DEFEAT",
      source: "RACE_RESULT",
      sourceKey: `${PREFIX}-defeat`,
      title: "Derrota na última volta",
      salience: "HIGH",
      status: "ACTIVE",
      occurredAt: new Date("2026-09-30T00:00:00.000Z"),
    },
  });

  const conversation = await prisma.conversation.create({
    data: {
      type: "DM",
      participants: { create: [{ characterId: ai.id }, { characterId: rival.id }] },
      messages: {
        create: [
          { senderType: "AI_CHARACTER", characterId: rival.id, content: "Boa corrida ontem." },
        ],
      },
    },
  });
  createdConversationIds.push(conversation.id);
  conversationId = conversation.id;

  const event = await prisma.event.create({
    data: {
      type: "RACE",
      importance: "HIGH",
      title: "GP de Teste",
      worldDate: new Date("2026-09-30T00:00:00.000Z"),
      participants: { create: [{ characterId: ai.id }, { characterId: rival.id }] },
    },
  });
  createdEventIds.push(event.id);
  eventId = event.id;
}

afterAll(async () => {
  await prisma.aiDecision.deleteMany({ where: { universeId } });
  if (createdConversationIds.length > 0) {
    await prisma.message.deleteMany({
      where: { conversationId: { in: createdConversationIds } },
    });
    await prisma.conversationParticipant.deleteMany({
      where: { conversationId: { in: createdConversationIds } },
    });
    await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  }
  if (createdEventIds.length > 0) {
    await prisma.eventCharacter.deleteMany({ where: { eventId: { in: createdEventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
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
    await prisma.memory.deleteMany({
      where: { participants: { none: {} }, universeId },
    });
    await prisma.pilotExperience.deleteMany({
      where: { characterId: { in: createdCharacterIds } },
    });
    await prisma.personaTrait.deleteMany({
      where: { persona: { characterId: { in: createdCharacterIds } } },
    });
    await prisma.characterPersona.deleteMany({
      where: { characterId: { in: createdCharacterIds } },
    });
    await prisma.characterAvailability.deleteMany({
      where: { characterId: { in: createdCharacterIds } },
    });
    await prisma.characterSchedule.deleteMany({
      where: { characterId: { in: createdCharacterIds } },
    });
    await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  }
  if (seasonId) await prisma.season.deleteMany({ where: { id: seasonId } });
  if (universeId) {
    await prisma.worldState.deleteMany({ where: { universeId } });
    await prisma.universe.deleteMany({ where: { id: universeId } });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

beforeAll(async () => {
  await setupFixtures();
});

function request(overrides: Partial<BehaviorDecisionRequest> = {}): BehaviorDecisionRequest {
  return {
    universeId,
    characterId: aiCharacterId,
    trigger: "MESSAGE_RECEIVED",
    worldDate: new Date("2026-10-01T00:00:00.000Z"),
    conversationId,
    userInitiated: true,
    ...overrides,
  };
}

describe("behavior decision foundation (V4.0)", () => {
  it("1) responde mensagem, persiste AiDecision e audita candidatos", async () => {
    const result = await evaluateBehaviorDecision(request());
    expect(result.status).toBe("DECIDED");
    expect(result.selected.actionType).toBe("RESPOND");
    expect(result.llmUsed).toBe(false);
    expect(result.contextVersion.startsWith("behavior-context.v1:")).toBe(true);
    expect(result.contextFingerprint).toMatch(/^[a-f0-9]{64}$/);

    const row = await prisma.aiDecision.findUniqueOrThrow({ where: { id: result.decisionId } });
    expect(row.universeId).toBe(universeId);
    expect(row.characterId).toBe(aiCharacterId);
    expect(row.status).toBe("DECIDED");
    expect(row.actionType).toBe("RESPOND");
    expect(row.conversationId).toBe(conversationId);
    expect(row.reason).toBe("POLICY_RESPOND_TO_DIRECT_MESSAGE");
    expect(row.contextVersion).toBe(result.contextVersion);
    expect(row.policyCode).toBe("behavior-policy.v1");
    const metadata = row.metadata as Record<string, unknown>;
    expect(metadata.trigger).toBe("MESSAGE_RECEIVED");
    expect(metadata.fingerprint).toBe(result.contextFingerprint);
    expect(metadata.engine).toBe("deterministic");
    expect(metadata.llmUsed).toBe(false);
    expect(Array.isArray(metadata.candidates)).toBe(true);
    expect((metadata.selected as Record<string, unknown>).actionType).toBe("RESPOND");
  });

  it("2) mesma entrada gera o mesmo contexto e a mesma decisão", async () => {
    const first = await evaluateBehaviorDecision(request());
    const second = await evaluateBehaviorDecision(request());
    expect(second.contextFingerprint).toBe(first.contextFingerprint);
    expect(second.selected.actionType).toBe(first.selected.actionType);
    expect(second.selected.reasonCode).toBe(first.selected.reasonCode);
    expect(second.candidates.map((candidate) => candidate.id)).toEqual(
      first.candidates.map((candidate) => candidate.id),
    );
  });

  it("3) character USER não age autonomamente", async () => {
    const result = await evaluateBehaviorDecision(
      request({
        characterId: userCharacterId,
        trigger: "MESSAGE_RECEIVED",
        conversationId,
        userInitiated: false,
      }),
    );
    expect(result.status).toBe("NO_ACTION");
    expect(result.selected.actionType).toBe("NO_ACTION");
    const respond = result.candidates.find((candidate) => candidate.actionType === "RESPOND");
    expect(respond?.failedPreconditions).toContain("CONTROLLER_IS_AI");
  });

  it("4) isolamento de Universe: personagem de outro universo é rejeitado", async () => {
    await expect(
      evaluateBehaviorDecision(request({ universeId: "00000000-0000-0000-0000-000000000000" })),
    ).rejects.toMatchObject({ code: "BEHAVIOR_UNIVERSE_MISMATCH" });
  });

  it("5) contexto ausente (conversa inexistente) é rejeitado", async () => {
    await expect(
      evaluateBehaviorDecision(
        request({ conversationId: "00000000-0000-0000-0000-000000000000" }),
      ),
    ).rejects.toMatchObject({ code: "BEHAVIOR_CONVERSATION_NOT_FOUND" });
  });

  it("6) evento com alvo e relacionamento seleciona SEND_MESSAGE", async () => {
    const result = await evaluateBehaviorDecision(
      request({
        trigger: "EVENT_CREATED",
        conversationId: null,
        eventId,
        userInitiated: false,
        metadata: { targetCharacterId: rivalCharacterId },
      }),
    );
    expect(result.selected.actionType).toBe("SEND_MESSAGE");
    expect(result.selected.targetCharacterId).toBe(rivalCharacterId);
  });

  it("7) metadados sensíveis são sanitizados no audit", async () => {
    const result = await evaluateBehaviorDecision(
      request({
        metadata: {
          apiKey: "sk-super-secreta",
          nested: { authorization: "Bearer abc123", safe: "ok" },
        },
      }),
    );
    const row = await prisma.aiDecision.findUniqueOrThrow({ where: { id: result.decisionId } });
    const metadata = row.metadata as Record<string, unknown>;
    const requestMetadata = metadata.requestMetadata as Record<string, unknown>;
    expect(requestMetadata.apiKey).toBe("[REDACTED]");
    expect((requestMetadata.nested as Record<string, unknown>).authorization).toBe("[REDACTED]");
    expect((requestMetadata.nested as Record<string, unknown>).safe).toBe("ok");
    expect(JSON.stringify(metadata)).not.toContain("sk-super-secreta");
  });

  it("8) contexto inclui apenas traits ON_TRACK e omite goals (V4.1)", async () => {
    const context = await buildBehaviorContext(request());
    expect(context.personality.traits.map((trait) => trait.key)).toEqual(["competitiveness"]);
    expect(context.omitted).toContainEqual({ section: "GOALS", reason: "GOALS_PENDING_V4_1" });
    expect(context.memory.recent.length).toBeGreaterThanOrEqual(1);
    expect(context.experience.recent.length).toBeGreaterThanOrEqual(1);
    expect(context.relationships.entries[0]?.otherCharacterId).toBe(rivalCharacterId);
  });

  it("9) language engine determinístico não altera a decisão", async () => {
    const engine = createDeterministicLanguageEngine();
    const decision = await evaluateBehaviorDecision(request());
    const context = await buildBehaviorContext(request());
    const first = await engine.compose({ context, decision });
    const second = await engine.compose({ context, decision });
    expect(first.text).toBe(second.text);
    expect(first.provider).toBe("deterministic");
    expect(first.fallback).toBe(true);
    expect(decision.llmUsed).toBe(false);
  });

  it("10) erro de personagem inexistente é explícito", async () => {
    await expect(
      evaluateBehaviorDecision(
        request({ characterId: "00000000-0000-0000-0000-000000000000" }),
      ),
    ).rejects.toBeInstanceOf(BehaviorError);
  });
});
