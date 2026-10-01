import { createHash } from "node:crypto";

import type { ExternalDriver, ExternalKnowledgeProvider, PrismaClient } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { PilotKnowledgeError } from "./pilot-knowledge.access.js";
import type { DriverIdentityQuery, ProviderIdentityCandidate } from "./providers/provider.types.js";

export type IdentityBasis = "PROVIDER_ID" | "WIKIDATA_QID" | "NAME_NATIONALITY" | "NAME_ONLY";

export type IdentityResolution =
  | {
      readonly kind: "RESOLVED";
      readonly driverId: string;
      readonly basis: IdentityBasis;
      readonly score: number;
    }
  | {
      readonly kind: "AMBIGUOUS_IDENTITY";
      readonly candidates: ReadonlyArray<{
        readonly driverId: string;
        readonly name: string;
        readonly score: number;
      }>;
    }
  | { readonly kind: "NOT_FOUND" };

export function normalizeIdentityName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(normalizeIdentityName(value).split(" ").filter((token) => token.length > 0));
}

export function identityMatchScore(
  query: DriverIdentityQuery,
  driver: Pick<ExternalDriver, "name" | "fullName" | "nationality" | "number">,
  dateOfBirth: Date | null,
): number {
  const queryName = normalizeIdentityName(query.name);
  const queryFull = query.fullName ? normalizeIdentityName(query.fullName) : queryName;
  const candidateName = normalizeIdentityName(driver.name);
  const candidateFull = driver.fullName ? normalizeIdentityName(driver.fullName) : candidateName;

  let score = 0;
  if (queryName.length > 0) {
    if (queryName === candidateName || queryName === candidateFull) score = 1;
    else if (candidateName.includes(queryName) || candidateFull.includes(queryName)) score = 0.9;
    else if (queryName.includes(candidateName) && candidateName.length > 2) score = 0.9;
    else {
      const queryTokens = tokenSet(queryFull);
      const candidateTokens = tokenSet(candidateFull);
      let common = 0;
      for (const token of queryTokens) {
        if (candidateTokens.has(token)) common += 1;
      }
      if (common > 0) {
        const ratio = common / Math.max(queryTokens.size, candidateTokens.size);
        score = 0.5 + 0.3 * ratio;
      }
    }
  }

  if (query.nationality && driver.nationality) {
    const a = normalizeIdentityName(query.nationality);
    const b = normalizeIdentityName(driver.nationality);
    if (a === b || a.includes(b) || b.includes(a)) score += 0.1;
  }
  if (query.number !== null && query.number !== undefined && driver.number !== null) {
    if (query.number === driver.number) score += 0.1;
  }
  if (query.dateOfBirth && dateOfBirth) {
    if (query.dateOfBirth.toISOString().slice(0, 10) === dateOfBirth.toISOString().slice(0, 10)) {
      score += 0.25;
    }
  }
  return Math.min(score, 1.25);
}

const IDENTITY_THRESHOLD = 0.75;
const AMBIGUITY_DELTA = 0.15;

export async function resolveExternalDriverIdentity(
  query: DriverIdentityQuery,
  providers: {
    readonly provider: ExternalKnowledgeProvider;
    readonly externalId?: string | null;
  },
  db: PrismaClient = prisma,
): Promise<IdentityResolution> {
  const source = providers.provider.toLowerCase();
  if (providers.externalId) {
    const exact = await db.externalDriver.findUnique({
      where: { source_externalId: { source, externalId: providers.externalId } },
      select: { id: true },
    });
    if (exact) return { kind: "RESOLVED", driverId: exact.id, basis: "PROVIDER_ID", score: 1 };
  }
  if (query.wikidataQid) {
    const profile = await db.externalDriverProfile.findUnique({
      where: { wikidataQid: query.wikidataQid },
      select: { externalDriverId: true },
    });
    if (profile) {
      return { kind: "RESOLVED", driverId: profile.externalDriverId, basis: "WIKIDATA_QID", score: 1 };
    }
  }

  const tokens = [...tokenSet(query.name)].filter((token) => token.length >= 3);
  const searchToken = tokens[0] ?? normalizeIdentityName(query.name);
  if (searchToken.length < 3) return { kind: "NOT_FOUND" };

  const candidates = await db.externalDriver.findMany({
    where: {
      OR: [
        { name: { contains: searchToken, mode: "insensitive" } },
        { fullName: { contains: searchToken, mode: "insensitive" } },
      ],
    },
    take: 25,
    select: {
      id: true,
      name: true,
      fullName: true,
      nationality: true,
      number: true,
      knowledgeProfile: { select: { dateOfBirth: true } },
    },
  });

  const scored = candidates
    .map((candidate) => ({
      driverId: candidate.id,
      name: candidate.name,
      score: identityMatchScore(query, candidate, candidate.knowledgeProfile?.dateOfBirth ?? null),
    }))
    .filter((candidate) => candidate.score >= IDENTITY_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.driverId.localeCompare(b.driverId));

  if (scored.length === 0) return { kind: "NOT_FOUND" };
  const [top, second] = scored;
  const discriminating =
    (query.dateOfBirth !== null && query.dateOfBirth !== undefined) ||
    (query.number !== null && query.number !== undefined);
  if (top && second) {
    const decisive = discriminating && top.score > second.score;
    if (!decisive && top.score - second.score <= AMBIGUITY_DELTA) {
      return {
        kind: "AMBIGUOUS_IDENTITY",
        candidates: scored.slice(0, 5),
      };
    }
  }
  const basis: IdentityBasis =
    query.nationality || (query.number !== null && query.number !== undefined) || query.dateOfBirth
      ? "NAME_NATIONALITY"
      : "NAME_ONLY";
  return { kind: "RESOLVED", driverId: top.driverId, basis, score: top.score };
}

export function canonicalCandidateHash(candidate: ProviderIdentityCandidate): string {
  const canonical = JSON.stringify({
    externalId: candidate.externalId,
    name: candidate.name,
    fullName: candidate.fullName ?? null,
    nationality: candidate.nationality ?? null,
    number: candidate.number ?? null,
    dateOfBirth: candidate.dateOfBirth?.toISOString() ?? null,
    wikidataQid: candidate.wikidataQid ?? null,
    f1dbDriverId: candidate.f1dbDriverId ?? null,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export async function ensureExternalDriverForProvider(
  provider: ExternalKnowledgeProvider,
  candidate: ProviderIdentityCandidate,
  now: Date = new Date(),
  db: PrismaClient = prisma,
): Promise<ExternalDriver> {
  const source = provider.toLowerCase();
  const contentHash = canonicalCandidateHash(candidate);
  const data = {
    source,
    externalId: candidate.externalId,
    name: candidate.name,
    fullName: candidate.fullName ?? null,
    nationality: candidate.nationality ?? null,
    number: candidate.number ?? null,
    contentHash,
    lastSyncedAt: now,
    sourceRecord: {
      provider,
      externalId: candidate.externalId,
      dateOfBirth: candidate.dateOfBirth?.toISOString() ?? null,
      wikidataQid: candidate.wikidataQid ?? null,
      f1dbDriverId: candidate.f1dbDriverId ?? null,
    },
  };
  const existing = await db.externalDriver.findUnique({
    where: { source_externalId: { source, externalId: candidate.externalId } },
    select: { id: true },
  });
  if (existing) {
    return db.externalDriver.update({ where: { id: existing.id }, data });
  }
  return db.externalDriver.create({ data });
}

export function requireResolvedIdentity(
  resolution: IdentityResolution,
): { readonly driverId: string; readonly basis: IdentityBasis; readonly score: number } {
  if (resolution.kind === "NOT_FOUND") {
    throw new PilotKnowledgeError("DRIVER_NOT_FOUND", "Nenhum piloto correspondente encontrado", 404);
  }
  if (resolution.kind === "AMBIGUOUS_IDENTITY") {
    throw new PilotKnowledgeError(
      "AMBIGUOUS_IDENTITY",
      `Identidade ambígua: ${resolution.candidates.length} candidatos; confirme o binding manualmente`,
      409,
    );
  }
  return { driverId: resolution.driverId, basis: resolution.basis, score: resolution.score };
}
