import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";

type TestUser = { cookie: string; userId: string };

const createdSeasonIds: string[] = [];
const createdRaceIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdTeamIds: string[] = [];
const createdConversationIds: string[] = [];

let app: FastifyInstance;
let owner: TestUser;

let seasonMainId: string;
let raceOneId: string;
let raceTwoId: string;
let seasonBoringId: string;
let raceBoringId: string;
let seasonFlipId: string;
let raceFlipOneId: string;
let raceFlipTwoId: string;

let driverAId: string;
let driverBId: string;
let driverCId: string;
let charAId: string;
let charBId: string;
let charCId: string;

type SeasonShim = { id: string };

async function createUser(email: string, name: string): Promise<TestUser> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name, email, password: "narrate-strong-1" },
  });
  expect(res.statusCode).toBe(200);
  const cookie = (res.cookies ?? [])
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookie, userId: user.id };
}

async function createCharacter(user: TestUser, name: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/characters",
    headers: { cookie: user.cookie },
    payload: { name, nationality: "BR", birthDate: "1990-01-01" },
  });
  expect(res.statusCode).toBe(201);
  const character = res.json().character as { id: string };
  createdCharacterIds.push(character.id);
  return character;
}

async function createDriver(user: TestUser, characterId: string) {
  const res = await app.inject({
    method: "PUT",
    url: `/api/drivers/${characterId}`,
    headers: { cookie: user.cookie },
    payload: { name: "Piloto Teste" },
  });
  expect(res.statusCode).toBe(200);
  const driver = res.json().driver as { id: string };
  return { driverProfileId: driver.id };
}

async function createTeam(user: TestUser, name: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/teams",
    headers: { cookie: user.cookie },
    payload: { name },
  });
  expect(res.statusCode).toBe(201);
  const team = res.json().team as { id: string };
  createdTeamIds.push(team.id);
  return team;
}

async function createSeason(user: TestUser, year: number) {
  const res = await app.inject({
    method: "POST",
    url: "/api/seasons",
    headers: { cookie: user.cookie },
    payload: { year },
  });
  expect(res.statusCode).toBe(201);
  const season = res.json().season as SeasonShim;
  createdSeasonIds.push(season.id);
  return season;
}

async function createRace(
  user: TestUser,
  seasonId: string,
  round: number,
  name: string,
) {
  const res = await app.inject({
    method: "POST",
    url: `/api/seasons/${seasonId}/races`,
    headers: { cookie: user.cookie },
    payload: {
      name,
      circuit: "Interlagos",
      country: "Brasil",
      date: `2099-0${round}-15T14:00:00.000Z`,
      round,
    },
  });
  expect(res.statusCode).toBe(201);
  const race = res.json().race as { id: string };
  createdRaceIds.push(race.id);
  return race;
}

async function assignSeat(
  user: TestUser,
  seasonId: string,
  teamId: string,
  driverProfileId: string,
  seat: 1 | 2,
): Promise<void> {
  const res = await app.inject({
    method: "POST",
    url: "/api/roster/assign",
    headers: { cookie: user.cookie },
    payload: { seasonId, teamId, driverProfileId, seat },
  });
  expect(res.statusCode).toBe(200);
}

function writeResult(
  raceId: string,
  driverProfileId: string,
  data: {
    position?: number | null;
    grid?: number | null;
    status?: string | null;
  },
) {
  return prisma.raceResult.upsert({
    where: { raceId_driverProfileId: { raceId, driverProfileId } },
    create: {
      raceId,
      driverProfileId,
      position: data.position ?? null,
      grid: data.grid ?? null,
      status: data.status ?? null,
      points: 0,
    },
    update: {
      position: data.position ?? null,
      grid: data.grid ?? null,
      status: data.status ?? null,
    },
  });
}

type ProcessPayload = {
  raceId: string;
  events: Array<{ key: string; type: string; importance: string; title: string }>;
};

async function processNarrative(user: TestUser, raceId: string) {
  const res = await app.inject({
    method: "POST",
    url: `/api/races/${raceId}/narrative/process`,
    headers: { cookie: user.cookie },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as ProcessPayload;
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  owner = await createUser("narrate@example.com", "Dona Narrate");

  const charA = await createCharacter(owner, "Piloto A");
  charAId = charA.id;
  driverAId = (await createDriver(owner, charA.id)).driverProfileId;
  const charB = await createCharacter(owner, "Piloto B");
  charBId = charB.id;
  driverBId = (await createDriver(owner, charB.id)).driverProfileId;
  const charC = await createCharacter(owner, "Piloto C");
  charCId = charC.id;
  driverCId = (await createDriver(owner, charC.id)).driverProfileId;

  const teamOne = await createTeam(owner, "Equipe Primeira");
  const teamTwo = await createTeam(owner, "Equipe Segunda");
  const teamThree = await createTeam(owner, "Equipe Terceira");

  const main = await createSeason(owner, 2100);
  seasonMainId = main.id;
  await assignSeat(owner, seasonMainId, teamOne.id, driverAId, 1);
  await assignSeat(owner, seasonMainId, teamOne.id, driverBId, 2);
  await assignSeat(owner, seasonMainId, teamTwo.id, driverCId, 1);

  const raceOne = await createRace(owner, seasonMainId, 1, "GP Controle");
  raceOneId = raceOne.id;
  const raceTwo = await createRace(owner, seasonMainId, 2, "GP Virada");
  raceTwoId = raceTwo.id;

  const boring = await createSeason(owner, 2090);
  seasonBoringId = boring.id;
  await assignSeat(owner, seasonBoringId, teamTwo.id, driverAId, 1);
  await assignSeat(owner, seasonBoringId, teamThree.id, driverCId, 1);
  const raceBoring = await createRace(owner, seasonBoringId, 1, "GP Sem Graça");
  raceBoringId = raceBoring.id;

  const flip = await createSeason(owner, 2087);
  seasonFlipId = flip.id;
  await assignSeat(owner, seasonFlipId, teamOne.id, driverAId, 1);
  await assignSeat(owner, seasonFlipId, teamOne.id, driverBId, 2);
  await assignSeat(owner, seasonFlipId, teamTwo.id, driverCId, 1);
  raceFlipOneId = (await createRace(owner, seasonFlipId, 1, "GP Basico")).id;
  raceFlipTwoId = (await createRace(owner, seasonFlipId, 2, "GP Decisao")).id;
});

afterAll(async () => {
  await prisma.conversationParticipant.deleteMany({
    where: { conversationId: { in: createdConversationIds } },
  });
  await prisma.message.deleteMany({
    where: { conversationId: { in: createdConversationIds } },
  });
  await prisma.conversation.deleteMany({
    where: { id: { in: createdConversationIds } },
  });
  await prisma.memory.deleteMany({
    where: {
      eventId: {
        in: (await prisma.event.findMany({
          where: { payload: { path: ["origin"], equals: "RACE_RESULT" } },
          select: { id: true },
        })).map((e) => e.id),
      },
    },
  });
  await prisma.event.deleteMany({
    where: { payload: { path: ["origin"], equals: "RACE_RESULT" } },
  });
  await prisma.relationship.deleteMany({
    where: {
      OR: [
        { characterAId: charAId, characterBId: charBId },
        { characterAId: charBId, characterBId: charAId },
      ],
    },
  });
  await prisma.raceResult.deleteMany({
    where: { raceId: { in: createdRaceIds } },
  });
  await prisma.race.deleteMany({
    where: { id: { in: createdRaceIds } },
  });
  await prisma.seasonDriverEntry.deleteMany({
    where: { seasonId: { in: createdSeasonIds } },
  });
  await prisma.season.deleteMany({
    where: { id: { in: createdSeasonIds } },
  });
  await prisma.driverProfile.deleteMany({
    where: { characterId: { in: createdCharacterIds } },
  });
  await prisma.character.deleteMany({
    where: { id: { in: createdCharacterIds } },
  });
  await prisma.team.deleteMany({
    where: { id: { in: createdTeamIds } },
  });
  await prisma.user.deleteMany({ where: { id: owner.userId } });
  await app.close();
});

describe("Integracao narrativa de corrida", () => {
  it("rejeita sem autenticacao", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/races/00000000-0000-4000-8000-000000000001/narrative/process",
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejeita identificador invalido", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/races/nao-uuid/narrative/process",
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejeita corrida inexistente", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/races/00000000-0000-4000-8000-000000000099/narrative/process",
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("gera eventos elegiveis a partir de RaceResults e nao altera o resultado", async () => {
    await writeResult(raceOneId, driverAId, {
      position: 1,
      grid: 1,
      status: "Finished",
    });
    await writeResult(raceOneId, driverBId, {
      position: 2,
      grid: 2,
      status: "Finished",
    });
    await writeResult(raceOneId, driverCId, {
      position: null,
      grid: 3,
      status: "Retired",
    });

    const before = await prisma.raceResult.findMany({
      where: { raceId: raceOneId },
      select: {
        driverProfileId: true,
        position: true,
        grid: true,
        status: true,
      },
      orderBy: { driverProfileId: "asc" },
    });

    const payload = await processNarrative(owner, raceOneId);

    const kinds = payload.events.map((e) => e.key.split("|")[0]).sort();
    expect(kinds).toEqual(["dnf", "pole", "teammate-battle", "victory"]);
    expect(
      payload.events.find((e) => e.key.startsWith("victory"))!.title,
    ).toBe("Piloto A vence GP Controle");
    expect(
      payload.events.find((e) => e.key.startsWith("pole"))!.title,
    ).toBe("Piloto A garante a pole em GP Controle");
    expect(payload.events.find((e) => e.key.startsWith("dnf"))!.title).toBe(
      "Piloto C abandona GP Controle",
    );

    expect(
      await prisma.raceResult.findMany({
        where: { raceId: raceOneId },
        select: {
          driverProfileId: true,
          position: true,
          grid: true,
          status: true,
        },
        orderBy: { driverProfileId: "asc" },
      }),
    ).toEqual(before);
    const raceOneEvents = await prisma.event.findMany({
      where: {
        payload: { path: ["raceId"], equals: raceOneId },
      },
    });
    const victoryEvent = raceOneEvents.find((e) => {
      const p = e.payload as Record<string, unknown>;
      return p.kind === "victory";
    });
    expect(victoryEvent).toBeDefined();
    const victoryParticipants = (
      await prisma.eventCharacter.findMany({
        where: { eventId: victoryEvent!.id },
        select: { characterId: true },
      })
    )
      .map((p) => p.characterId)
      .sort();
    expect(victoryParticipants).toEqual([charAId, charBId].sort());

    const battleEvent = raceOneEvents.find((e) => {
      const p = e.payload as Record<string, unknown>;
      return p.kind === "teammate-battle";
    });
    expect(battleEvent).toBeDefined();
    const battleParticipants = (
      await prisma.eventCharacter.findMany({
        where: { eventId: battleEvent!.id },
        select: { characterId: true },
      })
    )
      .map((p) => p.characterId)
      .sort();
    expect(battleParticipants).toEqual([charAId, charBId].sort());
  });

  it("reprocessamento e idempotente sem duplicar eventos", async () => {
    const first = await processNarrative(owner, raceOneId);
    expect(first.events).toHaveLength(0);

    const total = await prisma.event.count({
      where: { payload: { path: ["raceId"], equals: raceOneId } },
    });
    expect(total).toBe(4);
  });

  it("detecta mudanca relevante de lideranca no campeonato", async () => {
    await writeResult(raceFlipOneId, driverAId, {
      position: 1,
      grid: 1,
      status: "Finished",
    });
    await writeResult(raceFlipOneId, driverCId, {
      position: 2,
      grid: 2,
      status: "Finished",
    });
    await writeResult(raceFlipOneId, driverBId, {
      position: 3,
      grid: 3,
      status: "Finished",
    });
    const leadRaceOne = await processNarrative(owner, raceFlipOneId);
    expect(leadRaceOne.events.find((e) => e.key.startsWith("lead-change"))).toBeUndefined();

    await writeResult(raceFlipTwoId, driverCId, {
      position: 1,
      grid: 1,
      status: "Finished",
    });
    await writeResult(raceFlipTwoId, driverBId, {
      position: 2,
      grid: 2,
      status: "Finished",
    });
    await writeResult(raceFlipTwoId, driverAId, {
      position: 4,
      grid: 3,
      status: "Finished",
    });

    const payload = await processNarrative(owner, raceFlipTwoId);

    const lead = payload.events.find((e) => e.key.startsWith("lead-change"));
    expect(lead).toBeDefined();
    expect(lead!.title).toBe(
      "Mudança de liderança no campeonato em GP Decisao",
    );

    const leadEventByKind = await prisma.event.findFirstOrThrow({
      where: {
        payload: { path: ["kind"], equals: "lead-change" },
      },
      orderBy: { createdAt: "desc" },
    });
    const kindPayload = leadEventByKind.payload as Record<string, unknown>;
    expect(kindPayload.fromId).toBe(driverAId);
    expect(kindPayload.toId).toBe(driverCId);
  });

  it("resultado irrelevante nao gera evento", async () => {
    await writeResult(raceBoringId, driverAId, {
      position: 4,
      grid: null,
      status: "Finished",
    });
    await writeResult(raceBoringId, driverCId, {
      position: 5,
      grid: null,
      status: "Finished",
    });

    const payload = await processNarrative(owner, raceBoringId);
    expect(payload.events).toHaveLength(0);
    expect(
      await prisma.event.count({
        where: { payload: { path: ["raceId"], equals: raceBoringId } },
      }),
    ).toBe(0);
  });

  it("evento aparece no contexto narrativo e evolui memory/relationship", async () => {
    const conversation = await app.inject({
      method: "POST",
      url: "/api/conversations",
      headers: { cookie: owner.cookie },
      payload: {
        title: "Convesa de Box",
        type: "GROUP",
        participantIds: [charAId, charBId, charCId],
      },
    });
    expect(conversation.statusCode).toBe(201);
    const conv = conversation.json().conversation as { id: string };
    createdConversationIds.push(conv.id);

    const context = await app.inject({
      method: "GET",
      url: `/api/conversations/${conv.id}/context`,
      headers: { cookie: owner.cookie },
    });
    expect(context.statusCode).toBe(200);
    const body = context.json().context as {
      events: Array<{ id: string; type: string; title: string }>;
      memories: Array<{
        id: string;
        eventId: string | null;
        source: string;
      }>;
      relationships: Array<{
        characterAId: string;
        characterBId: string;
        dimensions: Record<string, number>;
      }>;
    };

    const events = await prisma.event.findMany({
      where: { payload: { path: ["raceId"], equals: raceOneId } },
      select: { id: true, title: true },
    });
    for (const event of events) {
      const visible = body.events.find((e) => e.id === event.id);
      expect(visible).toBeDefined();
      expect(visible!.title).toBe(event.title);
    }

    const battleMemory = body.memories.find(
      (m) => m.source === "GENERATED_EVENT",
    );
    expect(battleMemory).toBeDefined();
    expect(battleMemory!.eventId).not.toBeNull();

    const battleRel = body.relationships.find(
      (r) =>
        (r.characterAId === charAId && r.characterBId === charBId) ||
        (r.characterAId === charBId && r.characterBId === charAId),
    );
    expect(battleRel).toBeDefined();
    expect(battleRel!.dimensions.rivalry).toBe(15);
    expect(battleRel!.dimensions.affinity).toBe(-10);
    expect(battleRel!.dimensions.trust).toBe(-5);
  });

  it("isola eventos entre temporadas e corridas", async () => {
    const mainCount = await prisma.event.count({
      where: { payload: { path: ["seasonId"], equals: seasonMainId } },
    });
    const boringCount = await prisma.event.count({
      where: { payload: { path: ["seasonId"], equals: seasonBoringId } },
    });
    expect(mainCount).toBeGreaterThan(0);
    expect(boringCount).toBe(0);

    const raceEvents = await prisma.event.findMany({
      where: { payload: { path: ["origin"], equals: "RACE_RESULT" } },
      select: { payload: true },
    });
    const raceIds = raceEvents
      .filter(
        (event) =>
          event.payload !== null &&
          typeof event.payload === "object" &&
          (event.payload as Record<string, unknown>).origin === "RACE_RESULT",
      )
      .map((event) => (event.payload as Record<string, unknown>).raceId);
    expect(raceIds).toContain(raceOneId);
    expect(raceIds).toContain(raceFlipOneId);
    expect(raceIds).toContain(raceFlipTwoId);
    expect(raceIds).not.toContain(raceBoringId);
    expect(raceIds).not.toContain(raceTwoId);
  });
});