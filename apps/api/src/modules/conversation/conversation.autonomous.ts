import type { CharacterController, ConversationStatus, MessageSenderType } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { assembleGenerationBundle, type GenerationProvider } from "../generation/generation.assembly.js";
import { evaluateBehaviorDecision } from "../behavior/behavior.decision.js";
import { executeBehaviorDecision } from "../behavior/behavior.execution.js";
import { conversationTurnLimits } from "./conversation.policy.js";
import {
  planConversationTurn,
  summarizeConversation,
  type ConversationTurnPlan,
} from "./conversation.turn-engine.js";

export class ConversationAutonomousError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "ConversationAutonomousError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type AutonomousTurnLanguage = {
  readonly provider: string;
  readonly model: string;
  readonly fallback: boolean;
};

export type AutonomousTurnResult =
  | {
      readonly executed: false;
      readonly reasonCode: string;
      readonly plan: ConversationTurnPlan;
      readonly decisionId: string | null;
    }
  | {
      readonly executed: true;
      readonly reasonCode: "EXECUTED";
      readonly plan: ConversationTurnPlan;
      readonly decisionId: string;
      readonly messageId: string;
      readonly speakerCharacterId: string;
      readonly language: AutonomousTurnLanguage;
    };

function normalizeContent(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function fallbackText(speakerName: string): string {
  return `${speakerName} continua a conversa.`;
}

export async function runAutonomousConversationTurn(
  conversationId: string,
  options: {
    readonly userId: string;
    readonly worldDate?: Date;
    readonly provider?: GenerationProvider;
    readonly forceSpeakerCharacterId?: string;
  },
): Promise<AutonomousTurnResult> {
  const limits = conversationTurnLimits();
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
              userId: true,
              availability: { select: { status: true } },
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
    throw new ConversationAutonomousError("CONVERSATION_NOT_FOUND", "Conversa não encontrada", 404);
  }
  const owns = conversation.participants.some(
    (participant) => participant.character.userId === options.userId,
  );
  if (!owns) {
    throw new ConversationAutonomousError("CONVERSATION_NOT_FOUND", "Conversa não encontrada", 404);
  }

  const participants = conversation.participants
    .map((participant) => participant.character)
    .sort((a, b) => a.id.localeCompare(b.id));
  const messages = [...conversation.messages].reverse();
  const plan = planConversationTurn({
    status: conversation.status as ConversationStatus,
    participants: participants.map((character) => ({
      characterId: character.id,
      name: character.name,
      controller: character.controlledBy as CharacterController,
      universeId: character.universeId,
      available:
        !character.availability ||
        character.availability.status === "AVAILABLE" ||
        character.availability.status === "RACE_WEEKEND",
    })),
    messages: messages.map((message) => ({
      senderType: message.senderType as MessageSenderType,
      characterId: message.characterId,
      content: message.content,
      createdAt: message.createdAt,
    })),
    worldDate: options.worldDate ?? new Date(),
    limits,
  });

  if (!plan.canContinue && !options.forceSpeakerCharacterId) {
    return { executed: false, reasonCode: plan.reasonCode, plan, decisionId: null };
  }

  const forcedSpeakerId = options.forceSpeakerCharacterId ?? null;
  const speaker = forcedSpeakerId
    ? participants.find(
        (character) => character.id === forcedSpeakerId && character.controlledBy === "AI",
      )
    : participants.find((character) => character.id === plan.speakerCharacterId);
  if (!speaker || !speaker.universeId) {
    return { executed: false, reasonCode: "NO_UNIVERSE", plan, decisionId: null };
  }
  const effectiveTargetCharacterId =
    forcedSpeakerId !== null
      ? (messages[messages.length - 1]?.characterId ?? null)
      : plan.targetCharacterId;

  const worldDate =
    options.worldDate ??
    (
      await prisma.worldState.findUnique({
        where: { universeId_key: { universeId: speaker.universeId, key: "default" } },
        select: { currentDate: true },
      })
    )?.currentDate;
  if (!worldDate) {
    throw new ConversationAutonomousError("PRECONDITION_FAILED", "WorldState sem currentDate", 400);
  }

  const lastMessage = messages[messages.length - 1] ?? null;
  const userPrompt = [
    `Continue a conversa como ${speaker.name}.`,
    "Responda exclusivamente em português do Brasil (pt-BR).",
    plan.summary ? `Resumo recente: ${plan.summary}` : null,
    `Motivo do turno: ${plan.speakerReasonCode ?? "DETERMINISTIC_ORDER"}.`,
  ]
    .filter((line): line is string => line !== null)
    .join(" ")
    .slice(0, 2000);

  let language: AutonomousTurnLanguage = {
    provider: "deterministic",
    model: "behavior-language.v1",
    fallback: true,
  };
  let text = fallbackText(speaker.name);
  if (options.provider) {
    try {
      const generated = await assembleGenerationBundle(
        prisma,
        {
          userId: options.userId,
          conversationId,
          now: worldDate,
          userPrompt,
          targetCharacterId: speaker.id,
        },
        options.provider,
      );
      if (generated.meta.mode === "generated" && generated.text?.trim()) {
        text = generated.text.trim();
        language = {
          provider: generated.meta.provider,
          model: options.provider.name,
          fallback: false,
        };
      }
    } catch {
      language = { provider: "deterministic", model: "behavior-language.v1", fallback: true };
    }
  }

  if (lastMessage && normalizeContent(lastMessage.content) === normalizeContent(text)) {
    return { executed: false, reasonCode: "REPEATED_CONTENT", plan, decisionId: null };
  }

  const decision = await evaluateBehaviorDecision({
    universeId: speaker.universeId,
    characterId: speaker.id,
    trigger: "CONVERSATION_TURN_DUE",
    worldDate,
    conversationId,
    userInitiated: false,
    ...(effectiveTargetCharacterId
      ? { metadata: { targetCharacterId: effectiveTargetCharacterId } }
      : {}),
  });
  if (decision.selected.actionType !== "RESPOND") {
    return { executed: false, reasonCode: decision.reasonCode, plan, decisionId: decision.decisionId };
  }

  const execution = await executeBehaviorDecision(decision.decisionId, {
    contentOverride: {
      text,
      provider: language.provider,
      model: language.model,
      fallback: language.fallback,
    },
  });
  if (execution.status !== "EXECUTED" || !execution.executedMessageId) {
    return {
      executed: false,
      reasonCode: execution.errorCode ?? execution.status,
      plan,
      decisionId: decision.decisionId,
    };
  }

  return {
    executed: true,
    reasonCode: "EXECUTED",
    plan,
    decisionId: decision.decisionId,
    messageId: execution.executedMessageId,
    speakerCharacterId: speaker.id,
    language,
  };
}

export { summarizeConversation };
