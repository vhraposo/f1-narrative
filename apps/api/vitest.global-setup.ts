import { PrismaClient } from "@prisma/client";

const TEST_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/f1_narrative_test?schema=public";

const FIXTURE_EMAIL_FILTER = {
  OR: [{ email: { endsWith: "@f1nw.test" } }, { email: { endsWith: "@test.dev" } }],
} as const;

export async function setup(): Promise<void> {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
}

export async function teardown(): Promise<void> {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.findMany({
      where: FIXTURE_EMAIL_FILTER,
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);

    if (userIds.length > 0) {
      const universes = await prisma.universe.findMany({
        where: { userId: { in: userIds } },
        select: { id: true },
      });
      const universeIds = universes.map((universe) => universe.id);
      if (universeIds.length > 0) {
        await prisma.driverEntryEvent.deleteMany({
          where: { entry: { season: { universeId: { in: universeIds } } } },
        });
        await prisma.seasonDriverEntry.deleteMany({
          where: { season: { universeId: { in: universeIds } } },
        });
        await prisma.raceSessionResult.deleteMany({
          where: { race: { season: { universeId: { in: universeIds } } } },
        });
        await prisma.raceResult.deleteMany({
          where: { race: { season: { universeId: { in: universeIds } } } },
        });
        await prisma.championshipStanding.deleteMany({
          where: { season: { universeId: { in: universeIds } } },
        });
        await prisma.driverAttribute.deleteMany({
          where: { season: { universeId: { in: universeIds } } },
        });
        await prisma.teamPerformance.deleteMany({
          where: { season: { universeId: { in: universeIds } } },
        });
        await prisma.race.deleteMany({
          where: { season: { universeId: { in: universeIds } } },
        });
        await prisma.season.deleteMany({ where: { universeId: { in: universeIds } } });
        await prisma.team.deleteMany({ where: { universeId: { in: universeIds } } });
        await prisma.character.deleteMany({ where: { universeId: { in: universeIds } } });
        await prisma.worldState.deleteMany({ where: { universeId: { in: universeIds } } });
        await prisma.universe.deleteMany({ where: { id: { in: universeIds } } });
      }
      await prisma.character.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }

    await prisma.memory.deleteMany({ where: { participants: { none: {} } } });
    await prisma.pilotExperience.deleteMany({
      where: { status: "INVALIDATED", memories: { none: {} } },
    });

    const remainingUsers = await prisma.user.count({ where: FIXTURE_EMAIL_FILTER });
    const remainingMemories = await prisma.memory.count({
      where: { participants: { none: {} } },
    });
    if (remainingUsers > 0 || remainingMemories > 0) {
      console.warn(
        `[test-teardown] resíduo remanescente: users=${remainingUsers} orphanMemories=${remainingMemories}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}
