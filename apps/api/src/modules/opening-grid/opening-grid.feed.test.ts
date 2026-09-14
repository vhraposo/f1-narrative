import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { JOLPICA_SOURCE } from "../external-sync/jolpica.service.js";
import { OpeningGridClient } from "./opening-grid.client.js";
import { OpeningGridTransport } from "./opening-grid.transport.js";
import { loadOpeningGridFeed } from "./opening-grid.feed.js";
import {
  OPENING_GRID_SOURCE,
  normalizeOpeningGridClaims,
  openingGridEntryListSeasonSchema,
  validateOpeningGridPayload,
  type OpeningGridEntryListSeason,
} from "./opening-grid.source.js";
import { persistOpeningGridClaims } from "./opening-grid.persist.js";
import { resolveOpeningGrid } from "./opening-grid.resolver.js";
import { universeInitService, type Actor } from "../universe-init/universe-init.service.js";

const YEAR = 2026;

const JOLPICA_TEAM_IDS = [
  "alpine",
  "aston_martin",
  "audi",
  "cadillac",
  "ferrari",
  "haas",
  "mclaren",
  "mercedes",
  "rb",
  "red_bull",
  "williams",
];

const JOLPICA_DRIVER_IDS = [
  "norris",
  "piastri",
  "russell",
  "antonelli",
  "max_verstappen",
  "hadjar",
  "leclerc",
  "hamilton",
  "albon",
  "sainz",
  "arvid_lindblad",
  "lawson",
  "alonso",
  "stroll",
  "ocon",
  "bearman",
  "bortoleto",
  "hulkenberg",
  "gasly",
  "colapinto",
  "perez",
  "bottas",
];

let app: FastifyInstance;

async function resetYear(year: number): Promise<void> {
  await prisma.externalBindingDriverSeason.deleteMany({
    where: {
      externalDriverSeason: {
        seasonYear: year,
        source: { in: [JOLPICA_SOURCE, OPENING_GRID_SOURCE] },
      },
    },
  });
  const extDriverSeasons = await prisma.externalDriverSeason.findMany({
    where: { seasonYear: year, source: { in: [JOLPICA_SOURCE, OPENING_GRID_SOURCE] } },
    select: { externalDriverId: true },
  });
  const extDriverIds = [...new Set(extDriverSeasons.map((row) => row.externalDriverId))];
  const extTeams = await prisma.externalTeam.findMany({
    where: { source: JOLPICA_SOURCE, externalId: { in: JOLPICA_TEAM_IDS } },
    select: { id: true },
  });
  await prisma.externalDriverSeason.deleteMany({
    where: { seasonYear: year, source: { in: [JOLPICA_SOURCE, OPENING_GRID_SOURCE] } },
  });
  await prisma.externalDriver.deleteMany({ where: { id: { in: extDriverIds } } });
  await prisma.externalDriver.deleteMany({
    where: { source: OPENING_GRID_SOURCE, externalId: { in: JOLPICA_DRIVER_IDS } },
  });
  await prisma.externalTeam.deleteMany({
    where: { source: OPENING_GRID_SOURCE, externalId: { in: JOLPICA_TEAM_IDS } },
  });
  await prisma.externalTeam.deleteMany({ where: { id: { in: extTeams.map((row) => row.id) } } });
  await prisma.externalSeason.deleteMany({
    where: { year, source: { in: [JOLPICA_SOURCE, OPENING_GRID_SOURCE] } },
  });
}

async function seedParticipants(year: number): Promise<{ extSeasonId: string }> {
  await resetYear(year);
  const extSeason = await prisma.externalSeason.create({
    data: { source: JOLPICA_SOURCE, year, name: String(year), status: "ACTIVE", contentHash: "feed-test-jolpica" },
  });
  for (const teamId of JOLPICA_TEAM_IDS) {
    await prisma.externalTeam.create({
      data: {
        source: JOLPICA_SOURCE,
        externalId: teamId,
        name: teamId,
        shortName: teamId,
        color: "#000000",
        contentHash: `feed-test-team-${teamId}`,
      },
    });
  }
  const feed = loadOpeningGridFeed(year);
  if (!feed) throw new Error(`Feed de Opening Grid ${year} ausente`);
  for (const team of feed.teams) {
    for (const driver of team.drivers) {
      const extDriver = await prisma.externalDriver.create({
        data: {
          source: JOLPICA_SOURCE,
          externalId: driver.externalId!,
          name: driver.name,
          fullName: driver.fullName ?? driver.name,
          nationality: driver.nationality ?? "Unknown",
          number: driver.number ?? null,
          contentHash: `feed-test-driver-${driver.externalId}`,
        },
      });
      await prisma.externalDriverSeason.create({
        data: {
          source: JOLPICA_SOURCE,
          externalDriverId: extDriver.id,
          seasonYear: year,
          teamExternalId: team.teamExternalId,
          teamNameSnapshot: team.name,
          number: driver.number ?? null,
          role: null,
          contentHash: `feed-test-ds-${driver.externalId}`,
        },
      });
    }
  }
  return { extSeasonId: extSeason.id };
}

async function persistFeedClaims(year: number) {
  const feed = loadOpeningGridFeed(year);
  if (!feed) throw new Error(`Feed de Opening Grid ${year} ausente`);
  const claims = normalizeOpeningGridClaims(feed);
  return prisma.$transaction((tx) => persistOpeningGridClaims(tx, claims));
}

async function snapshotJolpica() {
  const seasons = await prisma.externalDriverSeason.findMany({
    where: { source: JOLPICA_SOURCE, seasonYear: YEAR },
    orderBy: [{ externalDriver: { externalId: "asc" } }],
  });
  const drivers = await prisma.externalDriver.findMany({
    where: { source: JOLPICA_SOURCE },
    orderBy: [{ externalId: "asc" }],
  });
  return { seasons, drivers };
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  await resetYear(YEAR);
});

afterAll(async () => {
  await resetYear(YEAR);
  await app.close();
});

describe("STEP 107.12 — Feed curado e versionado de Opening Grid (fonte oficial FIA 2025-12-19)", () => {
  it("1) Feed 2026 é um payload válido do schema (ano, schema, sem conflitos contextuais)", () => {
    const feed = loadOpeningGridFeed(YEAR);
    expect(feed).not.toBeNull();
    expect(feed?.year).toBe(YEAR);
    const parsed = openingGridEntryListSeasonSchema.safeParse(feed);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.year).toBe(YEAR);
    expect(validateOpeningGridPayload(feed!)).toEqual([]);
  });

  it("2) Feed declara as 11 equipes da Entry List oficial FIA de abertura", () => {
    const feed = loadOpeningGridFeed(YEAR);
    expect(feed?.teams).toHaveLength(11);
    expect(feed?.teams.map((team) => team.teamExternalId).sort()).toEqual([
      ...JOLPICA_TEAM_IDS,
    ].sort());
  });

  it("3) Feed produz 22 claims de titular (RACE_SEAT), exatamente 2 por equipe", () => {
    const feed = loadOpeningGridFeed(YEAR);
    const claims = normalizeOpeningGridClaims(feed!);
    expect(claims).toHaveLength(22);
    expect(claims.every((claim) => claim.role === "RACE_SEAT")).toBe(true);
    for (const team of feed!.teams) {
      expect(claims.filter((claim) => claim.teamExternalId === team.teamExternalId)).toHaveLength(2);
    }
  });

  it("4) Seat null aceito: nenhum titular inventado (seat 1/2); reserve false explícito", () => {
    const feed = loadOpeningGridFeed(YEAR);
    const drivers = feed!.teams.flatMap((team) => team.drivers);
    expect(drivers).toHaveLength(22);
    for (const driver of drivers) {
      expect(driver.seat).toBeNull();
      expect(driver.reserve).toBe(false);
    }
  });

  it("5) Reserva explícita é aceita e normalizada como RESERVE (sem inventar)", () => {
    const season: OpeningGridEntryListSeason = {
      year: YEAR,
      teams: [
        {
          teamExternalId: "haas",
          name: "Haas F1 Team",
          drivers: [
            { externalId: "ocon", name: "Esteban Ocon", number: 31 },
            { externalId: "bearman", name: "Oliver Bearman", number: 87 },
            { externalId: "ryo_hirakawa", name: "Ryo Hirakawa", reserve: true },
          ],
        },
      ],
    };
    expect(validateOpeningGridPayload(season)).toEqual([]);
    const claims = normalizeOpeningGridClaims(season);
    expect(claims.find((claim) => claim.driverExternalId === "ryo_hirakawa")?.role).toBe(
      "RESERVE",
    );
  });

  it("6) Duplicate seat no payload é rejeitado (DUPLICATE_SEAT)", () => {
    const season: OpeningGridEntryListSeason = {
      year: YEAR,
      teams: [
        {
          teamExternalId: "mclaren",
          name: "McLaren",
          drivers: [
            { externalId: "norris", name: "Lando Norris", seat: 1 },
            { externalId: "piastri", name: "Oscar Piastri", seat: 1 },
          ],
        },
      ],
    };
    const conflicts = validateOpeningGridPayload(season);
    expect(conflicts.some((conflict) => conflict.kind === "DUPLICATE_SEAT")).toBe(true);
  });

  it("7) Duplicate starter no payload é rejeitado (DUPLICATE_STARTER)", () => {
    const season: OpeningGridEntryListSeason = {
      year: YEAR,
      teams: [
        {
          teamExternalId: "mclaren",
          name: "McLaren",
          drivers: [
            { externalId: "norris", name: "Lando Norris", seat: 1 },
            { externalId: "piastri", name: "Oscar Piastri", seat: 2 },
          ],
        },
        {
          teamExternalId: "williams",
          name: "Williams",
          drivers: [
            { externalId: "sainz", name: "Carlos Sainz", seat: 1 },
            { externalId: "norris", name: "Lando Norris", seat: 2 },
          ],
        },
      ],
    };
    const conflicts = validateOpeningGridPayload(season);
    expect(conflicts.some((conflict) => conflict.kind === "DUPLICATE_STARTER")).toBe(true);
  });

  it("8) Ano do payload divergente do solicitado → MALFORMED (client rejeita)", async () => {
    const wrongYear: OpeningGridEntryListSeason = {
      year: 2027,
      teams: [
        {
          teamExternalId: "x",
          name: "X",
          drivers: [
            { externalId: "dx", name: "Dx", number: 1, seat: 1 },
            { externalId: "dy", name: "Dy", number: 2, seat: 2 },
          ],
        },
      ],
    };
    const transport = new OpeningGridTransport({
      baseUrl: "https://mock.invalid/og/",
      fetchImpl: async () =>
        new Response(JSON.stringify(wrongYear), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    const client = new OpeningGridClient({ transport });
    await expect(client.getSeason(YEAR)).rejects.toMatchObject({ code: "MALFORMED" });
  });

  it("9) Identidades do feed são compatíveis com o espelho Jolpica (mapping versionado, sem inferência por TLA/nome)", () => {
    const feed = loadOpeningGridFeed(YEAR);
    const driverIds = feed!.teams.flatMap((team) => team.drivers.map((driver) => driver.externalId!));
    expect(driverIds).toHaveLength(22);
    expect(new Set(driverIds).size).toBe(22);
    expect(driverIds.every((id) => JOLPICA_DRIVER_IDS.includes(id))).toBe(true);
    expect(feed!.teams.every((team) => JOLPICA_TEAM_IDS.includes(team.teamExternalId))).toBe(true);
  });

  it("10) Racing Bulls 2026 no feed de abertura = Lindblad #41 + Lawson #30 (sem Tsunoda)", () => {
    const feed = loadOpeningGridFeed(YEAR);
    const rb = feed!.teams.find((team) => team.teamExternalId === "rb");
    expect(rb).toBeDefined();
    expect(rb!.drivers).toHaveLength(2);
    const rbClaims = normalizeOpeningGridClaims(feed!).filter(
      (claim) => claim.teamExternalId === "rb",
    );
    expect(
      rbClaims
        .map((claim) => [claim.driverExternalId, claim.driverNumber, claim.role] as const)
        .sort((a, b) => a[0].localeCompare(b[0])),
    ).toEqual([
      ["arvid_lindblad", 41, "RACE_SEAT"],
      ["lawson", 30, "RACE_SEAT"],
    ]);
    expect(rbClaims.some((claim) => claim.driverExternalId === "tsunoda")).toBe(false);
  });

  it("11) Reserva multi-equipe é detectada (RESERVE_AFFILIATION_UNSUPPORTED); feed 2026 não declara reservas", () => {
    const multiTeam: OpeningGridEntryListSeason = {
      year: YEAR,
      teams: [
        {
          teamExternalId: "red_bull",
          name: "Red Bull Racing",
          drivers: [{ externalId: "tsunoda", name: "Yuki Tsunoda", reserve: true }],
        },
        {
          teamExternalId: "rb",
          name: "Visa Cash App Racing Bulls F1 Team",
          drivers: [{ externalId: "tsunoda", name: "Yuki Tsunoda", reserve: true }],
        },
      ],
    };
    const conflicts = validateOpeningGridPayload(multiTeam);
    expect(conflicts.some((conflict) => conflict.kind === "RESERVE_AFFILIATION_UNSUPPORTED")).toBe(
      true,
    );

    const feed = loadOpeningGridFeed(YEAR);
    const reserveClaims = normalizeOpeningGridClaims(feed!).filter(
      (claim) => claim.role === "RESERVE",
    );
    expect(reserveClaims).toHaveLength(0);
  });

  it("12) Persistência das claims do feed é idempotente (02 criados, 22 unchanged)", async () => {
    try {
      const first = await persistFeedClaims(YEAR);
      expect(first.created).toBeGreaterThan(0);
      const second = await persistFeedClaims(YEAR);
      expect(second.created).toBe(0);
      expect(second.updated).toBe(0);
      expect(second.unchanged).toBeGreaterThan(0);
      expect(
        await prisma.externalDriverSeason.count({
          where: { source: OPENING_GRID_SOURCE, seasonYear: YEAR },
        }),
      ).toBe(22);
    } finally {
      await resetYear(YEAR);
    }
  });

  it("13) Espelho Jolpica permanece intacto após persistir claims do feed e resolver", async () => {
    const ctx = await seedParticipants(YEAR);
    try {
      const before = await snapshotJolpica();
      await persistFeedClaims(YEAR);
      await resolveOpeningGrid(prisma, { source: JOLPICA_SOURCE, year: YEAR });
      const after = await snapshotJolpica();
      expect(after).toEqual(before);
      expect(ctx.extSeasonId).toBeTruthy();
    } finally {
      await resetYear(YEAR);
    }
  });

  it("14) OpeningGridResolver consome o feed: participants Jolpica + claims → 11 equipes RESOLVED", async () => {
    const ctx = await seedParticipants(YEAR);
    try {
      await persistFeedClaims(YEAR);
      const grid = await resolveOpeningGrid(prisma, {
        source: JOLPICA_SOURCE,
        year: YEAR,
        seasonId: undefined,
      });
      expect(grid.state).toBe("RESOLVED");
      expect(grid.teams).toHaveLength(11);
      expect(grid.resolvedTeams).toBe(11);
      expect(grid.unresolvedTeams).toBe(0);
      expect(grid.conflictedTeams).toBe(0);
      expect(grid.teams.every((team) => team.starters.length === 2)).toBe(true);
      expect(grid.teams.every((team) => team.reserves.length === 0)).toBe(true);
      expect(ctx.extSeasonId).toBeTruthy();
    } finally {
      await resetYear(YEAR);
    }
  });

  it("15) Universe Initialization materializa o grid do feed (11 equipes, 22 titulares, sem reservas)", async () => {
    const ctx = await seedParticipants(YEAR);
    await persistFeedClaims(YEAR);
    const user = await prisma.user.create({
      data: {
        name: "Feed Init Admin",
        email: `feed-init-${Date.now()}-${Math.random()}@f1nw.test`,
        password: "x",
        role: "ADMIN",
      },
    });
    const season = await prisma.season.create({
      data: { year: YEAR, name: String(YEAR), status: "PRE_SEASON" },
    });
    const actor: Actor = { id: user.id, role: "ADMIN" };
    try {
      const report = await universeInitService.execute(actor, {
        seasonId: season.id,
        externalSeasonId: ctx.extSeasonId,
        scopes: ["DRIVER_GRID"],
      });
      expect(report.conflicts).toEqual([]);
      expect(report.summary.openingGridState).toBe("RESOLVED");
      expect(report.summary.teamsCreated).toBe(11);
      expect(report.summary.entriesCreated).toBe(22);

      const entries = await prisma.seasonDriverEntry.findMany({
        where: { seasonId: season.id },
        include: { driverProfile: { include: { character: true } } },
      });
      expect(entries).toHaveLength(22);
      expect(entries.filter((entry) => entry.role === "RACE_SEAT")).toHaveLength(22);
      expect(entries.filter((entry) => entry.role === "RESERVE")).toHaveLength(0);
      const groups = new Map<string, typeof entries>();
      for (const entry of entries) {
        const key = entry.teamId!;
        const group = groups.get(key) ?? [];
        group.push(entry);
        groups.set(key, group);
      }
      expect(groups.size).toBe(11);
      for (const group of groups.values()) expect(group).toHaveLength(2);
    } finally {
      await prisma.driverEntryEvent.deleteMany({ where: { entry: { seasonId: season.id } } });
      await prisma.seasonDriverEntry.deleteMany({ where: { seasonId: season.id } });
      await prisma.externalBindingSeason.deleteMany({ where: { seasonId: season.id } });
      await prisma.externalBindingTeam.deleteMany({ where: { team: { userId: user.id } } });
      await prisma.externalBindingDriver.deleteMany({ where: { character: { userId: user.id } } });
      await prisma.externalBindingDriverSeason.deleteMany({
        where: { seasonDriverEntry: { seasonId: season.id } },
      });
      await prisma.team.deleteMany({ where: { userId: user.id } });
      await prisma.character.deleteMany({ where: { userId: user.id } });
      await prisma.season.deleteMany({ where: { id: season.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
      await resetYear(YEAR);
    }
  });

  it("16) Feed versionado é servido pelo dev server (GET /opening-grid/:year/opening-grid.json)", async () => {
    const res = await app.inject({ method: "GET", url: "/opening-grid/2026/opening-grid.json" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as OpeningGridEntryListSeason;
    expect(body.year).toBe(YEAR);
    expect(body.teams).toHaveLength(11);

    const missing = await app.inject({
      method: "GET",
      url: "/opening-grid/2099/opening-grid.json",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe("FEED_NOT_FOUND");
  });
});