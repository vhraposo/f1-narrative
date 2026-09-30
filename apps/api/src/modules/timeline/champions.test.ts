import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";

const PREFIX = "champ";
const SOURCE = "champ-synth";

let app: FastifyInstance;
let userA: { id: string; cookie: string };
let userB: { id: string; cookie: string };
let universeAId: string;
let universeBId: string;
let season2010Id: string;
let season2011Id: string;
let season2013Id: string;
let season2014Id: string;
let landoProfileId: string;
let alicyaProfileId: string;

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdExternalDriverIds: string[] = [];

async function signUp(label: string) {
  const email = `${PREFIX}-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@f1nw.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: `Champ ${label}`, email, password: "senha-segura-123" },
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

  const universeA = await prisma.universe.upsert({
    where: { userId: userA.id },
    update: { status: "READY" },
    create: { userId: userA.id, status: "READY" },
  });
  const universeB = await prisma.universe.upsert({
    where: { userId: userB.id },
    update: { status: "READY" },
    create: { userId: userB.id, status: "READY" },
  });
  universeAId = universeA.id;
  universeBId = universeB.id;

  async function createDriver(universeId: string, userId: string, name: string) {
    const character = await prisma.character.create({
      data: {
        name,
        nationality: "BR",
        birthDate: new Date("1995-01-01"),
        controlledBy: "USER",
        userId,
        universeId,
      },
    });
    createdCharacterIds.push(character.id);
    const profile = await prisma.driverProfile.create({
      data: { characterId: character.id },
    });
    return { characterId: character.id, profileId: profile.id };
  }

  const lando = await createDriver(universeAId, userA.id, `${PREFIX}-Lando S`);
  const alicya = await createDriver(universeAId, userA.id, `${PREFIX}-Alicya S`);
  landoProfileId = lando.profileId;
  alicyaProfileId = alicya.profileId;

  const extLando = await prisma.externalDriver.create({
    data: {
      source: SOURCE,
      externalId: `${PREFIX}-ext-lando`,
      name: `${PREFIX}-Lando S`,
      contentHash: "h1",
    },
  });
  const extAlicya = await prisma.externalDriver.create({
    data: {
      source: SOURCE,
      externalId: `${PREFIX}-ext-alicya`,
      name: `${PREFIX}-Alicya S`,
      contentHash: "h2",
    },
  });
  createdExternalDriverIds.push(extLando.id, extAlicya.id);

  await prisma.externalStanding.create({
    data: {
      source: SOURCE,
      seasonYear: 2010,
      externalDriverId: extLando.id,
      position: 1,
      points: 300,
      wins: 8,
      contentHash: "s2010",
    },
  });
  await prisma.externalStanding.create({
    data: {
      source: SOURCE,
      seasonYear: 2011,
      externalDriverId: extLando.id,
      position: 1,
      points: 320,
      wins: 9,
      contentHash: "s2011",
    },
  });
  await prisma.externalStanding.create({
    data: {
      source: SOURCE,
      seasonYear: 2013,
      externalDriverId: extAlicya.id,
      position: 1,
      points: 200,
      wins: 5,
      contentHash: "s2013",
    },
  });
  await prisma.externalBindingDriver.create({
    data: {
      universeId: universeAId,
      externalDriverId: extLando.id,
      characterId: lando.characterId,
      confidence: "CONFIRMED",
    },
  });
  await prisma.externalBindingDriver.create({
    data: {
      universeId: universeAId,
      externalDriverId: extAlicya.id,
      characterId: alicya.characterId,
      confidence: "CONFIRMED",
    },
  });

  season2010Id = (
    await prisma.season.create({
      data: { universeId: universeAId, year: 2010, name: "2010", status: "FINISHED" },
    })
  ).id;
  season2011Id = (
    await prisma.season.create({
      data: { universeId: universeAId, year: 2011, name: "2011", status: "FINISHED" },
    })
  ).id;
  season2013Id = (
    await prisma.season.create({
      data: { universeId: universeAId, year: 2013, name: "2013", status: "PRE_SEASON" },
    })
  ).id;
  season2014Id = (
    await prisma.season.create({
      data: { universeId: universeAId, year: 2014, name: "2014", status: "PRE_SEASON" },
    })
  ).id;

  await prisma.championshipStanding.create({
    data: { seasonId: season2010Id, driverProfileId: landoProfileId, position: 1, points: 300, wins: 8, podiums: 12 },
  });
  await prisma.championshipStanding.create({
    data: { seasonId: season2010Id, driverProfileId: alicyaProfileId, position: 2, points: 250, wins: 5, podiums: 10 },
  });

  const race = await prisma.race.create({
    data: {
      seasonId: season2011Id,
      name: "GP Champ 2011",
      round: 1,
      date: new Date("2011-03-01T00:00:00.000Z"),
      status: "FINISHED",
    },
  });
  await prisma.raceResult.create({
    data: { raceId: race.id, driverProfileId: landoProfileId, position: 1, grid: 1, points: 25, status: "Finished" },
  });
  await prisma.championshipStanding.create({
    data: { seasonId: season2011Id, driverProfileId: landoProfileId, position: 1, points: 25, wins: 1, podiums: 1 },
  });

  const worldDate = new Date("2013-01-01T00:00:00.000Z");
  await prisma.worldState.create({
    data: { universeId: universeAId, key: "default", currentDate: worldDate, currentSeasonId: season2013Id },
  });
  await prisma.timelineEvent.create({
    data: {
      universeId: universeAId,
      sequence: 1,
      worldDate,
      kind: "WORLD_ADVANCED",
      payload: {
        currentDate: worldDate.toISOString(),
        currentSeasonId: season2013Id,
        currentRaceId: null,
        currentSession: null,
      },
      causedBy: "USER",
    },
  });
});

afterAll(async () => {
  await prisma.timelineEvent.deleteMany({ where: { universeId: { in: [universeAId, universeBId] } } });
  await prisma.worldSnapshot.deleteMany({ where: { universeId: { in: [universeAId, universeBId] } } });
  await prisma.championshipStanding.deleteMany({ where: { season: { universeId: { in: [universeAId, universeBId] } } } });
  await prisma.raceResult.deleteMany({ where: { race: { season: { universeId: { in: [universeAId, universeBId] } } } } });
  await prisma.race.deleteMany({ where: { season: { universeId: { in: [universeAId, universeBId] } } } });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.externalBindingDriver.deleteMany({ where: { universeId: { in: [universeAId, universeBId] } } });
  await prisma.externalStanding.deleteMany({ where: { source: SOURCE } });
  await prisma.externalDriver.deleteMany({ where: { id: { in: createdExternalDriverIds } } });
  await prisma.season.deleteMany({ where: { universeId: { in: [universeAId, universeBId] } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
  await app.close();
});

function auth(cookie: string) {
  return { cookie };
}

describe("campeões — leitura", () => {
  it("1) lista por ano (DESC) com champion externo/universe e estados", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/timeline/champions",
      headers: auth(userA.cookie),
    });
    expect(res.statusCode).toBe(200);
    const champions = res.json().champions as Array<{
      year: number;
      state: string;
      origin: string;
      canEdit: boolean;
      blockedReason: string | null;
      seasonId: string | null;
      externalChampion: { name: string } | null;
      universeChampion: { name: string } | null;
    }>;
    expect(champions).toHaveLength(26);
    expect(champions[0]?.year).toBe(2025);
    expect(champions[champions.length - 1]?.year).toBe(2000);
    expect(champions.map((entry) => entry.year)).not.toContain(2026);
    expect(champions.map((entry) => entry.year)).not.toContain(1999);

    const match = champions.find((entry) => entry.year === 2010)!;
    expect(match.state).toBe("MATCH");
    expect(match.origin).toBe("STANDING");
    expect(match.canEdit).toBe(true);
    expect(match.externalChampion!.name).toContain("Lando");
    expect(match.universeChampion!.name).toContain("Lando");

    const derived = champions.find((entry) => entry.year === 2011)!;
    expect(derived.origin).toBe("DERIVED");
    expect(derived.canEdit).toBe(false);
    expect(derived.blockedReason).toBe("DERIVED_CHAMPION");

    const externalOnly = champions.find((entry) => entry.year === 2013)!;
    expect(externalOnly.state).toBe("EXTERNAL_ONLY");
    expect(externalOnly.universeChampion).toBeNull();
    expect(externalOnly.canEdit).toBe(false);
    expect(externalOnly.blockedReason).toBe("SEASON_IN_PROGRESS");

    const none = champions.find((entry) => entry.year === 2014)!;
    expect(none.state).toBe("NONE");
    expect(none.externalChampion).toBeNull();
    expect(none.universeChampion).toBeNull();
    expect(none.blockedReason).toBe("SEASON_IN_PROGRESS");

    const noSeason = champions.find((entry) => entry.year === 2005)!;
    expect(noSeason.seasonId).toBeNull();
    expect(noSeason.blockedReason).toBe("SEASON_NOT_IN_UNIVERSE");
  });

  it("2) detalhe retorna histórico e 404 leak-safe", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/timeline/champions/${season2010Id}`,
      headers: auth(userA.cookie),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().champion.year).toBe(2010);

    const foreign = await app.inject({
      method: "GET",
      url: `/api/timeline/champions/${season2010Id}`,
      headers: auth(userB.cookie),
    });
    expect(foreign.statusCode).toBe(404);

    const unauth = await app.inject({
      method: "GET",
      url: "/api/timeline/champions",
    });
    expect(unauth.statusCode).toBe(401);
  });

  it("3) Universe B não vê correções nem campeões de A", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/timeline/champions",
      headers: auth(userB.cookie),
    });
    expect(res.statusCode).toBe(200);
    const champions = res.json().champions as Array<{
      year: number;
      universeChampion: unknown;
      origin: string;
      seasonId: string | null;
    }>;
    expect(champions).toHaveLength(26);
    expect(champions.every((entry) => entry.universeChampion === null)).toBe(true);
    expect(champions.every((entry) => entry.seasonId === null)).toBe(true);
    expect(champions.every((entry) => entry.origin === "NONE")).toBe(true);

    const preview = await app.inject({
      method: "POST",
      url: `/api/timeline/champions/${season2010Id}/preview`,
      headers: auth(userB.cookie),
      payload: { mode: "EDIT", driverProfileId: alicyaProfileId },
    });
    expect(preview.statusCode).toBe(404);
  });
});

describe("campeões — edição", () => {
  it("4) preview é zero-write e determinístico", async () => {
    const eventsBefore = await prisma.timelineEvent.count({ where: { universeId: universeAId } });
    const standingsBefore = await prisma.championshipStanding.findMany({
      where: { seasonId: season2010Id },
      orderBy: { driverProfileId: "asc" },
    });

    const first = await app.inject({
      method: "POST",
      url: `/api/timeline/champions/${season2010Id}/preview`,
      headers: auth(userA.cookie),
      payload: { mode: "EDIT", driverProfileId: alicyaProfileId },
    });
    expect(first.statusCode).toBe(200);
    const preview = first.json().preview;
    expect(preview.before.name).toContain("Lando");
    expect(preview.after.name).toContain("Alicya");
    expect(preview.commandCount).toBe(2);

    const second = await app.inject({
      method: "POST",
      url: `/api/timeline/champions/${season2010Id}/preview`,
      headers: auth(userA.cookie),
      payload: { mode: "EDIT", driverProfileId: alicyaProfileId },
    });
    expect(second.json().preview.previewToken).toBe(preview.previewToken);

    expect(await prisma.timelineEvent.count({ where: { universeId: universeAId } })).toBe(eventsBefore);
    expect(
      await prisma.championshipStanding.findMany({
        where: { seasonId: season2010Id },
        orderBy: { driverProfileId: "asc" },
      }),
    ).toEqual(standingsBefore);
  });

  it("5) edit aplica STANDING_CORRECTED atomicamente e mantém histórico", async () => {
    const preview = await app.inject({
      method: "POST",
      url: `/api/timeline/champions/${season2010Id}/preview`,
      headers: auth(userA.cookie),
      payload: { mode: "EDIT", driverProfileId: alicyaProfileId },
    });
    const token = preview.json().preview.previewToken as string;

    const apply = await app.inject({
      method: "POST",
      url: `/api/timeline/champions/${season2010Id}/apply`,
      headers: auth(userA.cookie),
      payload: { mode: "EDIT", driverProfileId: alicyaProfileId, previewToken: token },
    });
    expect(apply.statusCode).toBe(200);
    expect(apply.json().events).toHaveLength(2);
    expect(
      apply.json().events.every((event: { kind: string }) => event.kind === "STANDING_CORRECTED"),
    ).toBe(true);

    const list = await app.inject({
      method: "GET",
      url: "/api/timeline/champions",
      headers: auth(userA.cookie),
    });
    const entry = (list.json().champions as Array<{ year: number; state: string; canRestore: boolean }>).find(
      (champion) => champion.year === 2010,
    )!;
    expect(entry.state).toBe("DIVERGENT");
    expect(entry.canRestore).toBe(true);

    const detail = await app.inject({
      method: "GET",
      url: `/api/timeline/champions/${season2010Id}`,
      headers: auth(userA.cookie),
    });
    expect(detail.json().history).toHaveLength(2);
  });

  it("6) edição em temporada DERIVED é bloqueada", async () => {
    const preview = await app.inject({
      method: "POST",
      url: `/api/timeline/champions/${season2011Id}/preview`,
      headers: auth(userA.cookie),
      payload: { mode: "EDIT", driverProfileId: alicyaProfileId },
    });
    expect(preview.statusCode).toBe(409);
    expect(preview.json().code).toBe("DERIVED_STANDING");
  });

  it("7) restore volta a coincidir com a fonte sem apagar histórico", async () => {
    const preview = await app.inject({
      method: "POST",
      url: `/api/timeline/champions/${season2010Id}/preview`,
      headers: auth(userA.cookie),
      payload: { mode: "RESTORE" },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().preview.before.name).toContain("Alicya");
    expect(preview.json().preview.after.name).toContain("Lando");
    const token = preview.json().preview.previewToken as string;

    const apply = await app.inject({
      method: "POST",
      url: `/api/timeline/champions/${season2010Id}/apply`,
      headers: auth(userA.cookie),
      payload: { mode: "RESTORE", previewToken: token },
    });
    expect(apply.statusCode).toBe(200);
    expect(apply.json().events).toHaveLength(2);

    const list = await app.inject({
      method: "GET",
      url: "/api/timeline/champions",
      headers: auth(userA.cookie),
    });
    const entry = (list.json().champions as Array<{ year: number; state: string; canRestore: boolean }>).find(
      (champion) => champion.year === 2010,
    )!;
    expect(entry.state).toBe("MATCH");
    expect(entry.canRestore).toBe(false);

    const detail = await app.inject({
      method: "GET",
      url: `/api/timeline/champions/${season2010Id}`,
      headers: auth(userA.cookie),
    });
    expect(detail.json().history).toHaveLength(4);
  });

  it("8) preview stale é rejeitado sem aplicação parcial", async () => {
    const preview = await app.inject({
      method: "POST",
      url: `/api/timeline/champions/${season2010Id}/preview`,
      headers: auth(userA.cookie),
      payload: { mode: "EDIT", driverProfileId: alicyaProfileId },
    });
    const staleToken = preview.json().preview.previewToken as string;

    const freshPreview = await app.inject({
      method: "POST",
      url: `/api/timeline/champions/${season2010Id}/preview`,
      headers: auth(userA.cookie),
      payload: { mode: "EDIT", driverProfileId: alicyaProfileId },
    });
    const applied = await app.inject({
      method: "POST",
      url: `/api/timeline/champions/${season2010Id}/apply`,
      headers: auth(userA.cookie),
      payload: {
        mode: "EDIT",
        driverProfileId: alicyaProfileId,
        previewToken: freshPreview.json().preview.previewToken,
      },
    });
    expect(applied.statusCode).toBe(200);

    const stale = await app.inject({
      method: "POST",
      url: `/api/timeline/champions/${season2010Id}/apply`,
      headers: auth(userA.cookie),
      payload: { mode: "EDIT", driverProfileId: alicyaProfileId, previewToken: staleToken },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("PREVIEW_STALE");
    expect(stale.body).not.toContain("SELECT");
  });
});

describe("campeões — integridade", () => {
  it("9) External Mirror permanece intacto", async () => {
    const rows = await prisma.externalStanding.findMany({
      where: { source: SOURCE },
      orderBy: [{ seasonYear: "asc" }],
    });
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.position === 1)).toBe(true);
    const bindings = await prisma.externalBindingDriver.count({
      where: { universeId: universeAId },
    });
    expect(bindings).toBe(2);
  });

  it("10) in-progress não vira campeão; UNIVERSE_ONLY sem fonte; 2026 fora da lista", async () => {
    const season2012 = await prisma.season.create({
      data: { universeId: universeAId, year: 2012, name: "2012", status: "FINISHED" },
    });
    await prisma.championshipStanding.create({
      data: { seasonId: season2012.id, driverProfileId: landoProfileId, position: 1, points: 240, wins: 6, podiums: 9 },
    });
    await prisma.championshipStanding.create({
      data: { seasonId: season2014Id, driverProfileId: landoProfileId, position: 1, points: 10, wins: 0, podiums: 0 },
    });
    const season2026 = await prisma.season.create({
      data: { universeId: universeAId, year: 2026, name: "2026", status: "PRE_SEASON" },
    });
    await prisma.championshipStanding.create({
      data: { seasonId: season2026.id, driverProfileId: alicyaProfileId, position: 1, points: 5, wins: 0, podiums: 0 },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/timeline/champions",
      headers: auth(userA.cookie),
    });
    const champions = res.json().champions as Array<{
      year: number;
      state: string;
      origin: string;
      universeChampion: unknown;
      blockedReason: string | null;
    }>;
    expect(champions).toHaveLength(26);
    expect(champions.map((entry) => entry.year)).not.toContain(2026);

    const universeOnly = champions.find((champion) => champion.year === 2012)!;
    expect(universeOnly.state).toBe("UNIVERSE_ONLY");
    expect(universeOnly.origin).toBe("STANDING");

    const inProgress = champions.find((champion) => champion.year === 2014)!;
    expect(inProgress.universeChampion).toBeNull();
    expect(inProgress.state).toBe("NONE");
    expect(inProgress.blockedReason).toBe("SEASON_IN_PROGRESS");
  });

  it("11) FONTE externa ausente bloqueia restore com erro determinístico", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/timeline/champions/${season2014Id}/preview`,
      headers: auth(userA.cookie),
      payload: { mode: "RESTORE" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("EXTERNAL_CHAMPION_MISSING");
  });
});
