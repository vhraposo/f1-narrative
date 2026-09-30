import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";

const PREFIX = "tl-harden";

let app: FastifyInstance;
let userA: { id: string; cookie: string };
let userB: { id: string; cookie: string };
let universeAId: string;
let seasonId: string;
let emptySeasonId: string;
let raceFinishedId: string;
let raceUpcomingId: string;
let raceToFinalizeId: string;
let driver1Id: string;
let driver2Id: string;

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];

async function signUp(label: string) {
  const email = `${PREFIX}-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@f1nw.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: `Harden ${label}`, email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  createdUserIds.push(user.id);
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  return { id: user.id, cookie };
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();

  userA = await signUp("a");
  userB = await signUp("b");

  const universe = await prisma.universe.upsert({
    where: { userId: userA.id },
    update: { status: "READY" },
    create: { userId: userA.id, status: "READY" },
  });
  universeAId = universe.id;

  seasonId = (
    await prisma.season.create({
      data: { universeId: universe.id, year: 2097, name: "2097", status: "ACTIVE" },
    })
  ).id;
  emptySeasonId = (
    await prisma.season.create({
      data: { universeId: universe.id, year: 2098, name: "2098", status: "PRE_SEASON" },
    })
  ).id;

  async function createDriver(label: string) {
    const character = await prisma.character.create({
      data: {
        name: `${PREFIX}-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        nationality: "BR",
        birthDate: new Date("1995-01-01"),
        controlledBy: "USER",
        userId: userA.id,
        universeId: universe.id,
      },
    });
    createdCharacterIds.push(character.id);
    const profile = await prisma.driverProfile.create({
      data: { characterId: character.id },
    });
    return profile.id;
  }
  driver1Id = await createDriver("d1");
  driver2Id = await createDriver("d2");

  raceFinishedId = (
    await prisma.race.create({
      data: {
        seasonId,
        name: "GP Hardening Finalizado",
        round: 1,
        date: new Date("2097-03-01T00:00:00.000Z"),
        status: "FINISHED",
      },
    })
  ).id;
  raceUpcomingId = (
    await prisma.race.create({
      data: {
        seasonId,
        name: "GP Hardening Futuro",
        round: 2,
        date: new Date("2097-06-01T00:00:00.000Z"),
        status: "UPCOMING",
      },
    })
  ).id;
  raceToFinalizeId = (
    await prisma.race.create({
      data: {
        seasonId,
        name: "GP Hardening Finalizar",
        round: 3,
        date: new Date("2097-09-01T00:00:00.000Z"),
        status: "RACE",
      },
    })
  ).id;

  await prisma.raceResult.create({
    data: {
      raceId: raceFinishedId,
      driverProfileId: driver1Id,
      position: 1,
      grid: 1,
      points: 25,
      status: "Finished",
    },
  });
  await prisma.raceResult.create({
    data: {
      raceId: raceFinishedId,
      driverProfileId: driver2Id,
      position: 2,
      grid: 2,
      points: 18,
      status: "Finished",
    },
  });
  await prisma.raceResult.create({
    data: {
      raceId: raceToFinalizeId,
      driverProfileId: driver1Id,
      position: 1,
      grid: 1,
      points: 25,
      status: "Finished",
    },
  });
  await prisma.championshipStanding.create({
    data: {
      seasonId,
      driverProfileId: driver1Id,
      points: 25,
      wins: 1,
      podiums: 1,
      position: 1,
    },
  });
  await prisma.championshipStanding.create({
    data: {
      seasonId: emptySeasonId,
      driverProfileId: driver1Id,
      points: 5,
      wins: 0,
      podiums: 0,
      position: 1,
    },
  });

  const worldDate = new Date("2097-12-01T00:00:00.000Z");
  await prisma.worldState.create({
    data: {
      universeId: universe.id,
      key: "default",
      currentDate: worldDate,
      currentSeasonId: seasonId,
    },
  });
});

afterAll(async () => {
  await prisma.timelineEvent.deleteMany({ where: { universeId: universeAId } });
  await prisma.worldSnapshot.deleteMany({ where: { universeId: universeAId } });
  await prisma.championshipStanding.deleteMany({
    where: { seasonId: { in: [seasonId, emptySeasonId] } },
  });
  await prisma.raceSessionResult.deleteMany({
    where: { race: { seasonId } },
  });
  await prisma.raceResult.deleteMany({ where: { race: { seasonId } } });
  await prisma.race.deleteMany({ where: { seasonId: { in: [seasonId, emptySeasonId] } } });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.season.deleteMany({ where: { id: { in: [seasonId, emptySeasonId] } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
  await app.close();
});

function auth(cookie: string) {
  return { cookie };
}

describe("legacy writer hardening", () => {
  it("1) 401 sem sessão em mutações históricas", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/race-results/nao-existe`,
      payload: { position: 3 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("2) PATCH/DELETE de resultado em corrida FINISHED exige Timeline", async () => {
    const result = await prisma.raceResult.findFirstOrThrow({
      where: { raceId: raceFinishedId, driverProfileId: driver2Id },
    });
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/race-results/${result.id}`,
      headers: auth(userA.cookie),
      payload: { position: 1 },
    });
    expect(patched.statusCode).toBe(409);
    expect(patched.json().code).toBe("USE_TIMELINE_CORRECTION");

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/race-results/${result.id}`,
      headers: auth(userA.cookie),
    });
    expect(deleted.statusCode).toBe(409);

    const reloaded = await prisma.raceResult.findUniqueOrThrow({
      where: { id: result.id },
    });
    expect(reloaded.position).toBe(2);
  });

  it("3) POST de resultado: bloqueado em corrida FINISHED; permitido em corrida aberta", async () => {
    const blocked = await app.inject({
      method: "POST",
      url: `/api/races/${raceFinishedId}/results`,
      headers: auth(userA.cookie),
      payload: { driverProfileId: driver1Id, position: 9 },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("USE_TIMELINE_CORRECTION");

    const allowed = await app.inject({
      method: "POST",
      url: `/api/races/${raceUpcomingId}/results`,
      headers: auth(userA.cookie),
      payload: { driverProfileId: driver1Id, position: 1, grid: 1 },
    });
    expect(allowed.statusCode).toBe(201);
  });

  it("4) PATCH/DELETE de corrida FINISHED exige Timeline; corrida aberta continua editável", async () => {
    const blocked = await app.inject({
      method: "PATCH",
      url: `/api/races/${raceFinishedId}`,
      headers: auth(userA.cookie),
      payload: { date: "2097-04-01T00:00:00.000Z" },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("USE_TIMELINE_CORRECTION");

    const deleteBlocked = await app.inject({
      method: "DELETE",
      url: `/api/races/${raceFinishedId}`,
      headers: auth(userA.cookie),
    });
    expect(deleteBlocked.statusCode).toBe(409);

    const allowed = await app.inject({
      method: "PATCH",
      url: `/api/races/${raceUpcomingId}`,
      headers: auth(userA.cookie),
      payload: { name: "GP Hardening Futuro (editado)" },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it("5) standings derivados: bloqueado com resultados; importado sem resultados continua editável", async () => {
    const derived = await prisma.championshipStanding.findFirstOrThrow({
      where: { seasonId, driverProfileId: driver1Id },
    });
    const blocked = await app.inject({
      method: "PATCH",
      url: `/api/championship-standings/${derived.id}`,
      headers: auth(userA.cookie),
      payload: { points: 999 },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("DERIVED_STANDING");

    const imported = await prisma.championshipStanding.findFirstOrThrow({
      where: { seasonId: emptySeasonId, driverProfileId: driver1Id },
    });
    const allowed = await app.inject({
      method: "PATCH",
      url: `/api/championship-standings/${imported.id}`,
      headers: auth(userA.cookie),
      payload: { points: 42 },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().standing.points).toBe(42);
  });

  it("6) PATCH /api/world é lifecycle e mantém lock/ownership", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/world",
      headers: auth(userA.cookie),
      payload: { currentDate: "2097-12-15T00:00:00.000Z" },
    });
    expect(res.statusCode).toBe(200);
    const world = await prisma.worldState.findUniqueOrThrow({
      where: { universeId_key: { universeId: universeAId, key: "default" } },
    });
    expect(world.currentDate.toISOString()).toBe("2097-12-15T00:00:00.000Z");
  });

  it("7) finalização normal continua funcionando sob lock", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/races/${raceToFinalizeId}/championship/apply`,
      headers: auth(userA.cookie),
    });
    expect(res.statusCode).toBe(200);
    const race = await prisma.race.findUniqueOrThrow({
      where: { id: raceToFinalizeId },
    });
    expect(race.status).toBe("FINISHED");
    const standings = await prisma.championshipStanding.findMany({
      where: { seasonId },
    });
    expect(standings.length).toBeGreaterThanOrEqual(1);
  });

  it("8) finalização de corrida de outro universo é leak-safe", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/races/${raceFinishedId}/championship/apply`,
      headers: auth(userB.cookie),
    });
    expect(res.statusCode).toBe(404);
  });

  it("9) fluxo de correção continua funcionando e é concorrente-seguro com o world", async () => {
    const command = {
      kind: "RACE_RESULT_CORRECTED",
      worldDate: "2097-12-01T00:00:00.000Z",
      raceId: raceFinishedId,
      driverProfileId: driver2Id,
      position: 1,
    };
    const preview = await app.inject({
      method: "POST",
      url: "/api/timeline/corrections/preview",
      headers: auth(userA.cookie),
      payload: command,
    });
    expect(preview.statusCode).toBe(200);
    const previewToken = preview.json().preview.previewToken as string;

    const [apply, worldPatch] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/timeline/corrections/apply",
        headers: auth(userA.cookie),
        payload: { command, previewToken },
      }),
      app.inject({
        method: "PATCH",
        url: "/api/world",
        headers: auth(userA.cookie),
        payload: { currentDate: "2097-12-20T00:00:00.000Z" },
      }),
    ]);
    expect(apply.statusCode).toBe(200);
    expect(worldPatch.statusCode).toBe(200);
    const events = await prisma.timelineEvent.findMany({
      where: {
        universeId: universeAId,
        kind: "RACE_RESULT_CORRECTED",
      },
    });
    expect(events).toHaveLength(1);
  });

  it("10) outro usuário não edita resultado alheio (ownership)", async () => {
    const result = await prisma.raceResult.findFirstOrThrow({
      where: { raceId: raceFinishedId, driverProfileId: driver1Id },
    });
    const res = await app.inject({
      method: "PATCH",
      url: `/api/race-results/${result.id}`,
      headers: auth(userB.cookie),
      payload: { position: 5 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("11) rota legada de correção está selada e não escreve nada", async () => {
    const before = await prisma.raceResult.count();
    const res = await app.inject({
      method: "POST",
      url: "/api/timeline/corrections",
      headers: auth(userA.cookie),
      payload: {
        kind: "RACE_RESULT_CORRECTED",
        worldDate: "2097-12-01T00:00:00.000Z",
        payload: { position: 1 },
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("USE_TIMELINE_CORRECTION");
    expect(await prisma.raceResult.count()).toBe(before);
    const legacyEvents = await prisma.timelineEvent.count({
      where: { universeId: universeAId, supersedesId: null, kind: "RACE_RESULT_CORRECTED" },
    });
    expect(legacyEvents).toBe(1);
  });

  it("12) timeline filtra e resume PERSONA_UPDATED", async () => {
    await prisma.timelineEvent.create({
      data: {
        universeId: universeAId,
        sequence: 900,
        worldDate: new Date("2097-12-02T00:00:00.000Z"),
        kind: "PERSONA_UPDATED",
        payload: { characterId: "00000000-0000-4000-8000-0000000000c1", evolutionRevision: 1 },
      },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/timeline?kind=PERSONA_UPDATED",
      headers: auth(userA.cookie),
    });
    expect(res.statusCode).toBe(200);
    const events = res.json().events as Array<{ kind: string; summary: string }>;
    expect(events.some((event) => event.kind === "PERSONA_UPDATED")).toBe(true);
    const persona = events.find((event) => event.kind === "PERSONA_UPDATED");
    expect(persona?.summary).toContain("Persona atualizada");
  });
});
