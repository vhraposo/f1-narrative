import type { Prisma } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { PilotKnowledgeError } from "../pilot-knowledge/pilot-knowledge.access.js";
import { appendTimelineEvent, lockUniverseTimeline } from "../timeline/timeline.service.js";
import {
  computeEffectiveTraits,
  evolutionFingerprint,
  pendingEvolutionFingerprint,
  planEvolutionCandidates,
  toAppliedEffect,
  type AppliedEvolutionEffect,
  type BaseTrait,
  type EffectiveTrait,
  type EvolutionCandidate,
  type EvolutionExperienceLike,
} from "./persona-evolution.rules.js";

export type EvolutionPreviewTrait = {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly origin: "MANUAL" | "EVIDENCE" | "RULE_DERIVED";
  readonly beforeConfidence: number;
  readonly afterConfidence: number;
  readonly skippedManual: boolean;
  readonly reasons: readonly {
    readonly ruleCode: string;
    readonly experienceId: string;
    readonly experienceTitle: string;
    readonly delta: number;
    readonly reason: string;
  }[];
};

export type EvolutionPreview = {
  readonly available: boolean;
  readonly reason?: string;
  readonly evolutionRevision: number;
  readonly pendingFingerprint: string;
  readonly pendingCount: number;
  readonly traits: readonly EvolutionPreviewTrait[];
  readonly skipped: readonly {
    readonly ruleCode: string;
    readonly traitKey: string;
    readonly reason: string;
  }[];
};

type PendingEffect = EvolutionCandidate & { readonly fingerprint: string };

async function loadContext(universeId: string, characterId: string) {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      id: true,
      universeId: true,
      userId: true,
      driverProfile: { select: { id: true } },
      persona: { include: { traits: true, traitEvolutions: true } },
    },
  });
  if (!character || character.universeId !== universeId || !character.driverProfile) {
    return null;
  }
  const experiences = await prisma.pilotExperience.findMany({
    where: { universeId, characterId, status: "ACTIVE" },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });
  return { character, experiences };
}

function baseTraitsOf(character: {
  readonly persona: {
    readonly traits: ReadonlyArray<{ key: string; value: string; confidence: number; sourceKind: "MANUAL" | "EVIDENCE" }>;
  } | null;
}): BaseTrait[] {
  return (character.persona?.traits ?? []).map((trait) => ({
    key: trait.key,
    value: trait.value,
    confidence: trait.confidence,
    sourceKind: trait.sourceKind,
  }));
}

async function planPendingEffects(
  universeId: string,
  characterId: string,
  experiences: readonly EvolutionExperienceLike[],
  existingFingerprints: ReadonlySet<string>,
): Promise<PendingEffect[]> {
  const candidates = planEvolutionCandidates(experiences);
  const pending: PendingEffect[] = [];
  for (const candidate of candidates) {
    const fingerprint = evolutionFingerprint({
      universeId,
      characterId,
      ruleCode: candidate.ruleCode,
      experienceId: candidate.experienceId,
    });
    if (existingFingerprints.has(fingerprint)) continue;
    pending.push({ ...candidate, fingerprint });
  }
  return pending;
}

function buildPreviewTraits(
  baseTraits: readonly BaseTrait[],
  existingEffects: readonly AppliedEvolutionEffect[],
  pending: readonly PendingEffect[],
): { traits: EvolutionPreviewTrait[]; skipped: EvolutionPreview["skipped"] } {
  const before = computeEffectiveTraits(baseTraits, existingEffects);
  const pendingAsApplied: AppliedEvolutionEffect[] = pending.map((candidate) => ({
    ruleCode: candidate.ruleCode,
    traitKey: candidate.traitKey,
    confidenceDelta: candidate.confidenceDelta,
    reason: candidate.reason,
    experienceId: candidate.experienceId,
    experienceTitle: candidate.experienceTitle,
    value: candidate.value,
    priority: candidate.priority,
  }));
  const after = computeEffectiveTraits(baseTraits, [...existingEffects, ...pendingAsApplied]);
  const beforeByKey = new Map(before.map((trait) => [trait.key, trait]));
  const skipped: Array<{ readonly ruleCode: string; readonly traitKey: string; readonly reason: string }> = [];

  const traits: EvolutionPreviewTrait[] = after
    .filter((trait) => {
      const beforeTrait = beforeByKey.get(trait.key);
      if (!beforeTrait) return trait.appliedEffects.length > 0;
      return (
        trait.effectiveConfidence !== beforeTrait.effectiveConfidence ||
        trait.value !== beforeTrait.value ||
        trait.skippedManual
      );
    })
    .map((trait) => {
      const beforeTrait = beforeByKey.get(trait.key);
      if (trait.skippedManual) {
        skipped.push({
          ruleCode: trait.appliedEffects[0]?.ruleCode ?? "UNKNOWN",
          traitKey: trait.key,
          reason: "trait manual preservado",
        });
      }
      return {
        key: trait.key,
        label: trait.label,
        value: trait.value,
        origin: trait.sourceKind,
        beforeConfidence: beforeTrait?.effectiveConfidence ?? trait.baseConfidence,
        afterConfidence: trait.effectiveConfidence,
        skippedManual: trait.skippedManual,
        reasons: trait.appliedEffects
          .filter((effect) => effect.experienceId !== null)
          .map((effect) => ({
            ruleCode: effect.ruleCode,
            experienceId: effect.experienceId as string,
            experienceTitle: effect.experienceTitle ?? "",
            delta: effect.confidenceDelta,
            reason: effect.reason,
          })),
      };
    });
  return { traits, skipped };
}

export async function previewPersonaEvolution(
  universeId: string,
  characterId: string,
): Promise<EvolutionPreview> {
  const context = await loadContext(universeId, characterId);
  if (!context) {
    return {
      available: false,
      reason: "CHARACTER_NOT_ELIGIBLE",
      evolutionRevision: 0,
      pendingFingerprint: "",
      pendingCount: 0,
      traits: [],
      skipped: [],
    };
  }
  const { character, experiences } = context;
  const existingFingerprints = new Set(
    (character.persona?.traitEvolutions ?? []).map((effect) => effect.fingerprint),
  );
  const pending = await planPendingEffects(universeId, characterId, experiences, existingFingerprints);
  const existingEffects = (character.persona?.traitEvolutions ?? []).map((row) =>
    toAppliedEffect({
      ruleCode: row.ruleCode,
      traitKey: row.traitKey,
      confidenceDelta: row.confidenceDelta,
      reason: row.reason,
      sourceExperienceId: row.sourceExperienceId,
      value: row.value,
      rulePriority: row.rulePriority,
      experienceTitle: null,
    }),
  );
  const { traits, skipped } = buildPreviewTraits(baseTraitsOf(character), existingEffects, pending);

  return {
    available: true,
    evolutionRevision: character.persona?.evolutionRevision ?? 0,
    pendingFingerprint: pendingEvolutionFingerprint(pending.map((effect) => effect.fingerprint)),
    pendingCount: pending.length,
    traits,
    skipped,
  };
}

export type EvolutionApplyResult =
  | {
      readonly applied: true;
      readonly evolutionRevision: number;
      readonly effectsApplied: number;
      readonly timelineEventId: string | null;
    }
  | {
      readonly applied: false;
      readonly evolutionRevision: number;
      readonly reason: "NO_PENDING_EFFECTS";
    };

export async function applyPersonaEvolution(
  universeId: string,
  characterId: string,
  expected: { readonly expectedRevision: number; readonly expectedPendingFingerprint: string },
): Promise<EvolutionApplyResult> {
  return prisma.$transaction(async (tx) => {
    await lockUniverseTimeline(tx, universeId);

    const context = await loadContextWithin(tx, universeId, characterId);
    if (!context) {
      throw new PilotKnowledgeError("NOT_FOUND", "Piloto não elegível para evolução", 404);
    }
    const { character, experiences } = context;

    const persona =
      character.persona ??
      (await tx.characterPersona.create({
        data: {
          characterId,
          origin: character.userId !== null ? "ORIGINAL" : "AI_CHARACTER",
          schemaVersion: "persona.v1",
        },
        include: { traits: true, traitEvolutions: true },
      }));

    if (persona.evolutionRevision !== expected.expectedRevision) {
      throw new PilotKnowledgeError(
        "EVOLUTION_STALE",
        "A revisão de persona mudou; gere um novo preview antes de aplicar.",
        409,
      );
    }

    const existingFingerprints = new Set(persona.traitEvolutions.map((effect) => effect.fingerprint));
    const pending = await planPendingEffects(universeId, characterId, experiences, existingFingerprints);
    const pendingFingerprint = pendingEvolutionFingerprint(pending.map((effect) => effect.fingerprint));
    if (pendingFingerprint !== expected.expectedPendingFingerprint) {
      throw new PilotKnowledgeError(
        "EVOLUTION_STALE",
        "O conjunto de efeitos pendentes mudou; gere um novo preview antes de aplicar.",
        409,
      );
    }
    if (pending.length === 0) {
      return { applied: false, evolutionRevision: persona.evolutionRevision, reason: "NO_PENDING_EFFECTS" as const };
    }

    const existingEffects = persona.traitEvolutions.map((row) =>
      toAppliedEffect({
        ruleCode: row.ruleCode,
        traitKey: row.traitKey,
        confidenceDelta: row.confidenceDelta,
        reason: row.reason,
        sourceExperienceId: row.sourceExperienceId,
        value: row.value,
        rulePriority: row.rulePriority,
        experienceTitle: null,
      }),
    );
    const beforeTraits = computeEffectiveTraits(baseTraitsOf(character), existingEffects);
    const beforeByKey = new Map(beforeTraits.map((trait) => [trait.key, trait]));

    for (const effect of pending) {
      await tx.personaTraitEvolution.create({
        data: {
          personaId: persona.id,
          traitKey: effect.traitKey,
          ruleCode: effect.ruleCode,
          rulePriority: effect.priority,
          value: effect.value,
          confidenceDelta: effect.confidenceDelta,
          reason: effect.reason,
          sourceExperienceId: effect.experienceId,
          fingerprint: effect.fingerprint,
        },
      });
    }

    const afterTraits = computeEffectiveTraits(baseTraitsOf(character), [
      ...existingEffects,
      ...pending.map((candidate) => ({
        ruleCode: candidate.ruleCode,
        traitKey: candidate.traitKey,
        confidenceDelta: candidate.confidenceDelta,
        reason: candidate.reason,
        experienceId: candidate.experienceId,
        experienceTitle: candidate.experienceTitle,
        value: candidate.value,
        priority: candidate.priority,
      })),
    ]);
    const afterByKey = new Map(afterTraits.map((trait) => [trait.key, trait]));

    const nextRevision = persona.evolutionRevision + 1;
    await tx.characterPersona.update({
      where: { id: persona.id },
      data: { evolutionRevision: nextRevision, evolutionAppliedAt: new Date() },
    });

    const worldState = await tx.worldState.findUnique({
      where: { universeId_key: { universeId, key: "default" } },
      select: { currentDate: true },
    });
    const payload = {
      characterId,
      evolutionRevision: nextRevision,
      effects: pending.map((effect) => {
        const before = beforeByKey.get(effect.traitKey);
        const after = afterByKey.get(effect.traitKey);
        return {
          ruleCode: effect.ruleCode,
          traitKey: effect.traitKey,
          experienceId: effect.experienceId,
          beforeConfidence: before?.effectiveConfidence ?? null,
          afterConfidence: after?.effectiveConfidence ?? null,
          delta: effect.confidenceDelta,
        };
      }),
    } satisfies Prisma.InputJsonValue;

    const event = await appendTimelineEvent(tx, universeId, {
      worldDate: worldState?.currentDate ?? new Date(),
      kind: "PERSONA_UPDATED",
      payload,
      causedBy: "USER",
    });

    return {
      applied: true,
      evolutionRevision: nextRevision,
      effectsApplied: pending.length,
      timelineEventId: event.id,
    };
  });
}

async function loadContextWithin(
  tx: Prisma.TransactionClient,
  universeId: string,
  characterId: string,
) {
  const character = await tx.character.findUnique({
    where: { id: characterId },
    select: {
      id: true,
      universeId: true,
      userId: true,
      driverProfile: { select: { id: true } },
      persona: { include: { traits: true, traitEvolutions: true } },
    },
  });
  if (!character || character.universeId !== universeId || !character.driverProfile) {
    return null;
  }
  const experiences = await tx.pilotExperience.findMany({
    where: { universeId, characterId, status: "ACTIVE" },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });
  return { character, experiences };
}
