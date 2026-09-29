import { createHmac, randomBytes } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  normalizeRaces,
  detectHasSprint,
} from "../external-sync/jolpica.normalizer.js";
import type { JolpicaRaceRaw } from "../external-sync/jolpica.client.js";
import { persistRaces } from "../external-sync/jolpica.persist.js";
import { computeContentHash } from "../external-sync/jolpica.hash.js";
import { universeInitService } from "../universe-init/universe-init.service.js";

const RUN = Date.now().toString(36);
const YEAR = 2096;
const SOURCE = "jolpica";
const createdUserIds: string[] = [];
const createdYears: number[] = [];

function nextYear(): number {
  const year = YEAR - createdYears.length;
  createdYears.push(year);
  return year;
}

type Fixture = {
  userId: string;
  cookie: string;
  universeId: string;
  seasonId: string;
  externalSeasonId: string;
  externalRaceId: string;
  year: number;
};

async function createUser(suffix: string) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET not set");
  const user = await prisma.user.create({
    data: {
      email: `sprint-${suffix}-${RUN}@f1nw.test`,
      name: `Sprint ${suffix}`,
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
  return { userId: user.id, cookie: `f1nw.session_token=${token}.${sig}` };
}

async function setup(
  suffix: string,
  hasSprint: boolean | null,
  options: {
    externalSeasonId?: string;
    externalRaceId?: string;
    year?: number;
    raceName?: string;
  } = {},
): Promise<Fixture> {
  const year = options.year ?? nextYear();
  const { userId, cookie } = await createUser(suffix);
  const universe = await prisma.universe.create({
    data: { userId, status: "READY" },
    select: { id: true },
  });
  const season = await prisma.season.create({
    data: { universeId: universe.id, year, status: "PRE_SEASON" },
    select: { id: true },
  });

  let externalSeasonId = options.externalSeasonId;
  if (!externalSeasonId) {
    const externalSeason = await prisma.externalSeason.create({
      data: { source: SOURCE, year, contentHash: `season-${suffix}-${RUN}` },
      select: { id: true },
    });
    externalSeasonId = externalSeason.id;
  }
  await prisma.externalBindingSeason.create({
    data: {
      universeId: universe.id,
      externalSeasonId,
      seasonId: season.id,
      confidence: "CONFIRMED",
    },
  });

  let externalRaceId = options.externalRaceId;
  if (!externalRaceId) {
    const externalRace = await prisma.externalRace.create({
      data: {
        source: SOURCE,
        seasonYear: year,
        round: 1,
        grandPrix: options.raceName ?? `GP Sprint Weekend ${suffix}`,
        name: options.raceName ?? `GP Sprint Weekend ${suffix}`,
        country: "Brazil",
        date: new Date(`${year}-03-01T00:00:00.000Z`),
        hasSprint,
        contentHash: `race-${suffix}-${RUN}`,
      },
      select: { id: true },
    });
    externalRaceId = externalRace.id;
  }

  return {
    userId,
    cookie,
    universeId: universe.id,
    seasonId: season.id,
    externalSeasonId,
    externalRaceId,
    year,
  };
}

async function materialize(fx: Fixture) {
  return universeInitService.execute(
    { id: fx.userId, role: "USER" },
    {
      seasonId: fx.seasonId,
      externalSeasonId: fx.externalSeasonId,
      scopes: ["RACES"],
    },
  );
}

async function loadRace(fx: Fixture) {
  const binding = await prisma.externalBindingRace.findUniqueOrThrow({
    where: {
      universeId_externalRaceId: {
        universeId: fx.universeId,
        externalRaceId: fx.externalRaceId,
      },
    },
    select: { raceId: true },
  });
  return prisma.race.findUniqueOrThrow({ where: { id: binding.raceId } });
}

describe("Sprint weekend determination", () => {
  afterAll(async () => {
    for (const year of [...createdYears, 2085]) {
      await prisma.externalBindingSeason.deleteMany({
        where: { externalSeason: { source: SOURCE, year } },
      });
      await prisma.externalBindingRace.deleteMany({
        where: { externalRace: { source: SOURCE, seasonYear: year } },
      });
      await prisma.externalRace.deleteMany({
        where: { source: SOURCE, seasonYear: year },
      });
      await prisma.externalSeason.deleteMany({
        where: { source: SOURCE, year },
      });
    }
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it("mapeia a fonte externa sem heurística de nome", () => {
    expect(
      detectHasSprint({ Sprint: "2026-03-14T04:00:00Z" } as JolpicaRaceRaw),
    ).toBe(true);
    expect(
      detectHasSprint({
        SprintQualifying: "2026-03-13T07:30:00Z",
      } as JolpicaRaceRaw),
    ).toBe(true);
    expect(
      detectHasSprint({
        FirstPractice: "2026-03-13T00:00:00Z",
        Qualifying: "2026-03-14T00:00:00Z",
      } as JolpicaRaceRaw),
    ).toBe(false);
    expect(
      detectHasSprint({ raceName: "GP Sprint Qualifying Special" } as JolpicaRaceRaw),
    ).toBeNull();
    expect(detectHasSprint({} as JolpicaRaceRaw)).toBeNull();

    const withSprint = normalizeRaces(
      [
        {
          season: String(YEAR),
          round: "1",
          raceName: "GP Sprint",
          Sprint: "2096-03-14T04:00:00Z",
        } as JolpicaRaceRaw,
      ],
      YEAR,
    )[0];
    const withoutSprint = normalizeRaces(
      [
        {
          season: String(YEAR),
          round: "1",
          raceName: "GP Sprint",
          FirstPractice: "2096-03-13T00:00:00Z",
        } as JolpicaRaceRaw,
      ],
      YEAR,
    )[0];
    expect(withSprint.data.hasSprint).toBe(true);
    expect(withoutSprint.data.hasSprint).toBe(false);
    expect(computeContentHash(withSprint.data)).not.toBe(
      computeContentHash(withoutSprint.data),
    );
  });

  it("persiste hasSprint no espelho de forma idempotente", async () => {
    const persistYear = 2085;
    createdYears.push(persistYear);
    const items = normalizeRaces(
      [
        {
          season: String(persistYear),
          round: "1",
          raceName: `GP Persist ${RUN}`,
          Sprint: "2085-03-14T04:00:00Z",
        } as JolpicaRaceRaw,
      ],
      persistYear,
    );
    const first = await prisma.$transaction((tx) =>
      persistRaces(tx, SOURCE, items, new Date()),
    );
    const second = await prisma.$transaction((tx) =>
      persistRaces(tx, SOURCE, items, new Date()),
    );
    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(1);

    const row = await prisma.externalRace.findFirstOrThrow({
      where: { source: SOURCE, seasonYear: persistYear, round: 1 },
    });
    expect(row.hasSprint).toBe(true);
  });

  it("materializa Sprint externo e ausência explícita sem heurística", async () => {
    const app = buildApp();
    await app.ready();

    const withSprint = await setup("ext-true", true);
    await materialize(withSprint);
    const raceTrue = await loadRace(withSprint);
    expect(raceTrue.sprintOverride).toBeNull();
    expect(raceTrue.sprintExternal).toBe(true);

    const response = await app.inject({
      method: "GET",
      url: `/api/races/${raceTrue.id}`,
      headers: { cookie: withSprint.cookie },
      remoteAddress: "10.122.2.1",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().race.hasSprint).toBe(true);
    expect(response.json().race.sprintExternal).toBe(true);

    const withoutSprint = await setup("ext-false", false);
    await materialize(withoutSprint);
    const raceFalse = await loadRace(withoutSprint);
    expect(raceFalse.sprintExternal).toBe(false);

    const unknown = await setup("ext-null", null, {
      raceName: `GP Sprint Heuristica ${RUN}`,
    });
    await materialize(unknown);
    const raceNull = await loadRace(unknown);
    expect(raceNull.sprintOverride).toBeNull();
    expect(raceNull.sprintExternal).toBeNull();

    const nullResponse = await app.inject({
      method: "GET",
      url: `/api/races/${raceNull.id}`,
      headers: { cookie: unknown.cookie },
      remoteAddress: "10.122.2.2",
    });
    expect(nullResponse.json().race.hasSprint).toBe(false);
    expect(nullResponse.json().race.sprintExternal).toBeNull();

    await app.close();
  });

  it("respeita override manual sobre a fonte externa", async () => {
    const app = buildApp();
    await app.ready();
    const fixture = await setup("override", false);
    await materialize(fixture);
    const race = await loadRace(fixture);
    expect(race.sprintExternal).toBe(false);

    const enable = await app.inject({
      method: "PATCH",
      url: `/api/races/${race.id}`,
      headers: { cookie: fixture.cookie },
      payload: { sprintOverride: true },
      remoteAddress: "10.122.3.1",
    });
    expect(enable.statusCode).toBe(200);
    expect(enable.json().race.sprintOverride).toBe(true);
    expect(enable.json().race.hasSprint).toBe(true);

    const external = await setup("override-true", true);
    await materialize(external);
    const externalRace = await loadRace(external);
    const disable = await app.inject({
      method: "PATCH",
      url: `/api/races/${externalRace.id}`,
      headers: { cookie: external.cookie },
      payload: { sprintOverride: false },
      remoteAddress: "10.122.3.2",
    });
    expect(disable.statusCode).toBe(200);
    expect(disable.json().race.hasSprint).toBe(false);

    const automatic = await app.inject({
      method: "PATCH",
      url: `/api/races/${externalRace.id}`,
      headers: { cookie: external.cookie },
      payload: { sprintOverride: null },
      remoteAddress: "10.122.3.3",
    });
    expect(automatic.statusCode).toBe(200);
    expect(automatic.json().race.sprintOverride).toBeNull();
    expect(automatic.json().race.hasSprint).toBe(true);

    await app.close();
  });

  it("refresh externo atualiza a sugestão sem remover o override", async () => {
    const app = buildApp();
    await app.ready();
    const fixture = await setup("refresh", true);
    await materialize(fixture);
    const race = await loadRace(fixture);
    await app.inject({
      method: "PATCH",
      url: `/api/races/${race.id}`,
      headers: { cookie: fixture.cookie },
      payload: { sprintOverride: true },
      remoteAddress: "10.122.4.1",
    });

    await prisma.externalRace.update({
      where: { id: fixture.externalRaceId },
      data: { hasSprint: false, contentHash: `race-refresh-${RUN}-2` },
    });
    await materialize(fixture);

    const after = await loadRace(fixture);
    expect(after.sprintOverride).toBe(true);
    expect(after.sprintExternal).toBe(false);

    const mirror = await prisma.externalRace.findUniqueOrThrow({
      where: { id: fixture.externalRaceId },
    });
    expect(mirror.hasSprint).toBe(false);

    await app.close();
  });

  it("mantém universos independentes para o mesmo weekend externo", async () => {
    const app = buildApp();
    await app.ready();
    const shared = await setup("shared-a", true);
    await materialize(shared);
    const raceA = await loadRace(shared);

    const second = await setup("shared-b", true, {
      externalSeasonId: shared.externalSeasonId,
      externalRaceId: shared.externalRaceId,
      year: shared.year,
    });
    await materialize(second);
    const raceB = await loadRace(second);

    await app.inject({
      method: "PATCH",
      url: `/api/races/${raceA.id}`,
      headers: { cookie: shared.cookie },
      payload: { sprintOverride: false },
      remoteAddress: "10.122.5.1",
    });
    await app.inject({
      method: "PATCH",
      url: `/api/races/${raceB.id}`,
      headers: { cookie: second.cookie },
      payload: { sprintOverride: true },
      remoteAddress: "10.122.5.2",
    });

    const afterA = await loadRace(shared);
    const afterB = await loadRace(second);
    expect(afterA.sprintOverride).toBe(false);
    expect(afterB.sprintOverride).toBe(true);

    const mirror = await prisma.externalRace.findUniqueOrThrow({
      where: { id: shared.externalRaceId },
    });
    expect(mirror.hasSprint).toBe(true);

    await app.close();
  });

  it("é idempotente e não duplica corridas em materializações repetidas", async () => {
    const app = buildApp();
    await app.ready();
    const fixture = await setup("idempotent", true);
    await materialize(fixture);
    const first = await loadRace(fixture);

    const second = await materialize(fixture);
    void second;
    const after = await loadRace(fixture);
    expect(after.id).toBe(first.id);
    expect(after.sprintExternal).toBe(true);

    const raceCount = await prisma.race.count({
      where: { seasonId: fixture.seasonId },
    });
    expect(raceCount).toBe(1);

    await app.close();
  });

  it("preserva o override em materializações concorrentes", async () => {
    const app = buildApp();
    await app.ready();
    const fixture = await setup("concurrent", true);
    await materialize(fixture);
    const race = await loadRace(fixture);
    await app.inject({
      method: "PATCH",
      url: `/api/races/${race.id}`,
      headers: { cookie: fixture.cookie },
      payload: { sprintOverride: false },
      remoteAddress: "10.122.6.1",
    });

    await Promise.all([materialize(fixture), materialize(fixture)]);

    const after = await loadRace(fixture);
    expect(after.id).toBe(race.id);
    expect(after.sprintOverride).toBe(false);
    expect(after.sprintExternal).toBe(true);
    const raceCount = await prisma.race.count({
      where: { seasonId: fixture.seasonId },
    });
    expect(raceCount).toBe(1);

    await app.close();
  });
});
