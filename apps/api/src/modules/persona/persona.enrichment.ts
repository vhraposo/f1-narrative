import type { PersonaEvidenceType } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { PERSONA_TRAIT_KEYS } from "./persona.rules.js";
import {
  loadBiographyEvidenceForCharacter,
  type CharacterBiographyEvidence,
} from "../pilot-knowledge/pilot-knowledge.provision.js";
import type { BiographyClaim } from "../pilot-knowledge/biography.claims.js";

export type PersonaTraitContext = "ON_TRACK" | "OFF_TRACK";

export type PersonaEnrichmentResult = {
  readonly characterId: string;
  readonly evidenceCreated: number;
  readonly traitsCreated: number;
  readonly traitsUpdated: number;
  readonly manualPreserved: number;
  readonly traitsByContext: { readonly onTrack: number; readonly offTrack: number };
};

type TraitMapping = {
  readonly key: string;
  readonly context: PersonaTraitContext;
};

const TRAIT_KEYS = new Set<string>(PERSONA_TRAIT_KEYS);

export function mapCuratedClaimToTrait(claim: BiographyClaim): TraitMapping | null {
  if (claim.category === "INTERESTS" || claim.category === "PROJECTS") {
    return { key: "interests", context: "OFF_TRACK" };
  }
  if (claim.category !== "PUBLIC_PERSONALITY") return null;
  const upper = claim.key.toUpperCase();
  let key = "behavioralTendencies";
  if (/COMPETITI/.test(upper)) key = "competitiveness";
  else if (/CONFIDENCE/.test(upper)) key = "confidence";
  else if (/HUMOR/.test(upper)) key = "humor";
  else if (/COMMUNICATION|SPEECH/.test(upper)) key = "communicationStyle";
  else if (/EMOTION|MENTAL|PRESSURE/.test(upper)) key = "emotionalExpression";
  if (!TRAIT_KEYS.has(key)) return null;
  return { key, context: "ON_TRACK" };
}

function mapEvidenceType(sourceType: string): PersonaEvidenceType {
  if (sourceType === "OFFICIAL_PROFILE") return "OFFICIAL_PROFILE";
  if (sourceType === "INTERVIEW") return "INTERVIEW";
  if (sourceType === "BIOGRAPHY_PAGE") return "BIOGRAPHY";
  if (sourceType === "PUBLIC_STATEMENT") return "PUBLIC_STATEMENT";
  return "OTHER_APPROVED";
}

function authorityRank(authority: string): number {
  if (authority === "PRIMARY_OFFICIAL") return 3;
  if (authority === "STRUCTURED_CANONICAL") return 2;
  if (authority === "SECONDARY") return 1;
  return 0;
}

function clamp(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

type SelectedClaim = { readonly claim: BiographyClaim; readonly mapping: TraitMapping };

function selectCuratedTraitClaims(evidence: CharacterBiographyEvidence): SelectedClaim[] {
  const curated = evidence.claimSet.claims.filter(
    (claim) => claim.status === "APPROVED" && claim.sourceRef !== null,
  );
  const best = new Map<string, SelectedClaim>();
  for (const claim of curated) {
    const mapping = mapCuratedClaimToTrait(claim);
    if (!mapping) continue;
    const slot = `${mapping.context}:${mapping.key}`;
    const current = best.get(slot);
    if (
      !current ||
      authorityRank(claim.authority) > authorityRank(current.claim.authority)
    ) {
      best.set(slot, { claim, mapping });
    }
  }
  return [...best.values()];
}

export async function enrichCharacterPersonaFromEvidence(
  characterId: string,
  now: Date = new Date(),
): Promise<PersonaEnrichmentResult | null> {
  const evidence = await loadBiographyEvidenceForCharacter(characterId, now);
  if (!evidence) return null;
  const selected = selectCuratedTraitClaims(evidence);
  if (selected.length === 0) return null;

  const persona = await prisma.characterPersona.upsert({
    where: { characterId },
    create: { characterId, origin: "REAL_DRIVER", schemaVersion: "persona.v1" },
    update: {},
    select: { id: true },
  });

  let evidenceCreated = 0;
  let traitsCreated = 0;
  let traitsUpdated = 0;
  let manualPreserved = 0;

  for (const { claim, mapping } of selected) {
    const source = claim.sourceRef;
    const existingTrait = await prisma.personaTrait.findUnique({
      where: {
        personaId_key_context: {
          personaId: persona.id,
          key: mapping.key,
          context: mapping.context,
        },
      },
      select: { id: true, sourceKind: true },
    });

    if (existingTrait?.sourceKind === "MANUAL") {
      manualPreserved += 1;
      continue;
    }

    const existingEvidence = await prisma.personaEvidence.findFirst({
      where: {
        personaId: persona.id,
        traitKey: mapping.key,
        excerpt: clamp(claim.display, 500),
        status: "APPROVED",
      },
      select: { id: true },
    });
    let evidenceId = existingEvidence?.id ?? null;
    if (!evidenceId) {
      const evidenceRow = await prisma.personaEvidence.create({
        data: {
          personaId: persona.id,
          traitKey: mapping.key,
          proposedValue: clamp(claim.value, 200),
          sourceType: mapEvidenceType(source?.sourceType ?? "OTHER_APPROVED"),
          title: clamp(source?.title ?? "Evidência pública curada", 200),
          url: source?.url ?? null,
          excerpt: clamp(claim.display, 500),
          confidence: claim.authority === "PRIMARY_OFFICIAL" ? 0.85 : 0.6,
          status: "APPROVED",
          reviewedAt: now,
        },
        select: { id: true },
      });
      evidenceId = evidenceRow.id;
      evidenceCreated += 1;
    }

    const value = clamp(claim.display, 200);
    if (existingTrait) {
      await prisma.personaTrait.update({
        where: { id: existingTrait.id },
        data: {
          value,
          confidence: claim.authority === "PRIMARY_OFFICIAL" ? 0.85 : 0.6,
          sourceKind: "EVIDENCE",
          evidenceId,
        },
      });
      traitsUpdated += 1;
    } else {
      await prisma.personaTrait.create({
        data: {
          personaId: persona.id,
          key: mapping.key,
          value,
          confidence: claim.authority === "PRIMARY_OFFICIAL" ? 0.85 : 0.6,
          sourceKind: "EVIDENCE",
          context: mapping.context,
          evidenceId,
        },
      });
      traitsCreated += 1;
    }
  }

  const traits = await prisma.personaTrait.findMany({
    where: { personaId: persona.id },
    select: { context: true },
  });

  return {
    characterId,
    evidenceCreated,
    traitsCreated,
    traitsUpdated,
    manualPreserved,
    traitsByContext: {
      onTrack: traits.filter((trait) => trait.context === "ON_TRACK").length,
      offTrack: traits.filter((trait) => trait.context === "OFF_TRACK").length,
    },
  };
}

export type PersonaBackfillSummary = {
  readonly targets: number;
  readonly enriched: number;
  readonly skipped: number;
  readonly failed: number;
  readonly traits: { readonly onTrack: number; readonly offTrack: number };
  readonly results: ReadonlyArray<PersonaEnrichmentResult & { readonly skipped: boolean }>;
};

export async function enrichPersonasForCharacters(
  characterIds: readonly string[],
  now: Date = new Date(),
): Promise<PersonaBackfillSummary> {
  const results: Array<PersonaEnrichmentResult & { skipped: boolean }> = [];
  let enriched = 0;
  let skipped = 0;
  let failed = 0;
  let onTrack = 0;
  let offTrack = 0;

  for (const characterId of characterIds) {
    try {
      const result = await enrichCharacterPersonaFromEvidence(characterId, now);
      if (!result) {
        skipped += 1;
        continue;
      }
      enriched += 1;
      onTrack += result.traitsByContext.onTrack;
      offTrack += result.traitsByContext.offTrack;
      results.push({ ...result, skipped: false });
    } catch {
      failed += 1;
    }
  }

  return {
    targets: characterIds.length,
    enriched,
    skipped,
    failed,
    traits: { onTrack, offTrack },
    results,
  };
}
