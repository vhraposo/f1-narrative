import { createHash } from "node:crypto";

import type { MemoryImportance, PilotExperienceType } from "@prisma/client";

export type EvolutionTraitKey =
  | "confidence"
  | "competitiveness"
  | "emotionalExpression"
  | "communicationStyle"
  | "behavioralTendencies"
  | "professionalPriorities";

export const EVOLUTION_TRAIT_KEYS: readonly EvolutionTraitKey[] = [
  "confidence",
  "competitiveness",
  "emotionalExpression",
  "communicationStyle",
  "behavioralTendencies",
  "professionalPriorities",
];

export const EVOLUTION_TRAIT_LABELS: Record<EvolutionTraitKey, string> = {
  confidence: "Confiança",
  competitiveness: "Competitividade",
  emotionalExpression: "Expressão emocional",
  communicationStyle: "Estilo de comunicação",
  behavioralTendencies: "Tendências comportamentais",
  professionalPriorities: "Prioridades profissionais",
};

export type EvolutionRuleCode =
  | "FIRST_WORLD_CHAMPIONSHIP"
  | "CHAMPIONSHIP_REPEAT"
  | "MAJOR_DEFEAT"
  | "TEAM_CHANGE_STABILITY"
  | "CONFLICT_PRESSURE";

export type EvolutionExperienceLike = {
  readonly id: string;
  readonly experienceType: PilotExperienceType;
  readonly salience: MemoryImportance;
  readonly title: string;
  readonly occurredAt: Date | null;
};

export type EvolutionCandidate = {
  readonly ruleCode: EvolutionRuleCode;
  readonly priority: number;
  readonly traitKey: EvolutionTraitKey;
  readonly value: string | null;
  readonly confidenceDelta: number;
  readonly reason: string;
  readonly experienceId: string;
  readonly experienceTitle: string;
};

type RuleDefinition = {
  readonly code: EvolutionRuleCode;
  readonly priority: number;
  readonly traitKey: EvolutionTraitKey;
  readonly value: string | null;
  readonly confidenceDelta: number;
  readonly reason: string;
  readonly matches: (
    experience: EvolutionExperienceLike,
    context: { readonly isFirstChampionship: boolean },
  ) => boolean;
};

export const EVOLUTION_RULES: readonly RuleDefinition[] = [
  {
    code: "FIRST_WORLD_CHAMPIONSHIP",
    priority: 1,
    traitKey: "confidence",
    value: "Elevada após título mundial",
    confidenceDelta: 0.06,
    reason: "Primeiro campeonato mundial neste Universe",
    matches: (experience, context) =>
      experience.experienceType === "CHAMPIONSHIP" && context.isFirstChampionship,
  },
  {
    code: "CHAMPIONSHIP_REPEAT",
    priority: 2,
    traitKey: "professionalPriorities" as EvolutionTraitKey,
    value: "Títulos como prioridade central",
    confidenceDelta: 0.03,
    reason: "Título adicional neste Universe",
    matches: (experience, context) =>
      experience.experienceType === "CHAMPIONSHIP" && !context.isFirstChampionship,
  },
  {
    code: "MAJOR_DEFEAT",
    priority: 3,
    traitKey: "emotionalExpression",
    value: "Mais contida após derrota relevante",
    confidenceDelta: 0.03,
    reason: "Derrota relevante registrada no Universe",
    matches: (experience) =>
      experience.experienceType === "SPORTING_DEFEAT" &&
      (experience.salience === "HIGH" || experience.salience === "CRITICAL"),
  },
  {
    code: "TEAM_CHANGE_STABILITY",
    priority: 4,
    traitKey: "behavioralTendencies",
    value: "Adaptação a nova equipe",
    confidenceDelta: 0.02,
    reason: "Mudança de equipe neste Universe",
    matches: (experience) => experience.experienceType === "TEAM_CHANGE",
  },
  {
    code: "CONFLICT_PRESSURE",
    priority: 5,
    traitKey: "communicationStyle",
    value: "Direto em contexto de conflito",
    confidenceDelta: 0.02,
    reason: "Conflito registrado neste Universe",
    matches: (experience) =>
      experience.experienceType === "CONFLICT" &&
      (experience.salience === "HIGH" || experience.salience === "CRITICAL"),
  },
];

export function planEvolutionCandidates(
  experiences: readonly EvolutionExperienceLike[],
): EvolutionCandidate[] {
  const championshipExperiences = experiences
    .filter((experience) => experience.experienceType === "CHAMPIONSHIP")
    .sort((a, b) => {
      const aTime = a.occurredAt?.getTime() ?? 0;
      const bTime = b.occurredAt?.getTime() ?? 0;
      if (aTime !== bTime) return aTime - bTime;
      return a.id.localeCompare(b.id);
    });
  const firstChampionshipId = championshipExperiences[0]?.id ?? null;

  const candidates: EvolutionCandidate[] = [];
  for (const experience of experiences) {
    for (const rule of EVOLUTION_RULES) {
      const isFirstChampionship = experience.id === firstChampionshipId;
      if (!rule.matches(experience, { isFirstChampionship })) continue;
      candidates.push({
        ruleCode: rule.code,
        priority: rule.priority,
        traitKey: rule.traitKey,
        value: rule.value,
        confidenceDelta: rule.confidenceDelta,
        reason: rule.reason,
        experienceId: experience.id,
        experienceTitle: experience.title,
      });
    }
  }
  return candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.ruleCode !== b.ruleCode) return a.ruleCode.localeCompare(b.ruleCode);
    return a.experienceId.localeCompare(b.experienceId);
  });
}

export function evolutionFingerprint(input: {
  readonly universeId: string;
  readonly characterId: string;
  readonly ruleCode: string;
  readonly experienceId: string;
}): string {
  const canonical = `${input.universeId}|${input.characterId}|${input.ruleCode}|${input.experienceId}`;
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function pendingEvolutionFingerprint(fingerprints: readonly string[]): string {
  const canonical = [...fingerprints].sort().join("|");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export type BaseTrait = {
  readonly key: string;
  readonly value: string;
  readonly confidence: number;
  readonly sourceKind: "MANUAL" | "EVIDENCE";
};

export type AppliedEvolutionEffect = {
  readonly ruleCode: string;
  readonly traitKey: string;
  readonly confidenceDelta: number;
  readonly reason: string;
  readonly experienceId: string | null;
  readonly experienceTitle: string | null;
  readonly value: string | null;
  readonly priority: number;
  readonly status?: "ACTIVE" | "SUPERSEDED";
};

export type EffectiveTrait = {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly sourceKind: "MANUAL" | "EVIDENCE" | "RULE_DERIVED";
  readonly baseConfidence: number;
  readonly effectiveConfidence: number;
  readonly appliedEffects: readonly AppliedEvolutionEffect[];
  readonly skippedManual: boolean;
};

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

export function computeEffectiveTraits(
  baseTraits: readonly BaseTrait[],
  effects: readonly AppliedEvolutionEffect[],
): EffectiveTrait[] {
  const activeEffects = effects.filter((effect) => effect.status !== "SUPERSEDED");
  const effectsByKey = new Map<string, AppliedEvolutionEffect[]>();
  for (const effect of activeEffects) {
    const list = effectsByKey.get(effect.traitKey) ?? [];
    list.push(effect);
    effectsByKey.set(effect.traitKey, list);
  }
  for (const list of effectsByKey.values()) {
    list.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.ruleCode !== b.ruleCode) return a.ruleCode.localeCompare(b.ruleCode);
      return (a.experienceId ?? "").localeCompare(b.experienceId ?? "");
    });
  }

  const keys = [
    ...baseTraits.map((trait) => trait.key),
    ...effectsByKey.keys(),
  ].filter((key, index, all) => all.indexOf(key) === index);

  const result: EffectiveTrait[] = [];
  for (const key of keys) {
    const base = baseTraits.find((trait) => trait.key === key) ?? null;
    const keyEffects = effectsByKey.get(key) ?? [];
    const delta = keyEffects.reduce((sum, effect) => sum + effect.confidenceDelta, 0);

    if (base && base.sourceKind === "MANUAL") {
      result.push({
        key,
        label: EVOLUTION_TRAIT_LABELS[key as EvolutionTraitKey] ?? key,
        value: base.value,
        sourceKind: "MANUAL",
        baseConfidence: base.confidence,
        effectiveConfidence: clampConfidence(base.confidence),
        appliedEffects: keyEffects,
        skippedManual: keyEffects.length > 0,
      });
      continue;
    }
    if (base) {
      result.push({
        key,
        label: EVOLUTION_TRAIT_LABELS[key as EvolutionTraitKey] ?? key,
        value: base.value,
        sourceKind: "EVIDENCE",
        baseConfidence: base.confidence,
        effectiveConfidence: clampConfidence(base.confidence + delta),
        appliedEffects: keyEffects,
        skippedManual: false,
      });
      continue;
    }
    const creator = keyEffects.find((effect) => effect.value !== null);
    if (!creator || creator.value === null) continue;
    result.push({
      key,
      label: EVOLUTION_TRAIT_LABELS[key as EvolutionTraitKey] ?? key,
      value: creator.value,
      sourceKind: "RULE_DERIVED",
      baseConfidence: 0.5,
      effectiveConfidence: clampConfidence(0.5 + delta),
      appliedEffects: keyEffects,
      skippedManual: false,
    });
  }
  return result;
}

export type EvolutionEffectRow = {
  readonly ruleCode: string;
  readonly traitKey: string;
  readonly confidenceDelta: number;
  readonly reason: string;
  readonly sourceExperienceId: string | null;
  readonly value: string | null;
  readonly rulePriority: number;
  readonly experienceTitle: string | null;
  readonly status?: "ACTIVE" | "SUPERSEDED";
};

export function toAppliedEffect(row: EvolutionEffectRow): AppliedEvolutionEffect {
  return {
    ruleCode: row.ruleCode,
    traitKey: row.traitKey,
    confidenceDelta: row.confidenceDelta,
    reason: row.reason,
    experienceId: row.sourceExperienceId,
    experienceTitle: row.experienceTitle,
    value: row.value,
    priority: row.rulePriority,
    ...(row.status !== undefined ? { status: row.status } : {}),
  };
}
