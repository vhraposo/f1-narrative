import type { Prisma } from "@prisma/client";
import {
  aggregateStandings,
  pointsForPosition,
  sprintPointsByDriver,
  type SprintEligibility,
} from "./championship-progression.engine.js";

type Tx = Prisma.TransactionClient;

function readEligibility(metadata: unknown): SprintEligibility | null {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const eligibility = (metadata as Record<string, unknown>).eligibility;
  if (
    eligibility === null ||
    typeof eligibility !== "object" ||
    Array.isArray(eligibility)
  ) {
    return null;
  }
  const record = eligibility as Record<string, unknown>;
  if (
    typeof record.neutralizedStart !== "boolean" ||
    typeof record.distancePct !== "number"
  ) {
    return null;
  }
  return {
    neutralizedStart: record.neutralizedStart,
    distancePct: record.distancePct,
  };
}

export async function recomputeSeasonStandings(
  tx: Tx,
  seasonId: string,
): Promise<void> {
  const [results, sprintRows] = await Promise.all([
    tx.raceResult.findMany({
      where: { race: { seasonId } },
      select: {
        raceId: true,
        driverProfileId: true,
        position: true,
        driverProfile: {
          select: {
            teamId: true,
            character: { select: { name: true } },
          },
        },
      },
      orderBy: [{ raceId: "asc" }, { driverProfileId: "asc" }],
    }),
    tx.raceSessionResult.findMany({
      where: { race: { seasonId }, session: "SPRINT" },
      select: {
        raceId: true,
        driverProfileId: true,
        position: true,
        teamId: true,
        metadata: true,
        driverProfile: {
          select: {
            teamId: true,
            character: { select: { name: true } },
          },
        },
      },
      orderBy: [{ raceId: "asc" }, { driverProfileId: "asc" }],
    }),
  ]);

  for (const result of results) {
    const points = pointsForPosition(result.position);
    await tx.raceResult.updateMany({
      where: { raceId: result.raceId, driverProfileId: result.driverProfileId },
      data: { points },
    });
  }

  const sprintPoints = sprintPointsByDriver(
    sprintRows.map((row) => ({
      driverProfileId: row.driverProfileId,
      position: row.position,
      eligibility: readEligibility(row.metadata),
    })),
  );
  for (const row of sprintRows) {
    const points = sprintPoints.get(row.driverProfileId) ?? 0;
    await tx.raceSessionResult.updateMany({
      where: {
        raceId: row.raceId,
        driverProfileId: row.driverProfileId,
        session: "SPRINT",
      },
      data: { points },
    });
  }

  const aggregates = aggregateStandings([
    ...results.map((result) => ({
      driverProfileId: result.driverProfileId,
      position: result.position,
      driverName: result.driverProfile.character.name,
      teamId: result.driverProfile.teamId,
    })),
    ...sprintRows.map((row) => ({
      driverProfileId: row.driverProfileId,
      position: null,
      driverName: row.driverProfile.character.name,
      teamId: row.teamId ?? row.driverProfile.teamId,
      extraPoints: sprintPoints.get(row.driverProfileId) ?? 0,
    })),
  ]);

  const standings = aggregates.map((entry, index) => ({
    seasonId,
    driverProfileId: entry.driverProfileId,
    points: entry.points,
    wins: entry.wins,
    podiums: entry.podiums,
    position: index + 1,
  }));

  for (const standing of standings) {
    await tx.championshipStanding.upsert({
      where: {
        seasonId_driverProfileId: {
          seasonId: standing.seasonId,
          driverProfileId: standing.driverProfileId,
        },
      },
      create: standing,
      update: {
        points: standing.points,
        wins: standing.wins,
        podiums: standing.podiums,
        position: standing.position,
      },
    });
  }

  if (standings.length > 0) {
    await tx.championshipStanding.deleteMany({
      where: {
        seasonId,
        driverProfileId: { notIn: standings.map((s) => s.driverProfileId) },
      },
    });
  }
}
