import { prisma } from "../../infrastructure/database/prisma.js";
import { runRecordedSync } from "../external-sync/external-sync-run.js";
import { EMPTY_PERSIST_RESULT, type PersistResult } from "../external-sync/jolpica.persist.js";
import { PilotKnowledgeError } from "./pilot-knowledge.access.js";
import { deriveMilestonesFromExternalData } from "./pilot-knowledge.events.js";
import { requireResolvedIdentity, resolveExternalDriverIdentity } from "./pilot-knowledge.identity.js";
import { upsertDriverProfileFromProvider } from "./pilot-knowledge.profile.js";
import { ingestExternalRelationships } from "./pilot-knowledge.relationships.js";
import { recordKnowledgeSource } from "./pilot-knowledge.sources.js";
import type {
  ExternalDriverKnowledgeProvider,
  ProviderIdentityCandidate,
  ProviderSourceReference,
} from "./providers/provider.types.js";

export const PILOT_SYNC_SCOPES = ["DRIVER_PROFILE", "DRIVER_RELATIONSHIPS", "DRIVER_EVENTS"] as const;
export type PilotSyncScope = (typeof PILOT_SYNC_SCOPES)[number];
export type PilotRefreshScope = PilotSyncScope | "ALL";

const COUNT_ZERO = EMPTY_PERSIST_RESULT;

async function resolveCandidateForDriver(
  provider: ExternalDriverKnowledgeProvider,
  externalDriverId: string,
): Promise<ProviderIdentityCandidate> {
  const driver = await prisma.externalDriver.findUnique({
    where: { id: externalDriverId },
    select: {
      id: true,
      source: true,
      externalId: true,
      name: true,
      fullName: true,
      nationality: true,
      number: true,
      knowledgeProfile: { select: { wikidataQid: true, f1dbDriverId: true } },
    },
  });
  if (!driver) {
    throw new PilotKnowledgeError("DRIVER_NOT_FOUND", "Piloto externo não encontrado", 404);
  }
  const candidates = await provider.resolveDriverIdentity({
    name: driver.name,
    fullName: driver.fullName,
    nationality: driver.nationality,
    number: driver.number,
    wikidataQid: driver.knowledgeProfile?.wikidataQid ?? null,
    f1dbDriverId: driver.knowledgeProfile?.f1dbDriverId ?? null,
    externalId: driver.source === provider.source.toLowerCase() ? driver.externalId : null,
  });
  if (candidates.length === 0) {
    throw new PilotKnowledgeError(
      "DRIVER_NOT_FOUND",
      `Provider ${provider.source} não encontrou este piloto`,
      404,
    );
  }
  if (driver.source === provider.source.toLowerCase()) {
    const exact = candidates.find((candidate) => candidate.externalId === driver.externalId);
    if (exact) return exact;
    throw new PilotKnowledgeError(
      "DRIVER_NOT_FOUND",
      `Provider ${provider.source} não reconhece o identificador ${driver.externalId}`,
      404,
    );
  }
  if (candidates.length > 1) {
    const resolution = await resolveExternalDriverIdentity(
      {
        name: driver.name,
        fullName: driver.fullName,
        nationality: driver.nationality,
        number: driver.number,
      },
      { provider: provider.source },
    );
    if (resolution.kind === "RESOLVED") {
      const match = candidates.find((candidate) => candidate.externalId === resolution.driverId);
      if (match) return match;
    }
    if (resolution.kind === "AMBIGUOUS_IDENTITY") {
      throw new PilotKnowledgeError(
        "AMBIGUOUS_IDENTITY",
        `Identidade ambígua para os providers ${provider.source}`,
        409,
      );
    }
  }
  return candidates[0] as ProviderIdentityCandidate;
}

async function recordProviderSource(
  reference: ProviderSourceReference,
  now: Date,
): Promise<string | null> {
  if (!reference.url) return null;
  const source = await recordKnowledgeSource(
    {
      provider: reference.provider,
      sourceKind: reference.sourceKind,
      url: reference.url,
      title: reference.title ?? null,
      license: reference.license,
      attributionRequirement: reference.attributionRequirement ?? null,
      attributionText: reference.attributionText ?? null,
      publishedAt: reference.publishedAt ?? null,
      sourceVersion: reference.sourceVersion ?? null,
    },
    now,
  );
  return source.id;
}

export type PilotRefreshScopeResult = {
  readonly scope: PilotSyncScope;
  readonly provider: string;
  readonly status: "SUCCESS" | "FAILED";
  readonly statistics: PersistResult | null;
  readonly error: string | null;
};

export async function refreshDriverKnowledge(input: {
  readonly externalDriverId: string;
  readonly scope: PilotRefreshScope;
  readonly providers: readonly ExternalDriverKnowledgeProvider[];
  readonly triggeredById?: string | null;
  readonly now?: Date;
}): Promise<{ readonly scopes: readonly PilotRefreshScopeResult[] }> {
  if (input.providers.length === 0) {
    throw new PilotKnowledgeError(
      "PROVIDERS_UNAVAILABLE",
      "Nenhum provider de pilot knowledge configurado neste ambiente",
      503,
    );
  }
  const now = input.now ?? new Date();
  const scopes: PilotSyncScope[] =
    input.scope === "ALL" ? [...PILOT_SYNC_SCOPES] : [input.scope];
  const results: PilotRefreshScopeResult[] = [];

  for (const scope of scopes) {
    for (const provider of input.providers) {
      try {
        const statistics = await runRecordedSync(
          {
            source: provider.source.toLowerCase(),
            scope,
            seasonYear: null,
            triggeredById: input.triggeredById ?? null,
          },
          async () => {
            if (scope === "DRIVER_PROFILE") {
              const candidate = await resolveCandidateForDriver(provider, input.externalDriverId);
              const structured = await provider.fetchStructuredProfile(candidate);
              const sourceId = await recordProviderSource(structured.source, now);
              await upsertDriverProfileFromProvider(
                input.externalDriverId,
                {
                  fullName: structured.profile.fullName,
                  publicName: structured.profile.publicName,
                  dateOfBirth: structured.profile.dateOfBirth,
                  placeOfBirth: structured.profile.placeOfBirth,
                  nationality: structured.profile.nationality,
                  representedCountry: structured.profile.representedCountry,
                  driverNumber: structured.profile.driverNumber,
                  driverCode: structured.profile.driverCode,
                  currentTeamName: structured.profile.currentTeamName,
                  officialLinks: structured.profile.officialLinks,
                  wikidataQid: candidate.wikidataQid ?? null,
                  f1dbDriverId: candidate.f1dbDriverId ?? null,
                  sourceId,
                  biographyFacts: structured.profile.biographyFacts,
                },
                now,
              );
              return { created: 0, updated: 1, unchanged: 0, skipped: 0 };
            }
            if (scope === "DRIVER_RELATIONSHIPS") {
              const candidate = await resolveCandidateForDriver(provider, input.externalDriverId);
              const relationships = await provider.fetchRelationships(candidate);
              if (relationships.length === 0) return COUNT_ZERO;
              const saved = await ingestExternalRelationships(
                input.externalDriverId,
                relationships.map((relationship) => ({
                  kind: relationship.kind,
                  targetType: relationship.targetType,
                  targetExternalId: relationship.targetExternalId ?? null,
                  targetWikidataQid: relationship.targetWikidataQid ?? null,
                  displayName: relationship.displayName,
                  state: relationship.state,
                  validFrom: relationship.validFrom ?? null,
                  validTo: relationship.validTo ?? null,
                  source: {
                    provider: provider.source,
                    sourceKind: "DATABASE_EXPORT",
                    url: relationship.targetWikidataQid
                      ? `https://www.wikidata.org/wiki/${relationship.targetWikidataQid}`
                      : null,
                    title: `Relação de ${candidate.name}`,
                    license: provider.source === "WIKIDATA" ? "CC0" : "UNKNOWN",
                  },
                })),
                now,
              );
              return { created: saved.length, updated: 0, unchanged: 0, skipped: 0 };
            }
            const saved = await deriveMilestonesFromExternalData(input.externalDriverId, now);
            return { created: 0, updated: saved.length, unchanged: 0, skipped: 0 };
          },
        );
        results.push({ scope, provider: provider.source, status: "SUCCESS", statistics, error: null });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "PROVIDERS_UNAVAILABLE") throw error;
        results.push({
          scope,
          provider: provider.source,
          status: "FAILED",
          statistics: null,
          error: error instanceof Error ? error.message : "Falha no refresh",
        });
      }
    }
  }

  if (results.every((result) => result.status === "FAILED")) {
    const first = results[0];
    throw new PilotKnowledgeError(
      "REFRESH_FAILED",
      first?.error ?? "Refresh falhou em todos os providers",
      502,
    );
  }
  return { scopes: results };
}

export type PilotKnowledgeStatus = {
  readonly profiles: { readonly total: number; readonly fresh: number; readonly stale: number; readonly unknown: number };
  readonly personas: { readonly total: number; readonly supported: number; readonly conflict: number; readonly unknown: number };
  readonly relationships: number;
  readonly events: number;
  readonly lastRuns: ReadonlyArray<{
    readonly source: string;
    readonly scope: string;
    readonly status: string;
    readonly startedAt: Date;
    readonly finishedAt: Date | null;
    readonly error: string | null;
  }>;
};

export async function getPilotKnowledgeStatus(): Promise<PilotKnowledgeStatus> {
  const [profiles, fresh, stale, unknown, personas, supportedPersonas, conflictPersonas, relationships, events, lastRuns] =
    await Promise.all([
      prisma.externalDriverProfile.count(),
      prisma.externalDriverProfile.count({ where: { refreshStatus: "FRESH" } }),
      prisma.externalDriverProfile.count({ where: { refreshStatus: "STALE" } }),
      prisma.externalDriverProfile.count({ where: { refreshStatus: "UNKNOWN" } }),
      prisma.externalDriverPersona.count(),
      prisma.externalDriverPersona.count({ where: { status: "SUPPORTED" } }),
      prisma.externalDriverPersona.count({ where: { status: "CONFLICT" } }),
      prisma.externalDriverRelationship.count(),
      prisma.externalDriverEvent.count(),
      prisma.externalSyncRun.findMany({
        where: { scope: { in: [...PILOT_SYNC_SCOPES] } },
        orderBy: [{ startedAt: "desc" }],
        take: 10,
        select: {
          source: true,
          scope: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          error: true,
        },
      }),
    ]);
  return {
    profiles: {
      total: profiles,
      fresh,
      stale,
      unknown,
    },
    personas: {
      total: personas,
      supported: supportedPersonas,
      conflict: conflictPersonas,
      unknown: personas - supportedPersonas - conflictPersonas,
    },
    relationships,
    events,
    lastRuns,
  };
}

export { requireResolvedIdentity };
