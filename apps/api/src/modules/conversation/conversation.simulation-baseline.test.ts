import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import type { GenerationProvider } from "../generation/generation.assembly.js";

const PREFIX = "conversation-baseline";
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];

let app: FastifyInstance;
let cookie: string;
let userId: string;
let universeId: string;
let userCharacterId: string;
let aiAId: string;
let aiBId: string;
let conversationId: string;

function provider(): GenerationProvider {
  let call = 0;
  return {
    name: "stub-22",
    async run() {
      call += 1;
      return {
        provider: "stub-22",
        mode: "generated" as const,
        text: `Resposta numero ${call}.`,
        tokenStats: { systemPromptChars: 0, contextBlocks: 1 },
      };
    },
  };
}

async function createCharacter(label: string, controller: "AI" | "USER", availability?: "AVAILABLE" | "OFFLINE") {
  const character = await prisma.character.create({
    data: {
      universeId,
      userId,
      controlledBy: controller,
      name: `${PREFIX}-${label}`,
      nationality: "BR",
      birthDate: new Date("1998-02-15T00:00:00.000Z"),
      ...(availability ? { availability: { create: { status: availability } } } : {}),
    },
  });
  createdCharacterIds.push(character.id);
  return character;
}

beforeAll(async () => {
  app = buildApp(undefined, provider());
  await app.ready();
  const email = `${PREFIX}-${Date.now()}@f1nw.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: "Baseline Owner", email, password: "senha-segura-123" },
    remoteAddress: "10.22.1.1",
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
    data: { universeId, key: "default", currentDate: new Date("2026-10-01T12:00:00.000Z") },
  });

  const userChar = await createCharacter("user", "USER");
  const aiA = await createCharacter("ai-a", "AI", "AVAILABLE");
  const aiB = await createCharacter("ai-b", "AI", "AVAILABLE");
  userCharacterId = userChar.id;
  aiAId = aiA.id;
  aiBId = aiB.id;

  const conversation = await prisma.conversation.create({
    data: {
      type: "GROUP",
      status: "ACTIVE",
      participants: { create: [userChar, aiA, aiB].map((c) => ({ characterId: c.id })) },
    },
  });
  createdConversationIds.push(conversation.id);
  conversationId = conversation.id;
});

afterAll(async () => {
  await prisma.aiDecision.deleteMany({ where: { universeId } });
  await prisma.characterGoal.deleteMany({ where: { universeId } });
  if (createdConversationIds.length > 0) {
    await prisma.message.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
    await prisma.conversationParticipant.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  }
  if (createdCharacterIds.length > 0) {
    await prisma.characterAvailability.deleteMany({ where: { characterId: { in: createdCharacterIds } } });
    await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  }
  if (createdUniverseIds.length > 0) {
    await prisma.worldState.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
    await prisma.universe.deleteMany({ where: { id: { in: createdUniverseIds } } });
  }
  if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await app.close();
  await prisma.$disconnect();
});

async function sendUserMessage(content: string) {
  const sent = await app.inject({
    method: "POST",
    url: `/api/conversations/${conversationId}/messages`,
    headers: { cookie },
    payload: { senderType: "USER_CHARACTER", characterId: userCharacterId, content },
    remoteAddress: "10.22.1.2",
  });
  expect(sent.statusCode).toBe(201);
}

type PlanBody = {
  plan: {
    energy: { level: string; energy: number; intensity: number; reasons: string[] };
    window: { maxInitialResponders: number; maxChainDepth: number; stopThresholds: { initial: number } };
    planned: Array<{ characterId: string; name: string; score: number; reasons: string[] }>;
    stopReason: string;
  };
};

async function fetchPlan(): Promise<PlanBody> {
  const response = await app.inject({
    method: "POST",
    url: `/api/conversations/${conversationId}/simulate-turn/plan`,
    headers: { cookie },
    payload: { worldDate: "2026-10-01T12:00:00.000Z" },
    remoteAddress: "10.22.1.3",
  });
  expect(response.statusCode).toBe(200);
  return response.json() as PlanBody;
}

describe("Fase 2.2 — baseline social e regressao de zero resposta", () => {
  it("A/B/C) 'bom dia amigos' produz oportunidade sem mencao, sem escolher todos", async () => {
    await sendUserMessage("bom dia amigos");
    const { plan } = await fetchPlan();
    expect(plan.planned.length).toBeGreaterThanOrEqual(1);
    expect(plan.planned.length).toBeLessThanOrEqual(2);
    expect(plan.planned.every((candidate) => candidate.characterId !== userCharacterId)).toBe(true);
    expect(plan.planned[0]?.reasons).toContain("SOCIAL_BASELINE");
  });

  it("D) mencao direta seleciona o personagem citado", async () => {
    const aiA = await prisma.character.findUniqueOrThrow({ where: { id: aiAId } });
    await sendUserMessage(`${aiA.name} preciso de ajuda`);
    const { plan } = await fetchPlan();
    expect(plan.planned[0]?.characterId).toBe(aiAId);
    expect(plan.planned[0]?.reasons).toContain("DIRECT_MENTION");
  });

  it("E) pergunta ao grupo abre multiplos candidatos", async () => {
    await sendUserMessage("gente, voces viram a corrida?");
    const { plan } = await fetchPlan();
    expect(plan.planned.length).toBeGreaterThanOrEqual(1);
    expect(plan.planned.length).toBeLessThanOrEqual(3);
  });

  it("B/execucao) simulate-turn gera ao menos uma mensagem para 'bom dia'", async () => {
    await sendUserMessage("bom dia");
    const simulation = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/simulate-turn`,
      headers: { cookie },
      payload: { worldDate: "2026-10-01T12:00:00.000Z" },
      remoteAddress: "10.22.1.4",
    });
    expect(simulation.statusCode).toBe(201);
    const body = simulation.json() as {
      simulation: { executed: boolean; steps: Array<{ characterId: string; messageId: string }>; stopReason: string };
    };
    expect(body.simulation.executed).toBe(true);
    expect(body.simulation.steps.length).toBeGreaterThanOrEqual(1);
    for (const step of body.simulation.steps) {
      expect(step.characterId).not.toBe(userCharacterId);
      const message = await prisma.message.findUniqueOrThrow({ where: { id: step.messageId } });
      expect(message.senderType).toBe("AI_CHARACTER");
    }
  });

  it("G) personagem indisponivel nao responde", async () => {
    const conversation = await prisma.conversation.create({
      data: {
        type: "GROUP",
        status: "ACTIVE",
        participants: { create: [{ characterId: aiBId }] },
        messages: {
          create: {
            senderType: "USER_CHARACTER",
            characterId: userCharacterId,
            content: "bom dia",
          },
        },
      },
    });
    createdConversationIds.push(conversation.id);
    await prisma.characterAvailability.upsert({
      where: { characterId: aiBId },
      update: { status: "OFFLINE" },
      create: { characterId: aiBId, status: "OFFLINE" },
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversation.id}/simulate-turn/plan`,
      headers: { cookie },
      payload: { worldDate: "2026-10-01T12:00:00.000Z" },
      remoteAddress: "10.22.1.5",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as PlanBody;
    expect(body.plan.planned).toEqual([]);
  });
});
