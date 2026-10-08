import { createHash } from "node:crypto";

import type { CharacterController, MessageSenderType } from "@prisma/client";

export type ResponseEngineParticipant = {
  readonly characterId: string;
  readonly name: string;
  readonly controller: CharacterController;
  readonly available: boolean;
};

export type ResponseEngineMessage = {
  readonly id: string;
  readonly senderType: MessageSenderType;
  readonly characterId: string | null;
  readonly content: string;
  readonly createdAt: Date;
  readonly replyToMessageId?: string | null;
};

export type ResponseSelectionInput = {
  readonly participants: readonly ResponseEngineParticipant[];
  readonly messages: readonly ResponseEngineMessage[];
  readonly relationshipAffinity?: Readonly<Record<string, number>>;
  readonly depth: number;
  readonly alreadyResponded: readonly string[];
  readonly recentAiContents?: readonly string[];
  readonly recentAiMessages?: readonly { readonly characterId: string; readonly content: string }[];
  readonly seed: {
    readonly universeId: string;
    readonly conversationId: string;
    readonly lastMessageId: string;
    readonly worldDate: Date;
  };
  readonly limits: {
    readonly maxResponders: number;
    readonly minScore: number;
  };
};

export type ResponseCandidate = {
  readonly characterId: string;
  readonly name: string;
  readonly score: number;
  readonly opportunity: number;
  readonly reasons: readonly string[];
};

export type ResponseSelectionStopReason =
  | "SELECTED"
  | "NO_ELIGIBLE_SPEAKER"
  | "NO_RESPONSE_OPPORTUNITY"
  | "NO_MESSAGES";

export type ResponseSelectionResult = {
  readonly candidates: readonly ResponseCandidate[];
  readonly selected: readonly ResponseCandidate[];
  readonly rejected: readonly ResponseCandidate[];
  readonly stopReason: ResponseSelectionStopReason;
};

const BASE_PRESENCE = 20;
const MENTION_SCORE = 100;
const REPLY_TARGET_SCORE = 80;
const SUBJECT_MENTION_SCORE = 25;
const SOCIAL_BASELINE_SCORE = 12;
const RECENT_SPEAKER_PENALTY = 25;
const RELATIONSHIP_MAX = 15;
const HIGH_AFFINITY_THRESHOLD = 0.7;
const DEPTH_PENALTY = 8;
const JITTER_MAX = 14;
const REDUNDANCY_PENALTY = 24;
const TOPIC_ENGAGEMENT_OVERLAP = 0.3;
const TOPIC_ENGAGEMENT_SCORE = 15;

const SOCIAL_PATTERN =
  /(\b(bom dia|boa tarde|boa noite|oi|ola|e ai|eai|gente|galera|pessoal|voces|vcs|alguem)\b)|(\?)/;

function seededFraction(value: string): number {
  const digest = createHash("sha256").update(value).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function tokenOverlap(a: string, b: string): number {
  const tokensA = new Set(normalizeText(a).split(/\s+/).filter((token) => token.length >= 3));
  const tokensB = new Set(normalizeText(b).split(/\s+/).filter((token) => token.length >= 3));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared += 1;
  return shared / Math.min(tokensA.size, tokensB.size);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ADDRESS_PREPOSITIONS = new Set([
  "o",
  "a",
  "os",
  "as",
  "do",
  "da",
  "dos",
  "das",
  "no",
  "na",
  "nos",
  "nas",
  "pro",
  "pra",
  "com",
  "sobre",
  "pelo",
  "pela",
  "de",
]);

export type ExplicitTargetKind = "DIRECT_MENTION" | "SUBJECT_MENTION";

export type ExplicitTargetMatch = {
  readonly characterId: string;
  readonly name: string;
  readonly kind: ExplicitTargetKind;
};

export function detectExplicitTargets(
  content: string,
  participants: readonly ResponseEngineParticipant[],
): ExplicitTargetMatch[] {
  const normalized = normalizeText(content);
  const matches: ExplicitTargetMatch[] = [];
  for (const participant of participants) {
    if (participant.controller !== "AI") continue;
    const tokens = normalizeText(participant.name)
      .split(/\s+/)
      .filter((token) => token.length >= 3);
    if (tokens.length === 0) continue;
    let matched = false;
    let direct = false;
    for (const token of tokens) {
      const escaped = escapeRegExp(token);
      if (!new RegExp(`\\b${escaped}\\b`).test(normalized)) continue;
      matched = true;
      const startsWith = new RegExp(`^\\s*${escaped}\\b`).test(normalized);
      const vocative = new RegExp(`(?:^|[,;:.!?]\\s*)${escaped}\\b\\s*[,!?]`).test(normalized);
      const nameQuestion = new RegExp(`\\b${escaped}\\b\\s*\\?\\s*$`).test(normalized);
      const nameAtEnd = new RegExp(`\\b${escaped}\\b\\s*[.!]?\\s*$`).test(normalized);
      const previousWord = new RegExp(`(\\w+)\\s+${escaped}\\b`).exec(normalized)?.[1] ?? null;
      const endDirect =
        nameAtEnd && (previousWord === null || !ADDRESS_PREPOSITIONS.has(previousWord));
      if (startsWith || vocative || nameQuestion || endDirect) direct = true;
    }
    if (matched) {
      matches.push({
        characterId: participant.characterId,
        name: participant.name,
        kind: direct ? "DIRECT_MENTION" : "SUBJECT_MENTION",
      });
    }
  }
  return matches;
}

export function selectResponseCandidates(
  input: ResponseSelectionInput,
): ResponseSelectionResult {
  const lastMessage = input.messages[input.messages.length - 1] ?? null;
  if (!lastMessage) {
    return { candidates: [], selected: [], rejected: [], stopReason: "NO_MESSAGES" };
  }
  const normalizedLast = normalizeText(lastMessage.content);
  const lastAiMessage = [...input.messages]
    .reverse()
    .find((message) => message.senderType === "AI_CHARACTER");
  const alreadyResponded = new Set(input.alreadyResponded);
  const messageById = new Map(input.messages.map((message) => [message.id, message]));
  const replyToMessage = lastMessage.replyToMessageId
    ? messageById.get(lastMessage.replyToMessageId) ?? null
    : null;
  const replyTargetCharacterId =
    replyToMessage?.senderType === "AI_CHARACTER" ? replyToMessage.characterId : null;
  const targets = detectExplicitTargets(lastMessage.content, input.participants);

  const eligible: ResponseCandidate[] = [];
  const rejected: ResponseCandidate[] = [];

  for (const participant of [...input.participants].sort((a, b) =>
    a.characterId.localeCompare(b.characterId),
  )) {
    if (participant.controller !== "AI") continue;
    if (alreadyResponded.has(participant.characterId)) {
      rejected.push({
        characterId: participant.characterId,
        name: participant.name,
        score: 0,
        opportunity: 0,
        reasons: ["ALREADY_RESPONDED"],
      });
      continue;
    }
    if (!participant.available) {
      rejected.push({
        characterId: participant.characterId,
        name: participant.name,
        score: 0,
        opportunity: 0,
        reasons: ["UNAVAILABLE"],
      });
      continue;
    }

    const reasons: string[] = [];
    let score = BASE_PRESENCE;
    const target = targets.find((entry) => entry.characterId === participant.characterId);
    const mentioned = target !== undefined;
    if (target?.kind === "DIRECT_MENTION") {
      score += MENTION_SCORE;
      reasons.push("DIRECT_MENTION");
    } else if (target) {
      score += SUBJECT_MENTION_SCORE;
      reasons.push("SUBJECT_MENTION");
    }
    if (replyTargetCharacterId === participant.characterId) {
      score += REPLY_TARGET_SCORE;
      reasons.push("REPLY_TARGET");
    }
    if (lastAiMessage?.characterId === participant.characterId) {
      score -= RECENT_SPEAKER_PENALTY;
      reasons.push("RECENTLY_SPOKE");
    }
    const affinity = input.relationshipAffinity?.[participant.characterId];
    if (typeof affinity === "number" && affinity > 0) {
      score += Math.round(Math.min(affinity, 1) * RELATIONSHIP_MAX);
      reasons.push("RELATIONSHIP_SIGNAL");
      if (affinity >= HIGH_AFFINITY_THRESHOLD) reasons.push("HIGH_AFFINITY");
    }
    if (input.depth > 0) {
      score -= DEPTH_PENALTY * input.depth;
      reasons.push("DEPTH_PENALTY");
    }
    if (!mentioned && SOCIAL_PATTERN.test(normalizedLast)) {
      score += SOCIAL_BASELINE_SCORE;
      reasons.push("SOCIAL_BASELINE");
    }
    const jitter = seededFraction(
      [
        input.seed.universeId,
        input.seed.conversationId,
        participant.characterId,
        input.seed.lastMessageId,
        input.seed.worldDate.toISOString(),
        String(input.depth),
      ].join(":"),
    );
    score += Math.round(jitter * JITTER_MAX);
    reasons.push("SEEDED_VARIATION");

    const recentlyAuthored = (input.recentAiMessages ?? []).slice(-3).filter(
      (message) => message.characterId === participant.characterId,
    );
    if (
      recentlyAuthored.some(
        (message) => tokenOverlap(message.content, normalizedLast) >= TOPIC_ENGAGEMENT_OVERLAP,
      )
    ) {
      score += TOPIC_ENGAGEMENT_SCORE;
      reasons.push("TOPIC_ENGAGEMENT");
    }
    if (
      recentlyAuthored.some((message) => tokenOverlap(message.content, normalizedLast) >= 0.6) &&
      !mentioned
    ) {
      score -= REDUNDANCY_PENALTY;
      reasons.push("REDUNDANT_RESPONSE");
    }
    if (input.depth > 0) {
      const contextual =
        reasons.includes("DIRECT_MENTION") ||
        reasons.includes("REPLY_TARGET") ||
        reasons.includes("SUBJECT_MENTION") ||
        reasons.includes("TOPIC_ENGAGEMENT") ||
        reasons.includes("HIGH_AFFINITY");
      if (!contextual) {
        rejected.push({
          characterId: participant.characterId,
          name: participant.name,
          score,
          opportunity: 0,
          reasons: [...reasons, "NO_CONTEXTUAL_REASON"],
        });
        continue;
      }
    }

    const opportunity = Math.max(0, Math.min(1, score / 70));
    if (score < input.limits.minScore) {
      rejected.push({
        characterId: participant.characterId,
        name: participant.name,
        score,
        opportunity,
        reasons: [...reasons, "LOW_SCORE"],
      });
      continue;
    }
    eligible.push({
      characterId: participant.characterId,
      name: participant.name,
      score,
      opportunity,
      reasons,
    });
  }

  eligible.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.characterId.localeCompare(b.characterId);
  });
  const directEligible = eligible.filter(
    (candidate) =>
      candidate.reasons.includes("DIRECT_MENTION") || candidate.reasons.includes("REPLY_TARGET"),
  );
  const selectionPool = directEligible.length > 0 ? directEligible : eligible;
  let selectionCap = Math.max(0, input.limits.maxResponders);
  if (directEligible.length === 0) {
    const hasContextualStrength = selectionPool.some(
      (candidate) =>
        candidate.reasons.includes("HIGH_AFFINITY") ||
        candidate.reasons.includes("TOPIC_ENGAGEMENT") ||
        candidate.reasons.includes("SUBJECT_MENTION"),
    );
    if (!hasContextualStrength) selectionCap = Math.min(selectionCap, 1);
  }
  const selected = selectionPool.slice(0, selectionCap);

  return {
    candidates: [...eligible, ...rejected],
    selected,
    rejected,
    stopReason: selected.length > 0 ? "SELECTED" : "NO_RESPONSE_OPPORTUNITY",
  };
}
