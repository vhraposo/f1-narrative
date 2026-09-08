import type { Prisma } from "@prisma/client";
import { computeContentHash } from "./jolpica.hash.js";
import type {
  NormalizedDriver,
  NormalizedDriverSeason,
  NormalizedRace,
  NormalizedResult,
  NormalizedSeason,
  NormalizedStanding,
  NormalizedTeam,
  NormalizedWithSource,
} from "./jolpica.normalizer.js";

export interface PersistResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
}

export const EMPTY_PERSIST_RESULT: PersistResult = {
  created: 0,
  updated: 0,
  unchanged: 0,
  skipped: 0,
};

export function mergePersistResults(results: PersistResult[]): PersistResult {
  return results.reduce<PersistResult>(
    (acc, result) => ({
      created: acc.created + result.created,
      updated: acc.updated + result.updated,
      unchanged: acc.unchanged + result.unchanged,
      skipped: acc.skipped + result.skipped,
    }),
    { ...EMPTY_PERSIST_RESULT },
  );
}

type Tx = Prisma.TransactionClient;

export async function persistSeasons(
  tx: Tx,
  source: string,
  items: NormalizedWithSource<NormalizedSeason>[],
  now: Date,
): Promise<PersistResult> {
  const result = { ...EMPTY_PERSIST_RESULT };
  for (const item of items) {
    const hash = computeContentHash(item.data);
    const existing = await tx.externalSeason.findUnique({
      where: { source_year: { source, year: item.data.year } },
      select: { id: true, contentHash: true },
    });
    if (!existing) {
      await tx.externalSeason.create({
        data: {
          source,
          year: item.data.year,
          name: item.data.name,
          status: item.data.status,
          contentHash: hash,
          sourceRecord: item.sourceRecord as Prisma.InputJsonValue,
        },
      });
      result.created += 1;
    } else if (existing.contentHash !== hash) {
      await tx.externalSeason.update({
        where: { id: existing.id },
        data: {
          name: item.data.name,
          status: item.data.status,
          contentHash: hash,
          sourceRecord: item.sourceRecord as Prisma.InputJsonValue,
          lastSyncedAt: now,
        },
      });
      result.updated += 1;
    } else {
      await tx.externalSeason.update({
        where: { id: existing.id },
        data: { lastSyncedAt: now },
      });
      result.unchanged += 1;
    }
  }
  return result;
}

export async function persistTeams(
  tx: Tx,
  source: string,
  items: NormalizedWithSource<NormalizedTeam>[],
  now: Date,
): Promise<PersistResult> {
  const result = { ...EMPTY_PERSIST_RESULT };
  for (const item of items) {
    const hash = computeContentHash(item.data);
    const existing = await tx.externalTeam.findUnique({
      where: { source_externalId: { source, externalId: item.data.externalId } },
      select: { id: true, contentHash: true },
    });
    if (!existing) {
      await tx.externalTeam.create({
        data: {
          source,
          externalId: item.data.externalId,
          name: item.data.name,
          shortName: item.data.shortName,
          color: item.data.color,
          contentHash: hash,
          sourceRecord: item.sourceRecord as Prisma.InputJsonValue,
        },
      });
      result.created += 1;
    } else if (existing.contentHash !== hash) {
      await tx.externalTeam.update({
        where: { id: existing.id },
        data: {
          name: item.data.name,
          shortName: item.data.shortName,
          color: item.data.color,
          contentHash: hash,
          sourceRecord: item.sourceRecord as Prisma.InputJsonValue,
          lastSyncedAt: now,
        },
      });
      result.updated += 1;
    } else {
      await tx.externalTeam.update({
        where: { id: existing.id },
        data: { lastSyncedAt: now },
      });
      result.unchanged += 1;
    }
  }
  return result;
}

export async function persistDrivers(
  tx: Tx,
  source: string,
  items: NormalizedWithSource<NormalizedDriver>[],
  now: Date,
): Promise<PersistResult> {
  const result = { ...EMPTY_PERSIST_RESULT };
  for (const item of items) {
    const hash = computeContentHash(item.data);
    const existing = await tx.externalDriver.findUnique({
      where: { source_externalId: { source, externalId: item.data.externalId } },
      select: { id: true, contentHash: true },
    });
    if (!existing) {
      await tx.externalDriver.create({
        data: {
          source,
          externalId: item.data.externalId,
          name: item.data.name,
          fullName: item.data.fullName,
          nationality: item.data.nationality,
          number: item.data.number,
          contentHash: hash,
          sourceRecord: item.sourceRecord as Prisma.InputJsonValue,
        },
      });
      result.created += 1;
    } else if (existing.contentHash !== hash) {
      await tx.externalDriver.update({
        where: { id: existing.id },
        data: {
          name: item.data.name,
          fullName: item.data.fullName,
          nationality: item.data.nationality,
          number: item.data.number,
          contentHash: hash,
          sourceRecord: item.sourceRecord as Prisma.InputJsonValue,
          lastSyncedAt: now,
        },
      });
      result.updated += 1;
    } else {
      await tx.externalDriver.update({
        where: { id: existing.id },
        data: { lastSyncedAt: now },
      });
      result.unchanged += 1;
    }
  }
  return result;
}

export async function persistDriverSeasons(
  tx: Tx,
  source: string,
  items: NormalizedWithSource<NormalizedDriverSeason>[],
  now: Date,
): Promise<PersistResult> {
  const result = { ...EMPTY_PERSIST_RESULT };
  for (const item of items) {
    const hash = computeContentHash(item.data);
    const driver = await tx.externalDriver.findUnique({
      where: {
        source_externalId: { source, externalId: item.data.driverExternalId },
      },
      select: { id: true },
    });
    if (!driver) {
      result.skipped += 1;
      continue;
    }
    const existing = await tx.externalDriverSeason.findUnique({
      where: {
        source_externalDriverId_seasonYear: {
          source,
          externalDriverId: driver.id,
          seasonYear: item.data.seasonYear,
        },
      },
      select: { id: true, contentHash: true },
    });
    if (!existing) {
      await tx.externalDriverSeason.create({
        data: {
          source,
          externalDriverId: driver.id,
          seasonYear: item.data.seasonYear,
          teamExternalId: item.data.teamExternalId,
          teamNameSnapshot: item.data.teamNameSnapshot,
          number: item.data.number,
          role: item.data.role,
          contentHash: hash,
          sourceRecord: item.sourceRecord as Prisma.InputJsonValue,
        },
      });
      result.created += 1;
    } else if (existing.contentHash !== hash) {
      await tx.externalDriverSeason.update({
        where: { id: existing.id },
        data: {
          teamExternalId: item.data.teamExternalId,
          teamNameSnapshot: item.data.teamNameSnapshot,
          number: item.data.number,
          role: item.data.role,
          contentHash: hash,
          sourceRecord: item.sourceRecord as Prisma.InputJsonValue,
          lastSyncedAt: now,
        },
      });
      result.updated += 1;
    } else {
      await tx.externalDriverSeason.update({
        where: { id: existing.id },
        data: { lastSyncedAt: now },
      });
      result.unchanged += 1;
    }
  }
  return result;
}

export async function persistRaces(
  tx: Tx,
  source: string,
  items: NormalizedWithSource<NormalizedRace>[],
  now: Date,
): Promise<PersistResult> {
  const result = { ...EMPTY_PERSIST_RESULT };
  for (const item of items) {
    const hash = computeContentHash(item.data);
    const existing = await tx.externalRace.findUnique({
      where: {
        source_seasonYear_round: {
          source,
          seasonYear: item.data.seasonYear,
          round: item.data.round,
        },
      },
      select: { id: true, contentHash: true },
    });
    if (!existing) {
      await tx.externalRace.create({
        data: {
          source,
          seasonYear: item.data.seasonYear,
          round: item.data.round,
          grandPrix: item.data.grandPrix,
          name: item.data.name,
          circuitName: item.data.circuitName,
          date: item.data.date,
          status: item.data.status,
          contentHash: hash,
          sourceRecord: item.sourceRecord as Prisma.InputJsonValue,
        },
      });
      result.created += 1;
    } else if (existing.contentHash !== hash) {
      await tx.externalRace.update({
        where: { id: existing.id },
        data: {
          grandPrix: item.data.grandPrix,
          name: item.data.name,
          circuitName: item.data.circuitName,
          date: item.data.date,
          status: item.data.status,
          contentHash: hash,
          sourceRecord: item.sourceRecord as Prisma.InputJsonValue,
          lastSyncedAt: now,
        },
      });
      result.updated += 1;
    } else {
      await tx.externalRace.update({
        where: { id: existing.id },
        data: { lastSyncedAt: now },
      });
      result.unchanged += 1;
    }
  }
  return result;
}

export async function persistResults(
  tx: Tx,
  source: string,
  items: NormalizedWithSource<NormalizedResult>[],
  now: Date,
): Promise<PersistResult> {
  const result = { ...EMPTY_PERSIST_RESULT };
  for (const item of items) {
    const hash = computeContentHash(item.data);
    const race = await tx.externalRace.findUnique({
      where: {
        source_seasonYear_round: {
          source,
          seasonYear: item.data.seasonYear,
          round: item.data.round,
        },
      },
      select: { id: true },
    });
    if (!race) {
      result.skipped += 1;
      continue;
    }
    const driver = await tx.externalDriver.findUnique({
      where: {
        source_externalId: { source, externalId: item.data.driverExternalId },
      },
      select: { id: true },
    });
    if (!driver) {
      result.skipped += 1;
      continue;
    }
    const existing = await tx.externalResult.findUnique({
      where: {
        source_externalRaceId_externalDriverId: {
          source,
          externalRaceId: race.id,
          externalDriverId: driver.id,
        },
      },
      select: { id: true, contentHash: true },
    });
    if (!existing) {
      await tx.externalResult.create({
        data: {
          source,
          externalRaceId: race.id,
          externalDriverId: driver.id,
          position: item.data.position,
          points: item.data.points,
          grid: item.data.grid,
          fastestLap: item.data.fastestLap,
          status: item.data.status,
          contentHash: hash,
          sourceRecord: item.sourceRecord as Prisma.InputJsonValue,
        },
      });
      result.created += 1;
    } else if (existing.contentHash !== hash) {
      await tx.externalResult.update({
        where: { id: existing.id },
        data: {
          position: item.data.position,
          points: item.data.points,
          grid: item.data.grid,
          fastestLap: item.data.fastestLap,
          status: item.data.status,
          contentHash: hash,
          sourceRecord: item.sourceRecord as Prisma.InputJsonValue,
          lastSyncedAt: now,
        },
      });
      result.updated += 1;
    } else {
      await tx.externalResult.update({
        where: { id: existing.id },
        data: { lastSyncedAt: now },
      });
      result.unchanged += 1;
    }
  }
  return result;
}

export async function persistStandings(
  tx: Tx,
  source: string,
  items: NormalizedWithSource<NormalizedStanding>[],
  now: Date,
): Promise<PersistResult> {
  const result = { ...EMPTY_PERSIST_RESULT };
  for (const item of items) {
    const hash = computeContentHash(item.data);
    const driver = await tx.externalDriver.findUnique({
      where: {
        source_externalId: { source, externalId: item.data.driverExternalId },
      },
      select: { id: true },
    });
    if (!driver) {
      result.skipped += 1;
      continue;
    }
    const existing = await tx.externalStanding.findUnique({
      where: {
        source_seasonYear_externalDriverId: {
          source,
          seasonYear: item.data.seasonYear,
          externalDriverId: driver.id,
        },
      },
      select: { id: true, contentHash: true },
    });
    if (!existing) {
      await tx.externalStanding.create({
        data: {
          source,
          seasonYear: item.data.seasonYear,
          externalDriverId: driver.id,
          position: item.data.position,
          points: item.data.points,
          wins: item.data.wins,
          podiums: item.data.podiums,
          contentHash: hash,
          sourceRecord: item.sourceRecord as Prisma.InputJsonValue,
        },
      });
      result.created += 1;
    } else if (existing.contentHash !== hash) {
      await tx.externalStanding.update({
        where: { id: existing.id },
        data: {
          position: item.data.position,
          points: item.data.points,
          wins: item.data.wins,
          podiums: item.data.podiums,
          contentHash: hash,
          sourceRecord: item.sourceRecord as Prisma.InputJsonValue,
          lastSyncedAt: now,
        },
      });
      result.updated += 1;
    } else {
      await tx.externalStanding.update({
        where: { id: existing.id },
        data: { lastSyncedAt: now },
      });
      result.unchanged += 1;
    }
  }
  return result;
}