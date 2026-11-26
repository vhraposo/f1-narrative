import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { evaluateBehaviorDecision } from "./behavior.decision.js";
import { executeBehaviorDecision } from "./behavior.execution.js";
import { runAutonomousConversationTurn } from "../conversation/conversation.autonomous.js";

// F7.5 — defesa estrutural no Command Layer em TEST DB.
// O writer único continua `executeBehaviorDecision`; aqui garantimos que alvos
// fora da conversa/universo e speakers fora da conversa não geram Message.

const PREFIX = "behavior-auth";
const WORLD_DATE = new Date("2026-10-01T12:00:00.000Z");

let app: FastifyInstance;

const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];

let ownerUserId: string;
let ownerCookie: string;
let universeId: string;
let characterAId: string;
let characterBId: string;
let characterOutsideId: string;
let characterForeignId: string;
let conversationId: string;

async function signUp(label: string): Promise<{ userId: string; cookie: string }> {
  const email = `${PREFIX}-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@f1nw.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: label, email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  createdUserIds.push(user.id);
  return { userId: user.id, cookie };
}

async function createAiCharacter(
  userId: string | null,
  owningUniverseId: string | null,
  name: string,
): Promise<string> {
  const character = await prisma.character.create({
    data: {
      userId,
      universeId: owningUniverseId,
      controlledBy: "AI",
      name,
      nationality: "BR",
      birthDate: new Date("1995-01-01T00:00:00.000Z"),
    },
  });
  createdCharacterIds.push(character.id);
  return character.id;
}

function respondRequest(characterId: string, targetCharacterId: string | null) {
  return {
    universeId,
    characterId,
    trigger: "CONVERSATION_TURN_DUE" as const,
    worldDate: WORLD_DATE,
    conversationId,
    userInitiated: false,
    ...(targetCharacterId ? { metadata: { targetCharacterId } } : {}),
  };
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  const owner = await signUp("owner");
  ownerUserId = owner.userId;
  ownerCookie = owner.cookie;
  const universe = await prisma.universe.upsert({
    where: { userId: owner.userId },
    update: {},
    create: { userId: owner.userId },
  });
  universeId = universe.id;
  createdUniverseIds.push(universe.id);

  const foreignOwner = await signUp("foreign");
  const foreignUniverse = await prisma.universe.upsert({
    where: { userId: foreignOwner.userId },
    update: {},
    create: { userId: foreignOwner.userId },
  });
  createdUniverseIds.push(foreignUniverse.id);

  characterAId = await createAiCharacter(owner.userId, universeId, `${PREFIX}-a`);
  characterBId = await createAiCharacter(owner.userId, universeId, `${PREFIX}-b`);
  characterOutsideId = await createAiCharacter(owner.userId, universeId, `${PREFIX}-outside`);
  characterForeignId = await createAiCharacter(
    foreignOwner.userId,
    foreignUniverse.id,
    `${PREFIX}-foreign`,
  );

  const conversation = await prisma.conversation.create({
    data: {
      type: "GROUP",
      participants: { create: [{ characterId: characterAId }, { characterId: characterBId }] },
    },
  });
  createdConversationIds.push(conversation.id);
  conversationId = conversation.id;
});

afterAll(async () => {
  await prisma.aiDecision.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
  if (createdConversationIds.length > 0) {
    await prisma.message.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  }
  if (createdCharacterIds.length > 0) {
    await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  }
  if (createdUniverseIds.length > 0) {
    await prisma.worldState.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
    await prisma.universe.deleteMany({ where: { id: { in: createdUniverseIds } } });
  }
  if (createdUserIds.length > 0) {
    await prisma.universe.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await app.close();
  await prisma.$disconnect();
});

describe("F7.5 — Command Layer authorization", () => {
  it("speaker válido com alvo participante executa e grava Message", async () => {
    const decision = await evaluateBehaviorDecision(
      respondRequest(characterAId, characterBId),
    );
    expect(decision.selected.actionType).toBe("RESPOND");
    const execution = await executeBehaviorDecision(decision.decisionId);
    expect(execution.status).toBe("EXECUTED");
    expect(execution.executedMessageId).not.toBeNull();
    const message = await prisma.message.findUniqueOrThrow({
      where: { id: execution.executedMessageId! },
    });
    expect(message.characterId).toBe(characterAId);
    expect(message.conversationId).toBe(conversationId);
  });

  it("alvo fora da conversa é rejeitado pelo Command Layer (sem Message)", async () => {
    const decision = await evaluateBehaviorDecision(
      respondRequest(characterAId, characterOutsideId),
    );
    const execution = await executeBehaviorDecision(decision.decisionId);
    expect(execution.status).toBe("REJECTED");
    expect(execution.errorCode).toBe("TARGET_NOT_PARTICIPANT");
    expect(execution.executedMessageId).toBeNull();

    const row = await prisma.aiDecision.findUniqueOrThrow({ where: { id: decision.decisionId } });
    expect(row.status).toBe("REJECTED");
  });

  it("alvo de outro Universe é rejeitado (UNIVERSE_MISMATCH)", async () => {
    const decision = await evaluateBehaviorDecision(
      respondRequest(characterAId, characterForeignId),
    );
    const execution = await executeBehaviorDecision(decision.decisionId);
    expect(execution.status).toBe("REJECTED");
    expect(execution.errorCode).toBe("UNIVERSE_MISMATCH");
    expect(execution.executedMessageId).toBeNull();
  });

  it("alvo inexistente é rejeitado (TARGET_NOT_FOUND)", async () => {
    const decision = await evaluateBehaviorDecision(
      respondRequest(characterAId, randomUUID()),
    );
    const execution = await executeBehaviorDecision(decision.decisionId);
    expect(execution.status).toBe("REJECTED");
    expect(execution.errorCode).toBe("TARGET_NOT_FOUND");
  });

  it("API direta não permite mensagem de remetente fora da conversa", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/messages`,
      headers: { cookie: ownerCookie },
      payload: { senderType: "AI_CHARACTER", characterId: characterOutsideId, content: "oi" },
    });
    expect(res.statusCode).toBe(403);
    expect(
      await prisma.message.count({ where: { conversationId, characterId: characterOutsideId } }),
    ).toBe(0);
  });

  it("executor de turno autônomo não aceita speaker fora da conversa", async () => {
    const result = await runAutonomousConversationTurn(conversationId, {
      userId: ownerUserId,
      worldDate: WORLD_DATE,
      forceSpeakerCharacterId: characterOutsideId,
    });
    expect(result.executed).toBe(false);
    if (!result.executed) {
      expect(result.decisionId).toBeNull();
    }
    expect(
      await prisma.message.count({ where: { conversationId, characterId: characterOutsideId } }),
    ).toBe(0);
  });
});
