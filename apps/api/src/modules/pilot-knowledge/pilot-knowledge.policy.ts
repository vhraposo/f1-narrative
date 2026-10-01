export const PILOT_KNOWLEDGE_SCHEMA_VERSION = "pilot-knowledge.v1";
export const EXTERNAL_PERSONA_SCHEMA_VERSION = "external-persona.v1";

export const PROFILE_BIOGRAPHY_DISPLAY_CAP = 1200;
export const PROFILE_BIOGRAPHY_CONTEXT_CAP = 600;
export const PERSONA_SUMMARY_CAP = 600;
export const TRAIT_VALUE_CAP = 200;
export const TRAITS_MAX = 12;
export const EVIDENCE_SUMMARY_CAP = 500;
export const RELATIONSHIPS_MAX = 8;
export const EVENTS_MAX = 8;
export const MEMORIES_MAX = 6;
export const PILOT_CONTEXT_PROMPT_CAP = 2000;

export const PROFILE_FRESH_DAYS = 30;
export const PERSONA_FRESH_DAYS = 30;
export const RELATIONSHIP_FRESH_DAYS = 14;
export const EVENT_FRESH_DAYS = 365;

export type PublicTraitGroup =
  | "COMMUNICATION"
  | "BEHAVIOR"
  | "INTERESTS"
  | "MOTIVATIONS"
  | "SPEECH";

export type PublicTraitDefinition = {
  readonly group: PublicTraitGroup;
  readonly label: string;
  readonly priority: number;
};

export const PUBLIC_TRAIT_REGISTRY: Record<string, PublicTraitDefinition> = {
  communicationStyle: { group: "COMMUNICATION", label: "Estilo de comunicação", priority: 1 },
  speechStyle: { group: "COMMUNICATION", label: "Estilo de fala", priority: 2 },
  directness: { group: "COMMUNICATION", label: "Franqueza", priority: 3 },
  verbosity: { group: "COMMUNICATION", label: "Verbosidade", priority: 4 },
  formality: { group: "COMMUNICATION", label: "Formalidade", priority: 5 },
  conversationalEnergy: { group: "COMMUNICATION", label: "Energia na conversa", priority: 6 },
  humorStyle: { group: "COMMUNICATION", label: "Humor", priority: 7 },

  competitiveness: { group: "BEHAVIOR", label: "Competitividade", priority: 8 },
  publicConfidence: { group: "BEHAVIOR", label: "Confiança pública", priority: 9 },
  behavioralTendencies: { group: "BEHAVIOR", label: "Tendências comportamentais", priority: 10 },
  reactionToPressure: { group: "BEHAVIOR", label: "Reação à pressão", priority: 11 },
  reactionToSuccess: { group: "BEHAVIOR", label: "Reação ao sucesso", priority: 12 },
  reactionToSetbacks: { group: "BEHAVIOR", label: "Reação a reveses", priority: 13 },
  conflictStyle: { group: "BEHAVIOR", label: "Estilo em conflitos", priority: 14 },

  hobbies: { group: "INTERESTS", label: "Hobbies", priority: 15 },
  sports: { group: "INTERESTS", label: "Esportes", priority: 16 },
  gaming: { group: "INTERESTS", label: "Jogos", priority: 17 },
  music: { group: "INTERESTS", label: "Música", priority: 18 },
  foodPreferences: { group: "INTERESTS", label: "Preferências gastronômicas", priority: 19 },
  otherInterests: { group: "INTERESTS", label: "Outros interesses", priority: 20 },

  careerGoals: { group: "MOTIVATIONS", label: "Objetivos de carreira", priority: 21 },
  statedMotivations: { group: "MOTIVATIONS", label: "Motivações declaradas", priority: 22 },
  publicValues: { group: "MOTIVATIONS", label: "Valores públicos", priority: 23 },
  professionalPriorities: { group: "MOTIVATIONS", label: "Prioridades profissionais", priority: 24 },

  typicalAnswerStyle: { group: "SPEECH", label: "Estilo típico de resposta", priority: 25 },
  typicalResponseLength: { group: "SPEECH", label: "Extensão típica das respostas", priority: 26 },
  tendencyToUseHumor: { group: "SPEECH", label: "Uso de humor na fala", priority: 27 },
  technicalDepth: { group: "SPEECH", label: "Profundidade técnica sobre corrida", priority: 28 },
  publicTone: { group: "SPEECH", label: "Tom público", priority: 29 },
};

export function isKnownPublicTraitKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(PUBLIC_TRAIT_REGISTRY, key);
}

export function publicTraitLabel(key: string): string {
  return PUBLIC_TRAIT_REGISTRY[key]?.label ?? key;
}

export function comparePublicTraits(
  a: { traitKey: string; status: string },
  b: { traitKey: string; status: string },
): number {
  const pa = PUBLIC_TRAIT_REGISTRY[a.traitKey]?.priority ?? 1000;
  const pb = PUBLIC_TRAIT_REGISTRY[b.traitKey]?.priority ?? 1000;
  if (pa !== pb) return pa - pb;
  if (a.status !== b.status) {
    const rank = (status: string) =>
      status === "SUPPORTED" ? 0 : status === "UNCERTAIN" ? 1 : status === "CONFLICT" ? 2 : 3;
    if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
  }
  return a.traitKey.localeCompare(b.traitKey);
}

export type SourceAuthorityClass =
  | "PRIMARY_OFFICIAL"
  | "STRUCTURED_LICENSED"
  | "REPUTABLE_SECONDARY"
  | "OTHER_SECONDARY";

export const SOURCE_AUTHORITY_RANK: Record<SourceAuthorityClass, number> = {
  PRIMARY_OFFICIAL: 3,
  STRUCTURED_LICENSED: 2,
  REPUTABLE_SECONDARY: 1,
  OTHER_SECONDARY: 0,
};

export function authorityClassOfProvider(provider: string): SourceAuthorityClass {
  switch (provider) {
    case "F1_OFFICIAL":
    case "FIA_OFFICIAL":
    case "TEAM_OFFICIAL":
    case "DRIVER_OFFICIAL":
      return "PRIMARY_OFFICIAL";
    case "F1DB":
    case "WIKIDATA":
    case "CURATED":
      return "STRUCTURED_LICENSED";
    case "REPUTABLE_NEWS":
      return "REPUTABLE_SECONDARY";
    default:
      return "OTHER_SECONDARY";
  }
}

export type RefreshStatus = "FRESH" | "STALE" | "UNKNOWN";

export function computeRefreshStatus(
  lastVerifiedAt: Date | null | undefined,
  now: Date,
  windowDays: number,
): RefreshStatus {
  if (!lastVerifiedAt) return "UNKNOWN";
  const ageMs = now.getTime() - lastVerifiedAt.getTime();
  if (ageMs < 0) return "FRESH";
  return ageMs <= windowDays * 24 * 60 * 60 * 1000 ? "FRESH" : "STALE";
}

export function clampText(value: string, cap: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= cap) return trimmed;
  const slice = trimmed.slice(0, cap);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > cap * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}
