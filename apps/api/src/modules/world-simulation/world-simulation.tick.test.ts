import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { runSimulationTick } from "./world-simulation.tick.js";

const PREFIX = "world-sim";
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdScheduleIds: string[] = [];
const createdEventIds: string[] = [];
const createdTickIds: string[] = [];

let app: FastifyInstance;
let cookie: string;
let userId: string;
let universeId: string;
let availableCharacterId: string;
let unavailableCharacterId: string;

const WINDOW_FROM = new Date("2026-10-01T00:00:00.000Z");
const WINDOW_TO = new Date("2026-10-02T00:00:00.000Z");

function remoteAddress(): string {
  return `10.31.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
}

async function createCharacter(label: string, availability: "AVAILABLE" | "OFFLINE") {
  const character = await prisma.character.create({
    data: {
      universeId,
      userId,
      controlledBy: "AI",
      name: `${PREFIX}-${label}`,
      nationality: "BR",
      birthDate: new Date("1998-02-15T00:00:00.000Z"),
      availability: { create: { status: availability } },
    },
  });
  createdCharacterIds.push(character.id);
  return character;
}

async function createSchedule(characterId: string, activity: string, startsAt: Date) {
  const schedule = await prisma.characterSchedule.create({
    data: { characterId, activity, startsAt },
  });
  createdScheduleIds.push(schedule.id);
  return schedule;
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  const email = `${PREFIX}-${Date.now()}@f1nw.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: "World Owner", email, password: "senha-segura-123" },
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

  const available = await createCharacter("available", "AVAILABLE");
  const unavailable = await createCharacter("unavailable", "OFFLINE");
  availableCharacterId = available.id;
  unavailableCharacterId = unavailable.id;
  const [pairA, pairB] = [available.id, unavailable.id].sort();
  await prisma.relationship.create({
    data: {
      characterAId: pairA as string,
      characterBId: pairB as string,
      dimensions: {},
    },
  });
  await createSchedule(available.id, "coletiva de imprensa", new Date("2026-10-01T09:00:00.000Z"));
  await createSchedule(unavailable.id, "descanso", new Date("2026-10-01T10:00:00.000Z"));
});

afterAll(async () => {
  const events = await prisma.event.findMany({
    where: { title: { startsWith: PREFIX } },
    select: { id: true },
  });
  const eventIds = events.map((event) => event.id);
  createdEventIds.push(...eventIds);
  if (eventIds.length > 0) {
    await prisma.relationshipChange.deleteMany({
      where: { sourceType: "EVENT", sourceId: { in: eventIds } },
    });
    await prisma.memoryCharacter.deleteMany({
      where: { memory: { eventId: { in: eventIds } } },
    });
    await prisma.memory.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.newsItem.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventCharacter.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  }
  await prisma.simulationTick.deleteMany({ where: { universeId } });
  await prisma.characterSchedule.deleteMany({
    where: { characterId: { in: createdCharacterIds } },
  });
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

describe("world narrative simulation tick (V4.5)", () => {
  it("1) um tick gera evento de agenda + news + consequência social", async () => {
    const result = await runSimulationTick({
      universeId,
      fromDate: WINDOW_FROM,
      toDate: WINDOW_TO,
    });
    createdTickIds.push(result.tickId);
    expect(result.status).toBe("COMPLETED");
    expect(result.reused).toBe(false);
    expect(result.summary?.eventsCreated).toBe(1);
    expect(result.summary?.newsCreated).toBeGreaterThanOrEqual(1);
    expect(result.summary?.skippedUnavailable).toBe(1);

    const event = await prisma.event.findFirstOrThrow({
      where: { payload: { path: ["simulation", "tickId"], equals: result.tickId } },
    });
    expect(event.title).toContain("coletiva de imprensa");
    expect(event.source).toBe("GENERATED_EVENT");
    const relationship = await prisma.relationship.findFirstOrThrow({
      where: { characterAId: availableCharacterId, characterBId: unavailableCharacterId },
    });
    expect((relationship.dimensions as Record<string, number>).affinity).toBeGreaterThan(0);
  });

  it("2) repetir o mesmo tick é idempotente", async () => {
    const eventsBefore = await prisma.event.count({
      where: { title: { startsWith: PREFIX } },
    });
    const result = await runSimulationTick({
      universeId,
      fromDate: WINDOW_FROM,
      toDate: WINDOW_TO,
    });
    expect(result.reused).toBe(true);
    expect(result.status).toBe("COMPLETED");
    const eventsAfter = await prisma.event.count({
      where: { title: { startsWith: PREFIX } },
    });
    expect(eventsAfter).toBe(eventsBefore);
  });

  it("3) dry-run calcula o plano sem persistir mutações", async () => {
    const eventsBefore = await prisma.event.count({
      where: { title: { startsWith: PREFIX } },
    });
    const result = await runSimulationTick({
      universeId,
      fromDate: new Date("2026-10-02T00:00:00.000Z"),
      toDate: new Date("2026-10-03T00:00:00.000Z"),
      dryRun: true,
    });
    createdTickIds.push(result.tickId);
    expect(result.status).toBe("DRY_RUN");
    expect(result.summary?.planned).toBe(0);
    expect(
      await prisma.event.count({ where: { title: { startsWith: PREFIX } } }),
    ).toBe(eventsBefore);
  });

  it("4) budget limita eventos por tick", async () => {
    await createSchedule(availableCharacterId, "treino livre", new Date("2026-10-04T09:00:00.000Z"));
    await createSchedule(availableCharacterId, "briefing técnico", new Date("2026-10-04T10:00:00.000Z"));
    process.env.WORLD_SIM_MAX_EVENTS_PER_TICK = "1";
    try {
      const result = await runSimulationTick({
        universeId,
        fromDate: new Date("2026-10-04T00:00:00.000Z"),
        toDate: new Date("2026-10-05T00:00:00.000Z"),
      });
      createdTickIds.push(result.tickId);
      expect(result.summary?.eventsCreated).toBe(1);
      expect(result.summary?.skippedByBudget).toBeGreaterThanOrEqual(1);
    } finally {
      delete process.env.WORLD_SIM_MAX_EVENTS_PER_TICK;
    }
  });

  it("5) agenda fora da janela é ignorada", async () => {
    const result = await runSimulationTick({
      universeId,
      fromDate: new Date("2026-09-01T00:00:00.000Z"),
      toDate: new Date("2026-09-02T00:00:00.000Z"),
    });
    createdTickIds.push(result.tickId);
    expect(result.summary?.scheduleDue).toBe(0);
    expect(result.summary?.eventsCreated).toBe(0);
  });

  it("6) estado canônico não é alterado pelo tick", async () => {
    const worldBefore = await prisma.worldState.findUniqueOrThrow({
      where: { universeId_key: { universeId, key: "default" } },
      select: { currentDate: true },
    });
    const results = await prisma.raceResult.count();
    const standings = await prisma.championshipStanding.count();
    const result = await runSimulationTick({
      universeId,
      fromDate: new Date("2026-10-06T00:00:00.000Z"),
      toDate: new Date("2026-10-07T00:00:00.000Z"),
    });
    createdTickIds.push(result.tickId);
    const worldAfter = await prisma.worldState.findUniqueOrThrow({
      where: { universeId_key: { universeId, key: "default" } },
      select: { currentDate: true },
    });
    expect(worldAfter.currentDate).toEqual(worldBefore.currentDate);
    expect(await prisma.raceResult.count()).toBe(results);
    expect(await prisma.championshipStanding.count()).toBe(standings);
  });

  it("7) rota autenticada executa tick e lista histórico", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/world/simulation-tick",
      headers: { cookie },
      payload: {
        fromDate: "2026-10-08T00:00:00.000Z",
        toDate: "2026-10-09T00:00:00.000Z",
        dryRun: true,
      },
      remoteAddress: remoteAddress(),
    });
    expect([200, 201]).toContain(response.statusCode);
    const list = await app.inject({
      method: "GET",
      url: "/api/world/simulation-ticks",
      headers: { cookie },
      remoteAddress: remoteAddress(),
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { ticks: unknown[] };
    expect(body.ticks.length).toBeGreaterThanOrEqual(1);
  });

  it("8) outro usuário não acessa ticks do Universe", async () => {
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
      method: "GET",
      url: `/api/world/simulation-ticks?universeId=${universeId}`,
      headers: { cookie: otherCookie },
      remoteAddress: remoteAddress(),
    });
    expect(response.statusCode).toBe(404);
  });
});
