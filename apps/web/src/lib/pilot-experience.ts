import { get, patch, post } from "@/lib/api";

export type PilotMemoryType =
  | "CAREER_MILESTONE"
  | "SPORTING_VICTORY"
  | "SPORTING_DEFEAT"
  | "CHAMPIONSHIP"
  | "TEAM_CHANGE"
  | "RELATIONSHIP_EVENT"
  | "CONFLICT"
  | "PERSONAL_MILESTONE"
  | "NARRATIVE_EVENT"
  | "SIGNIFICANT_RACE"
  | "OTHER_RELEVANT_EXPERIENCE";

export type PilotMemoryDerivation = "MANUAL" | "DERIVED" | "RULE_DERIVED";
export type PilotMemoryStatus = "ACTIVE" | "ARCHIVED" | "SUPERSEDED" | "INVALIDATED";
export type PilotImportance = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type PilotMemoryView = {
  id: string;
  content: string;
  summary: string | null;
  memoryType: PilotMemoryType | null;
  importance: PilotImportance;
  derivation: PilotMemoryDerivation;
  status: PilotMemoryStatus;
  revision: number;
  source: {
    experienceId: string | null;
    source: string;
    sourceKey: string | null;
    seasonYear?: number | null;
    raceId?: string | null;
    occurredAt?: string | null;
  };
  createdAt: string;
  updatedAt: string;
};

export type PilotExperienceView = {
  id: string;
  experienceType: PilotMemoryType;
  source: string;
  sourceKey: string;
  seasonYear: number | null;
  raceId: string | null;
  occurredAt: string | null;
  salience: PilotImportance;
  title: string;
  summary: string | null;
  status: "ACTIVE" | "INVALIDATED" | "SUPERSEDED";
  invalidationReason: string | null;
  revision: number;
};

export type EvolutionPreview = {
  available: boolean;
  reason?: string;
  evolutionRevision: number;
  pendingFingerprint: string;
  pendingCount: number;
  revertedEffects: Array<{
    id: string;
    ruleCode: string;
    traitKey: string;
    experienceId: string | null;
    reason: string;
  }>;
  traits: Array<{
    key: string;
    label: string;
    value: string;
    origin: "MANUAL" | "EVIDENCE" | "RULE_DERIVED";
    beforeConfidence: number;
    afterConfidence: number;
    skippedManual: boolean;
    reasons: Array<{
      ruleCode: string;
      experienceId: string;
      experienceTitle: string;
      delta: number;
      reason: string;
    }>;
  }>;
  skipped: Array<{ ruleCode: string; traitKey: string; reason: string }>;
};

export const PILOT_MEMORY_TYPE_LABELS: Record<PilotMemoryType, string> = {
  CAREER_MILESTONE: "Marco de carreira",
  SPORTING_VICTORY: "Vitória",
  SPORTING_DEFEAT: "Derrota",
  CHAMPIONSHIP: "Campeonato",
  TEAM_CHANGE: "Mudança de equipe",
  RELATIONSHIP_EVENT: "Relacionamento",
  CONFLICT: "Conflito",
  PERSONAL_MILESTONE: "Marco pessoal",
  NARRATIVE_EVENT: "Evento narrativo",
  SIGNIFICANT_RACE: "Corrida marcante",
  OTHER_RELEVANT_EXPERIENCE: "Outra experiência",
};

export const PILOT_MEMORY_STATUS_LABELS: Record<PilotMemoryStatus, string> = {
  ACTIVE: "Ativa",
  ARCHIVED: "Arquivada",
  SUPERSEDED: "Substituída",
  INVALIDATED: "Invalidada",
};

export const PILOT_IMPORTANCE_LABELS: Record<PilotImportance, string> = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
  CRITICAL: "Crítica",
};

export function listPilotMemories(
  characterId: string,
  filters: { status?: PilotMemoryStatus; type?: PilotMemoryType; importance?: PilotImportance } = {},
): Promise<{ memories: PilotMemoryView[] }> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.type) params.set("type", filters.type);
  if (filters.importance) params.set("importance", filters.importance);
  const query = params.toString();
  return get(`/api/pilot-context/${characterId}/memories${query ? `?${query}` : ""}`);
}

export function createPilotMemory(
  characterId: string,
  input: {
    content: string;
    summary?: string | null;
    memoryType?: PilotMemoryType | null;
    importance: PilotImportance;
    occurredAt?: string | null;
  },
): Promise<{ memory: PilotMemoryView }> {
  return post(`/api/pilot-context/${characterId}/memories`, input);
}

export function patchPilotMemory(
  characterId: string,
  memoryId: string,
  input: { content?: string; importance?: PilotImportance; status?: "ACTIVE" | "ARCHIVED" },
): Promise<{ memory: PilotMemoryView }> {
  return patch(`/api/pilot-context/${characterId}/memories/${memoryId}`, input);
}

export function reconcilePilotContext(characterId: string): Promise<{
  reconcile: {
    experiences: { created: number; updated: number; invalidated: number };
    memories: { created: number; superseded: number; invalidated: number };
  };
}> {
  return post(`/api/pilot-context/${characterId}/reconcile`, {});
}

export function listPilotExperiences(characterId: string): Promise<{ experiences: PilotExperienceView[] }> {
  return get(`/api/pilot-context/${characterId}/experiences`);
}

export function previewPilotEvolution(characterId: string): Promise<{ preview: EvolutionPreview }> {
  return post(`/api/pilot-context/${characterId}/evolution/preview`, {});
}

export function applyPilotEvolution(
  characterId: string,
  input: { expectedRevision: number; expectedPendingFingerprint: string },
): Promise<{
  evolution:
    | { applied: true; evolutionRevision: number; effectsApplied: number; timelineEventId: string | null }
    | { applied: false; evolutionRevision: number; reason: string };
}> {
  return post(`/api/pilot-context/${characterId}/evolution/apply`, input);
}
