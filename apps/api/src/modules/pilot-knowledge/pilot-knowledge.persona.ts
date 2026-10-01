import type {
  ExternalClaimStatus,
  ExternalDriverPersona,
  ExternalPublicEvidenceType,
  ExternalPublicTraitSource,
  ExternalKnowledgeProvider,
} from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { PilotKnowledgeError } from "./pilot-knowledge.access.js";
import {
  EXTERNAL_PERSONA_SCHEMA_VERSION,
  EVIDENCE_SUMMARY_CAP,
  PERSONA_FRESH_DAYS,
  PERSONA_SUMMARY_CAP,
  TRAIT_VALUE_CAP,
  authorityClassOfProvider,
  clampText,
  comparePublicTraits,
  computeRefreshStatus,
  isKnownPublicTraitKey,
  publicTraitLabel,
} from "./pilot-knowledge.policy.js";
import { recordKnowledgeSource, type KnowledgeSourceInput } from "./pilot-knowledge.sources.js";

const EVIDENCE_TYPE_RANK: Record<ExternalPublicEvidenceType, number> = {
  SELF_DESCRIPTION: 7,
  DRIVER_OFFICIAL: 6,
  FIA_TRANSCRIPT: 5,
  F1_PROFILE: 4,
  TEAM_PROFILE: 4,
  OFFICIAL_INTERVIEW: 3,
  STRUCTURED_DATA: 2,
  REPUTABLE_NEWS: 1,
};

export type PersonaEvidenceInput = {
  readonly traitKey: string;
  readonly proposedValue: string;
  readonly sourceKind: ExternalPublicTraitSource;
  readonly evidenceType: ExternalPublicEvidenceType;
  readonly summary: string;
  readonly confidence?: number | null;
  readonly source: KnowledgeSourceInput;
};

type EvidenceForResolution = {
  readonly id: string;
  readonly traitKey: string;
  readonly proposedValue: string;
  readonly sourceKind: ExternalPublicTraitSource;
  readonly evidenceType: ExternalPublicEvidenceType;
  readonly confidence: number | null;
  readonly sourceId: string | null;
  readonly provider: ExternalKnowledgeProvider | null;
};

export type ResolvedExternalTrait = {
  readonly traitKey: string;
  readonly value: string;
  readonly sourceKind: ExternalPublicTraitSource;
  readonly status: ExternalClaimStatus;
  readonly confidence: number | null;
  readonly evidenceId: string;
  readonly independentEvidenceCount: number;
};

function evidenceAuthority(evidence: EvidenceForResolution): number {
  const providerRank = evidence.provider ? authorityClassOfProvider(evidence.provider) : "OTHER_SECONDARY";
  const classRank =
    providerRank === "PRIMARY_OFFICIAL" ? 30 : providerRank === "STRUCTURED_LICENSED" ? 20 : providerRank === "REPUTABLE_SECONDARY" ? 10 : 0;
  return classRank + EVIDENCE_TYPE_RANK[evidence.evidenceType];
}

function normalizeClaimValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function resolveExternalPersonaTraits(
  evidences: readonly EvidenceForResolution[],
): ResolvedExternalTrait[] {
  const byTrait = new Map<string, EvidenceForResolution[]>();
  for (const evidence of evidences) {
    const list = byTrait.get(evidence.traitKey) ?? [];
    list.push(evidence);
    byTrait.set(evidence.traitKey, list);
  }

  const resolved: ResolvedExternalTrait[] = [];
  for (const [traitKey, list] of byTrait) {
    const sorted = [...list].sort((a, b) => {
      const diff = evidenceAuthority(b) - evidenceAuthority(a);
      if (diff !== 0) return diff;
      const confidenceDiff = (b.confidence ?? 0) - (a.confidence ?? 0);
      if (confidenceDiff !== 0) return confidenceDiff;
      return a.id.localeCompare(b.id);
    });
    const authoritative = sorted[0] as EvidenceForResolution;
    const authoritativeRank = evidenceAuthority(authoritative);
    const conflicting = sorted.some(
      (evidence) =>
        evidence.id !== authoritative.id &&
        evidenceAuthority(evidence) === authoritativeRank &&
        normalizeClaimValue(evidence.proposedValue) !== normalizeClaimValue(authoritative.proposedValue),
    );
    const distinctSources = new Set(list.map((evidence) => evidence.sourceId ?? evidence.id)).size;
    const strongInference = authoritative.sourceKind !== "INFERRED" || distinctSources >= 2;

    let status: ExternalClaimStatus;
    if (conflicting) status = "CONFLICT";
    else if (!strongInference) status = "UNCERTAIN";
    else status = "SUPPORTED";

    resolved.push({
      traitKey,
      value: clampText(authoritative.proposedValue, TRAIT_VALUE_CAP),
      sourceKind: authoritative.sourceKind,
      status,
      confidence: authoritative.confidence,
      evidenceId: authoritative.id,
      independentEvidenceCount: distinctSources,
    });
  }
  return resolved.sort(comparePublicTraits);
}

export async function ensureExternalPersona(
  externalDriverId: string,
): Promise<ExternalDriverPersona> {
  const profile = await prisma.externalDriverProfile.findUnique({
    where: { externalDriverId },
    select: { id: true, persona: { select: { id: true } } },
  });
  if (!profile) {
    throw new PilotKnowledgeError("PROFILE_NOT_FOUND", "Perfil externo não encontrado", 404);
  }
  if (profile.persona) {
    return prisma.externalDriverPersona.findUniqueOrThrow({ where: { id: profile.persona.id } });
  }
  return prisma.externalDriverPersona.create({
    data: {
      profileId: profile.id,
      schemaVersion: EXTERNAL_PERSONA_SCHEMA_VERSION,
      status: "UNKNOWN",
    },
  });
}

async function reconcileTraitsForPersona(
  personaId: string,
  now: Date,
): Promise<readonly ResolvedExternalTrait[]> {
  const evidences = await prisma.externalPersonaEvidence.findMany({
    where: { personaId, status: { not: "CONFLICT" } },
    include: { source: { select: { provider: true } } },
  });
  const rows: EvidenceForResolution[] = evidences.map((evidence) => ({
    id: evidence.id,
    traitKey: evidence.traitKey,
    proposedValue: evidence.proposedValue,
    sourceKind: evidence.sourceKind,
    evidenceType: evidence.evidenceType,
    confidence: evidence.confidence,
    sourceId: evidence.sourceId,
    provider: evidence.source?.provider ?? null,
  }));
  const resolved = resolveExternalPersonaTraits(rows);

  const existing = await prisma.externalPersonaTrait.findMany({ where: { personaId } });
  const resolvedKeys = new Set(resolved.map((trait) => trait.traitKey));
  for (const trait of existing) {
    if (!resolvedKeys.has(trait.traitKey)) {
      await prisma.externalPersonaTrait.delete({ where: { id: trait.id } });
    }
  }
  for (const trait of resolved) {
    await prisma.externalPersonaTrait.upsert({
      where: { personaId_traitKey: { personaId, traitKey: trait.traitKey } },
      create: {
        personaId,
        traitKey: trait.traitKey,
        value: trait.value,
        sourceKind: trait.sourceKind,
        status: trait.status,
        confidence: trait.confidence,
        evidenceId: trait.evidenceId,
      },
      update: {
        value: trait.value,
        sourceKind: trait.sourceKind,
        status: trait.status,
        confidence: trait.confidence,
        evidenceId: trait.evidenceId,
      },
    });
  }

  const aggregateStatus: ExternalClaimStatus = resolved.some((trait) => trait.status === "CONFLICT")
    ? "CONFLICT"
    : resolved.some((trait) => trait.status === "SUPPORTED")
      ? "SUPPORTED"
      : resolved.length > 0
        ? "UNCERTAIN"
        : "UNKNOWN";
  await prisma.externalDriverPersona.update({
    where: { id: personaId },
    data: { status: aggregateStatus, lastVerifiedAt: now },
  });
  return resolved;
}

export async function ingestPersonaEvidenceForDriver(
  externalDriverId: string,
  inputs: readonly PersonaEvidenceInput[],
  now: Date = new Date(),
): Promise<{ readonly personaId: string; readonly traits: readonly ResolvedExternalTrait[] }> {
  const persona = await ensureExternalPersona(externalDriverId);
  for (const input of inputs) {
    if (!isKnownPublicTraitKey(input.traitKey)) {
      throw new PilotKnowledgeError(
        "VALIDATION_ERROR",
        `traitKey não suportado para persona pública: ${input.traitKey}`,
        400,
      );
    }
  }
  for (const input of inputs) {
    const source = await recordKnowledgeSource(input.source, now);
    await prisma.externalPersonaEvidence.create({
      data: {
        personaId: persona.id,
        traitKey: input.traitKey,
        proposedValue: clampText(input.proposedValue, TRAIT_VALUE_CAP),
        evidenceType: input.evidenceType,
        sourceKind: input.sourceKind,
        sourceId: source.id,
        summary: clampText(input.summary, EVIDENCE_SUMMARY_CAP),
        confidence: input.confidence ?? null,
        status: "SUPPORTED",
        retrievedAt: now,
      },
    });
  }
  const traits = await reconcileTraitsForPersona(persona.id, now);
  return { personaId: persona.id, traits };
}

export type ExternalPersonaTraitView = {
  readonly traitKey: string;
  readonly label: string;
  readonly value: string;
  readonly sourceKind: ExternalPublicTraitSource;
  readonly status: ExternalClaimStatus;
  readonly lastVerifiedAt: Date | null;
};

export type ExternalPersonaView =
  | { readonly available: false; readonly reason: "CHARACTER_NOT_FOUND" | "NO_EXTERNAL_BINDING" | "NO_EXTERNAL_PROFILE" | "NO_PERSONA" }
  | {
      readonly available: true;
      readonly summary: string | null;
      readonly status: ExternalClaimStatus;
      readonly refresh: { readonly status: "FRESH" | "STALE" | "UNKNOWN"; readonly lastVerifiedAt: Date | null };
      readonly traits: readonly ExternalPersonaTraitView[];
    };

export async function getExternalPersonaView(
  characterId: string,
  now: Date = new Date(),
): Promise<ExternalPersonaView> {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      externalDriverBindings: {
        take: 1,
        orderBy: { createdAt: "asc" },
        select: {
          externalDriver: {
            select: {
              knowledgeProfile: {
                select: {
                  persona: {
                    include: { traits: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!character) return { available: false, reason: "CHARACTER_NOT_FOUND" };
  const binding = character.externalDriverBindings[0];
  if (!binding) return { available: false, reason: "NO_EXTERNAL_BINDING" };
  const profile = binding.externalDriver.knowledgeProfile;
  if (!profile) return { available: false, reason: "NO_EXTERNAL_PROFILE" };
  const persona = profile.persona;
  if (!persona) return { available: false, reason: "NO_PERSONA" };

  const traits = [...persona.traits]
    .sort(comparePublicTraits)
    .map((trait) => ({
      traitKey: trait.traitKey,
      label: publicTraitLabel(trait.traitKey),
      value: clampText(trait.value, TRAIT_VALUE_CAP),
      sourceKind: trait.sourceKind,
      status: trait.status,
      lastVerifiedAt: persona.lastVerifiedAt,
    }));

  return {
    available: true,
    summary: persona.summary ? clampText(persona.summary, PERSONA_SUMMARY_CAP) : null,
    status: persona.status,
    refresh: {
      status: computeRefreshStatus(persona.lastVerifiedAt, now, PERSONA_FRESH_DAYS),
      lastVerifiedAt: persona.lastVerifiedAt,
    },
    traits,
  };
}
