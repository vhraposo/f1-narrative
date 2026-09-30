import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { deleteUniverseDataForUsers } from "../../test-utils/universe-cleanup.js";

const PREFIX = "px-routes";
let app: FastifyInstance;
const createdUserIds: string[] = [];

function remoteAddress(): string {
  return `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
}

type TestUser = { cookie: string; userId: string };

async function createUser(label: string): Promise<TestUser> {
  const email = `${PREFIX}-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@f1nw.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: `PX ${label}`, email, password: "senha-segura-123" },
    remoteAddress: remoteAddress(),
  });
  expect(res.statusCode).toBe(200);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  createdUserIds.push(user.id);
  const cookie = (res.cookies ?? []).map((entry) => `${entry.name}=${entry.value}`).join("; ");
  return { cookie, userId: user.id };
}

async function createPilotFixture(user: TestUser, label: string) {
  const universe = await prisma.universe.upsert({
    where: { userId: user.userId },
    update: { status: "READY" },
    create: { userId: user.userId, status: "READY" },
  });
  const character = await prisma.character.create({
    data: {
      universeId: universe.id,
      controlledBy: "AI",
      name: `${PREFIX} ${label}`,
      nationality: "BRA",
      birthDate: new Date("2000-01-01T00:00:00.000Z"),
      driverProfile: { create: { number: 7 } },
    },
  });
  await prisma.worldState.create({
    data: {
      universeId: universe.id,
      key: "default",
      currentDate: new Date("2026-12-31T00:00:00.000Z"),
    },
  });
  return { universe, character };
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await prisma.personaTraitEvolution.deleteMany({
    where: { persona: { character: { name: { startsWith: PREFIX } } } },
  });
  await prisma.characterPersona.deleteMany({
    where: { character: { name: { startsWith: PREFIX } } },
  });
  await prisma.memory.deleteMany({ where: { participants: { some: { character: { name: { startsWith: PREFIX } } } } } });
  await prisma.pilotExperience.deleteMany({ where: { character: { name: { startsWith: PREFIX } } } });
  await deleteUniverseDataForUsers(prisma, createdUserIds);
  await prisma.worldState.deleteMany({ where: { universe: { userId: { in: createdUserIds } } } });
  await prisma.universe.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.character.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await app.close();
  await prisma.$disconnect();
});

describe("pilot experience routes", () => {
  it("1) exige autenticação e ownership leak-safe", async () => {
    const owner = await createUser("owner-1");
    const intruder = await createUser("intruder-1");
    const { character } = await createPilotFixture(owner, "own1");

    const anonymous = await app.inject({
      method: "GET",
      url: `/api/pilot-context/${character.id}/memories`,
      remoteAddress: remoteAddress(),
    });
    expect(anonymous.statusCode).toBe(401);

    const other = await app.inject({
      method: "GET",
      url: `/api/pilot-context/${character.id}/memories`,
      headers: { cookie: intruder.cookie },
      remoteAddress: remoteAddress(),
    });
    expect(other.statusCode).toBe(404);

    const invalid = await app.inject({
      method: "GET",
      url: "/api/pilot-context/not-a-uuid/memories",
      headers: { cookie: owner.cookie },
      remoteAddress: remoteAddress(),
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("2) lista e filtra memórias (status/tipo/importância)", async () => {
    const user = await createUser("owner-2");
    const { universe, character } = await createPilotFixture(user, "own2");
    await prisma.memory.createMany({
      data: [
        {
          universeId: universe.id,
          derivation: "MANUAL",
          status: "ACTIVE",
          importance: "HIGH",
          memoryType: "CHAMPIONSHIP",
          source: "USER_DEFINED",
          content: "Memória manual ativa",
        },
        {
          universeId: universe.id,
          derivation: "RULE_DERIVED",
          status: "INVALIDATED",
          importance: "LOW",
          memoryType: "TEAM_CHANGE",
          source: "GENERATED_EVENT",
          content: "Memória derivada invalidada",
        },
      ],
    });
    const all = await prisma.memory.findMany({ where: { universeId: universe.id }, select: { id: true } });
    await prisma.memoryCharacter.createMany({
      data: all.map((memory) => ({ memoryId: memory.id, characterId: character.id })),
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/pilot-context/${character.id}/memories`,
      headers: { cookie: user.cookie },
      remoteAddress: remoteAddress(),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { memories: Array<{ content: string; status: string }> };
    expect(body.memories).toHaveLength(2);

    const filtered = await app.inject({
      method: "GET",
      url: `/api/pilot-context/${character.id}/memories?status=ACTIVE&type=CHAMPIONSHIP&importance=HIGH`,
      headers: { cookie: user.cookie },
      remoteAddress: remoteAddress(),
    });
    const filteredBody = filtered.json() as { memories: Array<{ content: string }> };
    expect(filteredBody.memories).toHaveLength(1);
    expect(filteredBody.memories[0]?.content).toBe("Memória manual ativa");
  });

  it("3) cria/edita memória manual e bloqueia edição de derivada", async () => {
    const user = await createUser("owner-3");
    const { universe, character } = await createPilotFixture(user, "own3");

    const created = await app.inject({
      method: "POST",
      url: `/api/pilot-context/${character.id}/memories`,
      headers: { cookie: user.cookie },
      payload: {
        content: "Para este Universe, aquela corrida foi decisiva.",
        memoryType: "PERSONAL_MILESTONE",
        importance: "HIGH",
        occurredAt: "2026-05-01T00:00:00.000Z",
      },
      remoteAddress: remoteAddress(),
    });
    expect(created.statusCode).toBe(201);
    const memoryId = (created.json() as { memory: { id: string } }).memory.id;

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/pilot-context/${character.id}/memories/${memoryId}`,
      headers: { cookie: user.cookie },
      payload: { status: "ARCHIVED", importance: "MEDIUM" },
      remoteAddress: remoteAddress(),
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { memory: { status: string } }).memory.status).toBe("ARCHIVED");

    const derived = await prisma.memory.create({
      data: {
        universeId: universe.id,
        derivation: "RULE_DERIVED",
        status: "ACTIVE",
        importance: "HIGH",
        source: "GENERATED_EVENT",
        content: "Derivada",
        participants: { create: [{ characterId: character.id }] },
      },
    });
    const blocked = await app.inject({
      method: "PATCH",
      url: `/api/pilot-context/${character.id}/memories/${derived.id}`,
      headers: { cookie: user.cookie },
      payload: { content: "Tentativa de edição" },
      remoteAddress: remoteAddress(),
    });
    expect(blocked.statusCode).toBe(409);

    const invalid = await app.inject({
      method: "POST",
      url: `/api/pilot-context/${character.id}/memories`,
      headers: { cookie: user.cookie },
      payload: { content: "", importance: "HIGH" },
      remoteAddress: remoteAddress(),
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("4) reconcile cria experiencia/memoria curada e é idempotente via rota", async () => {
    const user = await createUser("owner-4");
    const { character } = await createPilotFixture(user, "own4");

    const first = await app.inject({
      method: "POST",
      url: `/api/pilot-context/${character.id}/reconcile`,
      headers: { cookie: user.cookie },
      payload: {
        curated: [
          {
            sourceKey: "curated:routes:1",
            experienceType: "PERSONAL_MILESTONE",
            title: "Marco pessoal do piloto",
            salience: "HIGH",
          },
        ],
      },
      remoteAddress: remoteAddress(),
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as { reconcile: { experiences: { created: number }; memories: { created: number } } };
    expect(firstBody.reconcile.experiences.created).toBeGreaterThanOrEqual(1);
    expect(firstBody.reconcile.memories.created).toBeGreaterThanOrEqual(1);

    const second = await app.inject({
      method: "POST",
      url: `/api/pilot-context/${character.id}/reconcile`,
      headers: { cookie: user.cookie },
      payload: {
        curated: [
          {
            sourceKey: "curated:routes:1",
            experienceType: "PERSONAL_MILESTONE",
            title: "Marco pessoal do piloto",
            salience: "HIGH",
          },
        ],
      },
      remoteAddress: remoteAddress(),
    });
    const secondBody = second.json() as { reconcile: { experiences: { created: number }; memories: { created: number } } };
    expect(secondBody.reconcile.experiences.created).toBe(0);
    expect(secondBody.reconcile.memories.created).toBe(0);

    const experiences = await app.inject({
      method: "GET",
      url: `/api/pilot-context/${character.id}/experiences`,
      headers: { cookie: user.cookie },
      remoteAddress: remoteAddress(),
    });
    expect(experiences.statusCode).toBe(200);
    expect((experiences.json() as { experiences: unknown[] }).experiences.length).toBeGreaterThan(0);
  });

  it("5) evolution preview/apply com idempotência e stale 409", async () => {
    const user = await createUser("owner-5");
    const { universe, character } = await createPilotFixture(user, "own5");
    await prisma.pilotExperience.create({
      data: {
        universeId: universe.id,
        characterId: character.id,
        experienceType: "CHAMPIONSHIP",
        source: "STANDING",
        sourceKey: "season:2026:champion",
        seasonYear: 2026,
        occurredAt: new Date("2026-12-01T00:00:00.000Z"),
        salience: "CRITICAL",
        title: "Campeão mundial em 2026",
      },
    });

    const preview = await app.inject({
      method: "POST",
      url: `/api/pilot-context/${character.id}/evolution/preview`,
      headers: { cookie: user.cookie },
      remoteAddress: remoteAddress(),
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json() as {
      preview: { evolutionRevision: number; pendingFingerprint: string; pendingCount: number };
    };
    expect(previewBody.preview.pendingCount).toBe(1);

    const applied = await app.inject({
      method: "POST",
      url: `/api/pilot-context/${character.id}/evolution/apply`,
      headers: { cookie: user.cookie },
      payload: {
        expectedRevision: previewBody.preview.evolutionRevision,
        expectedPendingFingerprint: previewBody.preview.pendingFingerprint,
      },
      remoteAddress: remoteAddress(),
    });
    expect(applied.statusCode).toBe(200);
    expect((applied.json() as { evolution: { applied: boolean; evolutionRevision: number } }).evolution).toMatchObject({
      applied: true,
      evolutionRevision: 1,
    });

    const stale = await app.inject({
      method: "POST",
      url: `/api/pilot-context/${character.id}/evolution/apply`,
      headers: { cookie: user.cookie },
      payload: {
        expectedRevision: 0,
        expectedPendingFingerprint: previewBody.preview.pendingFingerprint,
      },
      remoteAddress: remoteAddress(),
    });
    expect(stale.statusCode).toBe(409);
    expect((stale.json() as { code: string }).code).toBe("EVOLUTION_STALE");

    const repreview = await app.inject({
      method: "POST",
      url: `/api/pilot-context/${character.id}/evolution/preview`,
      headers: { cookie: user.cookie },
      remoteAddress: remoteAddress(),
    });
    const repreviewBody = repreview.json() as {
      preview: { evolutionRevision: number; pendingFingerprint: string; pendingCount: number };
    };
    expect(repreviewBody.preview.pendingCount).toBe(0);
    const noop = await app.inject({
      method: "POST",
      url: `/api/pilot-context/${character.id}/evolution/apply`,
      headers: { cookie: user.cookie },
      payload: {
        expectedRevision: repreviewBody.preview.evolutionRevision,
        expectedPendingFingerprint: repreviewBody.preview.pendingFingerprint,
      },
      remoteAddress: remoteAddress(),
    });
    expect((noop.json() as { evolution: { applied: boolean } }).evolution.applied).toBe(false);

    const eventCount = await prisma.timelineEvent.count({
      where: { universeId: universe.id, kind: "PERSONA_UPDATED" },
    });
    expect(eventCount).toBe(1);
  });
});
