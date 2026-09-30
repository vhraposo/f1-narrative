import { prisma } from "../../infrastructure/database/prisma.js";
import { deriveMilestonesFromExternalData } from "./pilot-knowledge.events.js";
import { upsertDriverProfileFromProvider } from "./pilot-knowledge.profile.js";
import { recordKnowledgeSource } from "./pilot-knowledge.sources.js";

export type ProvisionOutcome =
  | "PROVISIONED"
  | "ALREADY_PROVISIONED"
  | "NO_EXTERNAL_BINDING"
  | "DRIVER_NOT_FOUND";

export type ProvisionResult = {
  readonly outcome: ProvisionOutcome;
  readonly externalDriverId: string | null;
};

export async function ensurePilotKnowledgeProvisioned(
  characterId: string,
  now: Date = new Date(),
): Promise<ProvisionResult> {
  const binding = await prisma.externalBindingDriver.findFirst({
    where: { characterId },
    orderBy: { createdAt: "asc" },
    select: { externalDriverId: true },
  });
  if (!binding) return { outcome: "NO_EXTERNAL_BINDING", externalDriverId: null };

  const externalDriverId = binding.externalDriverId;
  const driver = await prisma.externalDriver.findUnique({
    where: { id: externalDriverId },
    select: { id: true, name: true, fullName: true, nationality: true, number: true },
  });
  if (!driver) return { outcome: "DRIVER_NOT_FOUND", externalDriverId };

  const existingProfile = await prisma.externalDriverProfile.findUnique({
    where: { externalDriverId },
    select: { id: true },
  });

  if (existingProfile) {
    await deriveMilestonesFromExternalData(externalDriverId, now);
    return { outcome: "ALREADY_PROVISIONED", externalDriverId };
  }

  const [seasons, titles] = await Promise.all([
    prisma.externalDriverSeason.findMany({
      where: { externalDriverId },
      orderBy: [{ seasonYear: "asc" }],
      select: { seasonYear: true, teamNameSnapshot: true, number: true },
    }),
    prisma.externalStanding.findMany({
      where: { externalDriverId, position: 1 },
      orderBy: [{ seasonYear: "asc" }],
      select: { seasonYear: true },
    }),
  ]);

  const teams = [...new Set(seasons.map((season) => season.teamNameSnapshot).filter(Boolean))] as string[];
  const championships = titles.map((title) => title.seasonYear);
  const lastSeason = seasons[seasons.length - 1] ?? null;
  const currentTeamName = lastSeason?.teamNameSnapshot ?? null;
  const driverNumber = lastSeason?.number ?? driver.number ?? null;

  const source = await recordKnowledgeSource(
    {
      provider: "CURATED",
      sourceKind: "DATABASE_EXPORT",
      url: null,
      title: "Espelho externo sincronizado (Jolpica)",
      license: "UNKNOWN",
      attributionRequirement: null,
      attributionText: "Dados do espelho externo do próprio sistema",
      metadata: { origin: "jolpica-mirror" },
    },
    now,
  );

  await upsertDriverProfileFromProvider(
    externalDriverId,
    {
      fullName: driver.fullName,
      publicName: driver.name,
      nationality: driver.nationality,
      driverNumber,
      currentTeamName,
      sourceId: source.id,
      biographyFacts: {
        publicName: driver.name,
        fullName: driver.fullName,
        nationality: driver.nationality,
        teams,
        championships,
      },
    },
    now,
  );

  await deriveMilestonesFromExternalData(externalDriverId, now);

  return { outcome: "PROVISIONED", externalDriverId };
}
