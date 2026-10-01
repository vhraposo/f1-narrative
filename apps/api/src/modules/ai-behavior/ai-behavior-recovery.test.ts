import { createHmac, randomBytes } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { AI_EXECUTING_STALE_MS } from "./ai-behavior.service.js";

type TestUser = { cookie: string; userId: string };

const createdUserIds: string[] = [];

async function createDbUser(suffix: string): Promise<TestUser> {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET not set");
  const user = await prisma.user.create({
    data: {
      email: `rec-${suffix}-${Date.now()}${Math.random()}@f1nw.test`,
      name: `Rec ${suffix}`,
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
  user: TestUser,
): Promise<{ universeId: string; characterId: string }> {
  const universe = await prisma.universe.create({
    data: { userId: user.userId, status: "READY" },
  });
  const character = await prisma.character.create({
    data: {
      name: `Rec AI ${Math.random().toString(36).slice(2, 6)}`,
      nationality: "Brazil",
      birthDate: new Date("2000-01-01"),
      userId: user.userId,
      universeId: universe.id,
      controlledBy: "AI",
    },
  });
  return { universeId: universe.id, characterId: character.id };
}

async function createDecision(
  universeId: string,
  characterId: string,
  status: "EXECUTING" | "EXECUTED" | "FAILED" | "DECIDED",
  updatedAt: Date,
) {
  const decision = await prisma.aiDecision.create({
    data: {
      universeId,
      characterId,
      status,
      actionType: "SEND_MESSAGE",
      contextVersion: "ai-behavior.v1",
    },
  });
  await prisma.$executeRaw`UPDATE "AiDecision" SET "updatedAt" = ${updatedAt} WHERE "id" = ${decision.id}::uuid`;
  return decision;
}

function recover(cookie: string) {
  return app.inject({
    method: "POST",
    url: "/api/ai-behavior/recover",
    headers: { cookie },
    payload: {},
    remoteAddress: `10.155.1.${Math.floor(Math.random() * 200) + 1}`,
  });
}

let app: ReturnType<typeof buildApp>;

describe("AI Decision recovery (stale EXECUTING)", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it("recupera apenas EXECUTING obsoleto e preserva os demais estados", async () => {
    app = buildApp();
    await app.ready();
    const user = await createDbUser("states");
    const fixture = await createFixture(user);
    const stale = await createDecision(
      fixture.universeId,
      fixture.characterId,
      "EXECUTING",
      new Date(Date.now() - AI_EXECUTING_STALE_MS - 60_000),
    );
    const recent = await createDecision(
      fixture.universeId,
      fixture.characterId,
      "EXECUTING",
      new Date(),
    );
    const executed = await createDecision(
      fixture.universeId,
      fixture.characterId,
      "EXECUTED",
      new Date(Date.now() - AI_EXECUTING_STALE_MS - 60_000),
    );
    const failed = await createDecision(
      fixture.universeId,
      fixture.characterId,
      "FAILED",
      new Date(Date.now() - AI_EXECUTING_STALE_MS - 60_000),
    );
    const messagesBefore = await prisma.message.count();

    const response = await recover(user.cookie);
    expect(response.statusCode).toBe(200);
    expect(response.json().recovered).toBe(1);

    const rows = await prisma.aiDecision.findMany({
      where: { id: { in: [stale.id, recent.id, executed.id, failed.id] } },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(stale.id)?.status).toBe("FAILED");
    expect(byId.get(stale.id)?.policyCode).toBe("EXECUTION_STALE");
    expect(byId.get(recent.id)?.status).toBe("EXECUTING");
    expect(byId.get(executed.id)?.status).toBe("EXECUTED");
    expect(byId.get(failed.id)?.status).toBe("FAILED");
    expect(await prisma.message.count()).toBe(messagesBefore);

    const execution = await app.inject({
      method: "POST",
      url: "/api/ai-behavior/execute",
      headers: { cookie: user.cookie },
      payload: { decisionId: stale.id },
      remoteAddress: "10.155.2.1",
    });
    expect(execution.statusCode).toBe(409);
    expect(execution.json().code).toBe("DECISION_NOT_EXECUTABLE");

    await app.close();
  });

  it("é idempotente e serializa recuperações concorrentes", async () => {
    app = buildApp();
    await app.ready();
    const user = await createDbUser("concurrent");
    const fixture = await createFixture(user);
    await createDecision(
      fixture.universeId,
      fixture.characterId,
      "EXECUTING",
      new Date(Date.now() - AI_EXECUTING_STALE_MS - 120_000),
    );
    await createDecision(
      fixture.universeId,
      fixture.characterId,
      "EXECUTING",
      new Date(Date.now() - AI_EXECUTING_STALE_MS - 90_000),
    );

    const [first, second] = await Promise.all([
      recover(user.cookie),
      recover(user.cookie),
    ]);
    expect(first.json().recovered + second.json().recovered).toBe(2);

    const again = await recover(user.cookie);
    expect(again.json().recovered).toBe(0);
    const remaining = await prisma.aiDecision.count({
      where: { characterId: fixture.characterId, status: "EXECUTING" },
    });
    expect(remaining).toBe(0);

    await app.close();
  });

  it("isola universos e exige autenticação", async () => {
    app = buildApp();
    await app.ready();
    const userA = await createDbUser("iso-a");
    const userB = await createDbUser("iso-b");
    const fixtureA = await createFixture(userA);
    const fixtureB = await createFixture(userB);
    const staleB = await createDecision(
      fixtureB.universeId,
      fixtureB.characterId,
      "EXECUTING",
      new Date(Date.now() - AI_EXECUTING_STALE_MS - 60_000),
    );

    const cross = await recover(userA.cookie);
    expect(cross.json().recovered).toBe(0);
    expect(
      (await prisma.aiDecision.findUniqueOrThrow({ where: { id: staleB.id } }))
        .status,
    ).toBe("EXECUTING");

    const own = await recover(userB.cookie);
    expect(own.json().recovered).toBe(1);

    const unauthenticated = await app.inject({
      method: "POST",
      url: "/api/ai-behavior/recover",
      payload: {},
    });
    expect(unauthenticated.statusCode).toBe(401);
    void fixtureA;

    await app.close();
  });
});
