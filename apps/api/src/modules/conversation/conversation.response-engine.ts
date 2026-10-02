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
const MENTION_SCORE = 40;
const SOCIAL_BASELINE_SCORE = 12;
const RECENT_SPEAKER_PENALTY = 25;
const RELATIONSHIP_MAX = 15;
const DEPTH_PENALTY = 8;
const JITTER_MAX = 14;
const REDUNDANCY_PENALTY = 24;

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
    const normalizedName = normalizeText(participant.name);
    const firstName = normalizedName.split(/\s+/)[0] ?? normalizedName;
    const mentioned =
      normalizedLast.includes(normalizedName) ||
      (firstName.length >= 3 && new RegExp(`\\b${firstName}\\b`).test(normalizedLast));
    if (mentioned) {
      score += MENTION_SCORE;
      reasons.push("DIRECT_MENTION");
    }
    if (lastAiMessage?.characterId === participant.characterId) {
      score -= RECENT_SPEAKER_PENALTY;
      reasons.push("RECENTLY_SPOKE");
    }
    const affinity = input.relationshipAffinity?.[participant.characterId];
    if (typeof affinity === "number" && affinity > 0) {
      score += Math.round(Math.min(affinity, 1) * RELATIONSHIP_MAX);
      reasons.push("RELATIONSHIP_SIGNAL");
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
      recentlyAuthored.some((message) => tokenOverlap(message.content, normalizedLast) >= 0.6) &&
      !mentioned
    ) {
      score -= REDUNDANCY_PENALTY;
      reasons.push("REDUNDANT_RESPONSE");
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
  const selected = eligible.slice(0, Math.max(0, input.limits.maxResponders));

  return {
    candidates: [...eligible, ...rejected],
    selected,
    rejected,
    stopReason: selected.length > 0 ? "SELECTED" : "NO_RESPONSE_OPPORTUNITY",
  };
}
