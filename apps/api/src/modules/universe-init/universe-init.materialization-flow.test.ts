import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  seedUniverseInitFixture,
  type InitFixtureIds,
} from "./universe-init.fixtures.js";

const YEAR = 2034;

type User = { id: string; cookie: string };

type DriverListRow = { character: { name: string } };
type TeamListRow = { name: string };
type CharacterListRow = {
  id: string;
  name: string;
  controlledBy: string;
  userId: string | null;
};
type ParticipantRow = {
  id: string;
  name: string;
  controlledBy: string;
  userId: string | null;
};

let app: FastifyInstance;
let admin: User;
let fixture: {
  ids: InitFixtureIds;
  cleanup: (extraUserIds?: string[]) => Promise<void>;
};

const createdConversationIds: string[] = [];
let adminUniverseId = "";
let adminSeasonId = "";
let mclarenTeamId = "";
let landoCharId = "";
let mclarenLandoEntryId = "";
let oscarProfileId = "";

const ORIGIN = "http://localhost:3000";

async function createSession(name: string): Promise<User> {
  const email = `init-${Date.now()}@f1nw.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: ORIGIN },
    payload: { name, email, password: "senha-segura-123" },
  });
  expect(res.statusCode, `body: ${res.body}`).toBe(200);
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: stored.id, cookie };
}

async function postInitialization(scopes?: string[]) {
  return app.inject({
    method: "POST",
    url: "/api/universe/initialization",
    headers: { cookie: admin.cookie },
    payload: {
      seasonId: adminSeasonId,
      externalSeasonId: fixture.ids.extSeasonId,
      ...(scopes ? { scopes } : {}),
    },
  });
}

async function saveUniverseRefs() {
  const universe = await prisma.universe.findUniqueOrThrow({
    where: { userId: admin.id },
    select: { id: true },
  });
  adminUniverseId = universe.id;
  const team = await prisma.team.findFirstOrThrow({
    where: { universeId: adminUniverseId },
    select: { id: true },
  });
  mclarenTeamId = team.id;
  const lando = await prisma.character.findFirstOrThrow({
    where: { universeId: adminUniverseId, name: "Lando Norris" },
    select: { id: true },
  });
  landoCharId = lando.id;
  const landoProfile = await prisma.driverProfile.findUniqueOrThrow({
    where: { characterId: lando.id },
    select: { id: true },
  });
  const landoEntry = await prisma.seasonDriverEntry.findUniqueOrThrow({
    where: {
      seasonId_driverProfileId: {
        seasonId: adminSeasonId,
        driverProfileId: landoProfile.id,
      },
    },
    select: { id: true },
  });
  mclarenLandoEntryId = landoEntry.id;
  const oscar = await prisma.character.findFirstOrThrow({
    where: { universeId: adminUniverseId, name: "Oscar Piastri" },
    select: { id: true },
  });
  const oscarProfile = await prisma.driverProfile.findUniqueOrThrow({
    where: { characterId: oscar.id },
    select: { id: true },
  });
  oscarProfileId = oscarProfile.id;
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  admin = await createSession("Init Admin Flow");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
  fixture = await seedUniverseInitFixture(YEAR);

  const adminUniverse = await prisma.universe.upsert({
    where: { userId: admin.id },
    update: {},
    create: { userId: admin.id },
  });
  adminUniverseId = adminUniverse.id;
  const adminSeason = await prisma.season.create({
    data: {
      universeId: adminUniverseId,
      year: YEAR,
      name: String(YEAR),
      status: "PRE_SEASON",
    },
  });
  adminSeasonId = adminSeason.id;

  const res = await postInitialization();
  expect(res.statusCode).toBe(200);
  const { report } = res.json();
  expect(report.conflicts).toEqual([]);

  await saveUniverseRefs();
});

afterAll(async () => {
  if (createdConversationIds.length > 0) {
    await prisma.conversation.deleteMany({
      where: { id: { in: createdConversationIds } },
    });
  }
  await fixture.cleanup([admin.id]);
  await prisma.$disconnect();
  await app.close();
});

describe("Materialização automática da F1 no Universo — fluxo real (107.1)", () => {
  it("1) ExternalTeam → Team com dados do espelho", async () => {
    const team = await prisma.team.findUniqueOrThrow({ where: { id: mclarenTeamId } });
    expect(team.name).toBe("McLaren");
    expect(team.shortName).toBe("MCL");
    expect(team.color).toBe("#ff8000");
    expect(team.userId).toBe(admin.id);
  });

  it("2) ExternalDriver → Character de IA + DriverProfile do universo", async () => {
    const characters = await prisma.character.findMany({
      where: { universeId: adminUniverseId },
    });
    expect(characters).toHaveLength(3);
    expect(characters.map((c) => c.controlledBy)).toEqual(["AI", "AI", "AI"]);
    expect(characters.map((c) => c.userId)).toEqual([null, null, null]);
    expect(characters.map((c) => c.name).sort()).toEqual([
      "Lando Norris",
      "Oscar Piastri",
      "Reserve X",
    ]);
    expect(
      await prisma.driverProfile.count({
        where: { character: { universeId: adminUniverseId } },
      }),
    ).toBe(3);
  });

  it("3) ExternalDriverSeason → SeasonDriverEntry (role/seat/número, ACTIVE, provenance IMPORTED)", async () => {
    const entries = await prisma.seasonDriverEntry.findMany({
      where: { seasonId: adminSeasonId },
    });
    expect(entries).toHaveLength(3);
    const landoEntry = entries.find((entry) => entry.number === 2)!;
    const oscarEntry = entries.find((entry) => entry.number === 4)!;
    const reserve = entries.find((entry) => entry.role === "RESERVE")!;
    expect(landoEntry.role).toBeNull();
    expect(landoEntry.seat).toBeNull();
    expect(landoEntry.teamId).not.toBeNull();
    expect(oscarEntry.role).toBeNull();
    expect(oscarEntry.seat).toBeNull();
    expect(oscarEntry.teamId).not.toBeNull();
    expect(reserve.role).toBe("RESERVE");
    expect(reserve.number).toBe(88);
    expect(reserve.seat).toBeNull();
    expect(entries.every((entry) => entry.status === "ACTIVE")).toBe(true);
    expect(entries.every((entry) => entry.provenance === "IMPORTED")).toBe(true);
  });

  it("4) eventos de grid (CREATED) e bindings coerentes preservam a provenance", async () => {
    const events = await prisma.driverEntryEvent.findMany({
      where: { entry: { seasonId: adminSeasonId } },
      select: { kind: true },
    });
    expect(events).toHaveLength(3);
    expect(events.every((event) => event.kind === "CREATED")).toBe(true);

    const teamBinding = await prisma.externalBindingTeam.findUniqueOrThrow({
      where: {
        universeId_externalTeamId: {
          universeId: adminUniverseId,
          externalTeamId: fixture.ids.extTeamId,
        },
      },
    });
    expect(teamBinding.confidence).toBe("CONFIRMED");
    expect(teamBinding.boundBy).toBe("ADMIN");

    expect(
      await prisma.externalBindingDriver.count({
        where: {
          externalDriverId: {
            in: [fixture.ids.extLandoId, fixture.ids.extOscarId, fixture.ids.extReserveId],
          },
        },
      }),
    ).toBe(3);
    expect(
      await prisma.externalBindingDriverSeason.count({
        where: {
          externalDriverSeasonId: {
            in: [fixture.ids.extDsLandoId, fixture.ids.extDsOscarId, fixture.ids.extDsReserveId],
          },
        },
      }),
    ).toBe(3);
    const driverBinding = await prisma.externalBindingDriver.findUniqueOrThrow({
      where: {
        universeId_externalDriverId: {
          universeId: adminUniverseId,
          externalDriverId: fixture.ids.extReserveId,
        },
      },
    });
    expect(driverBinding.confidence).toBe("CONFIRMED");
  });

  it("5) a temporada do universo vinculada é a correta (season correctness)", async () => {
    const binding = await prisma.externalBindingSeason.findUniqueOrThrow({
      where: {
        universeId_externalSeasonId: {
          universeId: adminUniverseId,
          externalSeasonId: fixture.ids.extSeasonId,
        },
      },
    });
    expect(binding.seasonId).toBe(adminSeasonId);
    expect(binding.confidence).toBe("CONFIRMED");
  });

  it("6) re-execução é idempotente (reusa, não duplica) e status informed", async () => {
    const beforeTeams = await prisma.team.count({ where: { universeId: adminUniverseId } });
    const beforeCharacters = await prisma.character.count({
      where: { universeId: adminUniverseId },
    });
    const beforeEntries = await prisma.seasonDriverEntry.count({ where: { seasonId: adminSeasonId } });

    const res = await postInitialization();
    expect(res.statusCode).toBe(200);
    const { report } = res.json();
    expect(report.conflicts).toEqual([]);
    expect(report.summary).toMatchObject({
      teamsCreated: 0,
      teamsReused: 1,
      charactersCreated: 0,
      charactersReused: 3,
      profilesCreated: 0,
      profilesReused: 3,
      entriesCreated: 0,
      entriesReused: 3,
      bindingsCreated: 0,
    });

    expect(await prisma.team.count({ where: { universeId: adminUniverseId } })).toBe(beforeTeams);
    expect(await prisma.character.count({ where: { universeId: adminUniverseId } })).toBe(
      beforeCharacters,
    );
    expect(await prisma.seasonDriverEntry.count({ where: { seasonId: adminSeasonId } })).toBe(beforeEntries);

    const statusRes = await app.inject({
      method: "GET",
      url: `/api/universe/initialization/status?seasonId=${adminSeasonId}&externalSeasonId=${fixture.ids.extSeasonId}`,
      headers: { cookie: admin.cookie },
    });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json().status.initialized).toBe(true);
  });

  it("7) roster inicial visível na API: GET /api/drivers e GET /api/teams", async () => {
    const driversRes = await app.inject({
      method: "GET",
      url: "/api/drivers",
      headers: { cookie: admin.cookie },
    });
    expect(driversRes.statusCode).toBe(200);
    const names = (driversRes.json().drivers as DriverListRow[]).map((d) => d.character.name);
    expect(names.sort()).toEqual(["Lando Norris", "Oscar Piastri", "Reserve X"]);

    const teamsRes = await app.inject({
      method: "GET",
      url: "/api/teams",
      headers: { cookie: admin.cookie },
    });
    expect(teamsRes.statusCode).toBe(200);
    const teamNames = (teamsRes.json().teams as TeamListRow[]).map((t) => t.name);
    expect(teamNames).toContain("McLaren");
  });

  it("8) pilotos materializados são IA: fora de /api/characters e no catálogo /api/characters/ai", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/characters",
      headers: { cookie: admin.cookie },
    });
    expect(res.statusCode).toBe(200);
    const characters = res.json().characters as CharacterListRow[];
    expect(characters.find((character) => character.name === "Lando Norris")).toBeUndefined();

    const aiRes = await app.inject({
      method: "GET",
      url: "/api/characters/ai",
      headers: { cookie: admin.cookie },
    });
    expect(aiRes.statusCode).toBe(200);
    const aiCharacters = aiRes.json().characters as CharacterListRow[];
    const lando = aiCharacters.find((character) => character.name === "Lando Norris");
    expect(lando).toBeTruthy();
    expect(lando!.id).toBe(landoCharId);
    expect(lando!.controlledBy).toBe("AI");
  });

  it("9) conversa GROUP pode incluir piloto materializado (Character de IA do universo)", async () => {
    const anchor = await prisma.character.create({
      data: {
        userId: admin.id,
        universeId: adminUniverseId,
        controlledBy: "USER",
        name: "Engenheiro do Jogador",
        nationality: "Brasileira",
        birthDate: new Date("1990-01-01"),
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/conversations",
      headers: { cookie: admin.cookie },
      payload: { title: "Rádio do grid", participantIds: [anchor.id, landoCharId] },
    });
    expect(res.statusCode).toBe(201);
    const { conversation } = res.json();
    createdConversationIds.push(conversation.id as string);
    const participants = conversation.participants as ParticipantRow[];
    const lando = participants.find((participant) => participant.name === "Lando Norris");
    expect(lando).toBeTruthy();
    expect(lando!.controlledBy).toBe("AI");
    expect(lando!.userId).toBeNull();
  });

  it("10) divergência narrativa (Lando → Ferrari) não é sobrescrita e gera CONFLICT", async () => {
    const ferrari = await prisma.team.create({
      data: {
        name: "Ferrari",
        shortName: "FER",
        color: "#e80020",
        userId: admin.id,
        universeId: adminUniverseId,
      },
    });
    await prisma.seasonDriverEntry.update({
      where: { id: mclarenLandoEntryId },
      data: { teamId: ferrari.id, seat: 1, provenance: "HYBRID" },
    });

    const res = await postInitialization(["DRIVER_GRID"]);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("CONFLICT");

    const landoEntry = await prisma.seasonDriverEntry.findUniqueOrThrow({
      where: { id: mclarenLandoEntryId },
    });
    expect(landoEntry.teamId).toBe(ferrari.id);
    expect(landoEntry.seat).toBe(1);
    expect(await prisma.team.count({ where: { universeId: adminUniverseId } })).toBe(2);
    expect(
      await prisma.character.count({
        where: { universeId: adminUniverseId, controlledBy: "AI" },
      }),
    ).toBe(3);
    expect(await prisma.seasonDriverEntry.count({ where: { seasonId: adminSeasonId } })).toBe(3);
  });

  it("11) Player Entry bloqueado quando o grid de abertura está UNRESOLVED (participante e assento aberto)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/universe/player-entry",
      headers: { cookie: admin.cookie },
      payload: {
        seasonId: adminSeasonId,
        teamId: mclarenTeamId,
        seat: 2,
        name: "Alicya Materializada",
        nationality: "Brasileira",
        birthDate: "2002-06-14",
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("OPENING_GRID_UNRESOLVED");

    expect(
      await prisma.character.count({
        where: { universeId: adminUniverseId, name: "Alicya Materializada" },
      }),
    ).toBe(0);
    expect(
      await prisma.seasonDriverEntry.count({
        where: { seasonId: adminSeasonId, teamId: mclarenTeamId, seat: 2 },
      }),
    ).toBe(0);

    const oscarEntry = await prisma.seasonDriverEntry.findFirstOrThrow({
      where: { seasonId: adminSeasonId, driverProfileId: oscarProfileId },
    });
    expect(oscarEntry.status).toBe("ACTIVE");
    expect(oscarEntry.role).toBeNull();
    expect(oscarEntry.seat).toBeNull();
    const displacedEvent = await prisma.driverEntryEvent.findFirst({
      where: { entryId: oscarEntry.id, kind: "DISPLACED" },
    });
    expect(displacedEvent).toBeNull();
  });
});