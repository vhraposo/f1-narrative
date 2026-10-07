import type { CharacterController, ConversationStatus, MessageSenderType } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { isAvailabilityOpen } from "../availability/availability.policy.js";
import {
  CONVERSATION_TURN_PLAN_VERSION,
  conversationTurnLimits,
  type ConversationTurnLimits,
} from "./conversation.policy.js";

export type ConversationTurnPlanReason =
  | "READY"
  | "CONVERSATION_NOT_FOUND"
  | "CONVERSATION_NOT_ACTIVE"
  | "NO_AI_PARTICIPANT"
  | "NO_MESSAGES"
  | "CONVERSATION_INACTIVE"
  | "TURN_BUDGET_EXHAUSTED"
  | "CONVERSATION_BUDGET_EXHAUSTED"
  | "SAME_SPEAKER_LIMIT"
  | "NO_ELIGIBLE_SPEAKER";

export type ConversationTurnSpeakerReason =
  | "DIRECT_MENTION"
  | "NEXT_PARTICIPANT"
  | "DETERMINISTIC_ORDER";

export type ConversationTurnParticipant = {
  readonly characterId: string;
  readonly name: string;
  readonly controller: CharacterController;
  readonly universeId: string | null;
  readonly available: boolean;
};

export type ConversationTurnMessage = {
  readonly senderType: MessageSenderType;
  readonly characterId: string | null;
  readonly content: string;
  readonly createdAt: Date;
};

export type ConversationTurnPlan = {
  readonly version: string;
  readonly canContinue: boolean;
  readonly reasonCode: ConversationTurnPlanReason;
  readonly speakerCharacterId: string | null;
  readonly speakerReasonCode: ConversationTurnSpeakerReason | null;
  readonly targetCharacterId: string | null;
  readonly budget: {
    readonly aiTurnsThisRound: number;
    readonly totalAiMessages: number;
    readonly consecutiveSameSpeaker: number;
  };
  readonly summary: string;
};

function normalizeContent(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function summarizeConversation(
  messages: readonly ConversationTurnMessage[],
  maxChars: number,
): string {
  if (messages.length === 0) return "";
  const lines: string[] = [];
  for (const message of messages) {
    const speaker = message.characterId ?? message.senderType;
    const excerpt = message.content.trim().replace(/\s+/g, " ").slice(0, 120);
    lines.push(`${speaker}: ${excerpt}`);
  }
  const joined = lines.join(" | ");
  return joined.length <= maxChars ? joined : `${joined.slice(0, maxChars - 1).trimEnd()}…`;
}

export function planConversationTurn(input: {
  readonly status: ConversationStatus;
  readonly participants: readonly ConversationTurnParticipant[];
  readonly messages: readonly ConversationTurnMessage[];
  readonly worldDate: Date;
  readonly limits?: ConversationTurnLimits;
}): ConversationTurnPlan {
  const limits = input.limits ?? conversationTurnLimits();
  const aiParticipants = input.participants
    .filter((participant) => participant.controller === "AI")
    .sort((a, b) => a.characterId.localeCompare(b.characterId));
  const summary = summarizeConversation(input.messages, limits.maxSummaryChars);
  const base = {
    version: CONVERSATION_TURN_PLAN_VERSION,
    speakerCharacterId: null,
    speakerReasonCode: null,
    targetCharacterId: null,
    summary,
  } as const;

  const aiMessages = input.messages.filter(
    (message) => message.senderType === "AI_CHARACTER" && message.characterId !== null,
  );
  const lastUserIndex = input.messages.reduce(
    (last, message, index) => (message.senderType === "USER_CHARACTER" ? index : last),
    -1,
  );
  const aiTurnsThisRound = input.messages.filter(
    (message, index) => index > lastUserIndex && message.senderType === "AI_CHARACTER",
  ).length;
  const budget = {
    aiTurnsThisRound,
    totalAiMessages: aiMessages.length,
    consecutiveSameSpeaker: 0,
  };

  if (input.status !== "ACTIVE") {
    return { ...base, canContinue: false, reasonCode: "CONVERSATION_NOT_ACTIVE", budget };
  }
  if (aiParticipants.length === 0) {
    return { ...base, canContinue: false, reasonCode: "NO_AI_PARTICIPANT", budget };
  }
  if (input.messages.length === 0) {
    return { ...base, canContinue: false, reasonCode: "NO_MESSAGES", budget };
  }
  const lastMessage = input.messages[input.messages.length - 1] as ConversationTurnMessage;
  if (input.worldDate.getTime() - lastMessage.createdAt.getTime() > limits.inactivityTimeoutMs) {
    return { ...base, canContinue: false, reasonCode: "CONVERSATION_INACTIVE", budget };
  }
  if (aiTurnsThisRound >= limits.maxAiTurnsPerRound) {
    return { ...base, canContinue: false, reasonCode: "TURN_BUDGET_EXHAUSTED", budget };
  }
  if (aiMessages.length >= limits.maxTotalAiMessages) {
    return { ...base, canContinue: false, reasonCode: "CONVERSATION_BUDGET_EXHAUSTED", budget };
  }

  let consecutiveSameSpeaker = 0;
  const lastAiSpeaker = aiMessages[aiMessages.length - 1]?.characterId ?? null;
  if (lastAiSpeaker) {
    for (let index = input.messages.length - 1; index >= 0; index -= 1) {
      const message = input.messages[index] as ConversationTurnMessage;
      if (message.senderType !== "AI_CHARACTER") break;
      if (message.characterId !== lastAiSpeaker) break;
      consecutiveSameSpeaker += 1;
    }
  }
  budget.consecutiveSameSpeaker = consecutiveSameSpeaker;

  const available = aiParticipants.filter((participant) => participant.available);
  if (available.length === 0) {
    return { ...base, canContinue: false, reasonCode: "NO_ELIGIBLE_SPEAKER", budget };
  }

  const normalizedLast = normalizeContent(lastMessage.content);
  const mentioned = available.filter((participant) =>
    normalizedLast.includes(participant.name.toLowerCase()),
  );
  const mentionedOther = mentioned.filter(
    (participant) => participant.characterId !== lastAiSpeaker,
  );
  const otherParticipants = available.filter(
    (participant) => participant.characterId !== lastAiSpeaker,
  );
  const sameSpeakerAllowed = consecutiveSameSpeaker < limits.maxConsecutiveSameSpeaker;

  let speaker: ConversationTurnParticipant;
  let speakerReasonCode: ConversationTurnSpeakerReason;
  if (mentionedOther.length > 0) {
    speaker = mentionedOther[0] as ConversationTurnParticipant;
    speakerReasonCode = "DIRECT_MENTION";
  } else if (otherParticipants.length > 0) {
    speaker = otherParticipants[0] as ConversationTurnParticipant;
    speakerReasonCode = "NEXT_PARTICIPANT";
  } else if (sameSpeakerAllowed) {
    speaker = available[0] as ConversationTurnParticipant;
    speakerReasonCode = "DETERMINISTIC_ORDER";
  } else {
    return { ...base, canContinue: false, reasonCode: "SAME_SPEAKER_LIMIT", budget };
  }

  const targetCharacterId =
    lastMessage.characterId && lastMessage.characterId !== speaker.characterId
      ? lastMessage.characterId
      : null;

  return {
    ...base,
    canContinue: true,
    reasonCode: "READY",
    speakerCharacterId: speaker.characterId,
    speakerReasonCode,
    targetCharacterId,
    budget,
  };
}

export async function planTurnForConversation(
  conversationId: string,
  options: { readonly worldDate: Date; readonly limits?: ConversationTurnLimits },
): Promise<ConversationTurnPlan> {
  const limits = options.limits ?? conversationTurnLimits();
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      status: true,
      participants: {
        select: {
          character: {
            select: {
              id: true,
              name: true,
              controlledBy: true,
              universeId: true,
              availability: { select: { status: true, until: true } },
            },
          },
        },
      },
      messages: {
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: limits.recentMessageWindow,
        select: { senderType: true, characterId: true, content: true, createdAt: true },
      },
    },
  });
  if (!conversation) {
    const limitsFallback = conversationTurnLimits();
    return {
      version: CONVERSATION_TURN_PLAN_VERSION,
      canContinue: false,
      reasonCode: "CONVERSATION_NOT_FOUND",
      speakerCharacterId: null,
      speakerReasonCode: null,
      targetCharacterId: null,
      budget: { aiTurnsThisRound: 0, totalAiMessages: 0, consecutiveSameSpeaker: 0 },
      summary: summarizeConversation([], limitsFallback.maxSummaryChars),
    };
  }

  const participants: ConversationTurnParticipant[] = conversation.participants
    .map((participant) => participant.character)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((character) => ({
      characterId: character.id,
      name: character.name,
      controller: character.controlledBy,
      universeId: character.universeId,
      available: isAvailabilityOpen(character.availability, options.worldDate),
    }));

  const messages = [...conversation.messages].reverse();

  return planConversationTurn({
    status: conversation.status,
    participants,
    messages,
    worldDate: options.worldDate,
    limits,
  });
}
