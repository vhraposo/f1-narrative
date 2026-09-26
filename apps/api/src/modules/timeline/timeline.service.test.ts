import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import { recomputeSeasonStandings } from "../championship/championship-progression.service.js";
import {
  advanceUniverseTime,
  applyRetroactiveCorrection,
  createWorldSnapshot,
  listTimelineEvents,
  lockUniverseTimeline,
  recomputeUniverseState,
} from "./timeline.service.js";

const RUN = Date.now().toString(36);
const YEAR = 2098;
const createdUserIds: string[] = [];

type Fixture = {
  userId: string;
  universeId: string;
  seasonId: string;
  teamId: string;
  raceId: string;
  driverA: string;
  driverB: string;
};

async function createDriver(
  universeId: string,
  userId: string,
  seasonId: string,
  teamId: string,
  name: string,
  number: number,
): Promise<string> {
  const character = await prisma.character.create({
    data: {
      userId,
      universeId,
      controlledBy: "USER",
      name,
      nationality: "Brasileira",
      birthDate: new Date("1995-01-01"),
    },
    select: { id: true },
  });
  const profile = await prisma.driverProfile.create({
    data: { characterId: character.id, number },
    select: { id: true },
  });
  await prisma.seasonDriverEntry.create({
    data: {
      seasonId,
      driverProfileId: profile.id,
      teamId,
      number,
      status: "ACTIVE",
      role: "RACE_SEAT",
      seat: number === 10 ? 1 : 2,
    },
  });
  return profile.id;
}

async function setupUniverse(suffix: string): Promise<Fixture> {
  const user = await prisma.user.create({
    data: {
      email: `tl-${suffix}-${RUN}@f1nw.test`,
      name: `TL ${suffix}`,
      password: null,
      emailVerified: false,
    },
    select: { id: true },
  });
  createdUserIds.push(user.id);

  const universe = await prisma.universe.create({
    data: { userId: user.id, status: "READY" },
    select: { id: true },
  });
  const season = await prisma.season.create({
    data: { universeId: universe.id, year: YEAR, status: "ACTIVE" },
    select: { id: true },
  });
  const team = await prisma.team.create({
    data: {
      universeId: universe.id,
      userId: user.id,
      name: `Team ${suffix} ${RUN}`,
    },
    select: { id: true },
  });
  const driverA = await createDriver(
    universe.id,
    user.id,
    season.id,
    team.id,
    `Alpha ${suffix} ${RUN}`,
    10,
  );
  const driverB = await createDriver(
    universe.id,
    user.id,
    season.id,
    team.id,
    `Beta ${suffix} ${RUN}`,
    11,
  );
  const race = await prisma.race.create({
    data: {
      seasonId: season.id,
      name: `Race ${suffix} ${RUN}`,
      round: 1,
      date: new Date(`${YEAR}-03-01T00:00:00.000Z`),
      status: "RACE",
    },
    select: { id: true },
  });
  await prisma.raceResult.createMany({
    data: [
      { raceId: race.id, driverProfileId: driverA, position: 1 },
      { raceId: race.id, driverProfileId: driverB, position: 2 },
    ],
  });

  await prisma.$transaction((tx) =>
    recomputeSeasonStandings(tx, season.id),
  );

  return {
    userId: user.id,
    universeId: universe.id,
    seasonId: season.id,
    teamId: team.id,
    raceId: race.id,
    driverA,
    driverB,
  };
}

function dateAt(day: number): Date {
  return new Date(`${YEAR}-03-${String(day).padStart(2, "0")}T00:00:00.000Z`);
}

async function standingsOf(seasonId: string) {
  return prisma.championshipStanding.findMany({
    where: { seasonId },
    select: {
      driverProfileId: true,
      points: true,
      wins: true,
      podiums: true,
      position: true,
    },
    orderBy: [{ position: "asc" }, { driverProfileId: "asc" }],
  });
}

afterAll(async () => {
  for (const userId of createdUserIds) {
    const universes = await prisma.universe.findMany({
      where: { userId },
      select: { id: true },
    });
    for (const universe of universes) {
      const seasonFilter = { season: { universeId: universe.id } };
      await prisma.seasonDriverEntry.deleteMany({ where: seasonFilter });
      await prisma.raceResult.deleteMany({
        where: { race: { season: { universeId: universe.id } } },
      });
      await prisma.championshipStanding.deleteMany({ where: seasonFilter });
      await prisma.race.deleteMany({ where: seasonFilter });
      await prisma.season.deleteMany({ where: { universeId: universe.id } });
      await prisma.driverProfile.deleteMany({
        where: { character: { universeId: universe.id } },
      });
      await prisma.team.deleteMany({ where: { universeId: universe.id } });
      await prisma.character.deleteMany({ where: { universeId: universe.id } });
      await prisma.timelineEvent.deleteMany({
        where: { universeId: universe.id },
      });
      await prisma.worldSnapshot.deleteMany({
        where: { universeId: universe.id },
      });
      await prisma.universe.delete({ where: { id: universe.id } });
    }
    await prisma.user.delete({ where: { id: userId } });
  }
  await prisma.$disconnect();
});

describe("Timeline — fundação temporal", () => {
  it("1/4/9) avanço cria evento, atualiza WorldState e snapshot inicial", async () => {
    const fx = await setupUniverse("adv");

    const event = await advanceUniverseTime(fx.universeId, {
      worldDate: dateAt(1),
      currentSeasonId: fx.seasonId,
      currentRaceId: fx.raceId,
      currentSession: "RACE",
    });
    expect(event.kind).toBe("WORLD_ADVANCED");
    expect(event.sequence).toBe(1);

    const world = await prisma.worldState.findUniqueOrThrow({
      where: { universeId_key: { universeId: fx.universeId, key: "default" } },
    });
    expect(world.currentDate.toISOString()).toBe(dateAt(1).toISOString());
    expect(world.currentRaceId).toBe(fx.raceId);

    const baseline = await prisma.worldSnapshot.findUnique({
      where: {
        universeId_sequence: { universeId: fx.universeId, sequence: 0 },
      },
    });
    expect(baseline).not.toBeNull();

    const second = await advanceUniverseTime(fx.universeId, {
      worldDate: dateAt(2),
      currentSession: "QUALIFYING",
    });
    expect(second.sequence).toBe(2);
    const world2 = await prisma.worldState.findUniqueOrThrow({
      where: { universeId_key: { universeId: fx.universeId, key: "default" } },
    });
    expect(world2.currentDate.toISOString()).toBe(dateAt(2).toISOString());
    expect(world2.currentSession).toBe("QUALIFYING");
  });

  it("2/3) append-only e ordenação determinística (worldDate, sequence)", async () => {
    const fx = await setupUniverse("order");
    await advanceUniverseTime(fx.universeId, {
      worldDate: dateAt(1),
      currentSeasonId: fx.seasonId,
      currentRaceId: fx.raceId,
    });
    await applyRetroactiveCorrection(fx.universeId, {
      kind: "RACE_RESULT_CORRECTED",
      worldDate: dateAt(1),
      payload: { raceId: fx.raceId, driverProfileId: fx.driverB, position: 1 },
    });

    const events = await listTimelineEvents(fx.universeId);
    expect(events.map((e) => e.sequence)).toEqual([1, 2]);
    expect(events.map((e) => e.kind)).toEqual([
      "WORLD_ADVANCED",
      "RACE_RESULT_CORRECTED",
    ]);

    const first = await prisma.timelineEvent.findUniqueOrThrow({
      where: { id: events[0].id },
    });
    expect(first.kind).toBe("WORLD_ADVANCED");
    expect((first.payload as { currentDate: string }).currentDate).toBe(
      dateAt(1).toISOString(),
    );
  });

  it("5/6/7) snapshot explícito, recompute completo e recompute a partir de snapshot", async () => {
    const fx = await setupUniverse("recompute");
    await advanceUniverseTime(fx.universeId, {
      worldDate: dateAt(1),
      currentSeasonId: fx.seasonId,
      currentRaceId: fx.raceId,
    });

    const before = await standingsOf(fx.seasonId);
    expect(before).toHaveLength(2);
    const alphaBefore = before.find((s) => s.driverProfileId === fx.driverA)!;
    expect(alphaBefore.points).toBe(25);
    expect(alphaBefore.position).toBe(1);

    const lastEvent = await prisma.timelineEvent.findFirstOrThrow({
      where: { universeId: fx.universeId },
      orderBy: { sequence: "desc" },
    });
    await prisma.$transaction((tx) =>
      createWorldSnapshot(tx, fx.universeId, lastEvent.sequence, lastEvent.worldDate),
    );
    const snapshot = await prisma.worldSnapshot.findUniqueOrThrow({
      where: {
        universeId_sequence: {
          universeId: fx.universeId,
          sequence: lastEvent.sequence,
        },
      },
    });

    await applyRetroactiveCorrection(fx.universeId, {
      kind: "RACE_RESULT_CORRECTED",
      worldDate: dateAt(1),
      payload: { raceId: fx.raceId, driverProfileId: fx.driverB, position: 1 },
    });
    await applyRetroactiveCorrection(fx.universeId, {
      kind: "RACE_RESULT_CORRECTED",
      worldDate: dateAt(1),
      payload: { raceId: fx.raceId, driverProfileId: fx.driverA, position: 2 },
    });

    const corrected = await standingsOf(fx.seasonId);
    const betaAfter = corrected.find((s) => s.driverProfileId === fx.driverB)!;
    expect(betaAfter.points).toBe(25);
    expect(betaAfter.position).toBe(1);

    const full = await prisma.$transaction((tx) =>
      recomputeUniverseState(tx, fx.universeId),
    );
    const fullStandings = await standingsOf(fx.seasonId);

    const fromSnapshot = await prisma.$transaction((tx) =>
      recomputeUniverseState(tx, fx.universeId, {
        fromSnapshotId: snapshot.id,
      }),
    );
    const snapshotStandings = await standingsOf(fx.seasonId);

    expect(fromSnapshot.applied).toBe(2);
    expect(snapshotStandings).toEqual(fullStandings);
    expect(full.applied).toBeGreaterThan(0);
  });

  it("8) mesmo histórico produz o mesmo estado em universos distintos", async () => {
    const a = await setupUniverse("same-a");
    const b = await setupUniverse("same-b");
    for (const fx of [a, b]) {
      await advanceUniverseTime(fx.universeId, {
        worldDate: dateAt(1),
        currentSeasonId: fx.seasonId,
        currentRaceId: fx.raceId,
      });
      await applyRetroactiveCorrection(fx.universeId, {
        kind: "RACE_RESULT_CORRECTED",
        worldDate: dateAt(1),
        payload: { raceId: fx.raceId, driverProfileId: fx.driverB, position: 1 },
      });
    }
    const standingsA = await standingsOf(a.seasonId);
    const standingsB = await standingsOf(b.seasonId);
    expect(standingsA.map((s) => [s.position, s.points, s.wins])).toEqual(
      standingsB.map((s) => [s.position, s.points, s.wins]),
    );
  });

  it("10/11) correção retroativa, supersession e replay preservando histórico", async () => {
    const fx = await setupUniverse("retro");
    await advanceUniverseTime(fx.universeId, {
      worldDate: dateAt(5),
      currentSeasonId: fx.seasonId,
      currentRaceId: fx.raceId,
    });

    const first = await applyRetroactiveCorrection(fx.universeId, {
      kind: "RACE_RESULT_CORRECTED",
      worldDate: dateAt(1),
      payload: { raceId: fx.raceId, driverProfileId: fx.driverB, position: 1 },
    });
    const second = await applyRetroactiveCorrection(fx.universeId, {
      kind: "RACE_RESULT_CORRECTED",
      worldDate: dateAt(2),
      payload: { raceId: fx.raceId, driverProfileId: fx.driverB, position: 2 },
      supersedesId: first.id,
    });

    const events = await listTimelineEvents(fx.universeId);
    expect(events).toHaveLength(3);
    expect(events.find((e) => e.id === first.id)).toBeTruthy();
    expect(
      events.find((e) => e.id === second.id)?.supersedesId,
    ).toBe(first.id);

    const standings = await standingsOf(fx.seasonId);
    const alpha = standings.find((s) => s.driverProfileId === fx.driverA)!;
    expect(alpha.position).toBe(1);
    expect(alpha.points).toBe(25);
  });

  it("12) falha transacional não deixa estado parcial", async () => {
    const a = await setupUniverse("fail-a");
    const b = await setupUniverse("fail-b");
    await advanceUniverseTime(a.universeId, {
      worldDate: dateAt(1),
      currentSeasonId: a.seasonId,
      currentRaceId: a.raceId,
    });

    const eventsBefore = await prisma.timelineEvent.count({
      where: { universeId: a.universeId },
    });
    const standingsBefore = await standingsOf(a.seasonId);

    await expect(
      applyRetroactiveCorrection(a.universeId, {
        kind: "RACE_RESULT_CORRECTED",
        worldDate: dateAt(1),
        payload: {
          raceId: b.raceId,
          driverProfileId: a.driverB,
          position: 1,
        },
      }),
    ).rejects.toThrow();

    const eventsAfter = await prisma.timelineEvent.count({
      where: { universeId: a.universeId },
    });
    expect(eventsAfter).toBe(eventsBefore);
    expect(await standingsOf(a.seasonId)).toEqual(standingsBefore);
  });

  it("13) isolamento completo entre universos", async () => {
    const a = await setupUniverse("iso-a");
    const b = await setupUniverse("iso-b");
    for (const fx of [a, b]) {
      await advanceUniverseTime(fx.universeId, {
        worldDate: dateAt(1),
        currentSeasonId: fx.seasonId,
        currentRaceId: fx.raceId,
      });
    }
    const standingsBBefore = await standingsOf(b.seasonId);

    await applyRetroactiveCorrection(a.universeId, {
      kind: "RACE_RESULT_CORRECTED",
      worldDate: dateAt(1),
      payload: { raceId: a.raceId, driverProfileId: a.driverB, position: 1 },
    });

    expect(await standingsOf(b.seasonId)).toEqual(standingsBBefore);
    const bEvents = await prisma.timelineEvent.count({
      where: { universeId: b.universeId },
    });
    expect(bEvents).toBe(1);
  });

  it("14) avanços concorrentes são serializados e consistentes", async () => {
    const fx = await setupUniverse("conc");
    await advanceUniverseTime(fx.universeId, {
      worldDate: dateAt(1),
      currentSeasonId: fx.seasonId,
      currentRaceId: fx.raceId,
    });

    const [second, third] = await Promise.all([
      advanceUniverseTime(fx.universeId, { worldDate: dateAt(2) }),
      advanceUniverseTime(fx.universeId, { worldDate: dateAt(3) }),
    ]);
    expect(new Set([second.sequence, third.sequence]).size).toBe(2);

    const world = await prisma.worldState.findUniqueOrThrow({
      where: { universeId_key: { universeId: fx.universeId, key: "default" } },
    });
    expect(world.currentDate.toISOString()).toBe(dateAt(3).toISOString());

    const events = await listTimelineEvents(fx.universeId);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.sequence)).toEqual([1, 2, 3]);
  });

  it("15) replay/recompute é idempotente", async () => {
    const fx = await setupUniverse("idem");
    await advanceUniverseTime(fx.universeId, {
      worldDate: dateAt(1),
      currentSeasonId: fx.seasonId,
      currentRaceId: fx.raceId,
    });
    await applyRetroactiveCorrection(fx.universeId, {
      kind: "RACE_RESULT_CORRECTED",
      worldDate: dateAt(1),
      payload: { raceId: fx.raceId, driverProfileId: fx.driverB, position: 1 },
    });

    const eventsBefore = await prisma.timelineEvent.count({
      where: { universeId: fx.universeId },
    });

    await prisma.$transaction(async (tx) => {
      await lockUniverseTimeline(tx, fx.universeId);
      await recomputeUniverseState(tx, fx.universeId);
    });
    const first = await standingsOf(fx.seasonId);
    await prisma.$transaction(async (tx) => {
      await lockUniverseTimeline(tx, fx.universeId);
      await recomputeUniverseState(tx, fx.universeId);
    });
    const second = await standingsOf(fx.seasonId);

    expect(second).toEqual(first);
    expect(
      await prisma.timelineEvent.count({ where: { universeId: fx.universeId } }),
    ).toBe(eventsBefore);
  });
});
