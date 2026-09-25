import type { PrismaClient } from "@prisma/client";

type Db = Pick<
  PrismaClient,
  | "universe"
  | "driverEntryEvent"
  | "seasonDriverEntry"
  | "raceResult"
  | "championshipStanding"
  | "race"
  | "season"
  | "team"
  | "character"
>;

export async function deleteUniverseDataForUsers(
  db: Db,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  const universes = await db.universe.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const universeIds = universes.map((universe) => universe.id);
  if (universeIds.length === 0) return;

  await db.driverEntryEvent.deleteMany({
    where: { entry: { season: { universeId: { in: universeIds } } } },
  });
  await db.seasonDriverEntry.deleteMany({
    where: { season: { universeId: { in: universeIds } } },
  });
  await db.raceResult.deleteMany({
    where: { race: { season: { universeId: { in: universeIds } } } },
  });
  await db.championshipStanding.deleteMany({
    where: { season: { universeId: { in: universeIds } } },
  });
  await db.race.deleteMany({
    where: { season: { universeId: { in: universeIds } } },
  });
  await db.season.deleteMany({ where: { universeId: { in: universeIds } } });
  await db.team.deleteMany({ where: { universeId: { in: universeIds } } });
  await db.character.deleteMany({ where: { universeId: { in: universeIds } } });
}
