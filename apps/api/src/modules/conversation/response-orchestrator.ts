
export const RESPONSE_ORCHESTRATOR_VERSION = "response-orchestrator.v1";

export type ResponseOrchestratorController = "AI" | "USER";

export interface ResponseOrchestratorParticipant {
  characterId: string;
  name: string;
  controlledBy: ResponseOrchestratorController;
  available?: boolean;
}

export interface ResponseOrchestratorUserMessage {
  content: string;
  senderCharacterId?: string | null;
}

export interface ResponseOrchestratorRecentMessage {
  characterId: string | null;
  senderType?: string | null;
}

export interface ResponseOrchestratorMemory {
  participantCharacterIds: readonly string[];
}

export interface ResponseOrchestratorEvent {
  participantCharacterIds: readonly string[];
}

export interface ResponseOrchestratorRelationship {
  characterAId: string;
  characterBId: string;
}

export interface ResponseOrchestratorInput {
  userMessage: ResponseOrchestratorUserMessage;
  participants: readonly ResponseOrchestratorParticipant[];
  recentMessages?: readonly ResponseOrchestratorRecentMessage[];
  memories?: readonly ResponseOrchestratorMemory[];
  events?: readonly ResponseOrchestratorEvent[];
  relationships?: readonly ResponseOrchestratorRelationship[];
  config?: ResponseOrchestratorConfigInput;
}

export interface ResponseOrchestratorWeights {
  directMentionFullName: number;
  directMentionFirstName: number;
  questionRelevance: number;
  relationshipRelevance: number;
  memoryRelevance: number;
  eventRelevance: number;
  recencyRelevance: number;
  unavailablePenalty: number;
  noSignalsPenalty: number;
}

export interface ResponseOrchestratorConfig {
  threshold: number;
  maxResponders: number;
  recentMessageWindow: number;
  weights: ResponseOrchestratorWeights;
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type ResponseOrchestratorConfigInput = DeepPartial<ResponseOrchestratorConfig>;

export const RESPONSE_ORCHESTRATOR_DEFAULT_CONFIG: ResponseOrchestratorConfig = {
  threshold: 25,
  maxResponders: 3,
  recentMessageWindow: 6,
  weights: {
    directMentionFullName: 100,
    directMentionFirstName: 60,
    questionRelevance: 10,
    relationshipRelevance: 20,
    memoryRelevance: 15,
    eventRelevance: 15,
    recencyRelevance: 10,
    unavailablePenalty: -25,
    noSignalsPenalty: -100,
  },
};

// ---------------------------------------------------------------------------
// Saída
// ---------------------------------------------------------------------------

export type ResponseOrchestratorReasonCode =
  | "DIRECT_MENTION"
  | "QUESTION_RELEVANCE"
  | "RELATION_RELEVANCE"
  | "MEMORY_RELEVANCE"
  | "EVENT_RELEVANCE"
  | "RECENCY"
  | "UNAVAILABLE_PENALTY"
  | "NO_SIGNALS_PENALTY";

export type ResponseOrchestratorExcludedReason =
  | "BELOW_THRESHOLD"
  | "NO_SIGNALS"
  | "CAP_REACHED";

export interface ResponseOrchestratorCandidateResult {
  characterId: string;
  score: number;
  selected: boolean;
  reasons: ResponseOrchestratorReasonCode[];
  excludedReason?: ResponseOrchestratorExcludedReason;
}

export interface ResponseOrchestratorSelection {
  candidates: ResponseOrchestratorCandidateResult[];
  selected: string[];
  reasons: Record<string, ResponseOrchestratorReasonCode[]>;
}

export const RESPONSE_ORCHESTRATOR_REASON_ORDER: readonly ResponseOrchestratorReasonCode[] = [
  "DIRECT_MENTION",
  "QUESTION_RELEVANCE",
  "RELATION_RELEVANCE",
  "MEMORY_RELEVANCE",
  "EVENT_RELEVANCE",
  "RECENCY",
  "UNAVAILABLE_PENALTY",
  "NO_SIGNALS_PENALTY",
];

const REASON_ORDER_INDEX = new Map<string, number>(
  RESPONSE_ORCHESTRATOR_REASON_ORDER.map((code, index) => [code, index]),
);

const INTERROGATIVE_FIRST_TOKENS = new Set([
  "quem", "que", "qual", "quais", "quando", "onde", "como", "porque",
  "quanto", "quanta", "quantos", "quantas",
  "who", "what", "when", "where", "which", "whose", "why", "how", "whom",
]);

// ---------------------------------------------------------------------------
// Helpers (puros)
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) {
    return patch === undefined ? base : (patch as T);
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(patch)) {
    out[key] = deepMerge(out[key], patch[key]);
  }
  return out as T;
}

export function resolveResponseOrchestratorConfig(
  input?: ResponseOrchestratorConfigInput,
): ResponseOrchestratorConfig {
  if (input === undefined) {
    return RESPONSE_ORCHESTRATOR_DEFAULT_CONFIG;
  }
  return deepMerge(RESPONSE_ORCHESTRATOR_DEFAULT_CONFIG, input);
}

function tokenize(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function firstTokenOf(name: string): string | null {
  const tokens = tokenize(name);
  return tokens.length > 0 ? tokens[0] : null;
}

function containsContiguous(sub: readonly string[], text: readonly string[]): boolean {
  if (sub.length === 0 || sub.length > text.length) {
    return false;
  }
  for (let i = 0; i + sub.length <= text.length; i++) {
    let matches = true;
    for (let j = 0; j < sub.length; j++) {
      if (text[i + j] !== sub[j]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return true;
    }
  }
  return false;
}

function isQuestionInput(content: string, tokens: readonly string[]): boolean {
  if (content.trim().endsWith("?")) {
    return true;
  }
  const first = tokens[0];
  return first !== undefined && INTERROGATIVE_FIRST_TOKENS.has(first);
}

export function selectSpeakers(input: ResponseOrchestratorInput): ResponseOrchestratorSelection {
  const config = resolveResponseOrchestratorConfig(input.config);
  const contentTokens = tokenize(input.userMessage.content);
  const isQuestion = isQuestionInput(input.userMessage.content, contentTokens);
  const senderId = input.userMessage.senderCharacterId ?? null;

  const aiCandidates = input.participants.filter(
    (participant) => participant.controlledBy === "AI",
  );

  const firstTokenCounts = new Map<string, number>();
  for (const candidate of aiCandidates) {
    const first = firstTokenOf(candidate.name);
    if (first !== null) {
      firstTokenCounts.set(first, (firstTokenCounts.get(first) ?? 0) + 1);
    }
  }

  const windowMessages = input.recentMessages
    ? input.recentMessages.slice(-config.recentMessageWindow)
    : [];
  const recentSpeakerIds = new Set<string>();
  for (const message of windowMessages) {
    if (message.characterId !== null) {
      recentSpeakerIds.add(message.characterId);
    }
  }

  const results: ResponseOrchestratorCandidateResult[] = aiCandidates.map((candidate) => {
    const reached: ResponseOrchestratorReasonCode[] = [];
    let score = 0;
    let hasPositiveSignal = false;

    const fullNameTokens = tokenize(candidate.name);
    const firstName = firstTokenOf(candidate.name);

    if (containsContiguous(fullNameTokens, contentTokens)) {
      reached.push("DIRECT_MENTION");
      score += config.weights.directMentionFullName;
      hasPositiveSignal = true;
    } else if (
      firstName !== null &&
      (firstTokenCounts.get(firstName) ?? 0) === 1 &&
      contentTokens.includes(firstName)
    ) {
      reached.push("DIRECT_MENTION");
      score += config.weights.directMentionFirstName;
      hasPositiveSignal = true;
    }

    if (isQuestion) {
      reached.push("QUESTION_RELEVANCE");
      score += config.weights.questionRelevance;
      hasPositiveSignal = true;
    }

    if (
      senderId !== null &&
      input.relationships?.some(
        (relationship) =>
          (relationship.characterAId === senderId &&
            relationship.characterBId === candidate.characterId) ||
          (relationship.characterAId === candidate.characterId &&
            relationship.characterBId === senderId),
      )
    ) {
      reached.push("RELATION_RELEVANCE");
      score += config.weights.relationshipRelevance;
      hasPositiveSignal = true;
    }

    if (input.memories?.some((memory) => memory.participantCharacterIds.includes(candidate.characterId))) {
      reached.push("MEMORY_RELEVANCE");
      score += config.weights.memoryRelevance;
      hasPositiveSignal = true;
    }

    if (input.events?.some((event) => event.participantCharacterIds.includes(candidate.characterId))) {
      reached.push("EVENT_RELEVANCE");
      score += config.weights.eventRelevance;
      hasPositiveSignal = true;
    }

    if (recentSpeakerIds.has(candidate.characterId)) {
      reached.push("RECENCY");
      score += config.weights.recencyRelevance;
      hasPositiveSignal = true;
    }

    if (candidate.available === false) {
      reached.push("UNAVAILABLE_PENALTY");
      score += config.weights.unavailablePenalty;
    }

    if (!hasPositiveSignal) {
      reached.push("NO_SIGNALS_PENALTY");
      score += config.weights.noSignalsPenalty;
    }

    reached.sort(
      (a, b) => (REASON_ORDER_INDEX.get(a) ?? 0) - (REASON_ORDER_INDEX.get(b) ?? 0),
    );

    return {
      characterId: candidate.characterId,
      score,
      selected: false,
      reasons: reached,
    };
  });

  results.sort(
    (a, b) => b.score - a.score || a.characterId.localeCompare(b.characterId),
  );

  for (const result of results) {
    if (result.reasons.includes("NO_SIGNALS_PENALTY")) {
      result.excludedReason = "NO_SIGNALS";
    } else if (result.score < config.threshold) {
      result.excludedReason = "BELOW_THRESHOLD";
    }
  }

  const selected: string[] = [];
  for (const result of results) {
    if (result.excludedReason !== undefined) {
      continue;
    }
    if (selected.length < config.maxResponders) {
      result.selected = true;
      selected.push(result.characterId);
    } else {
      result.excludedReason = "CAP_REACHED";
    }
  }

  const reasons: Record<string, ResponseOrchestratorReasonCode[]> = {};
  for (const result of results) {
    reasons[result.characterId] = result.reasons;
  }

  return { candidates: results, selected, reasons };
}

export const responseOrchestrator = {
  name: RESPONSE_ORCHESTRATOR_VERSION,
  selectSpeakers,
} as const;