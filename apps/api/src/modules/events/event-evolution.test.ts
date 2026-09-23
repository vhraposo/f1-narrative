import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  isEligibleForEvolution,
  computeEventDelta,
  mergeEvolutionDimensions,
} from "./event-evolution.js";

let app: FastifyInstance;

type TestUser = {
  cookie: string;
  userId: string;
};

type EventRecord = {
  id: string;
  type: string;
  importance: string;
  source: string;
  title: string;
  description: string | null;
  worldDate: string | null;
  createdAt: string;
};

type Character = {
  id: string;
  name: string;
  nationality: string;
};

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdEventIds: string[] = [];

function track<T extends { id: string }>(list: string[], entity: T): T {
  list.push(entity.id);
  return entity;
}

async function createUser(email: string, name: string): Promise<TestUser> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name, email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const cookie = (res.cookies ?? [])
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const user = track(
    createdUserIds,
    await prisma.user.findUniqueOrThrow({ where: { email } }),
  );
  return { cookie, userId: user.id };
}

async function createCharacter(
  user: TestUser,
  payload: Record<string, unknown>,
): Promise<Character> {
  const res = await app.inject({
    method: "POST",
    url: "/api/characters",
    headers: { cookie: user.cookie },
    payload,
  });
  expect(res.statusCode).toBe(201);
  return track(createdCharacterIds, res.json().character as Character);
}

async function createEvent(
  user: TestUser,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; json: { event?: EventRecord; code?: string } }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/events",
    headers: { cookie: user.cookie },
    payload,
  });
  if (res.statusCode === 201 && res.json().event) {
    track(createdEventIds, res.json().event as { id: string });
  }
  return { statusCode: res.statusCode, json: res.json() as { event?: EventRecord; code?: string } };
}

async function addParticipant(
  user: TestUser,
  eventId: string,
  characterId: string,
): Promise<{ statusCode: number; json: { participant?: unknown; code?: string } }> {
  const res = await app.inject({
    method: "POST",
    url: `/api/events/${eventId}/participants`,
    headers: { cookie: user.cookie },
    payload: { characterId },
  });
  return { statusCode: res.statusCode, json: res.json() };
}

let owner: TestUser;
let charA: Character;
let charB: Character;

beforeAll(async () => {
  app = buildApp();
  await app.ready();

  const suffix = Date.now();
  owner = await createUser(`ev-evo-owner-${suffix}@f1nw.test`, "EvoOwner");

  charA = await createCharacter(owner, {
    name: "Evo Char A",
    nationality: "Brasileira",
    birthDate: "1995-01-01",
  });
  charB = await createCharacter(owner, {
    name: "Evo Char B",
    nationality: "Britânica",
    birthDate: "1990-01-01",
  });
});

afterAll(async () => {
  await prisma.memoryCharacter.deleteMany({
    where: { memory: { eventId: { in: createdEventIds } } },
  });
  await prisma.memory.deleteMany({ where: { eventId: { in: createdEventIds } } });
  await prisma.relationship.deleteMany({
    where: {
      OR: [
        { characterAId: { in: createdCharacterIds } },
        { characterBId: { in: createdCharacterIds } },
      ],
    },
  });
  await prisma.newsItem.deleteMany({
    where: { eventId: { in: createdEventIds } },
  });
  await prisma.eventCharacter.deleteMany({
    where: { eventId: { in: createdEventIds } },
  });
  await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

  await prisma.$disconnect();
  await app.close();
});

describe("event-evolution — camada pura", () => {
  it("eligibilidade: apenas tipos elegíveis com worldDate definido", () => {
    expect(isEligibleForEvolution("RACE_INCIDENT", new Date())).toBe(true);
    expect(isEligibleForEvolution("RELATIONSHIP", new Date())).toBe(true);
    expect(isEligibleForEvolution("SOCIAL", new Date())).toBe(true);
    expect(isEligibleForEvolution("RACE_INCIDENT", null)).toBe(false);
    expect(isEligibleForEvolution("RACE", new Date())).toBe(false);
    expect(isEligibleForEvolution("RELATIONSHIP", null)).toBe(false);
    expect(isEligibleForEvolution("PERSONAL", new Date())).toBe(false);
    expect(isEligibleForEvolution("NEWS", new Date())).toBe(false);
    expect(isEligibleForEvolution("WORLD", new Date())).toBe(false);
  });

  it("deltas por tipo e importância (MEDIUM = peso 1)", () => {
    expect(computeEventDelta("RACE_INCIDENT", "MEDIUM")).toEqual({
      affinity: -20,
      trust: -10,
      rivalry: 30,
    });
    expect(computeEventDelta("RELATIONSHIP", "MEDIUM")).toEqual({
      affinity: 25,
      trust: 20,
      rivalry: -10,
    });
    expect(computeEventDelta("SOCIAL", "MEDIUM")).toEqual({
      affinity: 10,
      trust: 5,
      rivalry: 0,
    });
  });

  it("importância escalona deltas (LOW/HIGH/CRITICAL)", () => {
    expect(computeEventDelta("RACE_INCIDENT", "HIGH")).toEqual({
      affinity: -30,
      trust: -15,
      rivalry: 45,
    });
    expect(computeEventDelta("RACE_INCIDENT", "CRITICAL")).toEqual({
      affinity: -40,
      trust: -20,
      rivalry: 60,
    });
    expect(computeEventDelta("RELATIONSHIP", "LOW")).toEqual({
      affinity: 13,
      trust: 10,
      rivalry: -5,
    });
  });

  it("merge preserva chaves legadas e aplica clamp -100..100", () => {
    const merged = mergeEvolutionDimensions(
      { affinity: 90, trust: 50, rivalry: -95, fame: 7 },
      { affinity: 25, trust: 20, rivalry: -10 },
    );
    expect(merged).toEqual({
      affinity: 100,
      trust: 70,
      rivalry: -100,
      fame: 7,
    });
  });

  it("merge parte de 0 quando dimensions ausente ou vazia", () => {
    expect(mergeEvolutionDimensions({}, { affinity: 10, trust: 5, rivalry: 0 })).toEqual({
      affinity: 10,
      trust: 5,
      rivalry: 0,
    });
    expect(mergeEvolutionDimensions({}, { affinity: 10, trust: 5, rivalry: 0 })).toEqual(
      mergeEvolutionDimensions(null, { affinity: 10, trust: 5, rivalry: 0 }),
    );
  });
});

describe("event-evolution — integração via API", () => {
  it("RACE_INCIDENT com worldDate + 2 participantes → cria Relationship com deltas e Memory evolução", async () => {
    const { json } = await createEvent(owner, {
      type: "RACE_INCIDENT",
      title: "Toque no grid",
      description: "Colisão na curva 1",
      importance: "HIGH",
      worldDate: "2026-09-20T10:00:00.000Z",
    });
    const event = json.event as EventRecord;

    await addParticipant(owner, event.id, charA.id);
    await addParticipant(owner, event.id, charB.id);

    const relationship = await prisma.relationship.findFirst({
      where: {
        OR: [
          { characterAId: charA.id, characterBId: charB.id },
          { characterAId: charB.id, characterBId: charA.id },
        ],
      },
    });
    expect(relationship).not.toBeNull();
    const dims = relationship!.dimensions as Record<string, unknown>;
    expect(dims.affinity).toBe(-30);
    expect(dims.trust).toBe(-15);
    expect(dims.rivalry).toBe(45);

    const memory = await prisma.memory.findFirst({
      where: { eventId: event.id, source: "GENERATED_EVENT" },
      include: { participants: true },
    });
    expect(memory).not.toBeNull();
    expect(memory!.importance).toBe("HIGH");
    expect(memory!.participants.map((p) => p.characterId).sort()).toEqual(
      [charA.id, charB.id].sort(),
    );
  });

  it("idempotência: reprocessar o mesmo Event não duplica Memory nem reaplica delta", async () => {
    const { json } = await createEvent(owner, {
      type: "RELATIONSHIP",
      title: "Aliança",
      importance: "MEDIUM",
      worldDate: "2026-09-21T10:00:00.000Z",
    });
    const event = json.event as EventRecord;

    await addParticipant(owner, event.id, charA.id);
    await addParticipant(owner, event.id, charB.id);

    const memoriesBefore = await prisma.memory.count({ where: { eventId: event.id } });
    const dimsBefore = (
      (await prisma.relationship.findFirstOrThrow({
        where: {
          OR: [
            { characterAId: charA.id, characterBId: charB.id },
            { characterAId: charB.id, characterBId: charA.id },
          ],
        },
      }))!.dimensions as Record<string, unknown>
    ).affinity;

    const { applyEventEvolution } = await import("./event-evolution.js");
    await prisma.$transaction(async (tx) => {
      await applyEventEvolution(tx, event.id);
    });

    const memoriesAfter = await prisma.memory.count({ where: { eventId: event.id } });
    const dimsAfter = (
      (await prisma.relationship.findFirstOrThrow({
        where: {
          OR: [
            { characterAId: charA.id, characterBId: charB.id },
            { characterAId: charB.id, characterBId: charA.id },
          ],
        },
      }))!.dimensions as Record<string, unknown>
    ).affinity;

    expect(memoriesAfter).toBe(memoriesBefore);
    expect(dimsAfter).toBe(dimsBefore);
  });

  it("RELATIONSHIP 3 participantes → pares distintos evoluídos idempotentemente", async () => {
    const charC = await createCharacter(owner, {
      name: "Evo Char C",
      nationality: "Italiana",
      birthDate: "1992-01-01",
    });
    const { json } = await createEvent(owner, {
      type: "SOCIAL",
      title: "Jantar",
      importance: "MEDIUM",
      worldDate: "2026-09-22T10:00:00.000Z",
    });
    const event = json.event as EventRecord;

    await addParticipant(owner, event.id, charA.id);
    await addParticipant(owner, event.id, charB.id);
    await addParticipant(owner, event.id, charC.id);

    const relationshipAB = await prisma.relationship.findFirst({
      where: {
        OR: [
          { characterAId: charA.id, characterBId: charB.id },
          { characterAId: charB.id, characterBId: charA.id },
        ],
      },
    });
    const relationshipAC = await prisma.relationship.findFirst({
      where: {
        OR: [
          { characterAId: charA.id, characterBId: charC.id },
          { characterAId: charC.id, characterBId: charA.id },
        ],
      },
    });
    const relationshipBC = await prisma.relationship.findFirst({
      where: {
        OR: [
          { characterAId: charB.id, characterBId: charC.id },
          { characterAId: charC.id, characterBId: charB.id },
        ],
      },
    });
    expect(relationshipAB).not.toBeNull();
    expect(relationshipAC).not.toBeNull();
    expect(relationshipBC).not.toBeNull();

    const memory = await prisma.memory.findFirstOrThrow({
      where: { eventId: event.id, source: "GENERATED_EVENT" },
      include: { participants: true },
    });
    expect(memory.participants.map((p) => p.characterId).sort()).toEqual(
      [charA.id, charB.id, charC.id].sort(),
    );
    expect(memory.summary).toBe("Jantar");
  });

  it("Evento não elegível (RACE) não gera evolução", async () => {
    const sourcesBefore = await prisma.relationship.count({
      where: {
        OR: [
          { characterAId: charA.id },
          { characterBId: charA.id },
        ],
      },
    });
    const { json } = await createEvent(owner, {
      type: "RACE",
      title: "GP sem evolução",
      worldDate: "2026-09-23T10:00:00.000Z",
    });
    const event = json.event as EventRecord;

    await addParticipant(owner, event.id, charA.id);
    await addParticipant(owner, event.id, charB.id);

    const sourcesAfter = await prisma.relationship.count({
      where: {
        OR: [
          { characterAId: charA.id },
          { characterBId: charA.id },
        ],
      },
    });
    const memory = await prisma.memory.findFirst({ where: { eventId: event.id } });

    expect(sourcesAfter).toBe(sourcesBefore);
    expect(memory).toBeNull();
  });

  it("Evento elegível sem worldDate não gera evolução", async () => {
    const { json } = await createEvent(owner, {
      type: "SOCIAL",
      title: "Sem data",
    });
    const event = json.event as EventRecord;

    await addParticipant(owner, event.id, charA.id);
    await addParticipant(owner, event.id, charB.id);

    const memory = await prisma.memory.findFirst({ where: { eventId: event.id } });
    expect(memory).toBeNull();
  });

  it("evolução funde em Relationship existente preservando chaves legadas", async () => {
    const existingRel = await prisma.relationship.findFirstOrThrow({
      where: {
        OR: [
          { characterAId: charA.id, characterBId: charB.id },
          { characterAId: charB.id, characterBId: charA.id },
        ],
      },
    });
    await prisma.relationship.update({
      where: { id: existingRel.id },
      data: { dimensions: { affinity: 50, note: "parceiros" } as Prisma.InputJsonValue },
    });

    const { json } = await createEvent(owner, {
      type: "RELATIONSHIP",
      title: "Reaproximação",
      importance: "MEDIUM",
      worldDate: "2026-09-24T10:00:00.000Z",
    });
    const event = json.event as EventRecord;
    await addParticipant(owner, event.id, charA.id);
    await addParticipant(owner, event.id, charB.id);

    const relationship = await prisma.relationship.findFirstOrThrow({
      where: {
        OR: [
          { characterAId: charA.id, characterBId: charB.id },
          { characterAId: charB.id, characterBId: charA.id },
        ],
      },
    });
    const dims = relationship.dimensions as Record<string, unknown>;
    expect(dims.affinity).toBe(75);
    expect(dims.note).toBe("parceiros");
  });

  it("DELETE evento evoluído limpa Memory vinculada e mantém Character", async () => {
    const { json } = await createEvent(owner, {
      type: "SOCIAL",
      title: "Deletável",
      importance: "MEDIUM",
      worldDate: "2026-09-25T10:00:00.000Z",
    });
    const event = json.event as EventRecord;
    await addParticipant(owner, event.id, charA.id);
    await addParticipant(owner, event.id, charB.id);

    expect(
      await prisma.memory.count({ where: { eventId: event.id } }),
    ).toBeGreaterThan(0);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/events/${event.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(del.statusCode).toBe(204);

    expect(await prisma.memory.count({ where: { eventId: event.id } })).toBe(0);
    expect(await prisma.character.findUnique({ where: { id: charA.id } })).not.toBeNull();
  });
});