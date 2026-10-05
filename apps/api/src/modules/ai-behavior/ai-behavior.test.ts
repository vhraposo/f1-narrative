import { createHmac, randomBytes } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { afterAll, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import type {
  GenerationProvider,
  ProviderInput,
  ProviderOutput,
} from "../generation/generation.assembly.js";

type TestUser = { cookie: string; userId: string };

type Fixture = {
  universeId: string;
  userCharacterId: string;
  aiCharacterId: string;
  conversationId: string;
  seasonId: string | null;
  raceId: string | null;
};

const createdUserIds: string[] = [];
const createdConversationIds: string[] = [];
const createdEventIds: string[] = [];

function stats(input: ProviderInput) {
  return { systemPromptChars: input.systemPrompt.length, contextBlocks: 1 };
}

function generatedProvider(capture?: {
  input?: ProviderInput;
  calls: number;
}): GenerationProvider {
  return {
    name: "spy",
    async run(input): Promise<ProviderOutput> {
      if (capture) {
        capture.calls += 1;
        capture.input = input;
      }
      return {
        provider: "spy",
        mode: "generated",
        text: "resposta espontanea",
        tokenStats: stats(input),
      };
    },
  };
}

async function createDbUser(suffix: string): Promise<TestUser> {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET not set");
  const user = await prisma.user.create({
    data: {
      email: `aib-${suffix}-${Date.now()}${Math.random()}@f1nw.test`,
      name: `AIB ${suffix}`,
      password: null,
      emailVerified: false,
    },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      userId: user.id,
    },
  });
  const sig = createHmac("sha256", secret).update(token).digest("base64");
  return { cookie: `f1nw.session_token=${token}.${sig}`, userId: user.id };
}

async function createFixture(
  userId: string,
  options: {
    withRace?: boolean;
    secondConversation?: boolean;
    universeIdOverride?: string;
  } = {},
): Promise<Fixture & { secondConversationId: string | null }> {
  const universe =
    options.universeIdOverride === undefined
      ? await prisma.universe.create({ data: { userId, status: "READY" } })
      : { id: options.universeIdOverride };

  const userCharacter = await prisma.character.create({
    data: {
      name: `User ${Math.random()}`,
      nationality: "Brazil",
      birthDate: new Date("2000-01-01"),
      userId: options.universeIdOverride === undefined ? userId : null,
      universeId: universe.id,
      controlledBy: "USER",
    },
  });
  const aiCharacter = await prisma.character.create({
    data: {
      name: `AI ${Math.random()}`,
      nationality: "Brazil",
      birthDate: new Date("2000-01-01"),
      userId: options.universeIdOverride === undefined ? userId : null,
      universeId: universe.id,
      controlledBy: "AI",
    },
  });

  const conversation = await prisma.conversation.create({
    data: { type: "GROUP", title: "AIB" },
  });
  createdConversationIds.push(conversation.id);
  await prisma.conversationParticipant.createMany({
    data: [
      { conversationId: conversation.id, characterId: userCharacter.id },
      { conversationId: conversation.id, characterId: aiCharacter.id },
    ],
  });

  let secondConversationId: string | null = null;
  if (options.secondConversation) {
    const second = await prisma.conversation.create({
      data: { type: "GROUP", title: "AIB 2" },
    });
    createdConversationIds.push(second.id);
    await prisma.conversationParticipant.createMany({
      data: [
        { conversationId: second.id, characterId: userCharacter.id },
        { conversationId: second.id, characterId: aiCharacter.id },
      ],
    });
    secondConversationId = second.id;
  }

  let seasonId: string | null = null;
  let raceId: string | null = null;
  if (options.withRace) {
    const season = await prisma.season.create({
      data: {
        universeId: universe.id,
        year: 2088,
        name: "2088",
      },
    });
    const race = await prisma.race.create({
      data: {
        seasonId: season.id,
        name: "GP de Teste 2088",
        round: 1,
        date: new Date("2088-03-01T00:00:00.000Z"),
      },
    });
    if (options.universeIdOverride === undefined) {
      await prisma.worldState.create({
        data: {
          universeId: universe.id,
          key: "default",
          currentSeasonId: season.id,
          currentRaceId: race.id,
          currentDate: new Date("2088-03-02T00:00:00.000Z"),
        },
      });
    }
    seasonId = season.id;
    raceId = race.id;
  } else {
    await prisma.worldState.create({
      data: {
        universeId: universe.id,
        key: "default",
        currentDate: new Date("2026-10-01T00:00:00.000Z"),
      },
    });
  }

  return {
    universeId: universe.id,
    userCharacterId: userCharacter.id,
    aiCharacterId: aiCharacter.id,
    conversationId: conversation.id,
    secondConversationId,
    seasonId,
    raceId,
  };
}

async function createUniverseForUser(userId: string): Promise<string> {
  const universe = await prisma.universe.create({
    data: { userId, status: "READY" },
  });
  return universe.id;
}

function evaluate(
  app: FastifyInstance,
  user: TestUser,
  characterId: string,
  trigger?: string,
) {
  return app.inject({
    method: "POST",
    url: "/api/ai-behavior/evaluate",
    headers: { cookie: user.cookie },
    payload: {
      characterId,
      ...(trigger !== undefined ? { trigger } : {}),
    },
    remoteAddress: `10.99.1.${Math.floor(Math.random() * 200) + 1}`,
  });
}

function execute(app: FastifyInstance, user: TestUser, decisionId: string) {
  return app.inject({
    method: "POST",
    url: "/api/ai-behavior/execute",
    headers: { cookie: user.cookie },
    payload: { decisionId },
    remoteAddress: `10.99.2.${Math.floor(Math.random() * 200) + 1}`,
  });
}

describe("AI Behavior (Fase 9)", () => {
  afterAll(async () => {
    await prisma.conversation.deleteMany({
      where: { id: { in: createdConversationIds } },
    });
    if (createdEventIds.length > 0) {
      await prisma.memoryCharacter.deleteMany({
        where: { memory: { eventId: { in: createdEventIds } } },
      });
      await prisma.memory.deleteMany({
        where: { eventId: { in: createdEventIds } },
      });
      await prisma.newsItem.deleteMany({
        where: { eventId: { in: createdEventIds } },
      });
      await prisma.eventCharacter.deleteMany({
        where: { eventId: { in: createdEventIds } },
      });
      await prisma.event.deleteMany({
        where: { id: { in: createdEventIds } },
      });
    }
    await prisma.character.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it("avalia personagem AI com conversa e audita SEND_MESSAGE", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("send");
    const fixture = await createFixture(user.userId);

    const response = await evaluate(app, user, fixture.aiCharacterId);
    expect(response.statusCode).toBe(200);
    const decision = response.json().decision;
    expect(decision.actionType).toBe("SEND_MESSAGE");
    expect(decision.status).toBe("DECIDED");
    expect(decision.conversationId).toBe(fixture.conversationId);
    expect(decision.characterId).toBe(fixture.aiCharacterId);
    expect(decision.contextVersion).toBe("ai-behavior.v1");

    const audit = await app.inject({
      method: "GET",
      url: `/api/ai-behavior/decisions?characterId=${fixture.aiCharacterId}`,
      headers: { cookie: user.cookie },
      remoteAddress: "10.99.3.1",
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().decisions[0].id).toBe(decision.id);

    await app.close();
  });

  it("impede USER Character, personagem de outro usuário e de outro Universe", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("guard");
    const other = await createDbUser("guard-other");
    const fixture = await createFixture(user.userId);
    const otherUniverse = await createUniverseForUser(other.userId);
    const foreignOwned = await createFixture(other.userId, {
      universeIdOverride: otherUniverse,
    });

    const userCharacter = await evaluate(app, user, fixture.userCharacterId);
    expect(userCharacter.statusCode).toBe(403);
    expect(userCharacter.json().code).toBe("CHARACTER_NOT_AI");

    const notOwned = await evaluate(app, user, foreignOwned.aiCharacterId);
    expect(notOwned.statusCode).toBe(404);
    expect(notOwned.json().code).toBe("CHARACTER_NOT_FOUND");

    const wrongUniverse = await prisma.character.create({
      data: {
        name: "AI Wrong Universe",
        nationality: "Brazil",
        birthDate: new Date("2000-01-01"),
        userId: user.userId,
        universeId: otherUniverse,
        controlledBy: "AI",
      },
    });
    const universeMismatch = await evaluate(app, user, wrongUniverse.id);
    expect(universeMismatch.statusCode).toBe(403);
    expect(universeMismatch.json().code).toBe("CHARACTER_NOT_IN_UNIVERSE");

    const unauthenticated = await app.inject({
      method: "POST",
      url: "/api/ai-behavior/evaluate",
      payload: { characterId: fixture.aiCharacterId },
    });
    expect(unauthenticated.statusCode).toBe(401);

    await app.close();
  });

  it("retorna NO_ACTION como resultado de primeira classe e recusa execução", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("noaction");
    const universe = await createUniverseForUser(user.userId);
    const ai = await prisma.character.create({
      data: {
        name: "AI Solo",
        nationality: "Brazil",
        birthDate: new Date("2000-01-01"),
        userId: user.userId,
        universeId: universe,
        controlledBy: "AI",
      },
    });

    const response = await evaluate(app, user, ai.id);
    expect(response.statusCode).toBe(200);
    const decision = response.json().decision;
    expect(decision.actionType).toBe("NO_ACTION");
    expect(decision.status).toBe("NO_ACTION");
    expect(decision.reason).toBeTruthy();

    const execution = await execute(app, user, decision.id);
    expect(execution.statusCode).toBe(409);
    expect(execution.json().code).toBe("DECISION_NOT_EXECUTABLE");

    await app.close();
  });

  it("executa SEND_MESSAGE pelo Dialogue Engine e persiste via Command Layer", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("execute");
    const fixture = await createFixture(user.userId);

    const evaluated = await evaluate(app, user, fixture.aiCharacterId);
    expect(evaluated.json().decision.actionType).toBe("SEND_MESSAGE");

    const execution = await execute(
      app,
      user,
      evaluated.json().decision.id,
    );
    expect(execution.statusCode).toBe(200);
    const decision = execution.json().decision;
    expect(decision.status).toBe("EXECUTED");
    expect(decision.executedMessageId).toBeTruthy();

    const aiMessage = await prisma.message.findFirst({
      where: {
        conversationId: fixture.conversationId,
        senderType: "AI_CHARACTER",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(aiMessage?.characterId).toBe(fixture.aiCharacterId);
    expect(aiMessage?.content.trim().length).toBeGreaterThan(0);

    const context = (aiMessage?.contextJson ?? {}) as Record<string, unknown>;
    const language = (context.language ?? {}) as Record<string, unknown>;
    const behavior = (context.behavior ?? {}) as Record<string, unknown>;
    expect(language.provider).toBe("dialogue-realizer");
    expect(behavior.reasonCode).toBeTruthy();
    expect(context.family).toBeUndefined();
    expect(context.generationKey).toBeUndefined();

    const official = await prisma.aiDecision.findFirst({
      where: {
        characterId: fixture.aiCharacterId,
        status: "EXECUTED",
        metadata: { path: ["trigger"], equals: "CONVERSATION_TURN_DUE" },
      },
      select: { executedMessageId: true, metadata: true },
    });
    expect(official?.executedMessageId).toBe(aiMessage?.id);
    expect(
      (official?.metadata as Record<string, unknown> | undefined)?.llmUsed,
    ).toBe(false);

    await app.close();
  });

  it("rejeita execução quando o executor não participa da conversa alvo", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("acl-execute");
    const fixture = await createFixture(user.userId);

    const conversation = await prisma.conversation.create({
      data: { type: "GROUP", title: "Sem o executor" },
    });
    createdConversationIds.push(conversation.id);
    await prisma.conversationParticipant.create({
      data: {
        conversationId: conversation.id,
        characterId: fixture.userCharacterId,
      },
    });
    const manipulated = await prisma.aiDecision.create({
      data: {
        universeId: fixture.universeId,
        characterId: fixture.aiCharacterId,
        status: "DECIDED",
        actionType: "SEND_MESSAGE",
        conversationId: conversation.id,
        contextVersion: "ai-behavior.v1",
      },
    });

    const execution = await execute(app, user, manipulated.id);
    expect(execution.statusCode).toBe(200);
    expect(execution.json().decision.status).toBe("REJECTED");
    expect(execution.json().decision.policyCode).toBe("TARGET_NOT_FOUND");
    expect(
      await prisma.message.count({ where: { conversationId: conversation.id } }),
    ).toBe(0);

    await app.close();
  });

  it("rejeição do engine não cria estado parcial", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("engine-reject");
    const fixture = await createFixture(user.userId);

    const evaluated = await evaluate(app, user, fixture.aiCharacterId);
    await prisma.characterAvailability.upsert({
      where: { characterId: fixture.aiCharacterId },
      update: { status: "OFFLINE" },
      create: { characterId: fixture.aiCharacterId, status: "OFFLINE" },
    });

    const execution = await execute(app, user, evaluated.json().decision.id);
    expect(execution.statusCode).toBe(200);
    expect(execution.json().decision.status).toBe("REJECTED");
    expect(execution.json().decision.policyCode).toBe("EXECUTION_REJECTED");

    const messages = await prisma.message.count({
      where: { conversationId: fixture.conversationId },
    });
    expect(messages).toBe(0);

    await app.close();
  });

  it("rejeição é sanitizada e não deixa estado parcial", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("sanitized");
    const fixture = await createFixture(user.userId);

    const evaluated = await evaluate(app, user, fixture.aiCharacterId);
    await prisma.worldState.deleteMany({ where: { universeId: fixture.universeId } });

    const execution = await execute(app, user, evaluated.json().decision.id);
    expect(execution.statusCode).toBe(200);
    expect(execution.json().decision.status).toBe("REJECTED");
    expect(execution.json().decision.policyCode).toBe("PRECONDITION_FAILED");
    expect(JSON.stringify(execution.json())).not.toContain(
      "WorldState sem currentDate",
    );
    expect(
      await prisma.message.count({ where: { conversationId: fixture.conversationId } }),
    ).toBe(0);

    await app.close();
  });

  it("aplica cooldown e limite de frequência", async () => {
    const app = buildApp(undefined, generatedProvider());
    await app.ready();
    const user = await createDbUser("cooldown");
    const fixture = await createFixture(user.userId);

    const first = await evaluate(app, user, fixture.aiCharacterId);
    const executed = await execute(app, user, first.json().decision.id);
    expect(executed.json().decision.status).toBe("EXECUTED");

    const second = await evaluate(app, user, fixture.aiCharacterId);
    const blocked = await execute(app, user, second.json().decision.id);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("COOLDOWN");
    const rejected = await prisma.aiDecision.findUniqueOrThrow({
      where: { id: second.json().decision.id },
    });
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.policyCode).toBe("COOLDOWN");

    const secondAi = await prisma.character.create({
      data: {
        name: "AI Limite",
        nationality: "Brazil",
        birthDate: new Date("2000-01-01"),
        userId: user.userId,
        universeId: fixture.universeId,
        controlledBy: "AI",
      },
    });
    const secondUser = await prisma.character.create({
      data: {
        name: "User Limite",
        nationality: "Brazil",
        birthDate: new Date("2000-01-01"),
        userId: user.userId,
        universeId: fixture.universeId,
        controlledBy: "USER",
      },
    });
    const secondConversation = await prisma.conversation.create({
      data: { type: "GROUP", title: "Limite" },
    });
    createdConversationIds.push(secondConversation.id);
    await prisma.conversationParticipant.createMany({
      data: [
        { conversationId: secondConversation.id, characterId: secondAi.id },
        { conversationId: secondConversation.id, characterId: secondUser.id },
      ],
    });

    for (let index = 0; index < 5; index += 1) {
      await prisma.aiDecision.create({
        data: {
          universeId: fixture.universeId,
          characterId: secondAi.id,
          status: "EXECUTED",
          actionType: "CREATE_EVENT",
          contextVersion: "ai-behavior.v1",
          createdAt: new Date(Date.now() - 5 * 60_000 - index),
        },
      });
    }
    const third = await evaluate(app, user, secondAi.id);
    const limited = await execute(app, user, third.json().decision.id);
    expect(limited.statusCode).toBe(409);
    expect(limited.json().code).toBe("FREQUENCY_LIMIT");

    await app.close();
  });

  it("mantém execução única sob concorrência (avaliação e execução duplas)", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("concurrent");
    const fixture = await createFixture(user.userId);

    const [firstEvaluation, secondEvaluation] = await Promise.all([
      evaluate(app, user, fixture.aiCharacterId),
      evaluate(app, user, fixture.aiCharacterId),
    ]);
    expect(firstEvaluation.statusCode).toBe(200);
    expect(secondEvaluation.statusCode).toBe(200);

    const [firstExecution, secondExecution] = await Promise.all([
      execute(app, user, firstEvaluation.json().decision.id),
      execute(app, user, secondEvaluation.json().decision.id),
    ]);
    const statuses = [
      firstExecution.statusCode,
      secondExecution.statusCode,
    ].sort();
    expect(statuses).toEqual([200, 409]);

    const executedCount = await prisma.aiDecision.count({
      where: {
        characterId: fixture.aiCharacterId,
        status: "EXECUTED",
        contextVersion: "ai-behavior.v1",
      },
    });
    expect(executedCount).toBe(1);
    const messages = await prisma.message.count({
      where: {
        conversationId: fixture.conversationId,
        senderType: "AI_CHARACTER",
      },
    });
    expect(messages).toBe(1);

    await app.close();
  });

  it("rejeita target de outro Universe e decisão manipulada", async () => {
    const app = buildApp(undefined, generatedProvider());
    await app.ready();
    const user = await createDbUser("target");
    const other = await createDbUser("target-other");
    const fixture = await createFixture(user.userId);
    const otherFixture = await createFixture(other.userId, {
      withRace: true,
    });

    const manipulated = await prisma.aiDecision.create({
      data: {
        universeId: fixture.universeId,
        characterId: fixture.aiCharacterId,
        status: "DECIDED",
        actionType: "SEND_MESSAGE",
        conversationId: otherFixture.conversationId,
        contextVersion: "ai-behavior.v1",
      },
    });
    const crossConversation = await execute(app, user, manipulated.id);
    expect(crossConversation.statusCode).toBe(200);
    expect(crossConversation.json().decision.status).toBe("REJECTED");
    expect(crossConversation.json().decision.policyCode).toBe(
      "TARGET_NOT_FOUND",
    );

    const invalidEvent = await prisma.aiDecision.create({
      data: {
        universeId: fixture.universeId,
        characterId: fixture.aiCharacterId,
        status: "DECIDED",
        actionType: "CREATE_EVENT",
        contextVersion: "ai-behavior.v1",
        metadata: { raceId: otherFixture.raceId, participantIds: [] },
      },
    });
    const invalidExecution = await execute(app, user, invalidEvent.id);
    expect(invalidExecution.statusCode).toBe(200);
    expect(invalidExecution.json().decision.status).toBe("REJECTED");
    expect(invalidExecution.json().decision.policyCode).toBe(
      "TARGET_NOT_IN_UNIVERSE",
    );

    await app.close();
  });

  it("integra Event, News, Memory e Relationship no CREATE_EVENT", async () => {
    const app = buildApp();
    await app.ready();
    const user = await createDbUser("event");
    const fixture = await createFixture(user.userId, { withRace: true });

    const evaluated = await evaluate(app, user, fixture.aiCharacterId);
    const decision = evaluated.json().decision;
    expect(decision.actionType).toBe("CREATE_EVENT");
    expect(decision.metadata.raceId).toBe(fixture.raceId);

    const execution = await execute(app, user, decision.id);
    expect(execution.statusCode).toBe(200);
    expect(execution.json().decision.status).toBe("EXECUTED");
    const eventId = execution.json().decision.executedEventId as string;
    createdEventIds.push(eventId);

    const event = await prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      include: { participants: true, newsItems: true },
    });
    expect(event.type).toBe("SOCIAL");
    expect(event.participants.length).toBe(2);
    expect(event.newsItems.length).toBe(1);
    const payload = event.payload as Record<string, unknown>;
    expect(payload.origin).toBe("ai_behavior");
    expect(payload.universeId).toBe(fixture.universeId);
    expect(payload.raceId).toBe(fixture.raceId);

    const memory = await prisma.memory.findFirst({
      where: { eventId },
    });
    expect(memory).not.toBeNull();

    const relationship = await prisma.relationship.findFirst({
      where: {
        OR: [
          {
            characterAId: fixture.aiCharacterId,
            characterBId: fixture.userCharacterId,
          },
          {
            characterAId: fixture.userCharacterId,
            characterBId: fixture.aiCharacterId,
          },
        ],
      },
    });
    expect(relationship).not.toBeNull();

    const reEvaluated = await evaluate(app, user, fixture.aiCharacterId);
    expect(reEvaluated.json().decision.actionType).toBe("SEND_MESSAGE");
    const behaviorEvents = await prisma.event.count({
      where: {
        payload: { path: ["raceId"], equals: fixture.raceId as string },
        AND: [{ payload: { path: ["origin"], equals: "ai_behavior" } }],
      },
    });
    expect(behaviorEvents).toBe(1);

    await app.close();
  });

  it("isola universos e conversas durante a execução", async () => {
    const app = buildApp(undefined, generatedProvider());
    await app.ready();
    const user = await createDbUser("iso");
    const other = await createDbUser("iso-other");
    const fixture = await createFixture(user.userId, {
      secondConversation: true,
    });
    const otherFixture = await createFixture(other.userId);

    const evaluated = await evaluate(app, user, fixture.aiCharacterId);
    const targetConversationId = evaluated.json().decision.conversationId;
    expect([fixture.conversationId, fixture.secondConversationId]).toContain(
      targetConversationId,
    );
    await execute(app, user, evaluated.json().decision.id);

    const targetMessages = await prisma.message.count({
      where: { conversationId: targetConversationId, senderType: "AI_CHARACTER" },
    });
    expect(targetMessages).toBe(1);
    const untouchedConversationId =
      targetConversationId === fixture.conversationId
        ? fixture.secondConversationId
        : fixture.conversationId;
    const untouched = await prisma.message.count({
      where: { conversationId: untouchedConversationId as string },
    });
    expect(untouched).toBe(0);
    const otherMessages = await prisma.message.count({
      where: { conversationId: otherFixture.conversationId },
    });
    expect(otherMessages).toBe(0);

    await app.close();
  });

  it("re-valida estado do personagem antes de executar", async () => {
    const app = buildApp(undefined, generatedProvider());
    await app.ready();
    const user = await createDbUser("state");
    const fixture = await createFixture(user.userId);

    const evaluated = await evaluate(app, user, fixture.aiCharacterId);
    await prisma.character.update({
      where: { id: fixture.aiCharacterId },
      data: { controlledBy: "USER" },
    });

    const execution = await execute(app, user, evaluated.json().decision.id);
    expect(execution.statusCode).toBe(403);
    expect(execution.json().code).toBe("CHARACTER_NOT_AI");

    await app.close();
  });
});
