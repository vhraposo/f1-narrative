import { describe, expect, it } from "vitest";
import {
  MANUAL_TRAIT_CONFIDENCE,
  MAX_EVIDENCE_EXCERPT_LENGTH,
  MAX_EVIDENCE_TITLE_LENGTH,
  MAX_EVIDENCE_URL_LENGTH,
  MAX_PROMPT_PERSONA_BLOCK_LENGTH,
  MAX_PROMPT_SUMMARY_LENGTH,
  MAX_PROMPT_TRAITS,
  MAX_SUMMARY_LENGTH,
  MAX_TRAIT_VALUE_LENGTH,
  PERSONA_EVIDENCE_TYPES,
  PERSONA_TRAIT_KEYS,
  PERSONA_TRAIT_REGISTRY,
  canTransitionPersonaEvidenceStatus,
  compareApprovedEvidenceAuthority,
  getPersonaTraitDefinition,
  inspectPersonaConfidence,
  inspectPersonaEvidenceExcerpt,
  inspectPersonaEvidenceProposal,
  inspectPersonaEvidencePublishedAt,
  inspectPersonaEvidenceSourceType,
  inspectPersonaEvidenceTitle,
  inspectPersonaEvidenceUrl,
  inspectPersonaProposedValue,
  inspectPersonaSummary,
  inspectPersonaTrait,
  inspectPersonaTraitKey,
  inspectPersonaTraitValue,
  isPersonaEvidenceType,
  isPersonaTraitKey,
  planPersonaEvidenceStatusTransition,
  planPersonaTraitReconcile,
  resolveAuthoritativeEvidence,
  resolveEvidenceAuthority,
  resolveManualTraitOverride,
  resolveTraitAuthority,
  resolveTraitConfidence,
  sortPersonaTraits,
  type PersonaEvidenceLike,
  type PersonaEvidenceStatus,
} from "./persona.rules.js";

function makeEvidence(
  overrides: Partial<PersonaEvidenceLike> & { id: string },
): PersonaEvidenceLike {
  return {
    traitKey: "humor",
    proposedValue: "Humor seco",
    confidence: 0.5,
    status: "APPROVED",
    publishedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function idOf(evidence: PersonaEvidenceLike | null): string | null {
  return evidence ? evidence.id : null;
}

describe("persona.rules — registry", () => {
  it("1) as oito keys existem, na ordem canônica", () => {
    expect(PERSONA_TRAIT_KEYS).toEqual([
      "communicationStyle",
      "speechStyle",
      "humor",
      "behavioralTendencies",
      "emotionalExpression",
      "competitiveness",
      "confidence",
      "interests",
    ]);
    expect(PERSONA_TRAIT_REGISTRY.map((definition) => definition.key)).toEqual([
      ...PERSONA_TRAIT_KEYS,
    ]);
  });

  it("2) labels corretos", () => {
    const labels = Object.fromEntries(
      PERSONA_TRAIT_REGISTRY.map((definition) => [definition.key, definition.label]),
    );
    expect(labels).toEqual({
      communicationStyle: "Estilo de comunicação",
      speechStyle: "Maneira de falar",
      humor: "Humor",
      behavioralTendencies: "Tendências comportamentais",
      emotionalExpression: "Expressão emocional",
      competitiveness: "Competitividade",
      confidence: "Autoconfiança",
      interests: "Interesses",
    });
  });

  it("3) prioridades corretas (1..8) e únicas", () => {
    const priorities = PERSONA_TRAIT_REGISTRY.map((definition) => definition.promptPriority);
    expect(priorities).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(priorities).size).toBe(priorities.length);
    PERSONA_TRAIT_KEYS.forEach((key, index) => {
      expect(getPersonaTraitDefinition(key).promptPriority).toBe(index + 1);
    });
  });

  it("4) caps corretos (valor 200; constantes de prompt/summary)", () => {
    for (const definition of PERSONA_TRAIT_REGISTRY) {
      expect(definition.maxValueLength).toBe(200);
      expect(definition.maxValueLength).toBe(MAX_TRAIT_VALUE_LENGTH);
    }
    expect(MAX_TRAIT_VALUE_LENGTH).toBe(200);
    expect(MAX_PROMPT_TRAITS).toBe(12);
    expect(MAX_PROMPT_PERSONA_BLOCK_LENGTH).toBe(2000);
    expect(MAX_SUMMARY_LENGTH).toBe(2000);
    expect(MAX_PROMPT_SUMMARY_LENGTH).toBe(600);
  });

  it("5) key desconhecida é rejeitada", () => {
    expect(isPersonaTraitKey("charisma")).toBe(false);
    expect(isPersonaTraitKey("humor")).toBe(true);
    expect(inspectPersonaTraitKey("charisma")).toBe("TRAIT_KEY_UNKNOWN");
    expect(inspectPersonaTraitKey("humor")).toBeNull();
    expect(
      inspectPersonaTrait({ key: "charisma", value: "valor válido" }),
    ).toContainEqual({ field: "traitKey", code: "TRAIT_KEY_UNKNOWN" });
    expect(() =>
      getPersonaTraitDefinition("charisma" as never),
    ).toThrowError(/charisma/);
  });
});

describe("persona.rules — validation", () => {
  it("6) value vazio (ou só espaços) é rejeitado", () => {
    expect(inspectPersonaTraitValue("")).toBe("TRAIT_VALUE_EMPTY");
    expect(inspectPersonaTraitValue("   ")).toBe("TRAIT_VALUE_EMPTY");
    expect(inspectPersonaTraitValue("frases curtas")).toBeNull();
  });

  it("7) value > 200 é rejeitado; 200 é aceito", () => {
    expect(inspectPersonaTraitValue("x".repeat(200))).toBeNull();
    expect(inspectPersonaTraitValue("x".repeat(201))).toBe("TRAIT_VALUE_TOO_LONG");
    expect(
      inspectPersonaTrait({ key: "humor", value: "x".repeat(201) }),
    ).toContainEqual({ field: "value", code: "TRAIT_VALUE_TOO_LONG" });
  });

  it("8) summary > 2000 é rejeitado; 2000 é aceito", () => {
    expect(inspectPersonaSummary("x".repeat(2000))).toBeNull();
    expect(inspectPersonaSummary("x".repeat(2001))).toBe("SUMMARY_TOO_LONG");
  });

  it("9) confidence < 0 é rejeitada (inclui NaN/Infinity)", () => {
    expect(inspectPersonaConfidence(-0.01)).toBe("CONFIDENCE_OUT_OF_RANGE");
    expect(inspectPersonaConfidence(Number.NaN)).toBe("CONFIDENCE_OUT_OF_RANGE");
    expect(inspectPersonaConfidence(Number.POSITIVE_INFINITY)).toBe(
      "CONFIDENCE_OUT_OF_RANGE",
    );
    expect(inspectPersonaConfidence(0)).toBeNull();
  });

  it("10) confidence > 1 é rejeitada; 1 é aceito", () => {
    expect(inspectPersonaConfidence(1.01)).toBe("CONFIDENCE_OUT_OF_RANGE");
    expect(inspectPersonaConfidence(1)).toBeNull();
  });

  it("11) proposedValue > 200 / vazio é rejeitado; 200 é aceito", () => {
    expect(inspectPersonaProposedValue("x".repeat(200))).toBeNull();
    expect(inspectPersonaProposedValue("x".repeat(201))).toBe(
      "PROPOSED_VALUE_TOO_LONG",
    );
    expect(inspectPersonaProposedValue("  ")).toBe("PROPOSED_VALUE_EMPTY");
    expect(
      inspectPersonaEvidenceProposal({
        traitKey: "humor",
        proposedValue: "x".repeat(201),
        confidence: 0.5,
      }),
    ).toContainEqual({ field: "proposedValue", code: "PROPOSED_VALUE_TOO_LONG" });
  });

  it("12) traitKey inválido em evidence e em trait", () => {
    expect(
      inspectPersonaEvidenceProposal({
        traitKey: "charisma",
        proposedValue: "valor válido",
        confidence: 0.5,
      }),
    ).toContainEqual({ field: "traitKey", code: "TRAIT_KEY_UNKNOWN" });
    expect(
      inspectPersonaTrait({ key: "charisma", value: "valor válido", confidence: 0.5 }),
    ).toContainEqual({ field: "traitKey", code: "TRAIT_KEY_UNKNOWN" });
    expect(
      inspectPersonaEvidenceProposal({
        traitKey: "humor",
        proposedValue: "valor válido",
        confidence: 1.5,
      }),
    ).toContainEqual({ field: "confidence", code: "CONFIDENCE_OUT_OF_RANGE" });
  });
});

describe("persona.rules — trait sorting", () => {
  it("13) promptPriority crescente domina confidence", () => {
    const sorted = sortPersonaTraits([
      { key: "interests", confidence: 1 },
      { key: "communicationStyle", confidence: 0.1 },
      { key: "humor", confidence: 0.5 },
    ]);
    expect(sorted.map((trait) => trait.key)).toEqual([
      "communicationStyle",
      "humor",
      "interests",
    ]);
  });

  it("14) desempate por confidence DESC (mesma prioridade)", () => {
    const sorted = sortPersonaTraits([
      { key: "alphaDesconhecida", confidence: 0.2 },
      { key: "zetaDesconhecida", confidence: 0.9 },
    ]);
    expect(sorted.map((trait) => trait.key)).toEqual([
      "zetaDesconhecida",
      "alphaDesconhecida",
    ]);
  });

  it("15) desempate por key ASC", () => {
    const sorted = sortPersonaTraits([
      { key: "zetaDesconhecida", confidence: 0.5 },
      { key: "alphaDesconhecida", confidence: 0.5 },
    ]);
    expect(sorted.map((trait) => trait.key)).toEqual([
      "alphaDesconhecida",
      "zetaDesconhecida",
    ]);
  });

  it("16) determinismo com input embaralhado (mesma coleção, mesma ordem)", () => {
    const traits = [
      { key: "interests", confidence: 0.4 },
      { key: "humor", confidence: 0.9 },
      { key: "communicationStyle", confidence: 1 },
      { key: "behavioralTendencies", confidence: 0.5 },
      { key: "speechStyle", confidence: 0.7 },
    ];
    const expected = JSON.stringify(sortPersonaTraits(traits));
    const permutations = [
      [4, 0, 2, 1, 3],
      [3, 2, 1, 0, 4],
      [1, 4, 3, 2, 0],
    ];
    for (const permutation of permutations) {
      const shuffled = permutation.map((index) => traits[index]);
      expect(JSON.stringify(sortPersonaTraits(shuffled))).toBe(expected);
    }
  });

  it("16b) chaves conhecidas vêm antes das desconhecidas e o input não é mutado", () => {
    const input = [
      { key: "zzzDesconhecida", confidence: 1 },
      { key: "humor", confidence: 0.1 },
    ];
    const snapshot = JSON.stringify(input);
    const sorted = sortPersonaTraits(input);
    expect(sorted.map((trait) => trait.key)).toEqual([
      "humor",
      "zzzDesconhecida",
    ]);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(sorted).not.toBe(input);
  });

  it("16c) comparator completo: confidence DESC, depois key ASC", () => {
    const a = { key: "bDesconhecida", confidence: 0.5 };
    const b = { key: "aDesconhecida", confidence: 0.5 };
    const c = { key: "cDesconhecida", confidence: 0.8 };
    expect(sortPersonaTraits([a, b, c]).map((trait) => trait.key)).toEqual([
      "cDesconhecida",
      "aDesconhecida",
      "bDesconhecida",
    ]);
  });
});

describe("persona.rules — evidence authority", () => {
  it("17) maior confidence vence", () => {
    const low = makeEvidence({ id: "low", confidence: 0.4 });
    const high = makeEvidence({ id: "high", confidence: 0.9 });
    expect(idOf(resolveAuthoritativeEvidence([low, high]))).toBe("high");
    expect(idOf(resolveAuthoritativeEvidence([high, low]))).toBe("high");
  });

  it("18) publishedAt é desempate (mais recente vence)", () => {
    const older = makeEvidence({
      id: "older",
      confidence: 0.8,
      publishedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const newer = makeEvidence({
      id: "newer",
      confidence: 0.8,
      publishedAt: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(idOf(resolveAuthoritativeEvidence([older, newer]))).toBe("newer");
  });

  it("19) publishedAt nulo perde para data preenchida", () => {
    const undated = makeEvidence({ id: "undated", confidence: 0.8, publishedAt: null });
    const dated = makeEvidence({
      id: "dated",
      confidence: 0.8,
      publishedAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    expect(idOf(resolveAuthoritativeEvidence([undated, dated]))).toBe("dated");
    expect(idOf(resolveAuthoritativeEvidence([dated, undated]))).toBe("dated");
  });

  it("20) createdAt é desempate (mais recente vence)", () => {
    const older = makeEvidence({
      id: "older",
      confidence: 0.8,
      publishedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const newer = makeEvidence({
      id: "newer",
      confidence: 0.8,
      publishedAt: null,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    expect(idOf(resolveAuthoritativeEvidence([older, newer]))).toBe("newer");
  });

  it("21) id ASC é o último desempate", () => {
    const same = {
      confidence: 0.8,
      publishedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    const a = makeEvidence({ id: "a", ...same });
    const b = makeEvidence({ id: "b", ...same });
    expect(idOf(resolveAuthoritativeEvidence([b, a]))).toBe("a");
    expect(idOf(resolveAuthoritativeEvidence([a, b]))).toBe("a");
  });

  it("22) evidências não-APPROVED são ignoradas", () => {
    const proposed = makeEvidence({ id: "proposed", status: "PROPOSED", confidence: 1 });
    const rejected = makeEvidence({ id: "rejected", status: "REJECTED", confidence: 1 });
    expect(resolveAuthoritativeEvidence([proposed, rejected])).toBeNull();

    const approved = makeEvidence({ id: "approved", status: "APPROVED", confidence: 0.1 });
    expect(idOf(resolveAuthoritativeEvidence([proposed, rejected, approved]))).toBe(
      "approved",
    );
  });

  it("23) mesma coleção em ordem diferente produz a mesma autoridade", () => {
    const evidences = [
      makeEvidence({ id: "a", confidence: 0.7, publishedAt: new Date("2026-02-01T00:00:00.000Z") }),
      makeEvidence({ id: "b", confidence: 0.7, publishedAt: new Date("2026-03-01T00:00:00.000Z") }),
      makeEvidence({ id: "c", confidence: 0.9, publishedAt: null }),
      makeEvidence({ id: "d", status: "PROPOSED", confidence: 1 }),
    ];
    const expected = idOf(resolveAuthoritativeEvidence(evidences));
    expect(expected).toBe("c");
    expect(idOf(resolveAuthoritativeEvidence([...evidences].reverse()))).toBe(expected);
    expect(
      idOf(resolveAuthoritativeEvidence([evidences[2], evidences[0], evidences[3], evidences[1]])),
    ).toBe(expected);
  });

  it("23b) comparator é total e não muta a coleção", () => {
    const evidences = [
      makeEvidence({ id: "a", confidence: 0.5 }),
      makeEvidence({ id: "b", confidence: 0.5 }),
    ];
    const snapshot = JSON.stringify(evidences);
    expect(compareApprovedEvidenceAuthority(evidences[0], evidences[0])).toBe(0);
    resolveAuthoritativeEvidence(evidences);
    expect(JSON.stringify(evidences)).toBe(snapshot);
  });
});

describe("persona.rules — confidence resolution", () => {
  it("24) MANUAL = 1.0 (mesmo com evidências aprovadas)", () => {
    const evidence = makeEvidence({ id: "e1", confidence: 0.3 });
    expect(resolveTraitConfidence("MANUAL", [])).toEqual({
      kind: "MANUAL",
      confidence: 1,
    });
    expect(resolveTraitConfidence("MANUAL", [evidence])).toEqual({
      kind: "MANUAL",
      confidence: MANUAL_TRAIT_CONFIDENCE,
    });
  });

  it("25) EVIDENCE = confidence da evidência autoritativa", () => {
    const low = makeEvidence({ id: "low", confidence: 0.6 });
    const high = makeEvidence({ id: "high", confidence: 0.9 });
    expect(resolveTraitConfidence("EVIDENCE", [low, high])).toEqual({
      kind: "EVIDENCE",
      confidence: 0.9,
      evidenceId: "high",
    });
  });

  it("26) múltiplas evidências não fazem média (nem soma/peso)", () => {
    const first = makeEvidence({ id: "a", confidence: 0.9 });
    const second = makeEvidence({ id: "b", confidence: 0.6 });
    const resolution = resolveTraitConfidence("EVIDENCE", [first, second]);
    expect(resolution).toEqual({
      kind: "EVIDENCE",
      confidence: 0.9,
      evidenceId: "a",
    });
    expect(resolution).not.toEqual({ kind: "EVIDENCE", confidence: 0.75, evidenceId: "a" });
  });

  it("27) sem evidência APPROVED não inventa valor (NONE)", () => {
    expect(resolveTraitConfidence("EVIDENCE", [])).toEqual({ kind: "NONE" });
    expect(
      resolveTraitConfidence("EVIDENCE", [
        makeEvidence({ id: "p", status: "PROPOSED", confidence: 1 }),
        makeEvidence({ id: "r", status: "REJECTED", confidence: 1 }),
      ]),
    ).toEqual({ kind: "NONE" });
    expect(resolveTraitConfidence(null, [])).toEqual({ kind: "NONE" });
  });
});

describe("persona.rules — evidence status transitions", () => {
  it("28) cada transição válida", () => {
    const valid: Array<[PersonaEvidenceStatus, PersonaEvidenceStatus]> = [
      ["PROPOSED", "APPROVED"],
      ["PROPOSED", "REJECTED"],
      ["APPROVED", "REJECTED"],
      ["REJECTED", "APPROVED"],
    ];
    for (const [from, to] of valid) {
      expect(canTransitionPersonaEvidenceStatus(from, to)).toBe(true);
      expect(planPersonaEvidenceStatusTransition(from, to)).toEqual({
        allowed: true,
        from,
        to,
      });
    }
  });

  it("29) cada transição inválida", () => {
    const invalid: Array<[PersonaEvidenceStatus, PersonaEvidenceStatus]> = [
      ["APPROVED", "PROPOSED"],
      ["REJECTED", "PROPOSED"],
    ];
    for (const [from, to] of invalid) {
      expect(canTransitionPersonaEvidenceStatus(from, to)).toBe(false);
      expect(planPersonaEvidenceStatusTransition(from, to)).toEqual({
        allowed: false,
        from,
        to,
        reason: "INVALID_TRANSITION",
      });
    }
  });

  it("30) mesmo status é inválido (reason SAME_STATUS)", () => {
    for (const status of ["PROPOSED", "APPROVED", "REJECTED"] as const) {
      expect(canTransitionPersonaEvidenceStatus(status, status)).toBe(false);
      expect(planPersonaEvidenceStatusTransition(status, status)).toEqual({
        allowed: false,
        from: status,
        to: status,
        reason: "SAME_STATUS",
      });
    }
  });
});

describe("persona.rules — source precedence", () => {
  it("31) MANUAL vence EVIDENCE", () => {
    const evidence = makeEvidence({ id: "e1", confidence: 1 });
    expect(resolveTraitAuthority("MANUAL", [evidence])).toEqual({ kind: "MANUAL" });
    expect(resolveTraitAuthority("MANUAL", [])).toEqual({ kind: "MANUAL" });
  });

  it("32) EVIDENCE usa a autoridade resolvida", () => {
    const low = makeEvidence({ id: "low", confidence: 0.2 });
    const high = makeEvidence({ id: "high", confidence: 0.8, proposedValue: "Provocador" });
    const authority = resolveTraitAuthority("EVIDENCE", [low, high]);
    expect(authority).toEqual({ kind: "EVIDENCE", evidence: high });
    expect(authority.kind === "EVIDENCE" ? authority.evidence.proposedValue : null).toBe(
      "Provocador",
    );
  });

  it("33) sem manual e sem evidência APPROVED = vazio; evidência fornece base", () => {
    expect(resolveTraitAuthority(null, [])).toEqual({ kind: "NONE" });
    expect(resolveTraitAuthority("EVIDENCE", [])).toEqual({ kind: "NONE" });
    const evidence = makeEvidence({ id: "e1", confidence: 0.5 });
    expect(resolveTraitAuthority(null, [evidence])).toEqual({
      kind: "EVIDENCE",
      evidence,
    });
  });
});

describe("persona.rules — evidence conflict", () => {
  it("34) valores diferentes coexistem (autoritativa + conflitante)", () => {
    const authoritative = makeEvidence({
      id: "winner",
      proposedValue: "Humor seco",
      confidence: 0.9,
    });
    const conflicting = makeEvidence({
      id: "other",
      proposedValue: "Humor físico",
      confidence: 0.7,
    });
    const resolution = resolveEvidenceAuthority([conflicting, authoritative]);
    expect(idOf(resolution.authoritative)).toBe("winner");
    expect(resolution.supporting).toEqual([]);
    expect(resolution.conflicting.map((item) => item.id)).toEqual(["other"]);
  });

  it("35) authority determinística com conflito (ordem não importa)", () => {
    const a = makeEvidence({ id: "a", proposedValue: "A", confidence: 0.7, publishedAt: new Date("2026-01-01T00:00:00.000Z") });
    const b = makeEvidence({ id: "b", proposedValue: "B", confidence: 0.7, publishedAt: new Date("2026-02-01T00:00:00.000Z") });
    const c = makeEvidence({ id: "c", proposedValue: "C", confidence: 0.7, publishedAt: new Date("2026-02-01T00:00:00.000Z") });
    for (const order of [
      [a, b, c],
      [c, b, a],
      [b, c, a],
    ]) {
      expect(idOf(resolveEvidenceAuthority(order).authoritative)).toBe("b");
    }
  });

  it("36) suporte e conflito são preservados semanticamente", () => {
    const authoritative = makeEvidence({
      id: "winner",
      proposedValue: "Humor seco",
      confidence: 0.9,
    });
    const supporter = makeEvidence({
      id: "supporter",
      proposedValue: "Humor seco",
      confidence: 0.6,
    });
    const conflicting = makeEvidence({
      id: "conflicting",
      proposedValue: "Humor físico",
      confidence: 0.8,
    });
    const nonApproved = makeEvidence({ id: "pending", status: "PROPOSED", confidence: 1 });
    const resolution = resolveEvidenceAuthority([
      nonApproved,
      conflicting,
      supporter,
      authoritative,
    ]);
    expect(idOf(resolution.authoritative)).toBe("winner");
    expect(resolution.supporting.map((item) => item.id)).toEqual(["supporter"]);
    expect(resolution.conflicting.map((item) => item.id)).toEqual(["conflicting"]);
  });

  it("37) conflito não gera erro nem apaga evidências", () => {
    const a = makeEvidence({ id: "a", proposedValue: "A", confidence: 0.5 });
    const b = makeEvidence({ id: "b", proposedValue: "B", confidence: 0.5 });
    const input = [a, b];
    const snapshot = JSON.stringify(input);
    expect(() => resolveEvidenceAuthority(input)).not.toThrow();
    const resolution = resolveEvidenceAuthority(input);
    expect(resolution.authoritative).not.toBeNull();
    expect(
      (resolution.supporting.length + resolution.conflicting.length),
    ).toBe(1);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("37b) sem APPROVED retorna estrutura vazia", () => {
    expect(
      resolveEvidenceAuthority([
        makeEvidence({ id: "p", status: "PROPOSED" }),
        makeEvidence({ id: "r", status: "REJECTED" }),
      ]),
    ).toEqual({ authoritative: null, supporting: [], conflicting: [] });
  });
});

describe("persona.rules — reconcile plan", () => {
  it("38) A) nenhuma evidência APPROVED + nenhum trait manual = nenhum trait efetivo", () => {
    expect(
      planPersonaTraitReconcile({
        currentSourceKind: null,
        currentEvidenceId: null,
        evidences: [],
      }),
    ).toEqual({ kind: "NO_EFFECTIVE_TRAIT" });
    expect(
      planPersonaTraitReconcile({
        currentSourceKind: null,
        currentEvidenceId: null,
        evidences: [makeEvidence({ id: "p", status: "PROPOSED" })],
      }),
    ).toEqual({ kind: "NO_EFFECTIVE_TRAIT" });
  });

  it("39) B) evidência APPROVED + nenhum manual = trait EVIDENCE", () => {
    const evidence = makeEvidence({ id: "e1", proposedValue: "Provocador", confidence: 0.8 });
    expect(
      planPersonaTraitReconcile({
        currentSourceKind: null,
        currentEvidenceId: null,
        evidences: [evidence],
      }),
    ).toEqual({
      kind: "SET_EVIDENCE_TRAIT",
      evidenceId: "e1",
      value: "Provocador",
      confidence: 0.8,
      changed: true,
    });
  });

  it("40) C) evidência APPROVED + trait MANUAL = MANUAL permanece", () => {
    expect(
      planPersonaTraitReconcile({
        currentSourceKind: "MANUAL",
        currentEvidenceId: null,
        evidences: [makeEvidence({ id: "e1", confidence: 1 })],
      }),
    ).toEqual({ kind: "KEEP_MANUAL_TRAIT" });
  });

  it("41) D) trait EVIDENCE + autoridade mudou = novo valor autoritativo", () => {
    const next = makeEvidence({ id: "next", proposedValue: "Reservado", confidence: 0.9 });
    expect(
      planPersonaTraitReconcile({
        currentSourceKind: "EVIDENCE",
        currentEvidenceId: "old",
        evidences: [next],
      }),
    ).toEqual({
      kind: "SET_EVIDENCE_TRAIT",
      evidenceId: "next",
      value: "Reservado",
      confidence: 0.9,
      changed: true,
    });
    expect(
      planPersonaTraitReconcile({
        currentSourceKind: "EVIDENCE",
        currentEvidenceId: "next",
        evidences: [next],
      }),
    ).toEqual({
      kind: "SET_EVIDENCE_TRAIT",
      evidenceId: "next",
      value: "Reservado",
      confidence: 0.9,
      changed: false,
    });
  });

  it("42) E) trait EVIDENCE + sem evidência APPROVED = remoção", () => {
    expect(
      planPersonaTraitReconcile({
        currentSourceKind: "EVIDENCE",
        currentEvidenceId: "old",
        evidences: [],
      }),
    ).toEqual({ kind: "REMOVE_EVIDENCE_TRAIT" });
    expect(
      planPersonaTraitReconcile({
        currentSourceKind: "EVIDENCE",
        currentEvidenceId: "old",
        evidences: [makeEvidence({ id: "old", status: "REJECTED" })],
      }),
    ).toEqual({ kind: "REMOVE_EVIDENCE_TRAIT" });
  });

  it("43) F) trait MANUAL + evidência rejeitada = MANUAL permanece", () => {
    expect(
      planPersonaTraitReconcile({
        currentSourceKind: "MANUAL",
        currentEvidenceId: null,
        evidences: [makeEvidence({ id: "r", status: "REJECTED" })],
      }),
    ).toEqual({ kind: "KEEP_MANUAL_TRAIT" });
  });

  it("43b) G) remoção manual não é ressuscitada (nenhuma decisão recria trait MANUAL)", () => {
    const decisions = [
      planPersonaTraitReconcile({
        currentSourceKind: null,
        currentEvidenceId: null,
        evidences: [makeEvidence({ id: "e1", confidence: 0.9 })],
      }),
      planPersonaTraitReconcile({
        currentSourceKind: null,
        currentEvidenceId: null,
        evidences: [],
      }),
    ];
    for (const decision of decisions) {
      expect(decision.kind).not.toBe("KEEP_MANUAL_TRAIT");
    }
    expect(decisions[0].kind).toBe("SET_EVIDENCE_TRAIT");
    expect(decisions[1].kind).toBe("NO_EFFECTIVE_TRAIT");
  });

  it("43c) override manual limpa evidência e fixa confidence 1.0", () => {
    expect(resolveManualTraitOverride()).toEqual({
      sourceKind: "MANUAL",
      confidence: MANUAL_TRAIT_CONFIDENCE,
      evidenceId: null,
    });
    expect(resolveManualTraitOverride().confidence).toBe(1);
  });
});

describe("persona.rules — evidence metadata validation", () => {
  it("44) metadados válidos passam (inclui ausentes opcionais)", () => {
    expect(
      inspectPersonaEvidenceProposal({
        traitKey: "humor",
        proposedValue: "Sarcástico",
        confidence: 0.7,
        sourceType: "INTERVIEW",
        title: "Entrevista",
        url: "https://example.com/fonte",
        publishedAt: new Date("2026-01-15T00:00:00.000Z"),
        excerpt: "Trecho",
      }),
    ).toEqual([]);
    expect(
      inspectPersonaEvidenceProposal({
        traitKey: "humor",
        proposedValue: "Sarcástico",
        confidence: 0.7,
      }),
    ).toEqual([]);
  });

  it("45) title vazio ou > 200 é rejeitado", () => {
    expect(inspectPersonaEvidenceTitle("")).toBe("EVIDENCE_TITLE_EMPTY");
    expect(inspectPersonaEvidenceTitle("   ")).toBe("EVIDENCE_TITLE_EMPTY");
    expect(inspectPersonaEvidenceTitle("x".repeat(200))).toBeNull();
    expect(inspectPersonaEvidenceTitle("x".repeat(201))).toBe(
      "EVIDENCE_TITLE_TOO_LONG",
    );
    expect(MAX_EVIDENCE_TITLE_LENGTH).toBe(200);
  });

  it("46) excerpt vazio ou > 500 é rejeitado", () => {
    expect(inspectPersonaEvidenceExcerpt("")).toBe("EVIDENCE_EXCERPT_EMPTY");
    expect(inspectPersonaEvidenceExcerpt("x".repeat(500))).toBeNull();
    expect(inspectPersonaEvidenceExcerpt("x".repeat(501))).toBe(
      "EVIDENCE_EXCERPT_TOO_LONG",
    );
    expect(MAX_EVIDENCE_EXCERPT_LENGTH).toBe(500);
  });

  it("47) url inválida, protocolo não-http ou > 2048 é rejeitada; ausente é válida", () => {
    expect(inspectPersonaEvidenceUrl(null)).toBeNull();
    expect(inspectPersonaEvidenceUrl(undefined)).toBeNull();
    expect(inspectPersonaEvidenceUrl("https://example.com/fonte")).toBeNull();
    expect(inspectPersonaEvidenceUrl("http://example.com")).toBeNull();
    expect(inspectPersonaEvidenceUrl("não é url")).toBe("EVIDENCE_URL_INVALID");
    expect(inspectPersonaEvidenceUrl("ftp://example.com")).toBe(
      "EVIDENCE_URL_INVALID",
    );
    expect(inspectPersonaEvidenceUrl(`https://example.com/${"x".repeat(2048)}`)).toBe(
      "EVIDENCE_URL_TOO_LONG",
    );
    expect(MAX_EVIDENCE_URL_LENGTH).toBe(2048);
  });

  it("48) publishedAt inválida é rejeitada; ausente/nula são válidas", () => {
    expect(inspectPersonaEvidencePublishedAt(null)).toBeNull();
    expect(inspectPersonaEvidencePublishedAt(undefined)).toBeNull();
    expect(inspectPersonaEvidencePublishedAt(new Date("2026-01-15T00:00:00.000Z"))).toBeNull();
    expect(inspectPersonaEvidencePublishedAt(new Date("invalid"))).toBe(
      "EVIDENCE_PUBLISHED_AT_INVALID",
    );
  });

  it("49) sourceType válido é aceito e desconhecido é rejeitado", () => {
    expect(isPersonaEvidenceType("INTERVIEW")).toBe(true);
    expect(isPersonaEvidenceType("PODCAST")).toBe(false);
    expect(PERSONA_EVIDENCE_TYPES).toEqual([
      "OFFICIAL_PROFILE",
      "INTERVIEW",
      "BIOGRAPHY",
      "PUBLIC_STATEMENT",
      "OTHER_APPROVED",
    ]);
    for (const sourceType of PERSONA_EVIDENCE_TYPES) {
      expect(inspectPersonaEvidenceSourceType(sourceType)).toBeNull();
    }
    expect(inspectPersonaEvidenceSourceType("PODCAST")).toBe(
      "EVIDENCE_SOURCE_TYPE_UNKNOWN",
    );
  });

  it("50) proposal agregada reporta issues de metadados", () => {
    const issues = inspectPersonaEvidenceProposal({
      traitKey: "humor",
      proposedValue: "Sarcástico",
      confidence: 0.7,
      sourceType: "PODCAST",
      title: "x".repeat(201),
      url: "não é url",
      publishedAt: new Date("invalid"),
      excerpt: "x".repeat(501),
    });
    expect(issues).toContainEqual({ field: "sourceType", code: "EVIDENCE_SOURCE_TYPE_UNKNOWN" });
    expect(issues).toContainEqual({ field: "title", code: "EVIDENCE_TITLE_TOO_LONG" });
    expect(issues).toContainEqual({ field: "url", code: "EVIDENCE_URL_INVALID" });
    expect(issues).toContainEqual({
      field: "publishedAt",
      code: "EVIDENCE_PUBLISHED_AT_INVALID",
    });
    expect(issues).toContainEqual({ field: "excerpt", code: "EVIDENCE_EXCERPT_TOO_LONG" });
  });
});
