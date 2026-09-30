import { describe, expect, it } from "vitest";

import {
  computeEffectiveTraits,
  evolutionFingerprint,
  pendingEvolutionFingerprint,
  planEvolutionCandidates,
  type AppliedEvolutionEffect,
  type EvolutionExperienceLike,
} from "./persona-evolution.rules.js";

function experience(overrides: Partial<EvolutionExperienceLike> & { id: string }): EvolutionExperienceLike {
  return {
    experienceType: "CHAMPIONSHIP",
    salience: "CRITICAL",
    title: "título",
    occurredAt: null,
    ...overrides,
  };
}

function effect(overrides: Partial<AppliedEvolutionEffect> & { ruleCode: string; traitKey: string }): AppliedEvolutionEffect {
  return {
    confidenceDelta: 0.05,
    reason: "razão",
    experienceId: "e1",
    experienceTitle: "exp",
    value: null,
    priority: 1,
    ...overrides,
  };
}

describe("persona evolution planning", () => {
  it("1) apenas o primeiro campeonato dispara FIRST; os demais REPEAT", () => {
    const candidates = planEvolutionCandidates([
      experience({ id: "c2026", occurredAt: new Date("2026-12-01") }),
      experience({ id: "c2025", occurredAt: new Date("2025-12-01") }),
    ]);
    const first = candidates.filter((candidate) => candidate.ruleCode === "FIRST_WORLD_CHAMPIONSHIP");
    const repeat = candidates.filter((candidate) => candidate.ruleCode === "CHAMPIONSHIP_REPEAT");
    expect(first).toHaveLength(1);
    expect(first[0]?.experienceId).toBe("c2025");
    expect(repeat).toHaveLength(1);
    expect(repeat[0]?.experienceId).toBe("c2026");
    expect(repeat[0]?.value).toBe("Títulos como prioridade central");
  });

  it("2) regras de derrota/team change/conflito respeitam salience", () => {
    const candidates = planEvolutionCandidates([
      experience({ id: "d1", experienceType: "SPORTING_DEFEAT", salience: "HIGH" }),
      experience({ id: "d2", experienceType: "SPORTING_DEFEAT", salience: "LOW" }),
      experience({ id: "t1", experienceType: "TEAM_CHANGE", salience: "MEDIUM" }),
      experience({ id: "x1", experienceType: "CONFLICT", salience: "CRITICAL" }),
    ]);
    const codes = candidates.map((candidate) => `${candidate.ruleCode}:${candidate.experienceId}`);
    expect(codes).toContain("MAJOR_DEFEAT:d1");
    expect(codes).not.toContain("MAJOR_DEFEAT:d2");
    expect(codes).toContain("TEAM_CHANGE_STABILITY:t1");
    expect(codes).toContain("CONFLICT_PRESSURE:x1");
  });

  it("3) fingerprint de efeito e de conjunto é determinístico", () => {
    const a = evolutionFingerprint({ universeId: "u1", characterId: "c1", ruleCode: "R", experienceId: "e1" });
    const b = evolutionFingerprint({ universeId: "u1", characterId: "c1", ruleCode: "R", experienceId: "e1" });
    const c = evolutionFingerprint({ universeId: "u2", characterId: "c1", ruleCode: "R", experienceId: "e1" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(pendingEvolutionFingerprint(["b", "a"])).toBe(pendingEvolutionFingerprint(["a", "b"]));
    expect(pendingEvolutionFingerprint(["a"])).not.toBe(pendingEvolutionFingerprint(["b"]));
  });
});

describe("effective persona computation", () => {
  it("4) baseline + soma de deltas, sem mutar o valor base", () => {
    const traits = computeEffectiveTraits(
      [{ key: "confidence", value: "Elevada", confidence: 0.5, sourceKind: "EVIDENCE" }],
      [effect({ ruleCode: "FIRST", traitKey: "confidence", confidenceDelta: 0.06 })],
    );
    expect(traits[0]?.effectiveConfidence).toBeCloseTo(0.56, 5);
    expect(traits[0]?.baseConfidence).toBe(0.5);
    expect(traits[0]?.value).toBe("Elevada");
  });

  it("5) MANUAL vence: delta registrado mas não aplicado ao display", () => {
    const traits = computeEffectiveTraits(
      [{ key: "confidence", value: "Muito alta", confidence: 0.9, sourceKind: "MANUAL" }],
      [effect({ ruleCode: "FIRST", traitKey: "confidence", confidenceDelta: 0.06 })],
    );
    expect(traits[0]?.skippedManual).toBe(true);
    expect(traits[0]?.effectiveConfidence).toBe(0.9);
  });

  it("6) regra cria trait com valor canônico quando ausente e sem valor não inventa texto", () => {
    const created = computeEffectiveTraits(
      [],
      [effect({ ruleCode: "REPEAT", traitKey: "professionalPriorities", value: "Títulos como prioridade central", confidenceDelta: 0.03 })],
    );
    expect(created[0]?.effectiveConfidence).toBeCloseTo(0.53, 5);
    expect(created[0]?.value).toBe("Títulos como prioridade central");
    expect(created[0]?.sourceKind).toBe("RULE_DERIVED");

    const empty = computeEffectiveTraits([], [effect({ ruleCode: "DEFEAT", traitKey: "emotionalExpression" })]);
    expect(empty).toHaveLength(0);
  });

  it("7) soma determinística independente da ordem e clamp em [0,1]", () => {
    const effects = [
      effect({ ruleCode: "B", traitKey: "confidence", confidenceDelta: 0.1 }),
      effect({ ruleCode: "A", traitKey: "confidence", confidenceDelta: 0.1 }),
    ];
    const forward = computeEffectiveTraits(
      [{ key: "confidence", value: "x", confidence: 0.95, sourceKind: "EVIDENCE" }],
      effects,
    );
    const backward = computeEffectiveTraits(
      [{ key: "confidence", value: "x", confidence: 0.95, sourceKind: "EVIDENCE" }],
      [...effects].reverse(),
    );
    expect(forward[0]?.effectiveConfidence).toBe(1);
    expect(backward[0]?.effectiveConfidence).toBe(1);
  });
});
