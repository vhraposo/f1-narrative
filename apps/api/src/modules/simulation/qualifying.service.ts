import type { PrismaClient } from "@prisma/client";
import {
  hashString,
  simulateQualifying,
  type QualifyingResult,
} from "./qualifying.engine.js";
import { effectivePerformance } from "../performance/team-performance.js";
import { effectiveDriverAttributes } from "../performance/driver-attribute.js";

export type QualifyingRunEntry = QualifyingResult & {
  driverName: string;
  teamName: string | null;
};

export async function simulateQualifyingForRace(
  db: PrismaClient,
  raceId: string,
): Promise<QualifyingRunEntry[] | null> {
  const race = await db.race.findUnique({
    where: { id: raceId },
    select: { id: true, seasonId: true, status: true },
  });

  if (!race) return null;

  const entries = await db.seasonDriverEntry.findMany({
    where: {
      seasonId: race.seasonId,
      status: "ACTIVE",
      role: "RACE_SEAT",
      teamId: { not: null },
    },
    select: {
      driverProfileId: true,
      teamId: true,
      driverProfile: {
        select: {
          character: { select: { name: true } },
        },
      },
      team: { select: { name: true } },
    },
  });

  const driverIds = entries.map((entry) => entry.driverProfileId);
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

  const nameByDriver = new Map(
    entries.map((entry) => [
      entry.driverProfileId,
      entry.driverProfile.character.name,
    ]),
  );
  const teamByName = new Map(
    entries.map((entry) => [entry.driverProfileId, entry.team?.name ?? null]),
  );

  const contenders = entries.map((entry) => {
    const attrs = attrsByDriver.get(entry.driverProfileId) ?? {
      speed: 50,
      consistency: 50,
    };
    const perf = perfByTeam.get(entry.teamId ?? "") ?? { carSpeed: 50 };
    return {
      driverProfileId: entry.driverProfileId,
      carSpeed: perf.carSpeed,
      speed: attrs.speed,
      consistency: attrs.consistency,
    };
  });

  const seed = hashString(`${race.id}:${race.seasonId}`);
  const grid = simulateQualifying(contenders, seed);

  const run: QualifyingRunEntry[] = grid.map((row) => ({
    ...row,
    driverName: nameByDriver.get(row.driverProfileId) ?? "Desconhecido",
    teamName: teamByName.get(row.driverProfileId) ?? null,
  }));

  for (const row of run) {
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
        grid: row.grid,
      },
      update: { grid: row.grid },
      select: { id: true, grid: true },
    });
  }

  if (race.status === "UPCOMING") {
    await db.race.update({
      where: { id: raceId },
      data: { status: "QUALIFYING" },
    });
  }

  return run;
}