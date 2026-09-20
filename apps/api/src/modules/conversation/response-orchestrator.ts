
import { isTopicMatch } from "./topic-match.js";

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

export type ResponseOrchestratorMemoryImportance = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface ResponseOrchestratorMemory {
  participantCharacterIds: readonly string[];
  id?: string;
  content?: string;
  summary?: string | null;
  importance?: ResponseOrchestratorMemoryImportance;
  emotionalImpact?: number | null;
  eventId?: string | null;
  createdAt?: string;
}

export interface ResponseOrchestratorEvent {
  participantCharacterIds: readonly string[];
  id?: string;
  type?: string;
  importance?: ResponseOrchestratorMemoryImportance;
  title?: string;
  description?: string | null;
  worldDate?: string | null;
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
  memoryRelatedRelevance: number;
  memoryTopicRelevance: number;
  memoryImportanceBoost: number;
  memoryRelevanceCap: number;
  eventRelevance: number;
  eventRelatedRelevance: number;
  eventTopicRelevance: number;
  eventImportanceBoost: number;
  eventRelevanceCap: number;
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
    memoryRelevance: 18,
    memoryRelatedRelevance: 12,
    memoryTopicRelevance: 10,
    memoryImportanceBoost: 4,
    memoryRelevanceCap: 20,
    eventRelevance: 18,
    eventRelatedRelevance: 12,
    eventTopicRelevance: 10,
    eventImportanceBoost: 4,
    eventRelevanceCap: 20,
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
  | "CAP_REACHED"
  | "NO_RESPONSE_OPPORTUNITY";

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

const FAREWELL_INITIATORS = new Set([
  "tchau",
  "adeus",
  "bye",
  "goodnight",
  "farewell",
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

function isFarewellInput(tokens: readonly string[]): boolean {
  const first = tokens[0];
  if (first === undefined) {
    return false;
  }
  if (first === "boa" && tokens[1] === "noite") {
    return true;
  }
  if (first === "good" && tokens[1] === "night") {
    return true;
  }
  if (first === "see" && tokens[1] === "you") {
    return true;
  }
  if (first === "bye" && tokens[1] === "bye") {
    return true;
  }
  if (first === "ate") {
    return true;
  }
  return FAREWELL_INITIATORS.has(first);
}

function buildRelatedIds(
  candidateId: string,
  relationships: readonly ResponseOrchestratorRelationship[] | undefined,
): Set<string> {
  const related = new Set<string>();
  for (const relationship of relationships ?? []) {
    if (relationship.characterAId === candidateId) {
      related.add(relationship.characterBId);
    } else if (relationship.characterBId === candidateId) {
      related.add(relationship.characterAId);
    }
  }
  return related;
}

function joinedText(parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ");
}

function isTopImportance(
  importance: ResponseOrchestratorMemoryImportance | undefined,
): boolean {
  return importance === "HIGH" || importance === "CRITICAL";
}

function memoryItemScore(
  candidateId: string,
  memory: ResponseOrchestratorMemory,
  relatedIds: ReadonlySet<string>,
  message: string,
  weights: ResponseOrchestratorWeights,
): number {
  const participants = memory.participantCharacterIds;
  const isDirect = participants.includes(candidateId);
  const isRelated =
    !isDirect && [...participants].some((participantId) => relatedIds.has(participantId));
  const memoryText = joinedText([memory.content, memory.summary]);
  const topicMatch = memoryText.length > 0 && isTopicMatch(message, memoryText);

  let base: number;
  if (isDirect) {
    base = weights.memoryRelevance;
  } else if (isRelated) {
    base = weights.memoryRelatedRelevance;
  } else if (participants.length === 0 && topicMatch) {
    base = weights.memoryTopicRelevance;
  } else {
    return 0;
  }

  let bonus = 0;
  if (isTopImportance(memory.importance)) {
    bonus += weights.memoryImportanceBoost;
  }
  if (participants.length > 0 && topicMatch) {
    bonus += weights.memoryTopicRelevance;
  }

  return Math.min(base + bonus, weights.memoryRelevanceCap);
}

function eventItemScore(
  candidateId: string,
  event: ResponseOrchestratorEvent,
  relatedIds: ReadonlySet<string>,
  message: string,
  weights: ResponseOrchestratorWeights,
): number {
  const participants = event.participantCharacterIds;
  const isDirect = participants.includes(candidateId);
  const isRelated =
    !isDirect && [...participants].some((participantId) => relatedIds.has(participantId));
  const eventText = joinedText([event.title, event.description]);
  const topicMatch = eventText.length > 0 && isTopicMatch(message, eventText);

  let base: number;
  if (isDirect) {
    base = weights.eventRelevance;
  } else if (isRelated) {
    base = weights.eventRelatedRelevance;
  } else if (participants.length === 0 && topicMatch) {
    base = weights.eventTopicRelevance;
  } else {
    return 0;
  }

  let bonus = 0;
  if (isTopImportance(event.importance)) {
    bonus += weights.eventImportanceBoost;
  }
  if (participants.length > 0 && topicMatch) {
    bonus += weights.eventTopicRelevance;
  }

  return Math.min(base + bonus, weights.eventRelevanceCap);
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

  const topicSignalByCharacter = new Map<string, boolean>();

  const results: ResponseOrchestratorCandidateResult[] = aiCandidates.map((candidate) => {
    const reached: ResponseOrchestratorReasonCode[] = [];
    let score = 0;
    let hasPositiveSignal = false;
    let hasTopicSignal = false;

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

    const relatedIds = buildRelatedIds(candidate.characterId, input.relationships);

    const memoryContribution = (() => {
      let best = 0;
      for (const memory of input.memories ?? []) {
        const memoryText = joinedText([memory.content, memory.summary]);
        if (
          memoryText.length > 0 &&
          isTopicMatch(input.userMessage.content, memoryText)
        ) {
          hasTopicSignal = true;
        }
        best = Math.max(
          best,
          memoryItemScore(
            candidate.characterId,
            memory,
            relatedIds,
            input.userMessage.content,
            config.weights,
          ),
        );
      }
      return best;
    })();
    if (memoryContribution > 0) {
      reached.push("MEMORY_RELEVANCE");
      score += memoryContribution;
      hasPositiveSignal = true;
    }

    const eventContribution = (() => {
      let best = 0;
      for (const event of input.events ?? []) {
        const eventText = joinedText([event.title, event.description]);
        if (
          eventText.length > 0 &&
          isTopicMatch(input.userMessage.content, eventText)
        ) {
          hasTopicSignal = true;
        }
        best = Math.max(
          best,
          eventItemScore(
            candidate.characterId,
            event,
            relatedIds,
            input.userMessage.content,
            config.weights,
          ),
        );
      }
      return best;
    })();
    if (eventContribution > 0) {
      reached.push("EVENT_RELEVANCE");
      score += eventContribution;
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

    topicSignalByCharacter.set(candidate.characterId, hasTopicSignal);

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

  const responseOpportunityGateActive =
    isFarewellInput(contentTokens) && !isQuestion;

  for (const result of results) {
    if (result.reasons.includes("NO_SIGNALS_PENALTY")) {
      result.excludedReason = "NO_SIGNALS";
    } else if (
      responseOpportunityGateActive &&
      !result.reasons.includes("DIRECT_MENTION") &&
      !(topicSignalByCharacter.get(result.characterId) ?? false)
    ) {
      result.excludedReason = "NO_RESPONSE_OPPORTUNITY";
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