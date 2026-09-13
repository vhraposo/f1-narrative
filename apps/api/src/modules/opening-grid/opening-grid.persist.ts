import type { Prisma } from "@prisma/client";
import { OPENING_GRID_SOURCE, type NormalizedOpeningGridClaim } from "./opening-grid.source.js";

export interface ClaimsPersistResult {
  created: number;
  updated: number;
  unchanged: number;
}

const EMPTY_RESULT: ClaimsPersistResult = { created: 0, updated: 0, unchanged: 0 };

function fnv1a(payload: string): string {
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return String(hash >>> 0);
}

export function claimsContentHash(claim: NormalizedOpeningGridClaim): string {
  return fnv1a(
    JSON.stringify({
      driverExternalId: claim.driverExternalId,
      driverName: claim.driverName,
      driverNumber: claim.driverNumber,
      teamExternalId: claim.teamExternalId,
      teamName: claim.teamName,
      role: claim.role,
    }),
  );
}

type Tx = Prisma.TransactionClient;

function mergeResults(base: ClaimsPersistResult, delta: ClaimsPersistResult): ClaimsPersistResult {
  return {
    created: base.created + delta.created,
    updated: base.updated + delta.updated,
    unchanged: base.unchanged + delta.unchanged,
  };
}

export async function persistOpeningGridClaims(
  tx: Tx,
  claims: NormalizedOpeningGridClaim[],
  now: Date = new Date(),
): Promise<ClaimsPersistResult> {
  if (claims.length === 0) return { ...EMPTY_RESULT };
  let result: ClaimsPersistResult = { ...EMPTY_RESULT };

  const year = claims[0].seasonYear;
  const driverSeeds = unique(claims, (claim) => claim.driverExternalId);
  const teamSeeds = unique(claims, (claim) => claim.teamExternalId);

  result = mergeResults(result, await persistSeason(tx, OPENING_GRID_SOURCE, year, now));

  for (const team of teamSeeds) {
    result = mergeResults(
      result,
      await persistTeam(tx, OPENING_GRID_SOURCE, team, now),
    );
  }

  for (const driver of driverSeeds) {
    result = mergeResults(
      result,
      await persistDriver(tx, OPENING_GRID_SOURCE, driver, now),
    );
  }

  for (const claim of claims) {
    result = mergeResults(result, await persistClaim(tx, OPENING_GRID_SOURCE, claim, now));
  }

  return result;
}

function unique<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

async function persistSeason(
  tx: Tx,
  source: string,
  year: number,
  now: Date,
): Promise<ClaimsPersistResult> {
  const hash = fnv1a(JSON.stringify({ source, year }));
  const existing = await tx.externalSeason.findUnique({
    where: { source_year: { source, year } },
    select: { id: true, contentHash: true },
  });
  if (!existing) {
    await tx.externalSeason.create({
      data: { source, year, name: String(year), status: "ACTIVE", contentHash: hash },
    });
    return { created: 1, updated: 0, unchanged: 0 };
  }
  if (existing.contentHash !== hash) {
    await tx.externalSeason.update({
      where: { id: existing.id },
      data: { name: String(year), status: "ACTIVE", contentHash: hash, lastSyncedAt: now },
    });
    return { created: 0, updated: 1, unchanged: 0 };
  }
  return { created: 0, updated: 0, unchanged: 1 };
}

async function persistTeam(
  tx: Tx,
  source: string,
  claim: NormalizedOpeningGridClaim,
  now: Date,
): Promise<ClaimsPersistResult> {
  const name = claim.teamName;
  const shortName = claim.teamShortName;
  const color = claim.teamColor;
  const hash = fnv1a(JSON.stringify({ name, shortName, color }));
  const existing = await tx.externalTeam.findUnique({
    where: { source_externalId: { source, externalId: claim.teamExternalId } },
    select: { id: true, contentHash: true },
  });
  if (!existing) {
    await tx.externalTeam.create({
      data: {
        source,
        externalId: claim.teamExternalId,
        name,
        shortName,
        color,
        contentHash: hash,
      },
    });
    return { created: 1, updated: 0, unchanged: 0 };
  }
  if (existing.contentHash !== hash) {
    await tx.externalTeam.update({
      where: { id: existing.id },
      data: { name, shortName, color, contentHash: hash, lastSyncedAt: now },
    });
    return { created: 0, updated: 1, unchanged: 0 };
  }
  return { created: 0, updated: 0, unchanged: 1 };
}

async function persistDriver(
  tx: Tx,
  source: string,
  claim: NormalizedOpeningGridClaim,
  now: Date,
): Promise<ClaimsPersistResult> {
  const name = claim.driverName;
  const fullName = claim.driverFullName;
  const nationality = claim.driverNationality;
  const number = claim.driverNumber;
  const hash = fnv1a(JSON.stringify({ name, fullName, nationality, number }));
  const existing = await tx.externalDriver.findUnique({
    where: { source_externalId: { source, externalId: claim.driverExternalId } },
    select: { id: true, contentHash: true },
  });
  if (!existing) {
    await tx.externalDriver.create({
      data: { source, externalId: claim.driverExternalId, name, fullName, nationality, number, contentHash: hash },
    });
    return { created: 1, updated: 0, unchanged: 0 };
  }
  if (existing.contentHash !== hash) {
    await tx.externalDriver.update({
      where: { id: existing.id },
      data: { name, fullName, nationality, number, contentHash: hash, lastSyncedAt: now },
    });
    return { created: 0, updated: 1, unchanged: 0 };
  }
  return { created: 0, updated: 0, unchanged: 1 };
}

async function persistClaim(
  tx: Tx,
  source: string,
  claim: NormalizedOpeningGridClaim,
  now: Date,
): Promise<ClaimsPersistResult> {
  const hash = claimsContentHash(claim);
  const driver = await tx.externalDriver.findUnique({
    where: { source_externalId: { source, externalId: claim.driverExternalId } },
    select: { id: true },
  });
  if (!driver) {
    return { created: 0, updated: 0, unchanged: 0 };
  }
  const existing = await tx.externalDriverSeason.findUnique({
    where: {
      source_externalDriverId_seasonYear: {
        source,
        externalDriverId: driver.id,
        seasonYear: claim.seasonYear,
      },
    },
    select: { id: true, contentHash: true },
  });
  if (!existing) {
    await tx.externalDriverSeason.create({
      data: {
        source,
        externalDriverId: driver.id,
        seasonYear: claim.seasonYear,
        teamExternalId: claim.teamExternalId,
        teamNameSnapshot: claim.teamName,
        number: claim.driverNumber,
        role: claim.role,
        contentHash: hash,
      },
    });
    return { created: 1, updated: 0, unchanged: 0 };
  }
  if (existing.contentHash !== hash) {
    await tx.externalDriverSeason.update({
      where: { id: existing.id },
      data: {
        teamExternalId: claim.teamExternalId,
        teamNameSnapshot: claim.teamName,
        number: claim.driverNumber,
        role: claim.role,
        contentHash: hash,
        lastSyncedAt: now,
      },
    });
    return { created: 0, updated: 1, unchanged: 0 };
  }
  return { created: 0, updated: 0, unchanged: 1 };
}