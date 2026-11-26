import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { getAutonomyState, runAutonomousTick, updateAutonomy } from "./autonomy.service.js";

const PREFIX = "autonomy";
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];

let app: FastifyInstance;
let cookie: string;
let userId: string;
let universeId: string;
let aiCharacterId: string;
let secondAiCharacterId: string;
let userCharacterId: string;

function remoteAddress(): string {
  return `10.41.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
}

async function createCharacter(label: string, controller: "AI" | "USER") {
  const character = await prisma.character.create({
    data: {
      universeId,
      userId,
      controlledBy: controller,
      name: `${PREFIX}-${label}`,
      nationality: "BR",
      birthDate: new Date("1998-02-15T00:00:00.000Z"),
      driverProfile: { create: { number: controller === "AI" ? 1 : 2 } },
      availability: { create: { status: "AVAILABLE" } },
    },
  });
  createdCharacterIds.push(character.id);
  return character;
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  const email = `${PREFIX}-${Date.now()}@f1nw.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: "Autonomy Owner", email, password: "senha-segura-123" },
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
      currentDate: new Date("2026-10-01T00:00:00.000Z"),
    },
  });

  const ai = await createCharacter("ai", "AI");
  const secondAi = await createCharacter("ai-2", "AI");
  const userChar = await createCharacter("user", "USER");
  aiCharacterId = ai.id;
  secondAiCharacterId = secondAi.id;
  userCharacterId = userChar.id;

  const [pairA, pairB] = [ai.id, secondAi.id].sort();
  await prisma.relationship.create({
    data: { characterAId: pairA as string, characterBId: pairB as string, dimensions: { rivalry: 0.4 } },
  });
  for (const characterId of [ai.id, secondAi.id, userChar.id]) {
    await prisma.pilotExperience.create({
      data: {
        universeId,
        characterId,
        experienceType: "SPORTING_DEFEAT",
        source: "RACE_RESULT",
        sourceKey: `${PREFIX}-${characterId}`,
        title: "Derrota significativa",
        salience: "HIGH",
        status: "ACTIVE",
        occurredAt: new Date("2026-09-30T00:00:00.000Z"),
      },
    });
  }
});

afterAll(async () => {
  await prisma.simulationTick.deleteMany({ where: { universeId } });
  await prisma.aiDecision.deleteMany({ where: { universeId } });
  await prisma.characterGoal.deleteMany({ where: { universeId } });
  await prisma.memoryCharacter.deleteMany({
    where: { characterId: { in: createdCharacterIds } },
  });
  await prisma.memory.deleteMany({ where: { participants: { none: {} }, universeId } });
  await prisma.pilotExperience.deleteMany({
    where: { characterId: { in: createdCharacterIds } },
  });
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
  if (createdCharacterIds.length > 0) {
    await prisma.characterAvailability.deleteMany({
      where: { characterId: { in: createdCharacterIds } },
    });
    await prisma.characterSchedule.deleteMany({
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

describe("autonomous universe (V4.7)", () => {
  it("1) modo OFF não executa nada", async () => {
    const result = await runAutonomousTick({ universeId });
    expect(result.status).toBe("SKIPPED");
    expect(result.reasonCode).toBe("AUTONOMY_DISABLED");
  });

  it("2) PAUSED não executa mesmo em FULL", async () => {
    await updateAutonomy(universeId, { mode: "FULL", status: "PAUSED" });
    const result = await runAutonomousTick({ universeId });
    expect(result.status).toBe("SKIPPED");
    expect(result.reasonCode).toBe("AUTONOMY_PAUSED");
  });

  it("3) OBSERVER avalia decisões sem executar", async () => {
    await updateAutonomy(universeId, { mode: "OBSERVER", status: "ACTIVE" });
    const result = await runAutonomousTick({ universeId });
    expect(result.status).toBe("EXECUTED");
    expect(result.decisionsEvaluated).toBeGreaterThanOrEqual(1);
    expect(result.actionsExecuted).toBe(0);
    const decisions = await prisma.aiDecision.count({ where: { universeId } });
    expect(decisions).toBeGreaterThanOrEqual(1);
    expect(await prisma.memory.count({ where: { universeId } })).toBe(0);
  });

  it("4) FULL executa ação segura e avança o cursor", async () => {
    await updateAutonomy(universeId, { mode: "FULL", status: "ACTIVE" });
    const result = await runAutonomousTick({
      universeId,
      toDate: new Date("2026-10-03T00:00:00.000Z"),
    });
    expect(result.status).toBe("EXECUTED");
    expect(result.actionsExecuted).toBeGreaterThanOrEqual(1);
    const state = await getAutonomyState(universeId);
    expect(state.lastSimulationAt?.toISOString()).toBe("2026-10-03T00:00:00.000Z");
    expect(state.simulationVersion).toBe("autonomy.v1");
  });

  it("5) USER character não recebe decisão autônoma", async () => {
    const decisions = await prisma.aiDecision.findMany({
      where: { universeId },
      select: { characterId: true },
    });
    expect(decisions.every((decision) => decision.characterId !== userCharacterId)).toBe(true);
    expect(
      decisions.some(
        (decision) =>
          decision.characterId === aiCharacterId ||
          decision.characterId === secondAiCharacterId,
      ),
    ).toBe(true);
  });

  it("6) dry-run avalia plano sem persistir decisões", async () => {
    const decisionsBefore = await prisma.aiDecision.count({ where: { universeId } });
    const result = await runAutonomousTick({
      universeId,
      dryRun: true,
      toDate: new Date("2026-10-04T00:00:00.000Z"),
    });
    expect(result.status).toBe("DRY_RUN");
    expect(result.planned.length).toBeGreaterThanOrEqual(1);
    expect(result.actionsExecuted).toBe(0);
    expect(await prisma.aiDecision.count({ where: { universeId } })).toBe(decisionsBefore);
  });

  it("7) budget limita ações por tick", async () => {
    process.env.AUTONOMY_MAX_ACTIONS_PER_TICK = "1";
    try {
      const result = await runAutonomousTick({
        universeId,
        toDate: new Date("2026-10-05T00:00:00.000Z"),
      });
      expect(result.actionsExecuted).toBeLessThanOrEqual(1);
    } finally {
      delete process.env.AUTONOMY_MAX_ACTIONS_PER_TICK;
    }
  });

  it("8) tick repetido é reutilizado sem duplicar decisões", async () => {
    const decisionsBefore = await prisma.aiDecision.count({ where: { universeId } });
    const result = await runAutonomousTick({
      universeId,
      toDate: new Date("2026-10-05T00:00:00.000Z"),
    });
    expect(result.status).toBe("REUSED");
    expect(await prisma.aiDecision.count({ where: { universeId } })).toBe(decisionsBefore);
  });

  it("9) rotas de controle e tick funcionam para o owner", async () => {
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/universe/autonomy",
      headers: { cookie },
      payload: { mode: "OBSERVER", status: "ACTIVE" },
      remoteAddress: remoteAddress(),
    });
    expect(patch.statusCode).toBe(200);
    const state = await app.inject({
      method: "GET",
      url: "/api/universe/autonomy",
      headers: { cookie },
      remoteAddress: remoteAddress(),
    });
    expect(state.statusCode).toBe(200);
    const body = state.json() as { autonomy: { mode: string } };
    expect(body.autonomy.mode).toBe("OBSERVER");
    const tick = await app.inject({
      method: "POST",
      url: "/api/universe/autonomy/tick",
      headers: { cookie },
      payload: { dryRun: true, toDate: "2026-10-06T00:00:00.000Z" },
      remoteAddress: remoteAddress(),
    });
    expect([200, 201]).toContain(tick.statusCode);
  });
});
