import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import type { GenerationProvider } from "../generation/generation.assembly.js";

const PREFIX = "conversation-autonomous";
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];

let app: FastifyInstance;
let cookie: string;
let userId: string;
let universeId: string;
let characterAId: string;
let characterBId: string;
let userCharacterId: string;
let conversationId: string;
let firstSpeakerId: string;
let secondSpeakerId: string;

function remoteAddress(): string {
  return `10.21.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
}

function stubProvider(text: string, name = "stub-v42"): GenerationProvider {
  return {
    name,
    async run() {
      return {
        provider: name,
        mode: "generated" as const,
        text,
        tokenStats: { systemPromptChars: 0, contextBlocks: 1 },
      };
    },
  };
}

function sequenceProvider(name = "stub-v42"): GenerationProvider {
  let call = 0;
  return {
    name,
    async run() {
      call += 1;
      return {
        provider: name,
        mode: "generated" as const,
        text: `Resposta dinâmica número ${call}.`,
        tokenStats: { systemPromptChars: 0, contextBlocks: 1 },
      };
    },
  };
}

function failingProvider(): GenerationProvider {
  return {
    name: "failing-v42",
    async run() {
      throw new Error("provider indisponível");
    },
  };
}

async function createCharacter(input: {
  label: string;
  controller: "AI" | "USER";
  availability?: "AVAILABLE" | "OFFLINE";
}) {
  const character = await prisma.character.create({
    data: {
      universeId,
      userId,
      controlledBy: input.controller,
      name: `${PREFIX}-${input.label}`,
      nationality: "BR",
      birthDate: new Date("1998-02-15T00:00:00.000Z"),
      ...(input.availability
        ? { availability: { create: { status: input.availability } } }
        : {}),
    },
  });
  createdCharacterIds.push(character.id);
  return character;
}

async function createConversation(participantIds: string[], seed: {
  content: string;
  characterId: string;
  minutesAgo: number;
}) {
  const conversation = await prisma.conversation.create({
    data: {
      type: "GROUP",
      participants: { create: participantIds.map((characterId) => ({ characterId })) },
      messages: {
        create: [
          {
            senderType: seed.characterId === userCharacterId ? "USER_CHARACTER" : "AI_CHARACTER",
            characterId: seed.characterId,
            content: seed.content,
            createdAt: new Date(
              new Date("2026-10-01T12:00:00.000Z").getTime() - seed.minutesAgo * 60 * 1000,
            ),
          },
        ],
      },
    },
  });
  createdConversationIds.push(conversation.id);
  return conversation;
}

beforeAll(async () => {
  app = buildApp(undefined, sequenceProvider());
  await app.ready();
  const email = `${PREFIX}-${Date.now()}@f1nw.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: "Autonomous Owner", email, password: "senha-segura-123" },
    remoteAddress: remoteAddress(),
  });
  expect(res.statusCode).toBe(200);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  userId = user.id;
  createdUserIds.push(user.id);
  cookie = (res.cookies ?? []).map((entry) => `${entry.name}=${entry.value}`).join("; ");

  const universe = await prisma.universe.upsert({
    where: { userId },
    update: { status: "READY" },
    create: { userId, status: "READY" },
  });
  createdUniverseIds.push(universe.id);
  universeId = universe.id;
  await prisma.worldState.create({
    data: {
      universeId,
      key: "default",
      currentDate: new Date("2026-10-01T12:00:00.000Z"),
    },
  });

  const aiA = await createCharacter({ label: "ai-a", controller: "AI", availability: "AVAILABLE" });
  const aiB = await createCharacter({ label: "ai-b", controller: "AI" });
  const userChar = await createCharacter({ label: "user", controller: "USER" });
  characterAId = aiA.id;
  characterBId = aiB.id;
  userCharacterId = userChar.id;

  const conversation = await createConversation(
    [characterAId, characterBId, userCharacterId],
    { content: "Vamos falar da corrida.", characterId: userCharacterId, minutesAgo: 1 },
  );
  conversationId = conversation.id;
});

afterAll(async () => {
  await prisma.aiDecision.deleteMany({ where: { universeId } });
  await prisma.characterGoal.deleteMany({ where: { universeId } });
  if (createdConversationIds.length > 0) {
    await prisma.message.deleteMany({
      where: { conversationId: { in: createdConversationIds } },
    });
    await prisma.conversationParticipant.deleteMany({
      where: { conversationId: { in: createdConversationIds } },
    });
    await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  }
  if (createdCharacterIds.length > 0) {
    await prisma.characterAvailability.deleteMany({
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
  await app.close();
  await prisma.$disconnect();
});

describe("autonomous conversation turns (V4.2)", () => {
  it("1) executa turno AI↔AI com provider e persiste mensagem + audit", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/autonomous-turn`,
      headers: { cookie },
      payload: { worldDate: "2026-10-01T12:00:00.000Z" },
      remoteAddress: remoteAddress(),
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      turn: {
        executed: boolean;
        messageId: string;
        speakerCharacterId: string;
        language: { provider: string; fallback: boolean };
        decisionId: string;
      };
    };
    expect(body.turn.executed).toBe(true);
    expect(body.turn.language.provider).toBe("stub-v42");
    expect(body.turn.language.fallback).toBe(false);
    firstSpeakerId = body.turn.speakerCharacterId;

    const message = await prisma.message.findUniqueOrThrow({
      where: { id: body.turn.messageId },
    });
    expect(message.content).toBe("Resposta dinâmica número 1.");
    expect(message.senderType).toBe("AI_CHARACTER");
    expect(message.characterId).toBe(body.turn.speakerCharacterId);
    const contextJson = message.contextJson as Record<string, unknown>;
    expect((contextJson.language as Record<string, unknown>).provider).toBe("stub-v42");

    const decision = await prisma.aiDecision.findUniqueOrThrow({
      where: { id: body.turn.decisionId },
    });
    expect(decision.status).toBe("EXECUTED");
    expect(decision.actionType).toBe("RESPOND");
  });

  it("2) turno seguinte alterna para o outro participante", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/autonomous-turn`,
      headers: { cookie },
      payload: { worldDate: "2026-10-01T12:00:00.000Z" },
      remoteAddress: remoteAddress(),
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { turn: { speakerCharacterId: string } };
    expect(body.turn.speakerCharacterId).not.toBe(firstSpeakerId);
    secondSpeakerId = body.turn.speakerCharacterId;
  });

  it("3) GET turn-plan é leitura pura e explica a seleção", async () => {
    const messagesBefore = await prisma.message.count({ where: { conversationId } });
    const response = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}/turn-plan?worldDate=2026-10-01T12:00:00.000Z`,
      headers: { cookie },
      remoteAddress: remoteAddress(),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      plan: { canContinue: boolean; speakerCharacterId: string | null; reasonCode: string };
    };
    expect(body.plan.canContinue).toBe(true);
    expect(body.plan.speakerCharacterId).toBe(firstSpeakerId);
    expect(await prisma.message.count({ where: { conversationId } })).toBe(messagesBefore);
  });

  it("4) provider falho cai no fallback determinístico sem quebrar a conversa", async () => {
    const failingApp = buildApp(undefined, failingProvider());
    await failingApp.ready();
    const response = await failingApp.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/autonomous-turn`,
      headers: { cookie },
      payload: { worldDate: "2026-10-01T12:00:00.000Z" },
      remoteAddress: remoteAddress(),
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      turn: { executed: boolean; language: { fallback: boolean; provider: string }; speakerCharacterId: string };
    };
    expect(body.turn.executed).toBe(true);
    expect(body.turn.language.fallback).toBe(true);
    expect(body.turn.language.provider).toBe("deterministic");
    expect(body.turn.speakerCharacterId).toBe(firstSpeakerId);
    expect(body.turn.speakerCharacterId).not.toBe(secondSpeakerId);
    await failingApp.close();
  });

  it("5) conteúdo repetido não é enviado", async () => {
    const last = await prisma.message.findFirstOrThrow({
      where: { conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: { content: true },
    });
    const repeatApp = buildApp(undefined, stubProvider(last.content));
    await repeatApp.ready();
    const response = await repeatApp.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/autonomous-turn`,
      headers: { cookie },
      payload: { worldDate: "2026-10-01T12:00:00.000Z" },
      remoteAddress: remoteAddress(),
    });
    const body = response.json() as { turn: { executed: boolean; reasonCode: string } };
    expect(body.turn.executed).toBe(false);
    expect(body.turn.reasonCode).toBe("REPEATED_CONTENT");
    await repeatApp.close();
  });

  it("6) conversa pausada não gera turno", async () => {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: "PAUSED" },
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/autonomous-turn`,
      headers: { cookie },
      payload: { worldDate: "2026-10-01T12:00:00.000Z" },
      remoteAddress: remoteAddress(),
    });
    const body = response.json() as { turn: { executed: boolean; reasonCode: string } };
    expect(body.turn.executed).toBe(false);
    expect(body.turn.reasonCode).toBe("CONVERSATION_NOT_ACTIVE");
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: "ACTIVE" },
    });
  });

  it("7) usuário sem participação recebe 404", async () => {
    const otherEmail = `${PREFIX}-other-${Date.now()}@f1nw.test`;
    const signUp = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { name: "Other", email: otherEmail, password: "senha-segura-123" },
      remoteAddress: remoteAddress(),
    });
    const otherUser = await prisma.user.findUniqueOrThrow({ where: { email: otherEmail } });
    createdUserIds.push(otherUser.id);
    const otherCookie = (signUp.cookies ?? [])
      .map((entry) => `${entry.name}=${entry.value}`)
      .join("; ");
    const response = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/autonomous-turn`,
      headers: { cookie: otherCookie },
      payload: { worldDate: "2026-10-01T12:00:00.000Z" },
      remoteAddress: remoteAddress(),
    });
    expect(response.statusCode).toBe(404);
  });

  it("8) conversa sem participante de IA não gera turno", async () => {
    const userOnly = await createConversation([userCharacterId], {
      content: "Sozinho.",
      characterId: userCharacterId,
      minutesAgo: 1,
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/conversations/${userOnly.id}/autonomous-turn`,
      headers: { cookie },
      payload: { worldDate: "2026-10-01T12:00:00.000Z" },
      remoteAddress: remoteAddress(),
    });
    const body = response.json() as { turn: { executed: boolean; reasonCode: string } };
    expect(body.turn.executed).toBe(false);
    expect(body.turn.reasonCode).toBe("NO_AI_PARTICIPANT");
  });

  it("9) budget de turnos por rodada bloqueia novas respostas", async () => {
    const budgetConversation = await createConversation(
      [characterAId, characterBId, userCharacterId],
      { content: "Pergunta.", characterId: userCharacterId, minutesAgo: 3 },
    );
    await prisma.message.create({
      data: {
        conversationId: budgetConversation.id,
        senderType: "AI_CHARACTER",
        characterId: characterAId,
        content: "Resposta 1.",
        createdAt: new Date("2026-10-01T11:59:00.000Z"),
      },
    });
    process.env.CONVERSATION_MAX_AI_TURNS_PER_ROUND = "1";
    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/conversations/${budgetConversation.id}/autonomous-turn`,
        headers: { cookie },
        payload: { worldDate: "2026-10-01T12:00:00.000Z" },
        remoteAddress: remoteAddress(),
      });
      const body = response.json() as { turn: { executed: boolean; reasonCode: string } };
      expect(body.turn.executed).toBe(false);
      expect(body.turn.reasonCode).toBe("TURN_BUDGET_EXHAUSTED");
    } finally {
      delete process.env.CONVERSATION_MAX_AI_TURNS_PER_ROUND;
    }
  });

  it("10) mensagem do usuário via POST /messages dispara resposta autônoma (caminho real)", async () => {
    const sent = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/messages`,
      headers: { cookie },
      payload: {
        senderType: "USER_CHARACTER",
        characterId: userCharacterId,
        content: "Bom dia",
      },
      remoteAddress: remoteAddress(),
    });
    expect(sent.statusCode).toBe(201);

    const turn = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/autonomous-turn`,
      headers: { cookie },
      payload: { worldDate: "2026-10-01T12:00:00.000Z" },
      remoteAddress: remoteAddress(),
    });
    expect(turn.statusCode).toBe(201);
    const body = turn.json() as {
      turn: { executed: boolean; speakerCharacterId: string; messageId: string };
    };
    expect(body.turn.executed).toBe(true);
    expect([characterAId, characterBId]).toContain(body.turn.speakerCharacterId);

    const aiMessage = await prisma.message.findUniqueOrThrow({
      where: { id: body.turn.messageId },
    });
    expect(aiMessage.senderType).toBe("AI_CHARACTER");
    expect(aiMessage.characterId).toBe(body.turn.speakerCharacterId);
    expect(aiMessage.content.trim().length).toBeGreaterThan(0);

    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { senderType: true, characterId: true, content: true },
    });
    expect(messages.some((message) => message.content === "Bom dia")).toBe(true);
    expect(messages.some((message) => message.senderType === "AI_CHARACTER")).toBe(true);
  });

  it("11) resposta autônoma funciona sem provider (fallback determinístico)", async () => {
    const fallbackApp = buildApp();
    await fallbackApp.ready();
    const sent = await fallbackApp.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/messages`,
      headers: { cookie },
      payload: {
        senderType: "USER_CHARACTER",
        characterId: userCharacterId,
        content: "Como vocês estão?",
      },
      remoteAddress: remoteAddress(),
    });
    expect(sent.statusCode).toBe(201);
    const turn = await fallbackApp.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/autonomous-turn`,
      headers: { cookie },
      payload: { worldDate: "2026-10-01T12:00:00.000Z" },
      remoteAddress: remoteAddress(),
    });
    expect(turn.statusCode).toBe(201);
    const body = turn.json() as {
      turn: { executed: boolean; language: { fallback: boolean } };
    };
    expect(body.turn.executed).toBe(true);
    expect(body.turn.language.fallback).toBe(true);
    await fallbackApp.close();
  });

  it("12) provider recebe instrução explícita de pt-BR no turno autônomo", async () => {
    const captured: string[] = [];
    const captureProvider: GenerationProvider = {
      name: "capture-v42",
      async run(input) {
        captured.push(input.systemPrompt);
        captured.push(input.userPrompt ?? "");
        return {
          provider: "capture-v42",
          mode: "generated" as const,
          text: "Bom dia, pessoal. Tudo bem?",
          tokenStats: { systemPromptChars: input.systemPrompt.length, contextBlocks: 1 },
        };
      },
    };
    const captureApp = buildApp(undefined, captureProvider);
    await captureApp.ready();
    const sent = await captureApp.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/messages`,
      headers: { cookie },
      payload: {
        senderType: "USER_CHARACTER",
        characterId: userCharacterId,
        content: "Bom dia amigos, tudo bom?",
      },
      remoteAddress: remoteAddress(),
    });
    expect(sent.statusCode).toBe(201);
    const turn = await captureApp.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/autonomous-turn`,
      headers: { cookie },
      payload: { worldDate: "2026-10-01T12:00:00.000Z" },
      remoteAddress: remoteAddress(),
    });
    expect(turn.statusCode).toBe(201);
    expect(captured.join("\n")).toContain("português do Brasil");
    await captureApp.close();
  });
});
