import type { PrismaClient } from "@prisma/client";
import { hashString } from "./qualifying.engine.js";
import {
  simulateRace,
  type RaceDriverResult,
} from "./race-simulation.engine.js";
import { effectivePerformance } from "../performance/team-performance.js";
import { effectiveDriverAttributes } from "../performance/driver-attribute.js";

export type RaceRunEntry = RaceDriverResult & {
  driverName: string;
  teamName: string | null;
};

export type RaceRun = {
  results: RaceRunEntry[];
  incidents: Array<{ driverProfileId: string; type: "RETIREMENT" }>;
};

export async function simulateRaceForRace(
  db: PrismaClient,
  raceId: string,
): Promise<RaceRun | null> {
  const race = await db.race.findUnique({
    where: { id: raceId },
    select: { id: true, seasonId: true, status: true },
  });

  if (!race) return null;

  const gridRows = await db.raceResult.findMany({
    where: { raceId, grid: { not: null } },
    orderBy: { grid: "asc" },
    select: { grid: true, driverProfileId: true },
  });

  const gridById = new Map(
    gridRows.map((row) => [row.driverProfileId, row.grid as number]),
  );
  const driverIds = gridRows.map((row) => row.driverProfileId);
  if (driverIds.length === 0) {
    return { results: [], incidents: [] };
  }

  const teamById = new Map<string, string | null>();
  const entries = await db.seasonDriverEntry.findMany({
    where: { seasonId: race.seasonId, driverProfileId: { in: driverIds } },
    select: { driverProfileId: true, teamId: true },
  });
  for (const entry of entries) {
    teamById.set(entry.driverProfileId, entry.teamId);
  }

  const teamIds = entries
    .map((entry) => entry.teamId)
    .filter((id): id is string => id !== null);

  const [driverRows, teamRows] = await Promise.all([
    db.driverAttribute.findMany({
      where: { seasonId: race.seasonId, driverProfileId: { in: driverIds } },
    }),
    db.teamPerformance.findMany({
      where: { seasonId: race.seasonId, teamId: { in: teamIds } },
    }),
  ]);

  const attrsByDriver = new Map(
    driverRows.map((row) => [row.driverProfileId, effectiveDriverAttributes(row)]),
  );
  const perfByTeam = new Map(
    teamRows.map((row) => [row.teamId, effectivePerformance(row)]),
  );

  const nameById = new Map<string, string>();
  const profiles = await db.driverProfile.findMany({
    where: { id: { in: driverIds } },
    select: {
      id: true,
      character: { select: { name: true } },
    },
  });
  for (const profile of profiles) {
    nameById.set(profile.id, profile.character.name);
  }

  const teamNameById = new Map<string, string>();
  const teams = await db.team.findMany({
    where: { id: { in: teamIds } },
    select: { id: true, name: true },
  });
  for (const team of teams) {
    teamNameById.set(team.id, team.name);
  }

  const contenders = driverIds.flatMap((driverProfileId) => {
    const startGrid = gridById.get(driverProfileId);
    if (startGrid === undefined) return [];
    const attrs = attrsByDriver.get(driverProfileId) ?? {
      speed: 50,
      consistency: 50,
      racecraft: 50,
    };
    const perf = perfByTeam.get(teamById.get(driverProfileId) ?? "") ?? {
      carSpeed: 50,
      reliability: 50,
    };
    return [
      {
        driverProfileId,
        carSpeed: perf.carSpeed,
        speed: attrs.speed,
        consistency: attrs.consistency,
        racecraft: attrs.racecraft,
        reliability: perf.reliability,
        startGrid,
      },
    ];
  });

  const seed = hashString(`${race.id}:${race.seasonId}:race`);
  const simulation = simulateRace(contenders, seed);

  const run: RaceRun = {
    results: simulation.results.map((row) => ({
      ...row,
      driverName: nameById.get(row.driverProfileId) ?? "Contender",
      teamName: teamNameById.get(teamById.get(row.driverProfileId) ?? "") ?? null,
    })),
    incidents: simulation.incidents,
  };

  for (const row of run.results) {
    await db.raceResult.upsert({
      where: {
        raceId_driverProfileId: {
          raceId,
          driverProfileId: row.driverProfileId,
        },
      },
      create: {
        raceId,
        driverProfileId: row.driverProfileId,
        grid: row.startGrid,
        position: row.position,
        status: row.status,
        points: 0,
      },
      update: { position: row.position, status: row.status },
      select: { id: true },
    });
  }

  if (race.status === "QUALIFYING") {
    await db.race.update({
      where: { id: raceId },
      data: { status: "RACE" },
    });
  }

  return run;
}