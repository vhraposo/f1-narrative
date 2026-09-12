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
  userId: string;
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
      seasonId: fixture.ids.seasonId,
      externalSeasonId: fixture.ids.extSeasonId,
      ...(scopes ? { scopes } : {}),
    },
  });
}

async function saveUniverseRefs() {
  const team = await prisma.team.findFirstOrThrow({
    where: { userId: admin.id },
    select: { id: true },
  });
  mclarenTeamId = team.id;
  const lando = await prisma.character.findFirstOrThrow({
    where: { userId: admin.id, name: "Lando Norris" },
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
        seasonId: fixture.ids.seasonId,
        driverProfileId: landoProfile.id,
      },
    },
    select: { id: true },
  });
  mclarenLandoEntryId = landoEntry.id;
  const oscar = await prisma.character.findFirstOrThrow({
    where: { userId: admin.id, name: "Oscar Piastri" },
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

  it("2) ExternalDriver → Character + DriverProfile (controlledBy USER, do usuário)", async () => {
    const characters = await prisma.character.findMany({ where: { userId: admin.id } });
    expect(characters).toHaveLength(3);
    expect(characters.map((c) => c.controlledBy)).toEqual(["USER", "USER", "USER"]);
    expect(characters.map((c) => c.name).sort()).toEqual([
      "Lando Norris",
      "Oscar Piastri",
      "Reserve X",
    ]);
    expect(await prisma.driverProfile.count({ where: { character: { userId: admin.id } } })).toBe(3);
  });

  it("3) ExternalDriverSeason → SeasonDriverEntry (role/seat/número, ACTIVE, provenance IMPORTED)", async () => {
    const entries = await prisma.seasonDriverEntry.findMany({
      where: { seasonId: fixture.ids.seasonId },
    });
    expect(entries).toHaveLength(3);
    const seat1 = entries.find((entry) => entry.seat === 1)!;
    const seat2 = entries.find((entry) => entry.seat === 2)!;
    const reserve = entries.find((entry) => entry.role === "RESERVE")!;
    expect(seat1.role).toBe("RACE_SEAT");
    expect(seat1.number).toBe(2);
    expect(seat1.driverProfileId).not.toBeNull();
    expect(seat2.role).toBe("RACE_SEAT");
    expect(seat2.number).toBe(4);
    expect(reserve.number).toBe(88);
    expect(reserve.seat).toBeNull();
    expect(entries.every((entry) => entry.status === "ACTIVE")).toBe(true);
    expect(entries.every((entry) => entry.provenance === "IMPORTED")).toBe(true);
  });

  it("4) eventos de grid (CREATED) e bindings coerentes preservam a provenance", async () => {
    const events = await prisma.driverEntryEvent.findMany({
      where: { entry: { seasonId: fixture.ids.seasonId } },
      select: { kind: true },
    });
    expect(events).toHaveLength(3);
    expect(events.every((event) => event.kind === "CREATED")).toBe(true);

    const teamBinding = await prisma.externalBindingTeam.findUniqueOrThrow({
      where: { externalTeamId: fixture.ids.extTeamId },
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
      where: { externalDriverId: fixture.ids.extReserveId },
    });
    expect(driverBinding.confidence).toBe("CONFIRMED");
  });

  it("5) a temporada do universo vinculada é a correta (season correctness)", async () => {
    const binding = await prisma.externalBindingSeason.findUniqueOrThrow({
      where: { externalSeasonId: fixture.ids.extSeasonId },
    });
    expect(binding.seasonId).toBe(fixture.ids.seasonId);
    expect(binding.confidence).toBe("CONFIRMED");
  });

  it("6) re-execução é idempotente (reusa, não duplica) e status informed", async () => {
    const beforeTeams = await prisma.team.count({ where: { userId: admin.id } });
    const beforeCharacters = await prisma.character.count({ where: { userId: admin.id } });
    const beforeEntries = await prisma.seasonDriverEntry.count({ where: { seasonId: fixture.ids.seasonId } });

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

    expect(await prisma.team.count({ where: { userId: admin.id } })).toBe(beforeTeams);
    expect(await prisma.character.count({ where: { userId: admin.id } })).toBe(beforeCharacters);
    expect(await prisma.seasonDriverEntry.count({ where: { seasonId: fixture.ids.seasonId } })).toBe(beforeEntries);

    const statusRes = await app.inject({
      method: "GET",
      url: `/api/universe/initialization/status?seasonId=${fixture.ids.seasonId}&externalSeasonId=${fixture.ids.extSeasonId}`,
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

  it("8) pilotos materializados elegíveis ao chat: GET /api/characters retorna os mesmos Characters", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/characters",
      headers: { cookie: admin.cookie },
    });
    expect(res.statusCode).toBe(200);
    const characters = res.json().characters as CharacterListRow[];
    const lando = characters.find((character) => character.name === "Lando Norris");
    expect(lando).toBeTruthy();
    expect(lando!.id).toBe(landoCharId);
    expect(lando!.controlledBy).toBe("USER");
    expect(lando!.userId).toBe(admin.id);
  });

  it("9) conversa GROUP pode incluir piloto materializado (participante de Character, sem tipo externo)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/conversations",
      headers: { cookie: admin.cookie },
      payload: { title: "Rádio do grid", participantIds: [landoCharId] },
    });
    expect(res.statusCode).toBe(201);
    const { conversation } = res.json();
    createdConversationIds.push(conversation.id as string);
    const participants = conversation.participants as ParticipantRow[];
    const lando = participants.find((participant) => participant.name === "Lando Norris");
    expect(lando).toBeTruthy();
    expect(lando!.controlledBy).toBe("USER");
    expect(lando!.userId).toBe(admin.id);
  });

  it("10) divergência narrativa (Lando → Ferrari) não é sobrescrita e gera CONFLICT", async () => {
    const ferrari = await prisma.team.create({
      data: { name: "Ferrari", shortName: "FER", color: "#e80020", userId: admin.id },
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
    expect(await prisma.team.count({ where: { userId: admin.id } })).toBe(2);
    expect(await prisma.character.count({ where: { userId: admin.id } })).toBe(3);
    expect(await prisma.seasonDriverEntry.count({ where: { seasonId: fixture.ids.seasonId } })).toBe(3);
  });

  it("11) Player Entry no grid materializado desloca piloto materializado → AVAILABLE", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/universe/player-entry",
      headers: { cookie: admin.cookie },
      payload: {
        seasonId: fixture.ids.seasonId,
        teamId: mclarenTeamId,
        seat: 2,
        name: "Alicya Materializada",
        nationality: "Brasileira",
        birthDate: "2002-06-14",
      },
    });
    expect(res.statusCode).toBe(201);
    const result = res.json() as {
      character: { name: string; controlledBy: string; userId: string };
      displaced: {
        entry: {
          driverProfile: { character: { name: string } };
          status: string;
          teamId: string | null;
          role: string | null;
          seat: number | null;
        };
      } | null;
    };
    expect(result.character.controlledBy).toBe("USER");
    expect(result.character.userId).toBe(admin.id);
    expect(result.displaced).toBeTruthy();
    expect(result.displaced!.entry.driverProfile.character.name).toBe("Oscar Piastri");
    expect(result.displaced!.entry.status).toBe("AVAILABLE");
    expect(result.displaced!.entry.teamId).toBeNull();
    expect(result.displaced!.entry.role).toBeNull();
    expect(result.displaced!.entry.seat).toBeNull();

    const oscarEntry = await prisma.seasonDriverEntry.findFirstOrThrow({
      where: { seasonId: fixture.ids.seasonId, driverProfileId: oscarProfileId },
    });
    expect(oscarEntry.status).toBe("AVAILABLE");
    expect(oscarEntry.number).toBeNull();
    const displacedEvent = await prisma.driverEntryEvent.findFirst({
      where: { entryId: oscarEntry.id, kind: "DISPLACED" },
    });
    expect(displacedEvent).toBeTruthy();
  });
});