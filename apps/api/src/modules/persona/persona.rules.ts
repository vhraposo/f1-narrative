export const MAX_TRAIT_VALUE_LENGTH = 200;
export const MAX_PROMPT_TRAITS = 12;
export const MAX_PROMPT_PERSONA_BLOCK_LENGTH = 2000;
export const MAX_SUMMARY_LENGTH = 2000;
export const MAX_PROMPT_SUMMARY_LENGTH = 600;
export const MANUAL_TRAIT_CONFIDENCE = 1;

export const PERSONA_TRAIT_KEYS = [
  "communicationStyle",
  "speechStyle",
  "humor",
  "behavioralTendencies",
  "emotionalExpression",
  "competitiveness",
  "confidence",
  "interests",
] as const;

export type PersonaTraitKey = (typeof PERSONA_TRAIT_KEYS)[number];

export type PersonaTraitDefinition = {
  readonly key: PersonaTraitKey;
  readonly label: string;
  readonly promptPriority: number;
  readonly maxValueLength: number;
};

export const PERSONA_TRAIT_REGISTRY: readonly PersonaTraitDefinition[] = [
  {
    key: "communicationStyle",
    label: "Estilo de comunicação",
    promptPriority: 1,
    maxValueLength: MAX_TRAIT_VALUE_LENGTH,
  },
  {
    key: "speechStyle",
    label: "Maneira de falar",
    promptPriority: 2,
    maxValueLength: MAX_TRAIT_VALUE_LENGTH,
  },
  {
    key: "humor",
    label: "Humor",
    promptPriority: 3,
    maxValueLength: MAX_TRAIT_VALUE_LENGTH,
  },
  {
    key: "behavioralTendencies",
    label: "Tendências comportamentais",
    promptPriority: 4,
    maxValueLength: MAX_TRAIT_VALUE_LENGTH,
  },
  {
    key: "emotionalExpression",
    label: "Expressão emocional",
    promptPriority: 5,
    maxValueLength: MAX_TRAIT_VALUE_LENGTH,
  },
  {
    key: "competitiveness",
    label: "Competitividade",
    promptPriority: 6,
    maxValueLength: MAX_TRAIT_VALUE_LENGTH,
  },
  {
    key: "confidence",
    label: "Autoconfiança",
    promptPriority: 7,
    maxValueLength: MAX_TRAIT_VALUE_LENGTH,
  },
  {
    key: "interests",
    label: "Interesses",
    promptPriority: 8,
    maxValueLength: MAX_TRAIT_VALUE_LENGTH,
  },
];

const REGISTRY_BY_KEY = new Map<PersonaTraitKey, PersonaTraitDefinition>(
  PERSONA_TRAIT_REGISTRY.map((definition) => [definition.key, definition]),
);

const UNKNOWN_TRAIT_PRIORITY = Number.MAX_SAFE_INTEGER;

export function isPersonaTraitKey(value: string): value is PersonaTraitKey {
  return REGISTRY_BY_KEY.has(value as PersonaTraitKey);
}

export function getPersonaTraitDefinition(key: PersonaTraitKey): PersonaTraitDefinition {
  const definition = REGISTRY_BY_KEY.get(key);
  if (!definition) {
    throw new Error(`Persona trait key desconhecida: ${key}`);
  }
  return definition;
}

export type PersonaTraitSource = "MANUAL" | "EVIDENCE";

export type PersonaEvidenceStatus = "PROPOSED" | "APPROVED" | "REJECTED";

export type PersonaTraitKeyIssue = "TRAIT_KEY_UNKNOWN";
export type PersonaTraitValueIssue = "TRAIT_VALUE_EMPTY" | "TRAIT_VALUE_TOO_LONG";
export type PersonaSummaryIssue = "SUMMARY_TOO_LONG";
export type PersonaConfidenceIssue = "CONFIDENCE_OUT_OF_RANGE";
export type PersonaProposedValueIssue =
  | "PROPOSED_VALUE_EMPTY"
  | "PROPOSED_VALUE_TOO_LONG";

export type PersonaRuleIssue =
  | { readonly field: "traitKey"; readonly code: PersonaTraitKeyIssue }
  | { readonly field: "value"; readonly code: PersonaTraitValueIssue }
  | { readonly field: "summary"; readonly code: PersonaSummaryIssue }
  | { readonly field: "confidence"; readonly code: PersonaConfidenceIssue }
  | { readonly field: "proposedValue"; readonly code: PersonaProposedValueIssue };

export function inspectPersonaTraitKey(key: string): PersonaTraitKeyIssue | null {
  if (!isPersonaTraitKey(key)) return "TRAIT_KEY_UNKNOWN";
  return null;
}

export function inspectPersonaTraitValue(value: string): PersonaTraitValueIssue | null {
  if (value.trim().length === 0) return "TRAIT_VALUE_EMPTY";
  if (value.length > MAX_TRAIT_VALUE_LENGTH) return "TRAIT_VALUE_TOO_LONG";
  return null;
}

export function inspectPersonaSummary(summary: string): PersonaSummaryIssue | null {
  if (summary.length > MAX_SUMMARY_LENGTH) return "SUMMARY_TOO_LONG";
  return null;
}

export function inspectPersonaConfidence(confidence: number): PersonaConfidenceIssue | null {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return "CONFIDENCE_OUT_OF_RANGE";
  }
  return null;
}

export function inspectPersonaProposedValue(value: string): PersonaProposedValueIssue | null {
  if (value.trim().length === 0) return "PROPOSED_VALUE_EMPTY";
  if (value.length > MAX_TRAIT_VALUE_LENGTH) return "PROPOSED_VALUE_TOO_LONG";
  return null;
}

export function inspectPersonaTrait(input: {
  readonly key: string;
  readonly value: string;
  readonly confidence?: number;
}): readonly PersonaRuleIssue[] {
  const issues: PersonaRuleIssue[] = [];

  const keyIssue = inspectPersonaTraitKey(input.key);
  if (keyIssue) issues.push({ field: "traitKey", code: keyIssue });

  const valueIssue = inspectPersonaTraitValue(input.value);
  if (valueIssue) issues.push({ field: "value", code: valueIssue });

  if (input.confidence !== undefined) {
    const confidenceIssue = inspectPersonaConfidence(input.confidence);
    if (confidenceIssue) issues.push({ field: "confidence", code: confidenceIssue });
  }

  return issues;
}

export function inspectPersonaEvidenceProposal(input: {
  readonly traitKey: string;
  readonly proposedValue: string;
  readonly confidence: number;
}): readonly PersonaRuleIssue[] {
  const issues: PersonaRuleIssue[] = [];

  const keyIssue = inspectPersonaTraitKey(input.traitKey);
  if (keyIssue) issues.push({ field: "traitKey", code: keyIssue });

  const proposedValueIssue = inspectPersonaProposedValue(input.proposedValue);
  if (proposedValueIssue) issues.push({ field: "proposedValue", code: proposedValueIssue });

  const confidenceIssue = inspectPersonaConfidence(input.confidence);
  if (confidenceIssue) issues.push({ field: "confidence", code: confidenceIssue });

  return issues;
}

export type PersonaTraitSortInput = {
  readonly key: string;
  readonly confidence: number;
};

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function promptPriorityFor(key: string): number {
  return isPersonaTraitKey(key)
    ? getPersonaTraitDefinition(key).promptPriority
    : UNKNOWN_TRAIT_PRIORITY;
}

export function comparePersonaTraits(
  a: PersonaTraitSortInput,
  b: PersonaTraitSortInput,
): number {
  const priorityA = promptPriorityFor(a.key);
  const priorityB = promptPriorityFor(b.key);
  if (priorityA !== priorityB) return priorityA - priorityB;

  if (a.confidence !== b.confidence) return b.confidence - a.confidence;

  return compareText(a.key, b.key);
}

export function sortPersonaTraits<T extends PersonaTraitSortInput>(
  traits: readonly T[],
): T[] {
  return [...traits].sort(comparePersonaTraits);
}

export type PersonaEvidenceLike = {
  readonly id: string;
  readonly traitKey: string;
  readonly proposedValue: string;
  readonly confidence: number;
  readonly status: PersonaEvidenceStatus;
  readonly publishedAt: Date | null;
  readonly createdAt: Date;
};

function comparePublishedAtDesc(a: Date | null, b: Date | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b.getTime() - a.getTime();
}

export function compareApprovedEvidenceAuthority(
  a: PersonaEvidenceLike,
  b: PersonaEvidenceLike,
): number {
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;

  const published = comparePublishedAtDesc(a.publishedAt, b.publishedAt);
  if (published !== 0) return published;

  const created = b.createdAt.getTime() - a.createdAt.getTime();
  if (created !== 0) return created;

  return compareText(a.id, b.id);
}

export function resolveAuthoritativeEvidence<T extends PersonaEvidenceLike>(
  evidences: readonly T[],
): T | null {
  const approved = evidences.filter((evidence) => evidence.status === "APPROVED");
  if (approved.length === 0) return null;
  return [...approved].sort(compareApprovedEvidenceAuthority)[0];
}

export type PersonaEvidenceAuthority<T extends PersonaEvidenceLike> = {
  readonly authoritative: T | null;
  readonly supporting: readonly T[];
  readonly conflicting: readonly T[];
};

export function resolveEvidenceAuthority<T extends PersonaEvidenceLike>(
  evidences: readonly T[],
): PersonaEvidenceAuthority<T> {
  const authoritative = resolveAuthoritativeEvidence(evidences);
  if (!authoritative) {
    return { authoritative: null, supporting: [], conflicting: [] };
  }

  const others = evidences.filter(
    (evidence) =>
      evidence.status === "APPROVED" && evidence.id !== authoritative.id,
  );

  return {
    authoritative,
    supporting: others.filter(
      (evidence) => evidence.proposedValue === authoritative.proposedValue,
    ),
    conflicting: others.filter(
      (evidence) => evidence.proposedValue !== authoritative.proposedValue,
    ),
  };
}

export type PersonaTraitConfidenceResolution =
  | { readonly kind: "MANUAL"; readonly confidence: number }
  | { readonly kind: "EVIDENCE"; readonly confidence: number; readonly evidenceId: string }
  | { readonly kind: "NONE" };

export function resolveTraitConfidence(
  sourceKind: PersonaTraitSource | null,
  evidences: readonly PersonaEvidenceLike[],
): PersonaTraitConfidenceResolution {
  if (sourceKind === "MANUAL") {
    return { kind: "MANUAL", confidence: MANUAL_TRAIT_CONFIDENCE };
  }

  if (sourceKind === "EVIDENCE") {
    const authoritative = resolveAuthoritativeEvidence(evidences);
    if (!authoritative) return { kind: "NONE" };
    return {
      kind: "EVIDENCE",
      confidence: authoritative.confidence,
      evidenceId: authoritative.id,
    };
  }

  return { kind: "NONE" };
}

const ALLOWED_EVIDENCE_TRANSITIONS: Record<
  PersonaEvidenceStatus,
  readonly PersonaEvidenceStatus[]
> = {
  PROPOSED: ["APPROVED", "REJECTED"],
  APPROVED: ["REJECTED"],
  REJECTED: ["APPROVED"],
};

export function canTransitionPersonaEvidenceStatus(
  from: PersonaEvidenceStatus,
  to: PersonaEvidenceStatus,
): boolean {
  return ALLOWED_EVIDENCE_TRANSITIONS[from].includes(to);
}

export type PersonaEvidenceTransitionPlan =
  | {
      readonly allowed: true;
      readonly from: PersonaEvidenceStatus;
      readonly to: PersonaEvidenceStatus;
    }
  | {
      readonly allowed: false;
      readonly from: PersonaEvidenceStatus;
      readonly to: PersonaEvidenceStatus;
      readonly reason: "SAME_STATUS" | "INVALID_TRANSITION";
    };

export function planPersonaEvidenceStatusTransition(
  from: PersonaEvidenceStatus,
  to: PersonaEvidenceStatus,
): PersonaEvidenceTransitionPlan {
  if (from === to) {
    return { allowed: false, from, to, reason: "SAME_STATUS" };
  }
  if (!canTransitionPersonaEvidenceStatus(from, to)) {
    return { allowed: false, from, to, reason: "INVALID_TRANSITION" };
  }
  return { allowed: true, from, to };
}

export type PersonaTraitAuthority<T extends PersonaEvidenceLike = PersonaEvidenceLike> =
  | { readonly kind: "MANUAL" }
  | { readonly kind: "EVIDENCE"; readonly evidence: T }
  | { readonly kind: "NONE" };

export function resolveTraitAuthority<T extends PersonaEvidenceLike>(
  sourceKind: PersonaTraitSource | null,
  evidences: readonly T[],
): PersonaTraitAuthority<T> {
  if (sourceKind === "MANUAL") return { kind: "MANUAL" };

  const authoritative = resolveAuthoritativeEvidence(evidences);
  if (!authoritative) return { kind: "NONE" };

  return { kind: "EVIDENCE", evidence: authoritative };
}

export type ManualTraitOverride = {
  readonly sourceKind: "MANUAL";
  readonly confidence: number;
  readonly evidenceId: null;
};

export function resolveManualTraitOverride(): ManualTraitOverride {
  return {
    sourceKind: "MANUAL",
    confidence: MANUAL_TRAIT_CONFIDENCE,
    evidenceId: null,
  };
}

export type PersonaTraitReconcileInput = {
  readonly currentSourceKind: PersonaTraitSource | null;
  readonly currentEvidenceId: string | null;
  readonly evidences: readonly PersonaEvidenceLike[];
};

export type PersonaTraitReconcileDecision =
  | { readonly kind: "NO_EFFECTIVE_TRAIT" }
  | { readonly kind: "KEEP_MANUAL_TRAIT" }
  | {
      readonly kind: "SET_EVIDENCE_TRAIT";
      readonly evidenceId: string;
      readonly value: string;
      readonly confidence: number;
      readonly changed: boolean;
    }
  | { readonly kind: "REMOVE_EVIDENCE_TRAIT" };

export function planPersonaTraitReconcile(
  input: PersonaTraitReconcileInput,
): PersonaTraitReconcileDecision {
  if (input.currentSourceKind === "MANUAL") {
    return { kind: "KEEP_MANUAL_TRAIT" };
  }

  const authoritative = resolveAuthoritativeEvidence(input.evidences);

  if (!authoritative) {
    return input.currentSourceKind === "EVIDENCE"
      ? { kind: "REMOVE_EVIDENCE_TRAIT" }
      : { kind: "NO_EFFECTIVE_TRAIT" };
  }

  return {
    kind: "SET_EVIDENCE_TRAIT",
    evidenceId: authoritative.id,
    value: authoritative.proposedValue,
    confidence: authoritative.confidence,
    changed: input.currentEvidenceId !== authoritative.id,
  };
}
