import type { PrismaClient } from "@prisma/client";

type Db = Pick<PrismaClient, "externalKnowledgeSource">;

export async function deleteKnowledgeSourcesForDrivers(
  db: Db,
  driverIds: string[],
): Promise<void> {
  if (driverIds.length === 0) return;
  const sources = await db.externalKnowledgeSource.findMany({
    where: {
      OR: [
        { driverProfiles: { some: { externalDriverId: { in: driverIds } } } },
        { personaEvidences: { some: { persona: { profile: { externalDriverId: { in: driverIds } } } } } },
        { driverRelationships: { some: { externalDriverId: { in: driverIds } } } },
        { driverEvents: { some: { externalDriverId: { in: driverIds } } } },
      ],
    },
    select: { id: true },
  });
  if (sources.length === 0) return;
  await db.externalKnowledgeSource.deleteMany({
    where: { id: { in: sources.map((source) => source.id) } },
  });
}
