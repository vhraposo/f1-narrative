import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";

const PREFIX = "tl-editor";

let app: FastifyInstance;
let userA: { id: string; cookie: string };
let userB: { id: string; cookie: string };
let universeAId: string;
let seasonWithResultsId: string;
let emptySeasonId: string;
let raceId: string;
let driver1Id: string;
let driver2Id: string;
let resultEventId: string;
let sprintEventId: string;
let numberEventId: string;
let standingEmptyEventId: string;
let standingDerivedEventId: string;
let raceScheduledEventId: string;
let worldEventId: string;
let evolutionEventId: string;
let narrativeEventId: string;

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];

async function signUp(label: string) {
  const email = `${PREFIX}-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@f1nw.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: `Editor ${label}`, email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  createdUserIds.push(user.id);
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  return { id: user.id, cookie };
}

const WORLD_DATE = new Date("2200-12-01T00:00:00.000Z");

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

  seasonWithResultsId = (
    await prisma.season.create({
      data: { universeId: universe.id, year: 2200, name: "2200", status: "FINISHED" },
    })
  ).id;
  emptySeasonId = (
    await prisma.season.create({
      data: { universeId: universe.id, year: 2201, name: "2201", status: "PRE_SEASON" },
    })
  ).id;

  async function createDriver(name: string) {
    const character = await prisma.character.create({
      data: {
        name,
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
  driver1Id = await createDriver(`${PREFIX}-d1`);
  driver2Id = await createDriver(`${PREFIX}-d2`);

  await prisma.seasonDriverEntry.create({
    data: {
      seasonId: seasonWithResultsId,
      driverProfileId: driver1Id,
      number: 76,
      role: "RACE_SEAT",
      status: "ACTIVE",
    },
  });

  raceId = (
    await prisma.race.create({
      data: {
        seasonId: seasonWithResultsId,
        name: "GP Editor",
        round: 1,
        date: new Date("2200-03-01T00:00:00.000Z"),
        status: "FINISHED",
      },
    })
  ).id;

  await prisma.raceResult.create({
    data: {
      raceId,
      driverProfileId: driver1Id,
      position: 5,
      grid: 5,
      points: 10,
      status: "Finished",
    },
  });
  await prisma.raceSessionResult.create({
    data: {
      raceId,
      driverProfileId: driver1Id,
      session: "SPRINT",
      position: 3,
      status: "Finished",
      points: 6,
      metadata: { eligibility: { neutralizedStart: false, distancePct: 100 } },
    },
  });
  await prisma.championshipStanding.create({
    data: {
      seasonId: seasonWithResultsId,
      driverProfileId: driver1Id,
      position: 2,
      points: 40,
      wins: 1,
      podiums: 2,
    },
  });
  await prisma.championshipStanding.create({
    data: {
      seasonId: emptySeasonId,
      driverProfileId: driver2Id,
      position: 1,
      points: 12,
      wins: 0,
      podiums: 1,
    },
  });

  await prisma.worldState.create({
    data: {
      universeId: universe.id,
      key: "default",
      currentDate: WORLD_DATE,
      currentSeasonId: seasonWithResultsId,
    },
  });

  const narrativeCharacter = await prisma.character.create({
    data: {
      name: `${PREFIX}-narrativa`,
      nationality: "BR",
      birthDate: new Date("1995-01-01"),
      controlledBy: "AI",
      universeId: universe.id,
    },
  });
  createdCharacterIds.push(narrativeCharacter.id);
  narrativeEventId = (
    await prisma.event.create({
      data: {
        type: "RACE",
        title: "Narrativa Editor",
        payload: { raceId },
        participants: { create: [{ characterId: narrativeCharacter.id }] },
      },
    })
  ).id;

  async function createEvent(
    kind:
      | "WORLD_ADVANCED"
      | "RACE_SCHEDULED"
      | "RACE_RESULT_CORRECTED"
      | "RACE_SESSION_RESULT_CORRECTED"
      | "NUMBER_CORRECTED"
      | "STANDING_CORRECTED"
      | "ATTRIBUTE_EVOLVED",
    sequence: number,
    payload: Record<string, unknown>,
    supersedesId?: string,
  ) {
    return prisma.timelineEvent.create({
      data: {
        universeId: universe.id,
        sequence,
        worldDate: WORLD_DATE,
        kind,
        payload: payload as Prisma.InputJsonValue,
        causedBy: "USER",
        supersedesId: supersedesId ?? null,
      },
    });
  }

  worldEventId = (
    await createEvent("WORLD_ADVANCED", 1, {
      currentDate: WORLD_DATE.toISOString(),
      currentSeasonId: seasonWithResultsId,
      currentRaceId: null,
      currentSession: null,
    })
  ).id;
  raceScheduledEventId = (
    await createEvent("RACE_SCHEDULED", 2, { raceId, round: 1 })
  ).id;
  resultEventId = (
    await createEvent("RACE_RESULT_CORRECTED", 3, {
      raceId,
      driverProfileId: driver1Id,
      position: 5,
      grid: 5,
      status: "Finished",
    })
  ).id;
  sprintEventId = (
    await createEvent("RACE_SESSION_RESULT_CORRECTED", 4, {
      raceId,
      driverProfileId: driver1Id,
      session: "SPRINT",
      position: 3,
    })
  ).id;
  numberEventId = (
    await createEvent("NUMBER_CORRECTED", 5, {
      seasonId: seasonWithResultsId,
      driverProfileId: driver1Id,
      number: 76,
    })
  ).id;
  standingEmptyEventId = (
    await createEvent("STANDING_CORRECTED", 6, {
      seasonId: emptySeasonId,
      driverProfileId: driver2Id,
      points: 12,
    })
  ).id;
  standingDerivedEventId = (
    await createEvent("STANDING_CORRECTED", 7, {
      seasonId: seasonWithResultsId,
      driverProfileId: driver1Id,
      points: 40,
    })
  ).id;
  evolutionEventId = (
    await createEvent("ATTRIBUTE_EVOLVED", 8, {
      seasonId: seasonWithResultsId,
      fingerprint: "fp-editor",
    })
  ).id;
});

afterAll(async () => {
  await prisma.timelineEvent.deleteMany({ where: { universeId: universeAId } });
  await prisma.eventCharacter.deleteMany({ where: { character: { universeId: universeAId } } });
  await prisma.event.deleteMany({ where: { id: narrativeEventId } });
  await prisma.worldSnapshot.deleteMany({ where: { universeId: universeAId } });
  await prisma.championshipStanding.deleteMany({
    where: { seasonId: { in: [seasonWithResultsId, emptySeasonId] } },
  });
  await prisma.raceSessionResult.deleteMany({ where: { raceId } });
  await prisma.raceResult.deleteMany({ where: { raceId } });
  await prisma.seasonDriverEntry.deleteMany({
    where: { seasonId: { in: [seasonWithResultsId, emptySeasonId] } },
  });
  await prisma.race.deleteMany({ where: { seasonId: seasonWithResultsId } });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.season.deleteMany({
    where: { id: { in: [seasonWithResultsId, emptySeasonId] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
  await app.close();
});

function auth(cookie: string) {
  return { cookie };
}

async function detail(eventId: string, cookie = userA.cookie) {
  const res = await app.inject({
    method: "GET",
    url: `/api/timeline/events/${eventId}`,
    headers: auth(cookie),
  });
  return res;
}

describe("timeline event edit model", () => {
  it("1) resultado: RACE_RESULT editável com valores atuais e supersedes sugerido", async () => {
    const res = await detail(resultEventId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const edit = body.edit;
    expect(edit.editorKind).toBe("RACE_RESULT");
    expect(edit.canEdit).toBe(false);
    expect(edit.blockedReason).toBe("EVOLUTION_STALE");
    expect(body.item.id).toBe(resultEventId);
    expect(body.supersedesChain).toEqual([]);
  });

  it("2) número: NUMBER editável com número atual", async () => {
    const res = await detail(numberEventId);
    const edit = res.json().edit;
    expect(edit.editorKind).toBe("NUMBER");
    expect(edit.canEdit).toBe(true);
    expect(edit.currentValues.number).toBe(76);
    expect(edit.suggestedSupersedesId).toBe(numberEventId);
    expect(edit.defaultWorldDate).toBe(WORLD_DATE.toISOString());
  });

  it("3) standing em temporada sem resultados é editável; com resultados é bloqueado", async () => {
    const empty = await detail(standingEmptyEventId);
    expect(empty.json().edit.editorKind).toBe("STANDING");
    expect(empty.json().edit.canEdit).toBe(true);
    expect(empty.json().edit.currentValues.points).toBe(12);

    const derived = await detail(standingDerivedEventId);
    expect(derived.json().edit.canEdit).toBe(false);
    expect(derived.json().edit.blockedReason).toBe("DERIVED_STANDING");
  });

  it("4) race scheduled → editor RACE; world advanced → sem editor visual", async () => {
    const race = await detail(raceScheduledEventId);
    expect(race.json().edit.editorKind).toBe("RACE");
    expect(race.json().edit.canEdit).toBe(true);
    expect(race.json().edit.currentValues.name).toBe("GP Editor");

    const world = await detail(worldEventId);
    expect(world.json().edit.canEdit).toBe(false);
    expect(world.json().edit.blockedReason).toBe("NO_VISUAL_EDITOR");
  });

  it("5) sprint editável quando não há evolução aplicada na temporada", async () => {
    const res = await detail(sprintEventId);
    const edit = res.json().edit;
    expect(edit.editorKind).toBe("SPRINT");
    expect(edit.blockedReason).toBe("EVOLUTION_STALE");
  });

  it("6) sem evolução, resultado e sprint ficam editáveis e sinalizam narrativa stale", async () => {
    await prisma.timelineEvent.delete({ where: { id: evolutionEventId } });

    const result = await detail(resultEventId);
    expect(result.json().edit.canEdit).toBe(true);
    expect(result.json().edit.editorKind).toBe("RACE_RESULT");
    expect(result.json().edit.currentValues).toMatchObject({
      position: 5,
      points: 10,
    });
    expect(result.json().edit.suggestedSupersedesId).toBe(resultEventId);
    expect(result.json().edit.narrativeStaleEventIds).toContain(narrativeEventId);

    const sprint = await detail(sprintEventId);
    expect(sprint.json().edit.canEdit).toBe(true);
    expect(sprint.json().edit.currentValues.position).toBe(3);
  });

  it("7) resultado ausente bloqueia com RESULT_NOT_FOUND", async () => {
    const result = await prisma.raceResult.findFirstOrThrow({
      where: { raceId, driverProfileId: driver1Id },
    });
    await prisma.raceResult.delete({ where: { id: result.id } });
    const res = await detail(resultEventId);
    expect(res.json().edit.canEdit).toBe(false);
    expect(res.json().edit.blockedReason).toBe("RESULT_NOT_FOUND");
    await prisma.raceResult.create({
      data: {
        raceId,
        driverProfileId: driver1Id,
        position: 5,
        grid: 5,
        points: 10,
        status: "Finished",
      },
    });
  });

  it("8) cadeia 76 → 77 preserva os dois eventos e a supersession", async () => {
    const newer = await prisma.timelineEvent.create({
      data: {
        universeId: universeAId,
        sequence: 20,
        worldDate: WORLD_DATE,
        kind: "NUMBER_CORRECTED",
        payload: { seasonId: seasonWithResultsId, driverProfileId: driver1Id, number: 77 },
        causedBy: "USER",
        supersedesId: numberEventId,
      },
    });

    const res = await detail(newer.id);
    const body = res.json();
    expect(body.item.number).toBe(77);
    expect(body.supersedesChain.map((item: { id: string }) => item.id)).toEqual([
      numberEventId,
    ]);
    const stored = await prisma.timelineEvent.count({
      where: { universeId: universeAId, kind: "NUMBER_CORRECTED" },
    });
    expect(stored).toBe(2);
    const original = await prisma.timelineEvent.findUniqueOrThrow({
      where: { id: numberEventId },
    });
    expect((original.payload as { number: number }).number).toBe(76);
    expect(original.supersedesId).toBeNull();
  });

  it("9) ownership leak-safe e 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/timeline/events/${numberEventId}`,
    });
    expect(res.statusCode).toBe(401);

    const foreign = await detail(numberEventId, userB.cookie);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).not.toContain("SELECT");

    const missing = await detail(randomUUID());
    expect(missing.statusCode).toBe(404);
  });
});
