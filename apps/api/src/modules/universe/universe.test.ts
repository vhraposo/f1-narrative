import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { deleteUniverseDataForUsers } from "../../test-utils/universe-cleanup.js";
import {
  seedUniverseInitFixture,
  type InitFixtureIds,
} from "../universe-init/universe-init.fixtures.js";
import { getUniverseForUser, provisionUniverse } from "./universe.service.js";

const YEAR = 2031;

type TestUser = { id: string; cookie: string };

let app: FastifyInstance;
let fixture: { ids: InitFixtureIds; cleanup: (extraUserIds?: string[]) => Promise<void> };
let userA: TestUser;
let userB: TestUser;

async function signUp(email: string, name: string): Promise<TestUser> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name, email, password: "senha-segura-123" },
  });
  expect(res.statusCode, `sign-up: ${res.body}`).toBe(200);
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: user.id, cookie };
}

async function universeOf(userId: string) {
  const universe = await getUniverseForUser(userId);
  expect(universe).toBeTruthy();
  return universe!;
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  fixture = await seedUniverseInitFixture(YEAR);
  userA = await signUp(`universe-a-${Date.now()}@f1nw.test`, "Universe A");
  userB = await signUp(`universe-b-${Date.now()}@f1nw.test`, "Universe B");
});

afterAll(async () => {
  await deleteUniverseDataForUsers(prisma, [userA.id, userB.id]);
  await fixture.cleanup([userA.id, userB.id]);
  await app.close();
  await prisma.$disconnect();
});

describe("Universe — provisionamento automático e isolamento", () => {
  it("A) signup provisiona Season/Teams/Drivers/Entries/WorldState e bindings no universo", async () => {
    const universe = await universeOf(userA.id);
    expect(universe.status).toBe("READY");

    const season = await prisma.season.findUnique({
      where: { universeId_year: { universeId: universe.id, year: YEAR } },
    });
    expect(season).toBeTruthy();

    const teams = await prisma.team.findMany({ where: { universeId: universe.id } });
    expect(teams).toHaveLength(1);
    expect(teams[0].name).toBe("McLaren");

    const characters = await prisma.character.findMany({
      where: { universeId: universe.id, controlledBy: "AI" },
    });
    expect(characters).toHaveLength(3);
    expect(characters.every((character) => character.userId === null)).toBe(true);

    const entries = await prisma.seasonDriverEntry.findMany({
      where: { seasonId: season!.id },
    });
    expect(entries).toHaveLength(3);

    const world = await prisma.worldState.findUnique({
      where: { universeId_key: { universeId: universe.id, key: "default" } },
    });
    expect(world?.currentSeasonId).toBe(season!.id);

    const seasonBinding = await prisma.externalBindingSeason.findUnique({
      where: {
        universeId_externalSeasonId: {
          universeId: universe.id,
          externalSeasonId: fixture.ids.extSeasonId,
        },
      },
    });
    expect(seasonBinding?.seasonId).toBe(season!.id);

    const teamBindings = await prisma.externalBindingTeam.findMany({
      where: { universeId: universe.id },
    });
    expect(teamBindings).toHaveLength(1);
    expect(teamBindings[0].externalTeamId).toBe(fixture.ids.extTeamId);

    const driverBindings = await prisma.externalBindingDriver.findMany({
      where: { universeId: universe.id },
    });
    expect(driverBindings).toHaveLength(3);
  });

  it("B) provisionar novamente é idempotente (não duplica nada)", async () => {
    const universe = await universeOf(userA.id);
    const before = {
      seasons: await prisma.season.count({ where: { universeId: universe.id } }),
      teams: await prisma.team.count({ where: { universeId: universe.id } }),
      characters: await prisma.character.count({ where: { universeId: universe.id } }),
      entries: await prisma.seasonDriverEntry.count({
        where: { season: { universeId: universe.id } },
      }),
      bindings: await prisma.externalBindingDriver.count({
        where: { universeId: universe.id },
      }),
    };

    const again = await provisionUniverse(userA.id);
    expect(again.report.status).toBe("READY");

    expect(await prisma.season.count({ where: { universeId: universe.id } })).toBe(
      before.seasons,
    );
    expect(await prisma.team.count({ where: { universeId: universe.id } })).toBe(before.teams);
    expect(await prisma.character.count({ where: { universeId: universe.id } })).toBe(
      before.characters,
    );
    expect(
      await prisma.seasonDriverEntry.count({ where: { season: { universeId: universe.id } } }),
    ).toBe(before.entries);
    expect(
      await prisma.externalBindingDriver.count({ where: { universeId: universe.id } }),
    ).toBe(before.bindings);
  });

  it("C) dois universos independentes usam o mesmo espelho sem colisão", async () => {
    const universeA = await universeOf(userA.id);
    const universeB = await universeOf(userB.id);
    expect(universeA.id).not.toBe(universeB.id);

    const seasonA = await prisma.season.findUniqueOrThrow({
      where: { universeId_year: { universeId: universeA.id, year: YEAR } },
    });
    const seasonB = await prisma.season.findUniqueOrThrow({
      where: { universeId_year: { universeId: universeB.id, year: YEAR } },
    });
    expect(seasonA.id).not.toBe(seasonB.id);

    const teamBindings = await prisma.externalBindingTeam.findMany({
      where: { externalTeamId: fixture.ids.extTeamId },
    });
    expect(teamBindings).toHaveLength(2);
    expect(new Set(teamBindings.map((binding) => binding.universeId)).size).toBe(2);

    const landoA = await prisma.character.findFirstOrThrow({
      where: { universeId: universeA.id, name: "Lando Norris" },
    });
    const landoB = await prisma.character.findFirstOrThrow({
      where: { universeId: universeB.id, name: "Lando Norris" },
    });
    expect(landoA.id).not.toBe(landoB.id);

    const teamA = await prisma.team.findFirstOrThrow({ where: { universeId: universeA.id } });
    const teamB = await prisma.team.findFirstOrThrow({ where: { universeId: universeB.id } });
    expect(teamA.id).not.toBe(teamB.id);
  });

  it("D) GET /api/teams e /api/drivers são escopados por universo", async () => {
    const universeA = await universeOf(userA.id);
    await app.inject({
      method: "POST",
      url: "/api/teams",
      headers: { cookie: userA.cookie },
      payload: { name: "Equipe Exclusiva A" },
    });

    const teamsA = await app.inject({
      method: "GET",
      url: "/api/teams",
      headers: { cookie: userA.cookie },
    });
    const teamsB = await app.inject({
      method: "GET",
      url: "/api/teams",
      headers: { cookie: userB.cookie },
    });
    const namesA = (teamsA.json().teams as { name: string }[]).map((team) => team.name);
    const namesB = (teamsB.json().teams as { name: string }[]).map((team) => team.name);
    expect(namesA).toContain("Equipe Exclusiva A");
    expect(namesB).not.toContain("Equipe Exclusiva A");

    const universeB = await universeOf(userB.id);
    const driversA = await app.inject({
      method: "GET",
      url: "/api/drivers",
      headers: { cookie: userA.cookie },
    });
    const driversB = await app.inject({
      method: "GET",
      url: "/api/drivers",
      headers: { cookie: userB.cookie },
    });
    expect(driversA.statusCode).toBe(200);
    expect(driversB.statusCode).toBe(200);

    const profilesA = await prisma.driverProfile.findMany({
      where: { character: { universeId: universeA.id } },
      select: { id: true },
    });
    const idsA = new Set(profilesA.map((profile) => profile.id));
    const idsB = (driversB.json().drivers as { id: string }[]).map((driver) => driver.id);
    expect(idsB.some((id) => idsA.has(id))).toBe(false);
    expect(universeA.id).not.toBe(universeB.id);
  });

  it("E) pilotos de grid são IA: fora de /api/characters e presentes em /api/characters/ai", async () => {
    const mine = await app.inject({
      method: "GET",
      url: "/api/characters",
      headers: { cookie: userA.cookie },
    });
    expect(mine.statusCode).toBe(200);
    const mineNames = (mine.json().characters as { name: string }[]).map(
      (character) => character.name,
    );
    expect(mineNames).not.toContain("Lando Norris");
    expect(mineNames).not.toContain("Oscar Piastri");

    const ai = await app.inject({
      method: "GET",
      url: "/api/characters/ai",
      headers: { cookie: userA.cookie },
    });
    expect(ai.statusCode).toBe(200);
    const aiNames = (ai.json().characters as { name: string }[]).map(
      (character) => character.name,
    );
    expect(aiNames).toContain("Lando Norris");
    expect(aiNames).toContain("Oscar Piastri");
  });

  it("F) Chat não altera o grid do universo (participants não mexem em Team/Entry)", async () => {
    const universe = await universeOf(userA.id);
    const season = await prisma.season.findUniqueOrThrow({
      where: { universeId_year: { universeId: universe.id, year: YEAR } },
    });
    const before = {
      teams: await prisma.team.count({ where: { universeId: universe.id } }),
      entries: await prisma.seasonDriverEntry.count({ where: { seasonId: season.id } }),
    };

    const anchorRes = await app.inject({
      method: "POST",
      url: "/api/characters",
      headers: { cookie: userA.cookie },
      payload: {
        name: "Engenheiro do Chat",
        nationality: "Brasileira",
        birthDate: "1990-01-01",
      },
    });
    expect(anchorRes.statusCode).toBe(201);
    const anchorId = (anchorRes.json() as { character: { id: string } }).character.id;

    const aiList = await app.inject({
      method: "GET",
      url: "/api/characters/ai",
      headers: { cookie: userA.cookie },
    });
    const lando = (aiList.json().characters as { id: string; name: string }[]).find(
      (character) => character.name === "Lando Norris",
    )!;
    expect(lando).toBeTruthy();

    const created = await app.inject({
      method: "POST",
      url: "/api/conversations",
      headers: { cookie: userA.cookie },
      payload: { title: "Rádio", participantIds: [anchorId, lando.id] },
    });
    expect(created.statusCode, `body: ${created.body}`).toBe(201);

    expect(await prisma.team.count({ where: { universeId: universe.id } })).toBe(before.teams);
    expect(await prisma.seasonDriverEntry.count({ where: { seasonId: season.id } })).toBe(
      before.entries,
    );
    const landoEntry = await prisma.seasonDriverEntry.findFirst({
      where: {
        seasonId: season.id,
        driverProfile: { character: { universeId: universe.id, name: "Lando Norris" } },
      },
    });
    expect(landoEntry).toBeTruthy();
    expect(landoEntry!.status).toBe("ACTIVE");
  });
});
