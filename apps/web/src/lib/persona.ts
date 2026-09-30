import { get, patch, post, remove } from "./api";

export type PersonaOrigin = "ORIGINAL" | "REAL_DRIVER" | "AI_CHARACTER";
export type PersonaTraitSource = "MANUAL" | "EVIDENCE";
export type PersonaEvidenceStatus = "PROPOSED" | "APPROVED" | "REJECTED";
export type PersonaEvidenceRole =
  | "AUTHORITATIVE"
  | "SUPPORTING"
  | "CONFLICTING"
  | null;
export type PersonaEvidenceType =
  | "OFFICIAL_PROFILE"
  | "INTERVIEW"
  | "BIOGRAPHY"
  | "PUBLIC_STATEMENT"
  | "OTHER_APPROVED";

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

export const PERSONA_TRAIT_LABELS: Record<PersonaTraitKey, string> = {
  communicationStyle: "Estilo de comunicação",
  speechStyle: "Maneira de falar",
  humor: "Humor",
  behavioralTendencies: "Tendências comportamentais",
  emotionalExpression: "Expressão emocional",
  competitiveness: "Competitividade",
  confidence: "Autoconfiança",
  interests: "Interesses",
};

export const PERSONA_EVIDENCE_TYPE_LABELS: Record<PersonaEvidenceType, string> = {
  OFFICIAL_PROFILE: "Perfil oficial",
  INTERVIEW: "Entrevista",
  BIOGRAPHY: "Biografia",
  PUBLIC_STATEMENT: "Declaração pública",
  OTHER_APPROVED: "Outra fonte aprovada",
};

export const PERSONA_EVIDENCE_STATUS_LABELS: Record<PersonaEvidenceStatus, string> = {
  PROPOSED: "Pendente",
  APPROVED: "Aprovada",
  REJECTED: "Rejeitada",
};

export const PERSONA_EVIDENCE_ROLE_LABELS: Record<
  Exclude<PersonaEvidenceRole, null>,
  string
> = {
  AUTHORITATIVE: "Aplicada",
  SUPPORTING: "Suporte",
  CONFLICTING: "Conflito",
};

export function personaTraitLabel(key: string): string {
  return (PERSONA_TRAIT_LABELS as Record<string, string>)[key] ?? key;
}

export function personaEvidenceTypeLabel(sourceType: string): string {
  return (
    (PERSONA_EVIDENCE_TYPE_LABELS as Record<string, string>)[sourceType] ??
    sourceType
  );
}

export function qualitativeConfidence(value: number): "Alta" | "Média" | "Baixa" {
  if (value >= 0.75) return "Alta";
  if (value >= 0.45) return "Média";
  return "Baixa";
}

export type PersonaTrait = {
  id: string;
  key: string;
  value: string;
  confidence: number;
  sourceKind: PersonaTraitSource;
  evidenceId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PersonaEvidence = {
  id: string;
  traitKey: string;
  proposedValue: string;
  sourceType: PersonaEvidenceType;
  title: string;
  url: string | null;
  publishedAt: string | null;
  excerpt: string;
  confidence: number;
  status: PersonaEvidenceStatus;
  reviewedById: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  role: PersonaEvidenceRole;
};

export type PersonaView = {
  exists: boolean;
  id: string | null;
  characterId: string;
  origin: PersonaOrigin | null;
  summary: string | null;
  schemaVersion: string;
  traits: PersonaTrait[];
  evidences: PersonaEvidence[];
};

export type UpdatePersonaInput = {
  summary?: string | null;
  traits?: Array<{ key: PersonaTraitKey; value: string }>;
};

export type CreatePersonaEvidenceInput = {
  traitKey: PersonaTraitKey;
  proposedValue: string;
  sourceType: PersonaEvidenceType;
  title: string;
  url?: string | null;
  publishedAt?: string | null;
  excerpt: string;
  confidence: number;
};

export type ReviewPersonaEvidenceInput = {
  status: "APPROVED" | "REJECTED";
};

type PersonaResponse = { persona: PersonaView };

export function getPersona(characterId: string): Promise<PersonaView> {
  return get<PersonaResponse>(`/api/characters/${characterId}/persona`).then(
    (r) => r.persona,
  );
}

export function updatePersona(
  characterId: string,
  input: UpdatePersonaInput,
): Promise<PersonaView> {
  return patch<PersonaResponse>(
    `/api/characters/${characterId}/persona`,
    input,
  ).then((r) => r.persona);
}

export function deletePersonaTrait(
  characterId: string,
  traitKey: string,
): Promise<PersonaView> {
  return remove<PersonaResponse>(
    `/api/characters/${characterId}/persona/traits/${traitKey}`,
  ).then((r) => r.persona);
}

export function createPersonaEvidence(
  characterId: string,
  input: CreatePersonaEvidenceInput,
): Promise<PersonaView> {
  return post<PersonaResponse>(
    `/api/characters/${characterId}/persona/evidence`,
    input,
  ).then((r) => r.persona);
}

export function reviewPersonaEvidence(
  evidenceId: string,
  input: ReviewPersonaEvidenceInput,
): Promise<PersonaView> {
  return patch<PersonaResponse>(
    `/api/persona-evidence/${evidenceId}`,
    input,
  ).then((r) => r.persona);
}
