import type { Prisma } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { getF1dbDataset } from "../f1db/f1db.dataset.js";
import {
  computeF1dbDriverMilestones,
  getF1dbDriverStats,
  resolveF1dbDriver,
} from "../f1db/f1db.drivers.js";
import { deriveMilestonesFromExternalData } from "./pilot-knowledge.events.js";
import {
  readDriverSourceIdentity,
  upsertDriverProfileFromProvider,
  type StructuredDriverProfileInput,
} from "./pilot-knowledge.profile.js";
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

type MirrorDriver = {
  readonly name: string;
  readonly fullName: string | null;
  readonly nationality: string | null;
  readonly number: number | null;
  readonly sourceRecord: Prisma.JsonValue | null;
};

async function collectMirrorCareer(externalDriverId: string) {
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
  return {
    teams,
    championships,
    currentTeamName: lastSeason?.teamNameSnapshot ?? null,
    driverNumber: lastSeason?.number ?? null,
    debutYear: seasons[0]?.seasonYear ?? null,
  };
}

function topMilestoneTitles(
  milestones: readonly { title: string; importance: number; seasonYear: number | null }[],
): string[] {
  return [...milestones]
    .sort((a, b) => b.importance - a.importance || (a.seasonYear ?? 0) - (b.seasonYear ?? 0))
    .slice(0, 3)
    .map((event) => event.title);
}

async function buildMirrorProfileInput(
  externalDriverId: string,
  driver: MirrorDriver,
  sourceId: string | null,
  now: Date,
): Promise<StructuredDriverProfileInput> {
  const [career, milestones] = await Promise.all([
    collectMirrorCareer(externalDriverId),
    deriveMilestonesFromExternalData(externalDriverId, now),
  ]);
  const sourceIdentity = readDriverSourceIdentity(driver.sourceRecord);

  const dataset = getF1dbDataset();
  const f1dbDriver = dataset
    ? resolveF1dbDriver({ name: driver.name, driverCode: sourceIdentity.driverCode })
    : null;
  const f1dbMilestones = f1dbDriver
    ? computeF1dbDriverMilestones(f1dbDriver.id)
    : null;
  const f1dbStats = f1dbDriver ? getF1dbDriverStats(f1dbDriver) : null;

  const debutYears = [
    career.debutYear,
    f1dbMilestones?.debut?.year ?? null,
  ].filter((year): year is number => typeof year === "number");
  const championships = [
    ...new Set([...career.championships, ...(f1dbMilestones?.championshipYears ?? [])]),
  ].sort((a, b) => a - b);
  const dateOfBirth = sourceIdentity.dateOfBirth ?? (f1dbDriver?.dateOfBirth
    ? new Date(`${f1dbDriver.dateOfBirth}T00:00:00.000Z`)
    : null);
  const driverCode = sourceIdentity.driverCode ?? f1dbDriver?.abbreviation ?? null;

  return {
    fullName: driver.fullName,
    publicName: driver.name,
    dateOfBirth,
    placeOfBirth: f1dbDriver?.placeOfBirth ?? null,
    driverCode,
    nationality: driver.nationality,
    driverNumber: career.driverNumber ?? driver.number ?? null,
    currentTeamName: career.currentTeamName,
    sourceId,
    biographyFacts: {
      publicName: driver.name,
      fullName: driver.fullName,
      dateOfBirth,
      placeOfBirth: f1dbDriver?.placeOfBirth ?? null,
      nationality: driver.nationality,
      debutYear: debutYears.length > 0 ? Math.min(...debutYears) : null,
      teams: career.teams,
      championships,
      milestoneTitles: topMilestoneTitles(milestones),
      career: f1dbStats
        ? {
            wins: f1dbStats.wins,
            podiums: f1dbStats.podiums,
            poles: f1dbStats.poles,
            fastestLaps: f1dbStats.fastestLaps,
            titles: f1dbStats.titles,
            starts: f1dbStats.starts,
          }
        : null,
    },
  };
}

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
    select: {
      id: true,
      name: true,
      fullName: true,
      nationality: true,
      number: true,
      sourceRecord: true,
    },
  });
  if (!driver) return { outcome: "DRIVER_NOT_FOUND", externalDriverId };

  const existingProfile = await prisma.externalDriverProfile.findUnique({
    where: { externalDriverId },
    select: { id: true, biographySourceId: true, sourceId: true },
  });

  if (existingProfile) {
    const biographySource = existingProfile.biographySourceId
      ? await prisma.externalKnowledgeSource.findUnique({
          where: { id: existingProfile.biographySourceId },
          select: { provider: true },
        })
      : null;
    const ownedByMirror = biographySource === null || biographySource.provider === "CURATED";
    if (ownedByMirror) {
      const input = await buildMirrorProfileInput(
        externalDriverId,
        driver,
        existingProfile.biographySourceId ?? existingProfile.sourceId ?? null,
        now,
      );
      await upsertDriverProfileFromProvider(externalDriverId, input, now);
    } else {
      await deriveMilestonesFromExternalData(externalDriverId, now);
    }
    return { outcome: "ALREADY_PROVISIONED", externalDriverId };
  }

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

  const input = await buildMirrorProfileInput(externalDriverId, driver, source.id, now);
  await upsertDriverProfileFromProvider(externalDriverId, input, now);

  return { outcome: "PROVISIONED", externalDriverId };
}
