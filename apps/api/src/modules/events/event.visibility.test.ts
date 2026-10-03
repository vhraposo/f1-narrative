import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { runAutonomousTick } from "../autonomy/autonomy.service.js";
import {
  buildAutonomyOpportunityPlan,
  readConversationOpportunityAudit,
} from "../autonomy/autonomy.opportunities.js";
import { assembleGenerationBundle } from "../generation/generation.assembly.js";
import type { GenerationProvider } from "../generation/generation.assembly.js";

// F7.3 — audiência de Event (PUBLIC/RESTRICTED) em TEST DB.
// Cobre API, contexto legado e F6 (opportunity). Cleanup completo.

const PREFIX = "event-visibility";
const WINDOW_START = new Date("2026-10-01T00:00:00.000Z");
const SIGNAL_AT = new Date("2026-10-01T12:00:00.000Z");
const TO_1 = new Date("2026-10-02T00:00:00.000Z");

let app: FastifyInstance;

type TestUser = { cookie: string; userId: string };

const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];
const createdEventIds: string[] = [];

let owner: TestUser;
let outsider: TestUser;
let ownerUniverseId: string;
let characterAId: string;
let characterBId: string;
let characterCId: string;
let conversationAbId: string;

function stubProvider(): GenerationProvider {
  return {
    name: "stub-f7-event",
    async run() {
      return {
        provider: "stub-f7-event",
        mode: "generated" as const,
        text: "ok",
        tokenStats: { systemPromptChars: 0, contextBlocks: 0 },
      };
    },
  };
}

async function createUser(label: string): Promise<TestUser> {
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
  return { cookie, userId: user.id };
}

async function createAiCharacter(
  userId: string,
  universeId: string,
  name: string,
): Promise<string> {
  const character = await prisma.character.create({
    data: {
      userId,
      universeId,
      controlledBy: "AI",
      name,
      nationality: "BR",
      birthDate: new Date("1995-01-01T00:00:00.000Z"),
    },
  });
  createdCharacterIds.push(character.id);
  return character.id;
}

async function createConversation(participantIds: string[]): Promise<string> {
  const conversation = await prisma.conversation.create({
    data: {
      type: "GROUP",
      createdAt: SIGNAL_AT,
      participants: { create: participantIds.map((characterId) => ({ characterId })) },
    },
  });
  createdConversationIds.push(conversation.id);
  return conversation.id;
}

async function createRestrictedEvent(input: {
  participantIds: string[];
  title: string;
  worldDate?: Date;
}): Promise<string> {
  const event = await prisma.event.create({
    data: {
      type: "SOCIAL",
      importance: "HIGH",
      source: "GENERATED_EVENT",
      visibility: "RESTRICTED",
      title: input.title,
      worldDate: input.worldDate ?? SIGNAL_AT,
      participants: {
        create: input.participantIds.map((characterId) => ({ characterId })),
      },
    },
  });
  createdEventIds.push(event.id);
  return event.id;
}

async function createEventApi(
  user: TestUser,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; id?: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/events",
    headers: { cookie: user.cookie },
    payload,
  });
  const body = res.json() as { event?: { id: string } };
  if (res.statusCode === 201 && body.event?.id) {
    createdEventIds.push(body.event.id);
    return { statusCode: res.statusCode, id: body.event.id };
  }
  return { statusCode: res.statusCode };
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  owner = await createUser("owner");
  outsider = await createUser("outsider");
  const ownerUniverse = await prisma.universe.upsert({
    where: { userId: owner.userId },
    update: { autonomyMode: "GUIDED", autonomyStatus: "ACTIVE" },
    create: { userId: owner.userId, autonomyMode: "GUIDED", autonomyStatus: "ACTIVE" },
  });
  ownerUniverseId = ownerUniverse.id;
  createdUniverseIds.push(ownerUniverse.id);
  await prisma.universe.upsert({
    where: { userId: outsider.userId },
    update: {},
    create: { userId: outsider.userId },
  });
  await prisma.worldState.create({
    data: { universeId: ownerUniverseId, key: "default", currentDate: WINDOW_START },
  });

  characterAId = await createAiCharacter(owner.userId, ownerUniverseId, `${PREFIX}-a`);
  characterBId = await createAiCharacter(owner.userId, ownerUniverseId, `${PREFIX}-b`);
  characterCId = await createAiCharacter(owner.userId, ownerUniverseId, `${PREFIX}-c`);
  conversationAbId = await createConversation([characterAId, characterBId]);
});

afterAll(async () => {
  await prisma.simulationTick.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
  await prisma.aiDecision.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
  await prisma.characterGoal.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
  if (createdEventIds.length > 0) {
    await prisma.newsItem.deleteMany({ where: { eventId: { in: createdEventIds } } });
    await prisma.eventCharacter.deleteMany({ where: { eventId: { in: createdEventIds } } });
    await prisma.memory.deleteMany({ where: { eventId: { in: createdEventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
  }
  if (createdConversationIds.length > 0) {
    await prisma.message.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  }
  if (createdCharacterIds.length > 0) {
    await prisma.relationshipChange.deleteMany({
      where: {
        OR: [
          { characterAId: { in: createdCharacterIds } },
          { characterBId: { in: createdCharacterIds } },
        ],
      },
    });
    await prisma.relationship.deleteMany({
      where: {
        OR: [
          { characterAId: { in: createdCharacterIds } },
          { characterBId: { in: createdCharacterIds } },
        ],
      },
    });
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

describe("F7.3 — audiência de Event", () => {
  it("PUBLIC continua acessível a qualquer usuário autenticado", async () => {
    const created = await createEventApi(owner, {
      type: "NEWS",
      title: `${PREFIX}-public`,
      visibility: "PUBLIC",
    });
    expect(created.statusCode).toBe(201);
    const publicId = created.id!;

    const outsiderGet = await app.inject({
      method: "GET",
      url: `/api/events/${publicId}`,
      headers: { cookie: outsider.cookie },
    });
    expect(outsiderGet.statusCode).toBe(200);

    const outsiderList = await app.inject({
      method: "GET",
      url: "/api/events",
      headers: { cookie: outsider.cookie },
    });
    expect(outsiderList.statusCode).toBe(200);
    expect(
      (outsiderList.json() as { events: Array<{ id: string; visibility: string }> }).events.some(
        (event) => event.id === publicId && event.visibility === "PUBLIC",
      ),
    ).toBe(true);
  });

  it("RESTRICTED é invisível para não autorizado (lista e GET)", async () => {
    const created = await createEventApi(owner, {
      type: "PERSONAL",
      title: `${PREFIX}-restricted`,
      visibility: "RESTRICTED",
    });
    expect(created.statusCode).toBe(201);
    const restrictedId = created.id!;

    const ownerGet = await app.inject({
      method: "GET",
      url: `/api/events/${restrictedId}`,
      headers: { cookie: owner.cookie },
    });
    expect(ownerGet.statusCode).toBe(200);

    const outsiderGet = await app.inject({
      method: "GET",
      url: `/api/events/${restrictedId}`,
      headers: { cookie: outsider.cookie },
    });
    expect(outsiderGet.statusCode).toBe(404);

    const outsiderList = await app.inject({
      method: "GET",
      url: "/api/events",
      headers: { cookie: outsider.cookie },
    });
    expect(outsiderList.statusCode).toBe(200);
    expect(
      (outsiderList.json() as { events: Array<{ id: string }> }).events.map((event) => event.id),
    ).not.toContain(restrictedId);
  });

  it("EventCharacter é a audiência do RESTRICTED para personagens do mesmo usuário", async () => {
    const restrictedId = await createRestrictedEvent({
      participantIds: [characterAId],
      title: `${PREFIX}-restricted-audience`,
    });
    const participantAdd = await app.inject({
      method: "POST",
      url: `/api/events/${restrictedId}/participants`,
      headers: { cookie: owner.cookie },
      payload: { characterId: characterAId },
    });
    // já criado via prisma; a rota é exercitada em outro caso — aqui só confirma
    // que o dono enxerga e um terceiro não.
    expect([201, 409]).toContain(participantAdd.statusCode);

    const ownerGet = await app.inject({
      method: "GET",
      url: `/api/events/${restrictedId}`,
      headers: { cookie: owner.cookie },
    });
    expect(ownerGet.statusCode).toBe(200);

    const outsiderGet = await app.inject({
      method: "GET",
      url: `/api/events/${restrictedId}`,
      headers: { cookie: outsider.cookie },
    });
    expect(outsiderGet.statusCode).toBe(404);
  });

  it("news: RESTRICTED não gera notícia e a remove ao reclassificar", async () => {
    const created = await createEventApi(owner, {
      type: "NEWS",
      title: `${PREFIX}-news-cycle`,
      visibility: "RESTRICTED",
    });
    expect(created.statusCode).toBe(201);
    const eventId = created.id!;
    expect(await prisma.newsItem.count({ where: { eventId } })).toBe(0);

    const toPublic = await app.inject({
      method: "PATCH",
      url: `/api/events/${eventId}`,
      headers: { cookie: owner.cookie },
      payload: { visibility: "PUBLIC" },
    });
    expect(toPublic.statusCode).toBe(200);
    expect(await prisma.newsItem.count({ where: { eventId } })).toBe(1);

    const toRestricted = await app.inject({
      method: "PATCH",
      url: `/api/events/${eventId}`,
      headers: { cookie: owner.cookie },
      payload: { visibility: "RESTRICTED" },
    });
    expect(toRestricted.statusCode).toBe(200);
    expect(await prisma.newsItem.count({ where: { eventId } })).toBe(0);
  });

  it("contexto legado respeita a audiência do evento RESTRICTED", async () => {
    const eventId = await createRestrictedEvent({
      participantIds: [characterAId],
      title: `${PREFIX}-context-restricted`,
    });

    const forA = await assembleGenerationBundle(
      prisma,
      { conversationId: conversationAbId, userId: owner.userId, targetCharacterId: characterAId },
      stubProvider(),
    );
    expect(forA.context.events.map((event) => event.id)).toContain(eventId);
    expect(forA.systemPrompt).toContain(`${PREFIX}-context-restricted`);

    const forB = await assembleGenerationBundle(
      prisma,
      { conversationId: conversationAbId, userId: owner.userId, targetCharacterId: characterBId },
      stubProvider(),
    );
    expect(forB.context.events.map((event) => event.id)).not.toContain(eventId);
    expect(forB.systemPrompt).not.toContain(`${PREFIX}-context-restricted`);

    const audienced = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationAbId}/context?characterId=${characterBId}`,
      headers: { cookie: owner.cookie },
    });
    expect(audienced.statusCode).toBe(200);
    expect(
      (audienced.json() as { context: { events: Array<{ id: string }> } }).context.events.map(
        (event) => event.id,
      ),
    ).not.toContain(eventId);
  });

  it("F6: RESTRICTED gera oportunidade só para o participante autorizado", async () => {
    await createRestrictedEvent({
      participantIds: [characterAId],
      title: `${PREFIX}-f6-restricted`,
    });

    const result = await runAutonomousTick({ universeId: ownerUniverseId, toDate: TO_1 });
    expect(result.status).toBe("EXECUTED");
    const decisions = await prisma.aiDecision.findMany({
      where: { universeId: ownerUniverseId },
      select: { characterId: true, metadata: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const audits = decisions
      .map((decision) => ({
        characterId: decision.characterId,
        audit: readConversationOpportunityAudit(decision.metadata),
      }))
      .filter((entry) => entry.audit !== null);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.characterId).toBe(characterAId);
    expect(String(audits[0]!.audit!.evidenceId)).toMatch(/^event:/);

    const auditedCharacters = new Set(audits.map((entry) => entry.characterId));
    expect(auditedCharacters.has(characterBId)).toBe(false);
    expect(auditedCharacters.has(characterCId)).toBe(false);
  });

  it("F6: PUBLIC continua gerando oportunidade e o plano é determinístico", async () => {
    const publicUser = await createUser("public-f6");
    const secondUniverse = await prisma.universe.upsert({
      where: { userId: publicUser.userId },
      update: { autonomyMode: "GUIDED", autonomyStatus: "ACTIVE" },
      create: { userId: publicUser.userId, autonomyMode: "GUIDED", autonomyStatus: "ACTIVE" },
    });
    createdUniverseIds.push(secondUniverse.id);
    const a = await createAiCharacter(publicUser.userId, secondUniverse.id, `${PREFIX}-p-a`);
    const b = await createAiCharacter(publicUser.userId, secondUniverse.id, `${PREFIX}-p-b`);
    await prisma.worldState.create({
      data: { universeId: secondUniverse.id, key: "default", currentDate: WINDOW_START },
    });
    await createConversation([a, b]);
    const event = await prisma.event.create({
      data: {
        type: "NEWS",
        importance: "HIGH",
        source: "GENERATED_EVENT",
        visibility: "PUBLIC",
        title: `${PREFIX}-f6-public`,
        worldDate: SIGNAL_AT,
        participants: { create: [{ characterId: b }] },
      },
    });
    createdEventIds.push(event.id);

    const planInput = {
      universeId: secondUniverse.id,
      fromDate: WINDOW_START,
      toDate: TO_1,
      characterIds: [a, b],
      maxConversations: 2,
      cooldownHours: 24,
    };
    const firstPlan = await buildAutonomyOpportunityPlan(planInput);
    const secondPlan = await buildAutonomyOpportunityPlan(planInput);
    expect(firstPlan.selection.selected.some((entry) => entry.evidenceId === `event:${event.id}`)).toBe(
      true,
    );
    expect(secondPlan.selection.selected.map((entry) => entry.evidenceId)).toEqual(
      firstPlan.selection.selected.map((entry) => entry.evidenceId),
    );
    expect(secondPlan.selection.selected.map((entry) => entry.opportunity.fingerprint)).toEqual(
      firstPlan.selection.selected.map((entry) => entry.opportunity.fingerprint),
    );

    await runAutonomousTick({ universeId: secondUniverse.id, toDate: TO_1 });
    const audits = (
      await prisma.aiDecision.findMany({
        where: { universeId: secondUniverse.id },
        select: { metadata: true },
      })
    )
      .map((decision) => readConversationOpportunityAudit(decision.metadata))
      .filter((audit) => audit !== null);
    expect(audits.some((audit) => audit!.evidenceId === `event:${event.id}`)).toBe(true);
  });
});
