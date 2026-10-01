import { get, patch, post, remove } from "@/lib/api";

export type PilotKnowledgeUnavailableReason =
  | "CHARACTER_NOT_FOUND"
  | "NO_DRIVER_PROFILE"
  | "NO_EXTERNAL_BINDING"
  | "NO_EXTERNAL_PROFILE";

export type PilotIdentityView = {
  publicName: string;
  fullName: string | null;
  dateOfBirth: string | null;
  placeOfBirth: string | null;
  nationality: string | null;
  representedCountry: string | null;
  driverNumber: number | null;
  driverCode: string | null;
  currentTeamName: string | null;
  officialLinks: Record<string, string> | null;
};

export type PilotBiographyView = {
  display: string | null;
  context: string | null;
  origin: "UNIVERSE" | "EXTERNAL" | "NONE";
  lastVerifiedAt: string | null;
};

export type BiographyLifecycleStatus =
  | "MISSING"
  | "READY"
  | "READY_FALLBACK"
  | "STALE"
  | "GENERATING"
  | "FAILED";

export type PilotBiographyStatusView = {
  status: BiographyLifecycleStatus;
  display: string | null;
  context: string | null;
  origin: "UNIVERSE" | "EXTERNAL" | "NONE";
  runId: string | null;
  evidenceVersion: string | null;
  generatorVersion: string | null;
  fallbackReason: string | null;
  lastVerifiedAt: string | null;
};

export type BiographyGenerationRunView = {
  id: string;
  status: string;
  mode: string | null;
  provider: string | null;
  model: string | null;
  fallbackReason: string | null;
  evidenceVersion: string | null;
  generatorVersion: string | null;
  promptHash: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type PilotKnowledgeResponse = {
  pilot: PilotKnowledgeView;
  biographyStatus?: PilotBiographyStatusView;
  sync?: {
    providersConfigured: boolean;
    provisioned: boolean;
    lastStatus: string | null;
    lastAt: string | null;
  };
};

export type PilotPersonaTraitView = {
  traitKey: string;
  label: string;
  value: string;
  sourceKind: "DIRECT_SELF_DESCRIPTION" | "OBSERVED_PUBLIC_BEHAVIOR" | "INFERRED";
  status: "SUPPORTED" | "UNCERTAIN" | "CONFLICT" | "UNKNOWN";
  lastVerifiedAt: string | null;
};

export type PilotPersonaView =
  | { available: false; reason: string }
  | {
      available: true;
      summary: string | null;
      status: "SUPPORTED" | "UNCERTAIN" | "CONFLICT" | "UNKNOWN";
      refresh: { status: "FRESH" | "STALE" | "UNKNOWN"; lastVerifiedAt: string | null };
      traits: PilotPersonaTraitView[];
    };

export type PilotPublicProfileStatus = "AVAILABLE" | "PARTIAL" | "EMPTY";

export type PilotPublicProfileFact = {
  category: string;
  label: string;
  display: string;
  year: number | null;
  authority: string;
  sourceTitle: string | null;
  sourceUrl: string | null;
};

export type PilotPublicProfileSource = {
  provider: string;
  title: string;
  url: string;
};

export type PilotPublicProfileView = {
  status: PilotPublicProfileStatus;
  summary: string | null;
  facts: PilotPublicProfileFact[];
  sources: PilotPublicProfileSource[];
  evidenceVersion: string | null;
  relevantAreaCount: number;
};

export type PilotHistoryEventView = {
  id: string;
  category: string;
  categoryLabel: string;
  title: string;
  summary: string | null;
  seasonYear: number | null;
  eventDate: string | null;
  importance: number;
  derivation: string;
  externalRaceId: string | null;
  raceName: string | null;
  link: { seasonId: string | null; raceId: string | null };
};

export type PilotRelationshipCurrentView = {
  displayName: string;
  state: "ACTIVE" | "ENDED" | "UNKNOWN";
  validFrom: string | null;
  validTo: string | null;
  origin: "UNIVERSE" | "EXTERNAL";
  verifiedAt: string | null;
};

export type PilotRelationshipEntryView = {
  kind: string;
  label: string;
  classification: "MATCH" | "DIVERGENT" | "UNKNOWN" | "CONFLICT";
  current: PilotRelationshipCurrentView | null;
  externalCurrent: Omit<PilotRelationshipCurrentView, "origin"> | null;
  history: Array<{
    displayName: string;
    state: "ACTIVE" | "ENDED" | "UNKNOWN";
    validFrom: string | null;
    validTo: string | null;
    origin: "UNIVERSE" | "EXTERNAL";
  }>;
};

export type PilotSourceView = {
  id: string;
  provider: string;
  sourceKind: string;
  url: string | null;
  title: string | null;
  license: string;
  attributionRequirement: string | null;
  attributionText: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  sourceVersion: string | null;
};

export type PilotKnowledgeView =
  | { available: false; reason: PilotKnowledgeUnavailableReason }
  | {
      available: true;
      topic: string | null;
      profile: {
        available: true;
        externalIdentity: {
          externalDriverId: string;
          source: string;
          name: string;
          fullName: string | null;
          nationality: string | null;
          number: number | null;
          wikidataQid: string | null;
          f1dbDriverId: string | null;
        };
        identity: PilotIdentityView;
        biography: PilotBiographyView;
        refresh: { status: "FRESH" | "STALE" | "UNKNOWN"; lastVerifiedAt: string | null };
        hasPersona: boolean;
      };
      persona: PilotPersonaView;
      publicProfile: PilotPublicProfileView;
      history: { available: true; events: PilotHistoryEventView[]; relevant: PilotHistoryEventView[] };
      relationships: {
        available: true;
        entries: PilotRelationshipEntryView[];
        universeOverrides: Array<{ id: string; kind: string; displayName: string }>;
      };
      sources: PilotSourceView[];
    };

export const PILOT_PUBLIC_PROFILE_PROVIDER_LABELS: Record<string, string> = {
  F1_OFFICIAL: "Formula 1",
  TEAM_OFFICIAL: "Equipe oficial",
  DRIVER_OFFICIAL: "Piloto oficial",
  FIA_OFFICIAL: "FIA",
  REPUTABLE_NEWS: "Imprensa confiável",
};

export function publicProfileProviderLabel(provider: string): string {
  return PILOT_PUBLIC_PROFILE_PROVIDER_LABELS[provider] ?? provider;
}

export const PILOT_CLASSIFICATION_LABELS: Record<string, string> = {
  MATCH: "Compatível com a fonte",
  DIVERGENT: "Divergente da fonte",
  UNKNOWN: "Sem comparação",
  CONFLICT: "Fontes em conflito",
};

export const PILOT_RELATIONSHIP_STATE_LABELS: Record<string, string> = {
  ACTIVE: "Ativo",
  ENDED: "Encerrado",
  UNKNOWN: "Sem data",
};

export const PILOT_ORIGIN_LABELS: Record<string, string> = {
  EXTERNAL: "Fonte externa",
  UNIVERSE: "Personalização do Universe",
};

export function getPilotKnowledge(
  characterId: string,
  topic?: string,
): Promise<PilotKnowledgeResponse> {
  const query = topic && topic.trim().length > 0 ? `?topic=${encodeURIComponent(topic.trim())}` : "";
  return get<PilotKnowledgeResponse>(`/api/pilot-knowledge/drivers/${characterId}${query}`);
}

export function requestBiographyGeneration(characterId: string): Promise<{
  generation: { runId: string; status: string; reused: boolean; skipped?: boolean };
}> {
  return post(`/api/pilot-knowledge/drivers/${characterId}/biography/generation`, {});
}

export function getBiographyGenerationRun(characterId: string): Promise<{
  generation: BiographyGenerationRunView | null;
}> {
  return get(`/api/pilot-knowledge/drivers/${characterId}/biography/generation`);
}

export function refreshPilotKnowledge(
  characterId: string,
  scope: "ALL" | "DRIVER_PROFILE" | "DRIVER_RELATIONSHIPS" | "DRIVER_EVENTS" = "ALL",
): Promise<{ refresh: { scopes: Array<{ scope: string; provider: string; status: string }> } }> {
  return post(`/api/pilot-knowledge/drivers/${characterId}/refresh`, { scope });
}

export function updatePilotBiography(
  characterId: string,
  display: string,
): Promise<{ biography: { display: string | null; origin: "UNIVERSE" } }> {
  return patch(`/api/pilot-knowledge/drivers/${characterId}/biography`, { display });
}

export function restorePilotBiography(characterId: string): Promise<void> {
  return remove<void>(`/api/pilot-knowledge/drivers/${characterId}/biography`);
}

export function getPilotKnowledgeStatus(): Promise<{
  status: {
    profiles: { total: number; fresh: number; stale: number; unknown: number };
    personas: { total: number; supported: number; conflict: number; unknown: number };
    relationships: number;
    events: number;
    lastRuns: Array<{
      source: string;
      scope: string;
      status: string;
      startedAt: string;
      finishedAt: string | null;
    }>;
  };
}> {
  return get("/api/pilot-knowledge/status");
}

export type UniverseRelationshipInput = {
  kind: string;
  targetType: "DRIVER" | "PUBLIC_PERSON" | "CHARACTER";
  displayName: string;
  state: "ACTIVE" | "ENDED" | "UNKNOWN";
  validFrom?: string | null;
  validTo?: string | null;
  targetCharacterId?: string | null;
  targetWikidataQid?: string | null;
};

export function createUniverseRelationship(
  characterId: string,
  input: UniverseRelationshipInput,
): Promise<{ relationship: { id: string } }> {
  return post(`/api/pilot-knowledge/drivers/${characterId}/relationships`, input);
}

export function updateUniverseRelationship(
  id: string,
  input: Partial<UniverseRelationshipInput>,
): Promise<{ relationship: { id: string } }> {
  return patch(`/api/pilot-knowledge/relationships/${id}`, input);
}

export function deleteUniverseRelationship(id: string): Promise<void> {
  return remove<void>(`/api/pilot-knowledge/relationships/${id}`);
}
