import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { buildDivergenceReport } from "./divergence.service.js";
import {
  getTimelineEventDetail,
  queryTimelineItems,
} from "./timeline.read.js";
import { TimelineError } from "./timeline.service.js";

const PREFIX = "tl-read";
const SOURCE = "tl-read-synth";

let app: FastifyInstance;

const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdExternalDriverIds: string[] = [];

let userA: { id: string; cookie: string };
let userB: { id: string; cookie: string };
let universeAId: string;
let universeBId: string;
let seasonAId: string;
let race1Id: string;
let race2Id: string;
let driver1Id: string;
let driver2Id: string;
let team1Id: string;

async function createUserViaApi(label: string) {
  const email = `${PREFIX}-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@f1nw.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: `TL ${label}`, email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  createdUserIds.push(user.id);
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  return { id: user.id, cookie };
}

async function createSeasonYear(year: number) {
  const season = await prisma.season.create({
    data: { universeId: universeAId, year, name: String(year) },
  });
  return season.id;
}

async function createTimelineEvent(data: {
  universeId: string;
  sequence: number;
  worldDate: Date;
  kind:
    | "WORLD_ADVANCED"
    | "RACE_SCHEDULED"
    | "RACE_UPDATED"
    | "SESSION_COMPLETED"
    | "ATTRIBUTE_EVOLVED"
    | "RACE_RESULT_CORRECTED"
    | "STANDING_CORRECTED"
    | "NUMBER_CORRECTED";
  payload: Record<string, unknown>;
  causedBy?: string;
  supersedesId?: string;
}) {
  return prisma.timelineEvent.create({
    data: {
      universeId: data.universeId,
      sequence: data.sequence,
      worldDate: data.worldDate,
      kind: data.kind,
      payload: data.payload as Prisma.InputJsonValue,
      causedBy: data.causedBy ?? "USER",
      supersedesId: data.supersedesId ?? null,
    },
  });
}

let evWorldId: string;
let evScheduledId: string;
let evCorrectionId: string;
let evCorrectionV2Id: string;
let evNumberId: string;
let evStandingId: string;
let evEvolutionId: string;

beforeAll(async () => {
  app = buildApp();
  await app.ready();

  userA = await createUserViaApi("a");
  userB = await createUserViaApi("b");

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
  createdUniverseIds.push(universeAId, universeBId);

  seasonAId = await createSeasonYear(2087);
  team1Id = (
    await prisma.team.create({
      data: {
        name: `${PREFIX}-equipe-1-${Date.now()}`,
        userId: userA.id,
        universeId: universeAId,
      },
    })
  ).id;
  race1Id = (
    await prisma.race.create({
      data: {
        seasonId: seasonAId,
        name: "GP Sintético 1",
        round: 1,
        date: new Date("2087-03-01T00:00:00.000Z"),
        status: "FINISHED",
      },
    })
  ).id;
  race2Id = (
    await prisma.race.create({
      data: {
        seasonId: seasonAId,
        name: "GP Sintético 2",
        round: 2,
        date: new Date("2087-03-15T00:00:00.000Z"),
        status: "UPCOMING",
      },
    })
  ).id;

  async function createDriver(label: string, teamId: string | null) {
    const character = await prisma.character.create({
      data: {
        name: `${PREFIX}-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        nationality: "BR",
        birthDate: new Date("1998-01-01"),
        controlledBy: "AI",
        universeId: universeAId,
      },
    });
    createdCharacterIds.push(character.id);
    const profile = await prisma.driverProfile.create({
      data: { characterId: character.id, teamId, number: null },
    });
    return profile.id;
  }

  driver1Id = await createDriver("d1", team1Id);
  driver2Id = await createDriver("d2", null);

  await prisma.raceResult.create({
    data: {
      raceId: race1Id,
      driverProfileId: driver1Id,
      position: 1,
      grid: 1,
      points: 25,
      status: "Finished",
    },
  });
  await prisma.raceResult.create({
    data: {
      raceId: race2Id,
      driverProfileId: driver2Id,
      position: 3,
      grid: 4,
      points: 15,
      status: "Finished",
    },
  });
  await prisma.championshipStanding.create({
    data: {
      seasonId: seasonAId,
      driverProfileId: driver1Id,
      points: 25,
      wins: 1,
      podiums: 1,
      position: 1,
    },
  });
  await prisma.championshipStanding.create({
    data: {
      seasonId: seasonAId,
      driverProfileId: driver2Id,
      points: 15,
      wins: 0,
      podiums: 1,
      position: 2,
    },
  });

  const externalDriver1 = await prisma.externalDriver.create({
    data: {
      source: SOURCE,
      externalId: `${PREFIX}-ext-d1-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: "Piloto Externo 1",
      contentHash: "h1",
    },
  });
  const externalDriver2 = await prisma.externalDriver.create({
    data: {
      source: SOURCE,
      externalId: `${PREFIX}-ext-d2-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: "Piloto Externo 2",
      contentHash: "h2",
    },
  });
  createdExternalDriverIds.push(externalDriver1.id, externalDriver2.id);

  const externalRace1 = await prisma.externalRace.create({
    data: {
      source: SOURCE,
      seasonYear: 2087,
      round: 1,
      grandPrix: "GP Sintético 1",
      date: new Date("2087-03-01T00:00:00.000Z"),
      contentHash: "er1",
    },
  });
  await prisma.externalRace.create({
    data: {
      source: SOURCE,
      seasonYear: 2087,
      round: 3,
      grandPrix: "GP Externo 3",
      date: new Date("2087-04-01T00:00:00.000Z"),
      contentHash: "er3",
    },
  });
  const externalResult1 = await prisma.externalResult.create({
    data: {
      source: SOURCE,
      externalRaceId: externalRace1.id,
      externalDriverId: externalDriver1.id,
      position: 1,
      grid: 1,
      status: "Finished",
      contentHash: "ers1",
    },
  });
  await prisma.externalResult.create({
    data: {
      source: SOURCE,
      externalRaceId: externalRace1.id,
      externalDriverId: externalDriver2.id,
      position: 5,
      grid: 6,
      status: "Finished",
      contentHash: "ers2",
    },
  });
  const externalStanding1 = await prisma.externalStanding.create({
    data: {
      source: SOURCE,
      seasonYear: 2087,
      externalDriverId: externalDriver1.id,
      position: 1,
      points: 25,
      wins: 1,
      contentHash: "es1",
    },
  });
  await prisma.externalStanding.create({
    data: {
      source: SOURCE,
      seasonYear: 2087,
      externalDriverId: externalDriver2.id,
      position: 9,
      points: 2,
      wins: 0,
      contentHash: "es2",
    },
  });

  await prisma.externalBindingRace.create({
    data: {
      universeId: universeAId,
      externalRaceId: externalRace1.id,
      raceId: race1Id,
      confidence: "CONFIRMED",
    },
  });
  const result1 = await prisma.raceResult.findFirstOrThrow({
    where: { raceId: race1Id, driverProfileId: driver1Id },
  });
  await prisma.externalBindingResult.create({
    data: {
      universeId: universeAId,
      externalResultId: externalResult1.id,
      raceResultId: result1.id,
      confidence: "CONFIRMED",
    },
  });
  const standing1 = await prisma.championshipStanding.findFirstOrThrow({
    where: { seasonId: seasonAId, driverProfileId: driver1Id },
  });
  await prisma.externalBindingStanding.create({
    data: {
      universeId: universeAId,
      externalStandingId: externalStanding1.id,
      championshipStandingId: standing1.id,
      confidence: "CONFIRMED",
    },
  });

  const baseDate = new Date("2087-01-01T00:00:00.000Z");
  function day(offset: number) {
    return new Date(baseDate.getTime() + offset * 86_400_000);
  }

  const world = await createTimelineEvent({
    universeId: universeAId,
    sequence: 1,
    worldDate: day(1),
    kind: "WORLD_ADVANCED",
    payload: {
      currentDate: day(1).toISOString(),
      currentSeasonId: seasonAId,
      currentRaceId: null,
      currentSession: null,
    },
  });
  evWorldId = world.id;
  const scheduled = await createTimelineEvent({
    universeId: universeAId,
    sequence: 2,
    worldDate: day(2),
    kind: "RACE_SCHEDULED",
    payload: { raceId: race1Id, round: 1, name: "GP Sintético 1" },
  });
  evScheduledId = scheduled.id;
  const correction = await createTimelineEvent({
    universeId: universeAId,
    sequence: 3,
    worldDate: day(3),
    kind: "RACE_RESULT_CORRECTED",
    payload: { raceId: race1Id, driverProfileId: driver1Id, position: 2 },
  });
  evCorrectionId = correction.id;
  const correctionV2 = await createTimelineEvent({
    universeId: universeAId,
    sequence: 4,
    worldDate: day(4),
    kind: "RACE_RESULT_CORRECTED",
    payload: { raceId: race1Id, driverProfileId: driver1Id, position: 1 },
    supersedesId: correction.id,
  });
  evCorrectionV2Id = correctionV2.id;
  const number = await createTimelineEvent({
    universeId: universeAId,
    sequence: 5,
    worldDate: day(5),
    kind: "NUMBER_CORRECTED",
    payload: { seasonId: seasonAId, driverProfileId: driver2Id, number: 7 },
  });
  evNumberId = number.id;
  const standing = await createTimelineEvent({
    universeId: universeAId,
    sequence: 6,
    worldDate: day(6),
    kind: "STANDING_CORRECTED",
    payload: { seasonId: seasonAId, driverProfileId: driver1Id, points: 30 },
  });
  evStandingId = standing.id;
  const evolution = await createTimelineEvent({
    universeId: universeAId,
    sequence: 7,
    worldDate: day(7),
    kind: "ATTRIBUTE_EVOLVED",
    payload: { seasonId: seasonAId, fingerprint: "fp-synth", racesConsidered: 2 },
  });
  evEvolutionId = evolution.id;

  await createTimelineEvent({
    universeId: universeBId,
    sequence: 1,
    worldDate: day(1),
    kind: "WORLD_ADVANCED",
    payload: {
      currentDate: day(1).toISOString(),
      currentSeasonId: null,
      currentRaceId: null,
      currentSession: null,
    },
  });
});

afterAll(async () => {
  await prisma.timelineEvent.deleteMany({
    where: { universeId: { in: [universeAId, universeBId] } },
  });
  await prisma.externalBindingResult.deleteMany({
    where: { universeId: { in: [universeAId, universeBId] } },
  });
  await prisma.externalBindingStanding.deleteMany({
    where: { universeId: { in: [universeAId, universeBId] } },
  });
  await prisma.externalBindingRace.deleteMany({
    where: { universeId: { in: [universeAId, universeBId] } },
  });
  await prisma.championshipStanding.deleteMany({
    where: { seasonId: seasonAId },
  });
  await prisma.raceResult.deleteMany({ where: { race: { seasonId: seasonAId } } });
  await prisma.race.deleteMany({ where: { seasonId: seasonAId } });
  await prisma.team.deleteMany({ where: { universeId: universeAId } });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.externalResult.deleteMany({
    where: { source: SOURCE, externalRace: { seasonYear: 2087 } },
  });
  await prisma.externalStanding.deleteMany({
    where: { source: SOURCE, seasonYear: 2087 },
  });
  await prisma.externalRace.deleteMany({
    where: { source: SOURCE, seasonYear: 2087 },
  });
  await prisma.externalDriver.deleteMany({
    where: { id: { in: createdExternalDriverIds } },
  });
  await prisma.season.deleteMany({ where: { id: seasonAId } });
  await prisma.universe.deleteMany({ where: { id: { in: createdUniverseIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
  await app.close();
});

describe("timeline read model", () => {
  it("1) lista em ordem cronológica decrescente com nomes resolvidos", async () => {
    const page = await queryTimelineItems(universeAId, { limit: 50 });
    expect(page.items).toHaveLength(7);
    expect(page.items[0]!.kind).toBe("ATTRIBUTE_EVOLVED");
    expect(page.items[0]!.season?.id).toBe(seasonAId);
    const correction = page.items.find((item) => item.id === evCorrectionV2Id)!;
    expect(correction.race?.id).toBe(race1Id);
    expect(correction.driver?.id).toBe(driver1Id);
    expect(correction.team?.id).toBe(team1Id);
    expect(correction.values).toMatchObject({ position: 1 });
    expect(correction.summary).toContain("GP Sintético 1");
  });

  it("2) marca correção e supersession (evento original preservado)", async () => {
    const page = await queryTimelineItems(universeAId, { limit: 50 });
    const original = page.items.find((item) => item.id === evCorrectionId)!;
    const replacement = page.items.find((item) => item.id === evCorrectionV2Id)!;
    expect(original.isCorrection).toBe(true);
    expect(original.isSuperseded).toBe(true);
    expect(original.supersededById).toBe(evCorrectionV2Id);
    expect(replacement.isSuperseded).toBe(false);
    expect(replacement.supersedesId).toBe(evCorrectionId);
    const number = page.items.find((item) => item.id === evNumberId)!;
    expect(number.number).toBe(7);
    expect(number.driver?.id).toBe(driver2Id);
  });

  it("3) detalhe retorna cadeia de supersession", async () => {
    const detail = await getTimelineEventDetail(universeAId, evCorrectionV2Id);
    expect(detail.item.id).toBe(evCorrectionV2Id);
    expect(detail.supersedesChain.map((item) => item.id)).toEqual([evCorrectionId]);
    const original = await getTimelineEventDetail(universeAId, evCorrectionId);
    expect(original.supersededByChain.map((item) => item.id)).toEqual([
      evCorrectionV2Id,
    ]);
  });

  it("4) filtra por kind, correções, corrida, piloto, equipe, temporada e data", async () => {
    const byKind = await queryTimelineItems(universeAId, {
      kind: "RACE_RESULT_CORRECTED",
    });
    expect(byKind.items.map((item) => item.id).sort()).toEqual(
      [evCorrectionId, evCorrectionV2Id].sort(),
    );

    const corrections = await queryTimelineItems(universeAId, {
      correctionsOnly: true,
    });
    expect(corrections.items).toHaveLength(4);

    const byRace = await queryTimelineItems(universeAId, { raceId: race1Id });
    expect(byRace.items.map((item) => item.id).sort()).toEqual(
      [evScheduledId, evCorrectionId, evCorrectionV2Id].sort(),
    );

    const byDriver = await queryTimelineItems(universeAId, {
      driverProfileId: driver1Id,
    });
    expect(byDriver.items.map((item) => item.id).sort()).toEqual(
      [evCorrectionId, evCorrectionV2Id, evStandingId].sort(),
    );

    const byTeam = await queryTimelineItems(universeAId, { teamId: team1Id });
    expect(byTeam.items).toHaveLength(3);

    const bySeason = await queryTimelineItems(universeAId, {
      seasonId: seasonAId,
    });
    expect(bySeason.items).toHaveLength(7);

    const byDate = await queryTimelineItems(universeAId, {
      from: new Date("2087-01-07T00:00:00.000Z"),
    });
    expect(byDate.items.map((item) => item.id).sort()).toEqual(
      [evStandingId, evEvolutionId].sort(),
    );

    const scheduled = await queryTimelineItems(universeAId, {
      kind: "RACE_SCHEDULED",
    });
    expect(scheduled.items[0]!.season?.id).toBe(seasonAId);
    expect(scheduled.items[0]!.values).toMatchObject({ round: 1 });
  });

  it("5) pagina por cursor sem repetir itens", async () => {
    const first = await queryTimelineItems(universeAId, { limit: 3 });
    expect(first.items).toHaveLength(3);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();
    const second = await queryTimelineItems(universeAId, {
      limit: 3,
      cursor: first.nextCursor as string,
    });
    const firstIds = new Set(first.items.map((item) => item.id));
    expect(second.items.every((item) => !firstIds.has(item.id))).toBe(true);
    expect(second.items).toHaveLength(3);
  });

  it("6) isolamento entre universos e ownership no detalhe", async () => {
    const pageB = await queryTimelineItems(universeBId, { limit: 50 });
    expect(pageB.items).toHaveLength(1);
    expect(pageB.items[0]!.kind).toBe("WORLD_ADVANCED");
    await expect(
      getTimelineEventDetail(universeBId, evWorldId),
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
    await expect(
      getTimelineEventDetail(universeAId, randomUUID()),
    ).rejects.toBeInstanceOf(TimelineError);
  });
});

describe("timeline divergence (Universe vs External)", () => {
  it("7) classifica corridas, resultados e standings", async () => {
    const report = await buildDivergenceReport(universeAId, seasonAId);

    const race1 = report.races.find((item) => item.raceId === race1Id)!;
    expect(race1.classification).toBe("MATCH");
    const race2 = report.races.find((item) => item.raceId === race2Id)!;
    expect(race2.classification).toBe("UNIVERSE_ONLY");
    const externalOnly = report.races.filter(
      (item) => item.classification === "EXTERNAL_ONLY",
    );
    expect(externalOnly).toHaveLength(1);
    expect(externalOnly[0]!.round).toBe(3);

    const boundResult = report.results.find(
      (item) => item.driverProfileId === driver1Id,
    )!;
    expect(boundResult.classification).toBe("MATCH");
    const universeOnlyResult = report.results.find(
      (item) => item.driverProfileId === driver2Id,
    )!;
    expect(universeOnlyResult.classification).toBe("UNIVERSE_ONLY");
    expect(
      report.results.filter((item) => item.classification === "EXTERNAL_ONLY"),
    ).toHaveLength(1);

    const boundStanding = report.standings.find(
      (item) => item.driverProfileId === driver1Id,
    )!;
    expect(boundStanding.classification).toBe("MATCH");
    expect(
      report.standings.find((item) => item.driverProfileId === driver2Id)!
        .classification,
    ).toBe("UNIVERSE_ONLY");
    expect(
      report.standings.filter((item) => item.classification === "EXTERNAL_ONLY"),
    ).toHaveLength(1);

    expect(report.summary.match).toBe(3);
    expect(report.summary.divergent).toBe(0);
  });

  it("8) divergência de resultado é detectada com campos afetados", async () => {
    const bound = await prisma.raceResult.findFirstOrThrow({
      where: { raceId: race1Id, driverProfileId: driver1Id },
    });
    await prisma.raceResult.update({
      where: { id: bound.id },
      data: { status: "DSQ" },
    });
    const report = await buildDivergenceReport(universeAId, seasonAId);
    const item = report.results.find(
      (result) => result.driverProfileId === driver1Id,
    )!;
    expect(item.classification).toBe("DIVERGENT");
    expect(item.fields).toEqual(["status"]);
    expect(item.status).toBe("DSQ");
    expect(item.externalStatus).toBe("Finished");
    await prisma.raceResult.update({
      where: { id: bound.id },
      data: { status: "Finished" },
    });
  });

  it("9) temporada de outro universo → 404", async () => {
    await expect(
      buildDivergenceReport(universeBId, seasonAId),
    ).rejects.toMatchObject({ code: "SEASON_NOT_FOUND", statusCode: 404 });
  });
});

describe("timeline routes", () => {
  it("10) 401 sem sessão", async () => {
    const res = await app.inject({ method: "GET", url: "/api/timeline" });
    expect(res.statusCode).toBe(401);
  });

  it("11) lista com filtros e paginação", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/timeline?correctionsOnly=true&limit=2",
      headers: { cookie: userA.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events).toHaveLength(2);
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBeTruthy();
    expect(body.events[0]).not.toHaveProperty("payload");

    const invalid = await app.inject({
      method: "GET",
      url: "/api/timeline?kind=NAO_EXISTE",
      headers: { cookie: userA.cookie },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("12) detalhe e divergência via HTTP com leak-safe", async () => {
    const detail = await app.inject({
      method: "GET",
      url: `/api/timeline/events/${evCorrectionV2Id}`,
      headers: { cookie: userA.cookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().item.id).toBe(evCorrectionV2Id);

    const foreignDetail = await app.inject({
      method: "GET",
      url: `/api/timeline/events/${randomUUID()}`,
      headers: { cookie: userA.cookie },
    });
    expect(foreignDetail.statusCode).toBe(404);

    const divergence = await app.inject({
      method: "GET",
      url: `/api/timeline/divergence?seasonId=${seasonAId}`,
      headers: { cookie: userA.cookie },
    });
    expect(divergence.statusCode).toBe(200);
    expect(divergence.json().divergence.summary).toMatchObject({
      match: 3,
      divergent: 0,
    });

    const foreignSeason = await app.inject({
      method: "GET",
      url: `/api/timeline/divergence?seasonId=${seasonAId}`,
      headers: { cookie: userB.cookie },
    });
    expect(foreignSeason.statusCode).toBe(404);
  });
});
