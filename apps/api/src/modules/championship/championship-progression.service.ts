import type { Prisma } from "@prisma/client";
import {
  aggregateStandings,
  pointsForPosition,
} from "./championship-progression.engine.js";

type Tx = Prisma.TransactionClient;

export async function recomputeSeasonStandings(
  tx: Tx,
  seasonId: string,
): Promise<void> {
  const results = await tx.raceResult.findMany({
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
  });

  for (const result of results) {
    const points = pointsForPosition(result.position);
    await tx.raceResult.updateMany({
      where: { raceId: result.raceId, driverProfileId: result.driverProfileId },
      data: { points },
    });
  }

  const aggregates = aggregateStandings(
    results.map((result) => ({
      driverProfileId: result.driverProfileId,
      position: result.position,
      driverName: result.driverProfile.character.name,
      teamId: result.driverProfile.teamId,
    })),
  );

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
