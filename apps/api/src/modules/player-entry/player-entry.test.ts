import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { JOLPICA_SOURCE } from "../external-sync/jolpica.service.js";

const WORLD_KEY = "default";
const YEAR = 2026;

type User = { id: string; cookie: string };

async function createUser(email: string, name: string): Promise<User> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name, email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: stored.id, cookie };
}

async function createSeason(year: number): Promise<{ id: string }> {
  const season = await prisma.season.create({ data: { year } });
  return { id: season.id };
}

async function setCurrentSeason(seasonId: string | null): Promise<void> {
  await prisma.worldState.upsert({
    where: { key: WORLD_KEY },
    update: { currentSeasonId: seasonId },
    create: { key: WORLD_KEY, currentSeasonId: seasonId },
  });
}

async function readCurrentSeason(): Promise<string | null> {
  const world = await prisma.worldState.findUnique({ where: { key: WORLD_KEY } });
  return world?.currentSeasonId ?? null;
}

type Fixture = {
  ids: {
    seasonId: string;
    teamId: string;
    extSeasonId: string;
    extTeamId: string;
    extTeamExternalId: string;
    driverLandoId: string;
    driverOscarId: string;
    entryLandoId: string;
    entryOscarId: string;
  };
  cleanup: () => Promise<void>;
};

async function seedUniverse2026(userId: string): Promise<Fixture> {
  const runId = Math.random().toString(36).slice(2, 8);

  const season = await prisma.season.create({
    data: { year: YEAR, name: String(YEAR), status: "PRE_SEASON" },
  });
  const team = await prisma.team.create({
    data: { name: "McLaren", shortName: "MCL", color: "#ff8000", userId },
  });
  const characterLando = await prisma.character.create({
    data: { name: "Lando Norris", nationality: "British", birthDate: new Date("1999-11-13"), userId },
  });
  const characterOscar = await prisma.character.create({
    data: { name: "Oscar Piastri", nationality: "Australian", birthDate: new Date("2001-04-06"), userId },
  });
  const driverLando = await prisma.driverProfile.create({
    data: { characterId: characterLando.id, number: 1, teamId: team.id },
  });
  const driverOscar = await prisma.driverProfile.create({
    data: { characterId: characterOscar.id, number: 81, teamId: team.id },
  });
  const entryLando = await prisma.seasonDriverEntry.create({
    data: {
      seasonId: season.id,
      driverProfileId: driverLando.id,
      teamId: team.id,
      role: "RACE_SEAT",
      seat: 1,
      number: 1,
      status: "ACTIVE",
      provenance: "IMPORTED",
    },
  });
  const entryOscar = await prisma.seasonDriverEntry.create({
    data: {
      seasonId: season.id,
      driverProfileId: driverOscar.id,
      teamId: team.id,
      role: "RACE_SEAT",
      seat: 2,
      number: 81,
      status: "ACTIVE",
      provenance: "IMPORTED",
    },
  });

  const extSeasonShared = await prisma.externalSeason.findUnique({
    where: { source_year: { source: JOLPICA_SOURCE, year: YEAR } },
    select: { id: true, status: true },
  });
  let extSeasonCreated = false;
  const extSeason = extSeasonShared
    ? extSeasonShared
    : await prisma.externalSeason.create({
        data: { source: JOLPICA_SOURCE, year: YEAR, name: String(YEAR), status: "ACTIVE", contentHash: `pe-ext-season-${runId}` },
      });
  if (!extSeasonShared) extSeasonCreated = true;

  const extTeam = await prisma.externalTeam.create({
    data: { source: JOLPICA_SOURCE, externalId: `mclaren-pe-${runId}`, name: "McLaren", shortName: "MCL", color: "#ff8000", contentHash: "pe-ext-team" },
  });
  const extLando = await prisma.externalDriver.create({
    data: { source: JOLPICA_SOURCE, externalId: `lando-norris-pe-${runId}`, name: "Lando Norris", fullName: "Lando Norris", nationality: "British", number: 1, contentHash: "pe-ext-lando" },
  });
  const extOscar = await prisma.externalDriver.create({
    data: { source: JOLPICA_SOURCE, externalId: `oscar-piastri-pe-${runId}`, name: "Oscar Piastri", fullName: "Oscar Piastri", nationality: "Australian", number: 81, contentHash: "pe-ext-oscar" },
  });

  const dsLando = await prisma.externalDriverSeason.create({
    data: { source: JOLPICA_SOURCE, externalDriverId: extLando.id, seasonYear: YEAR, teamExternalId: extTeam.externalId, teamNameSnapshot: "McLaren", number: 1, role: null, contentHash: "pe-ds-lando" },
  });
  const dsOscar = await prisma.externalDriverSeason.create({
    data: { source: JOLPICA_SOURCE, externalDriverId: extOscar.id, seasonYear: YEAR, teamExternalId: extTeam.externalId, teamNameSnapshot: "McLaren", number: 81, role: null, contentHash: "pe-ds-oscar" },
  });

  await prisma.externalBindingSeason.create({
    data: { externalSeasonId: extSeason.id, seasonId: season.id, confidence: "CONFIRMED", boundBy: "ADMIN" },
  });
  await prisma.externalBindingTeam.create({
    data: { externalTeamId: extTeam.id, teamId: team.id, confidence: "CONFIRMED", boundBy: "ADMIN" },
  });
  await prisma.externalBindingDriver.create({
    data: { externalDriverId: extLando.id, characterId: characterLando.id, confidence: "CONFIRMED", boundBy: "ADMIN" },
  });
  await prisma.externalBindingDriver.create({
    data: { externalDriverId: extOscar.id, characterId: characterOscar.id, confidence: "CONFIRMED", boundBy: "ADMIN" },
  });
  await prisma.externalBindingDriverSeason.create({
    data: { externalDriverSeasonId: dsLando.id, seasonDriverEntryId: entryLando.id, confidence: "CONFIRMED", boundBy: "ADMIN" },
  });
  await prisma.externalBindingDriverSeason.create({
    data: { externalDriverSeasonId: dsOscar.id, seasonDriverEntryId: entryOscar.id, confidence: "CONFIRMED", boundBy: "ADMIN" },
  });

  const cleanup = async () => {
    await prisma.externalBindingSeason.deleteMany({
      where: { externalSeasonId: extSeason.id, seasonId: season.id },
    });
    await prisma.externalBindingTeam.deleteMany({ where: { teamId: team.id } });
    await prisma.seasonDriverEntry.deleteMany({ where: { seasonId: season.id } });
    await prisma.driverProfile.deleteMany({ where: { character: { userId } } });
    await prisma.character.deleteMany({ where: { userId } });
    await prisma.team.deleteMany({ where: { userId } });
    await prisma.season.deleteMany({ where: { id: season.id } });
    await prisma.externalDriverSeason.deleteMany({
      where: { id: { in: [dsLando.id, dsOscar.id] } },
    });
    await prisma.externalDriver.deleteMany({
      where: { id: { in: [extLando.id, extOscar.id] } },
    });
    await prisma.externalTeam.deleteMany({ where: { id: extTeam.id } });
    if (extSeasonCreated) {
      await prisma.externalSeason.deleteMany({ where: { id: extSeason.id } });
    }
  };

  return {
    ids: {
      seasonId: season.id,
      teamId: team.id,
      extSeasonId: extSeason.id,
      extTeamId: extTeam.id,
      extTeamExternalId: extTeam.externalId,
      driverLandoId: driverLando.id,
      driverOscarId: driverOscar.id,
      entryLandoId: entryLando.id,
      entryOscarId: entryOscar.id,
    },
    cleanup,
  };
}

let app: FastifyInstance;
let user: User;
let intruder: User;
let fixture: Fixture;

type PostResult = {
  character: { id: string; name: string; controlledBy: string; userId: string };
  driverProfile: { id: string; teamId: string | null };
  entry: {
    id: string;
    seasonId: string;
    teamId: string;
    driverProfileId: string;
    role: string;
    seat: number;
    status: string;
    provenance: string;
  };
  displaced: {
    entry: {
      id: string;
      driverProfileId: string;
      teamId: string | null;
      role: string | null;
      seat: number | null;
      status: string;
      driverProfile: {
        character: { id: string; name: string };
      };
    };
  } | null;
};

async function postEntry(
  actor: User,
  body: {
    seasonId: string;
    teamId: string;
    seat: number;
    name: string;
    nationality?: string;
  },
) {
  return app.inject({
    method: "POST",
    url: "/api/universe/player-entry",
    headers: { cookie: actor.cookie },
    payload: {
      seasonId: body.seasonId,
      teamId: body.teamId,
      seat: body.seat,
      name: body.name,
      nationality: body.nationality ?? "Brasileira",
      birthDate: "2002-06-14",
    },
  });
}

async function getEntry(driverProfileId: string, seasonId: string) {
  return prisma.seasonDriverEntry.findUnique({
    where: { seasonId_driverProfileId: { seasonId, driverProfileId } },
  });
}

async function getEvents(entryId: string) {
  return prisma.driverEntryEvent.findMany({
    where: { entryId },
    orderBy: { createdAt: "asc" },
  });
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  user = await createUser(`pe-user-${Date.now()}@f1nw.test`, "PE User");
  intruder = await createUser(`pe-intr-${Date.now()}@f1nw.test`, "PE Intruder");
  fixture = await seedUniverse2026(user.id);
});

afterAll(async () => {
  await fixture.cleanup();
  await prisma.$disconnect();
  await app.close();
});

describe("Player Entry routes — setup (antes das mutações)", () => {
  it("GET /api/universe/player-entry/setup exige sessão", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/universe/player-entry/setup",
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET setup sem seasonId lista temporadas vinculadas (fonte externa)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/universe/player-entry/setup",
      headers: { cookie: user.cookie },
    });
    expect(res.statusCode).toBe(200);
    const { seasons, selection } = res.json();
    expect(selection).toBeNull();
    const season = seasons.find((s: { id: string }) => s.id === fixture.ids.seasonId);
    expect(season).toBeTruthy();
    expect(season.externalSeasonId).toBe(fixture.ids.extSeasonId);
    expect(season.year).toBe(YEAR);
  });

  it("GET setup com seasonId devolve times, assentos (fonte vs universo) e reservas", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/universe/player-entry/setup?seasonId=${fixture.ids.seasonId}`,
      headers: { cookie: user.cookie },
    });
    expect(res.statusCode).toBe(200);
    const { seasons, selection } = res.json();
    expect(selection.seasonId).toBe(fixture.ids.seasonId);
    const mclaren = selection.teams.find((t: { id: string }) => t.id === fixture.ids.teamId);
    expect(mclaren).toBeTruthy();
    expect(mclaren.name).toBe("McLaren");
    expect(mclaren.externalTeamId).toBe(fixture.ids.extTeamExternalId);

    const seat1 = mclaren.seats.find((s: { seat: number }) => s.seat === 1);
    const seat2 = mclaren.seats.find((s: { seat: number }) => s.seat === 2);
    expect(seat1.source.name).toBe("Lando Norris");
    expect(seat2.source.name).toBe("Oscar Piastri");
    expect(seat1.universe.characterName).toBe("Lando Norris");
    expect(seat2.universe.characterName).toBe("Oscar Piastri");
    expect(Array.isArray(mclaren.reserve)).toBe(true);
    expect(seasons.length).toBeGreaterThan(0);
  });

  it("POST /api/universe/player-entry com temporada não vinculada → 409", async () => {
    const orphan = await createSeason(2025);
    const res = await postEntry(user, { seasonId: orphan.id, teamId: fixture.ids.teamId, seat: 1, name: "Alicya Orphan" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("SEASON_NOT_BOUND");
    await prisma.season.delete({ where: { id: orphan.id } });
  });
});

describe("Player Entry — criação (A/B/G/H)", () => {
  it("A) cria personagem + perfil de piloto + entrada na F1", async () => {
    const res = await postEntry(user, { seasonId: fixture.ids.seasonId, teamId: fixture.ids.teamId, seat: 1, name: "Alicya A" });
    expect(res.statusCode).toBe(201);
    const result = res.json() as PostResult;

    expect(result.character.controlledBy).toBe("USER");
    expect(result.character.userId).toBe(user.id);
    expect(result.character.name).toBe("Alicya A");

    const profile = await prisma.driverProfile.findUnique({
      where: { characterId: result.character.id },
    });
    expect(profile).toBeTruthy();

    expect(result.entry.seasonId).toBe(fixture.ids.seasonId);
    expect(result.entry.teamId).toBe(fixture.ids.teamId);
    expect(result.entry.driverProfileId).toBe(profile!.id);
    expect(result.entry.role).toBe("RACE_SEAT");
    expect(result.entry.seat).toBe(1);
    expect(result.entry.status).toBe("ACTIVE");
    expect(result.entry.provenance).toBe("CANONICAL");
  });

  it("B) entra na equipe do universo existente (sem criar time)", async () => {
    const teamsBefore = await prisma.team.count({ where: { userId: user.id } });
    const res = await postEntry(user, { seasonId: fixture.ids.seasonId, teamId: fixture.ids.teamId, seat: 1, name: "Alicya B" });
    expect(res.statusCode).toBe(201);
    const result = res.json() as PostResult;
    expect(result.entry.teamId).toBe(fixture.ids.teamId);
    const teamsAfter = await prisma.team.count({ where: { userId: user.id } });
    expect(teamsAfter).toBe(teamsBefore);
  });

  it("G) reusa a equipe espelhada (CONFIRMED binding), nunca confirma por nome", async () => {
    await postEntry(user, { seasonId: fixture.ids.seasonId, teamId: fixture.ids.teamId, seat: 1, name: "Alicya G" });
    await prisma.externalBindingTeam.deleteMany({
      where: { externalTeamId: fixture.ids.extTeamId },
    });
    const res = await postEntry(user, { seasonId: fixture.ids.seasonId, teamId: fixture.ids.teamId, seat: 1, name: "Alicya G2" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("TEAM_NOT_MIRRORED");
    await prisma.externalBindingTeam.create({
      data: { externalTeamId: fixture.ids.extTeamId, teamId: fixture.ids.teamId, confidence: "CONFIRMED", boundBy: "ADMIN" },
    });
  });

  it("H) reusa a temporada existente do universo (sem criar temporada)", async () => {
    const seasonsBefore = await prisma.season.count();
    const res = await postEntry(user, { seasonId: fixture.ids.seasonId, teamId: fixture.ids.teamId, seat: 1, name: "Alicya H" });
    expect(res.statusCode).toBe(201);
    const result = res.json() as PostResult;
    expect(result.entry.seasonId).toBe(fixture.ids.seasonId);
    const seasonsAfter = await prisma.season.count();
    expect(seasonsAfter).toBe(seasonsBefore);
  });
});

describe("Player Entry — substituição (C/D/E/I)", () => {
  it("C) substitui o ocupante do universo (Oscar / assento 2)", async () => {
    const res = await postEntry(user, { seasonId: fixture.ids.seasonId, teamId: fixture.ids.teamId, seat: 2, name: "Alicya C" });
    expect(res.statusCode).toBe(201);
    const result = res.json() as PostResult;

    expect(result.entry.seat).toBe(2);
    expect(result.entry.role).toBe("RACE_SEAT");
    expect(result.displaced).toBeTruthy();
    expect(result.displaced!.entry.driverProfile.character.name).toBe("Oscar Piastri");
    expect(result.displaced!.entry.status).toBe("AVAILABLE");
    expect(result.displaced!.entry.teamId).toBeNull();
    expect(result.displaced!.entry.role).toBeNull();
    expect(result.displaced!.entry.seat).toBeNull();

    const oscarEvents = await getEvents(fixture.ids.entryOscarId);
    const displacedEvent = oscarEvents.find((e) => e.kind === "DISPLACED");
    expect(displacedEvent).toBeTruthy();
    expect(displacedEvent!.from).toMatchObject({
      teamId: fixture.ids.teamId,
      role: "RACE_SEAT",
      seat: 2,
      status: "ACTIVE",
    });
    expect(displacedEvent!.to).toMatchObject({
      teamId: null,
      role: null,
      seat: null,
      status: "AVAILABLE",
    });
  });

  it("D) Oscar vira agente livre (AVAILABLE com team/seat/role null)", async () => {
    await postEntry(user, { seasonId: fixture.ids.seasonId, teamId: fixture.ids.teamId, seat: 2, name: "Alicya D" });

    const oscar = await getEntry(fixture.ids.driverOscarId, fixture.ids.seasonId);
    expect(oscar?.status).toBe("AVAILABLE");
    expect(oscar?.teamId).toBeNull();
    expect(oscar?.seat).toBeNull();
    expect(oscar?.role).toBeNull();
    expect(oscar?.number).toBeNull();

    const events = await getEvents(oscar!.id);
    expect(events.some((e) => e.kind === "DISPLACED")).toBe(true);

    const cached = await prisma.driverProfile.findUnique({
      where: { id: fixture.ids.driverOscarId },
      select: { teamId: true },
    });
    expect(cached?.teamId).toBeNull();
  });

  it("E) entrada do jogador é CANONICAL (diferente do espelho IMPORTED)", async () => {
    const res = await postEntry(user, { seasonId: fixture.ids.seasonId, teamId: fixture.ids.teamId, seat: 1, name: "Alicya E" });
    expect(res.statusCode).toBe(201);
    const result = res.json() as PostResult;
    expect(result.entry.provenance).toBe("CANONICAL");

    const mirrors = await prisma.seasonDriverEntry.findMany({
      where: { id: { in: [fixture.ids.entryLandoId, fixture.ids.entryOscarId] } },
      select: { provenance: true },
    });
    expect(mirrors.every((entry) => entry.provenance === "IMPORTED")).toBe(true);
  });

  it("I) assento ocupado por personagem canônico é substituído", async () => {
    const r1 = await postEntry(user, { seasonId: fixture.ids.seasonId, teamId: fixture.ids.teamId, seat: 2, name: "Rookie I" });
    expect(r1.statusCode).toBe(201);
    const first = r1.json() as PostResult;

    const r2 = await postEntry(user, { seasonId: fixture.ids.seasonId, teamId: fixture.ids.teamId, seat: 2, name: "Rookie I2" });
    expect(r2.statusCode).toBe(201);
    const second = r2.json() as PostResult;
    expect(second.displaced).toBeTruthy();
    expect(second.displaced!.entry.driverProfile.character.name).toBe("Rookie I");

    const firstNow = await getEntry(first.driverProfile.id, fixture.ids.seasonId);
    expect(firstNow?.status).toBe("AVAILABLE");
    expect(firstNow?.teamId).toBeNull();
    expect(firstNow?.seat).toBeNull();
  });
});

describe("Player Entry — bloqueios (F/K)", () => {
  it("F) mesmo nome com perfil de piloto existente é bloqueado (sem duplicação)", async () => {
    const dup = await postEntry(user, { seasonId: fixture.ids.seasonId, teamId: fixture.ids.teamId, seat: 1, name: "Lando Norris" });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("CHARACTER_NAME_EXISTS");

    const count = await prisma.character.count({
      where: { name: { equals: "Lando Norris", mode: "insensitive" }, userId: user.id },
    });
    expect(count).toBe(1);
  });

  it("K) rollback transacional: equipe de outro usuário aborta tudo", async () => {
    const strangerTeam = await prisma.team.create({
      data: { name: "Equipe Alheia", userId: intruder.id },
    });
    const charactersBefore = await prisma.character.count({ where: { userId: user.id } });
    const entriesBefore = await prisma.seasonDriverEntry.count({
      where: { seasonId: fixture.ids.seasonId, driverProfile: { character: { userId: user.id } } },
    });

    const res = await postEntry(user, { seasonId: fixture.ids.seasonId, teamId: strangerTeam.id, seat: 1, name: "Alicya K" });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("TEAM_NOT_FOUND");

    const charactersAfter = await prisma.character.count({ where: { userId: user.id } });
    expect(charactersAfter).toBe(charactersBefore);

    const entriesAfter = await prisma.seasonDriverEntry.count({
      where: { seasonId: fixture.ids.seasonId, driverProfile: { character: { userId: user.id } } },
    });
    expect(entriesAfter).toBe(entriesBefore);
    await prisma.team.delete({ where: { id: strangerTeam.id } });
  });
});

describe("Player Entry — multi-equipes e fonte externa (J)", () => {
  it("J) segundo personagem entra em outra equipe na mesma temporada", async () => {
    const runId = Math.random().toString(36).slice(2, 8);
    const ferrari = await prisma.team.create({
      data: { name: "Ferrari", shortName: "FER", color: "#dc0000", userId: user.id },
    });
    const extFerrari = await prisma.externalTeam.create({
      data: { source: JOLPICA_SOURCE, externalId: `ferrari-pe-${runId}`, name: "Ferrari", shortName: "FER", color: "#dc0000", contentHash: "pe-ext-ferrari" },
    });
    await prisma.externalBindingTeam.create({
      data: { externalTeamId: extFerrari.id, teamId: ferrari.id, confidence: "CONFIRMED", boundBy: "ADMIN" },
    });

    const mcl = await postEntry(user, { seasonId: fixture.ids.seasonId, teamId: fixture.ids.teamId, seat: 2, name: "Alicya J-Mcl" });
    const fer = await postEntry(user, { seasonId: fixture.ids.seasonId, teamId: ferrari.id, seat: 1, name: "Alicya J-Fer" });
    expect(mcl.statusCode).toBe(201);
    expect(fer.statusCode).toBe(201);

    const mclResult = mcl.json() as PostResult;
    const ferResult = fer.json() as PostResult;
    expect(mclResult.entry.teamId).toBe(fixture.ids.teamId);
    expect(ferResult.entry.teamId).toBe(ferrari.id);
    expect(mclResult.entry.seasonId).toBe(fixture.ids.seasonId);
    expect(ferResult.entry.seasonId).toBe(fixture.ids.seasonId);

    await prisma.externalTeam.delete({ where: { id: extFerrari.id } });
  });
});

describe("Player Entry — cache WorldState (L/M)", () => {
  it("L) temporada corrente sincroniza o cache DriverProfile.teamId", async () => {
    const original = await readCurrentSeason();
    await setCurrentSeason(fixture.ids.seasonId);

    const res = await postEntry(user, { seasonId: fixture.ids.seasonId, teamId: fixture.ids.teamId, seat: 1, name: "Alicya L" });
    expect(res.statusCode).toBe(201);
    const result = res.json() as PostResult;
    expect(result.driverProfile.teamId).toBe(fixture.ids.teamId);

    const cached = await prisma.driverProfile.findUnique({
      where: { id: result.driverProfile.id },
      select: { teamId: true },
    });
    expect(cached?.teamId).toBe(fixture.ids.teamId);

    await setCurrentSeason(original);
  });

  it("M) temporada não corrente NÃO atualiza o cache teamId", async () => {
    const original = await readCurrentSeason();
    const otherSeason = await createSeason(2027);
    await setCurrentSeason(otherSeason.id);

    const res = await postEntry(user, { seasonId: fixture.ids.seasonId, teamId: fixture.ids.teamId, seat: 1, name: "Alicya M" });
    expect(res.statusCode).toBe(201);
    const result = res.json() as PostResult;

    const cached = await prisma.driverProfile.findUnique({
      where: { id: result.driverProfile.id },
      select: { teamId: true },
    });
    expect(cached?.teamId).toBeNull();
    await prisma.season.delete({ where: { id: otherSeason.id } });

    await setCurrentSeason(original);
  });
});

describe("Player Entry — vínculo externo (N)", () => {
  it("N) personagem do jogador NÃO ganha vínculo externo (sem ExternalBindingDriver)", async () => {
    const res = await postEntry(user, { seasonId: fixture.ids.seasonId, teamId: fixture.ids.teamId, seat: 1, name: "Alicya N" });
    expect(res.statusCode).toBe(201);
    const result = res.json() as PostResult;

    const driverBindings = await prisma.externalBindingDriver.count({
      where: { characterId: result.character.id },
    });
    expect(driverBindings).toBe(0);

    const entryBindings = await prisma.externalBindingDriverSeason.count({
      where: { seasonDriverEntryId: result.entry.id },
    });
    expect(entryBindings).toBe(0);
  });
});

describe("Player Entry — re-contratação do deslocado (HOTFIX G)", () => {
  it("G) o piloto deslocado (AVAILABLE) pode ser contratado depois por outra equipe", async () => {
    const before = await getEntry(fixture.ids.driverOscarId, fixture.ids.seasonId);
    expect(before?.status).toBe("AVAILABLE");
    expect(before?.teamId).toBeNull();

    const newTeam = await prisma.team.create({
      data: { name: "Equipe Nova", shortName: "NOV", color: "#123456", userId: user.id },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/roster/hire",
      headers: { cookie: user.cookie },
      payload: {
        seasonId: fixture.ids.seasonId,
        teamId: newTeam.id,
        driverProfileId: fixture.ids.driverOscarId,
        role: "RACE_SEAT",
        seat: 1,
        number: 81,
      },
    });
    expect(res.statusCode).toBe(200);
    const hired = res.json().entry;
    expect(hired.status).toBe("ACTIVE");
    expect(hired.teamId).toBe(newTeam.id);
    expect(hired.seat).toBe(1);

    const oscarEvents = await getEvents(fixture.ids.entryOscarId);
    const kinds = oscarEvents.map((e) => e.kind);
    expect(kinds).toEqual(["DISPLACED", "HIRED"]);

    const charCount = await prisma.character.count({
      where: { name: "Oscar Piastri", userId: user.id },
    });
    expect(charCount).toBe(1);
  });
});