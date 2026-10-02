import type { CharacterController, MessageSenderType } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { runAutonomousConversationTurn, type AutonomousTurnResult } from "./conversation.autonomous.js";
import { conversationTurnLimits } from "./conversation.policy.js";
import {
  evaluateConversationEnergy,
  planResponseWindow,
  type ConversationEnergy,
  type ResponseWindow,
} from "./conversation.energy.js";
import {
  buildDialogueCandidateSet,
  buildFallbackPlan,
  deriveDialogueIntent,
  DeterministicDialoguePlanner,
  validateDialoguePlan,
  type DialogueIntent,
  type DialoguePlan,
} from "./conversation.dialogue.js";
import {
  buildDialogueRealizerContext,
  createDialogueRealizer,
  DeterministicDialogueRealizer,
  resolveDialogueRealizerKind,
} from "./conversation.dialogue-realizer.js";
import { validateDialogueOutput } from "./conversation.dialogue-output.js";
import { deriveDialogueEmotion } from "./conversation.dialogue-emotion.js";
import { deriveDialogueTopic } from "./conversation.dialogue-topic.js";
import { buildDialogueMemoryContext } from "./conversation.dialogue-memory.js";
import {
  buildDialogueContext,
  buildDialogueKnowledgeContext,
} from "./conversation.dialogue-context.js";
import { retrieveRelevantMemories } from "../memory/memory.retrieval.js";
import { selectResponseCandidates } from "./conversation.response-engine.js";
import type { GenerationProvider } from "../generation/generation.assembly.js";

export type SimulationStopReason =
  | "NO_MESSAGES"
  | "NO_OPPORTUNITY"
  | "LOW_ACTIVITY"
  | "NATURAL_END"
  | "REDUNDANT_RESPONSE"
  | "DEPTH_LIMIT"
  | "BUDGET_LIMIT"
  | "CONVERSATION_INACTIVE"
  | "NO_ELIGIBLE_SPEAKER"
  | string;

export type SimulationStep = {
  readonly depth: number;
  readonly characterId: string;
  readonly name: string;
  readonly messageId: string;
  readonly language: { provider: string; model: string; fallback: boolean };
};

export type SimulationSelectionTrace = {
  readonly depth: number;
  readonly candidates: ReadonlyArray<{
    characterId: string;
    score: number;
    opportunity: number;
    reasons: readonly string[];
  }>;
  readonly selected: readonly string[];
  readonly stopReason: string;
};

export type SimulationPlan = {
  readonly energy: ConversationEnergy;
  readonly window: ResponseWindow;
  readonly planned: ReadonlyArray<{
    characterId: string;
    name: string;
    score: number;
    opportunity: number;
    reasons: readonly string[];
  }>;
  readonly stopReason: SimulationStopReason;
  readonly dialogue: DialoguePlan;
  readonly candidates: ReadonlyArray<{
    characterId: string;
    score: number;
    opportunity: number;
    reasons: readonly string[];
    eligible: boolean;
  }>;
};

export type DialogueExecutionTrace = {
  readonly speakerCharacterId: string;
  readonly intent: string;
  readonly replyToMessageId: string | null;
  readonly realizerKind: string;
  readonly fallback: boolean;
  readonly violations: readonly string[];
  readonly messageIds: readonly string[];
};

export type SimulationResult = {
  readonly executed: boolean;
  readonly stopReason: SimulationStopReason;
  readonly depth: number;
  readonly steps: readonly SimulationStep[];
  readonly selection: readonly SimulationSelectionTrace[];
  readonly plan: SimulationPlan;
  readonly trace?: readonly DialogueExecutionTrace[];
};

type PlanInput = {
  readonly conversationId: string;
  readonly participantIds: readonly string[];
  readonly participants: ReadonlyArray<{
    characterId: string;
    name: string;
    controller: CharacterController;
    available: boolean;
  }>;
  readonly messages: ReadonlyArray<{
    id: string;
    senderType: MessageSenderType;
    characterId: string | null;
    content: string;
    createdAt: Date;
  }>;
  readonly affinity: Record<string, number>;
  readonly budgetRemaining: number;
  readonly universeId: string;
};

async function loadPlanInput(
  conversationId: string,
  userId: string,
): Promise<PlanInput | null> {
  const limits = conversationTurnLimits();
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
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
        select: { id: true, senderType: true, characterId: true, content: true, createdAt: true },
      },
    },
  });
  if (!conversation) return null;
  const owns = conversation.participants.some(
    (participant) => participant.character.userId === userId,
  );
  if (!owns) return null;

  const messages = [...conversation.messages].reverse();
  const lastUserIndex = messages.reduce(
    (last, message, index) => (message.senderType === "USER_CHARACTER" ? index : last),
    -1,
  );
  const aiTurnsThisRound = messages.filter(
    (message, index) => index > lastUserIndex && message.senderType === "AI_CHARACTER",
  ).length;

  const participantIds = conversation.participants.map((participant) => participant.character.id);
  const affinity = await loadAffinity(participantIds);
  const universeId =
    conversation.participants
      .map((participant) => participant.character.universeId)
      .find((value): value is string => typeof value === "string") ?? "unknown";

  return {
    conversationId,
    participantIds,
    participants: conversation.participants.map((participant) => ({
      characterId: participant.character.id,
      name: participant.character.name,
      controller: participant.character.controlledBy as CharacterController,
      available:
        !participant.character.availability ||
        participant.character.availability.status === "AVAILABLE" ||
        participant.character.availability.status === "RACE_WEEKEND",
    })),
    messages: messages.map((message) => ({
      id: message.id,
      senderType: message.senderType as MessageSenderType,
      characterId: message.characterId,
      content: message.content,
      createdAt: message.createdAt,
    })),
    affinity,
    budgetRemaining: Math.max(0, limits.maxAiTurnsPerRound - aiTurnsThisRound),
    universeId,
  };
}

async function loadAffinity(characterIds: readonly string[]): Promise<Record<string, number>> {
  if (characterIds.length < 2) return {};
  const relationships = await prisma.relationship.findMany({
    where: {
      OR: [
        { characterAId: { in: [...characterIds] } },
        { characterBId: { in: [...characterIds] } },
      ],
    },
    select: { characterAId: true, characterBId: true, dimensions: true },
  });
  const affinity: Record<string, number> = {};
  for (const relationship of relationships) {
    const dimensions =
      relationship.dimensions && typeof relationship.dimensions === "object"
        ? (relationship.dimensions as Record<string, unknown>)
        : {};
    const read = (key: string): number =>
      typeof dimensions[key] === "number" ? (dimensions[key] as number) : 0;
    const value = Math.max(0, Math.min(1, ((read("affinity") + read("trust")) / 200) * 0.5 + 0.5));
    for (const id of [relationship.characterAId, relationship.characterBId]) {
      if (!characterIds.includes(id)) continue;
      affinity[id] = Math.max(affinity[id] ?? 0, value);
    }
  }
  return affinity;
}

function lastUserMessage(input: PlanInput) {
  return [...input.messages].reverse().find((message) => message.senderType === "USER_CHARACTER") ?? null;
}

function recentAiMessages(input: PlanInput): { characterId: string; content: string }[] {
  return input.messages
    .filter(
      (message): message is typeof message & { characterId: string } =>
        message.senderType === "AI_CHARACTER" && typeof message.characterId === "string",
    )
    .slice(-3)
    .map((message) => ({ characterId: message.characterId, content: message.content }));
}

export async function getSimulationPlan(
  conversationId: string,
  options: { readonly userId: string; readonly worldDate?: Date },
): Promise<SimulationPlan> {
  const input = await loadPlanInput(conversationId, options.userId);
  if (!input) {
    const energy = evaluateConversationEnergy({
      message: "",
      participantCount: 0,
      recentAiMessages: 0,
    });
    return {
      energy,
      window: planResponseWindow(energy, { budgetRemaining: 0 }),
      planned: [],
      stopReason: "CONVERSATION_INACTIVE",
      dialogue: {
        conversationIntent: "CLOSE",
        topic: null,
        emotionalTone: "NEUTRAL",
        turns: [],
        continuation: "STOP",
        stopReason: "INACTIVE",
      },
      candidates: [],
    };
  }
  const lastMessage = input.messages[input.messages.length - 1] ?? null;
  if (!lastMessage) {
    const energy = evaluateConversationEnergy({
      message: "",
      participantCount: input.participants.length,
      recentAiMessages: 0,
    });
    return {
      energy,
      window: planResponseWindow(energy, { budgetRemaining: input.budgetRemaining }),
      planned: [],
      stopReason: "NO_MESSAGES",
      dialogue: {
        conversationIntent: "CLOSE",
        topic: null,
        emotionalTone: "NEUTRAL",
        turns: [],
        continuation: "STOP",
        stopReason: "NO_OPPORTUNITY",
      },
      candidates: [],
    };
  }
  const userMessage = lastUserMessage(input);
  const trigger =
    lastMessage.senderType === "USER_CHARACTER"
      ? lastMessage
      : userMessage && userMessage.createdAt.getTime() >= lastMessage.createdAt.getTime()
        ? userMessage
        : lastMessage;
  const triggerMessages =
    trigger.id === lastMessage.id
      ? input.messages
      : [...input.messages.filter((message) => message.id !== trigger.id), trigger];
  const recentAi = input.messages.filter(
    (message) => message.senderType === "AI_CHARACTER",
  ).length;
  const energy = evaluateConversationEnergy({
    message: trigger.content,
    participantCount: input.participants.length,
    recentAiMessages: recentAi,
  });
  const window = planResponseWindow(energy, { budgetRemaining: input.budgetRemaining });
  if (window.maxInitialResponders === 0) {
    return {
      energy,
      window,
      planned: [],
      stopReason: "BUDGET_LIMIT",
      dialogue: {
        conversationIntent: "CLOSE",
        topic: null,
        emotionalTone: "NEUTRAL",
        turns: [],
        continuation: "STOP",
        stopReason: "BUDGET",
      },
      candidates: [],
    };
  }
  const selection = selectResponseCandidates({
    participants: input.participants.map((participant) => ({ ...participant })),
    messages: triggerMessages.map((message) => ({ ...message })),
    relationshipAffinity: input.affinity,
    depth: 0,
    alreadyResponded: [],
    recentAiMessages: recentAiMessages(input),
    seed: {
      universeId: input.universeId,
      conversationId,
      lastMessageId: trigger.id,
      worldDate: options.worldDate ?? trigger.createdAt,
    },
    limits: {
      maxResponders: window.maxInitialResponders,
      minScore: window.stopThresholds.initial,
    },
  });
  const candidateSet = buildDialogueCandidateSet({
    conversationId,
    universeId: input.universeId,
    lastMessageId: trigger.id,
    lastMessageContent: trigger.content,
    depth: 0,
    energy,
    window,
    selection,
  });
  const planner = new DeterministicDialoguePlanner();
  const proposed = await planner.plan({ candidateSet });
  const participantIds = new Set(input.participants.map((participant) => participant.characterId));
  const aiParticipantIds = new Set(
    input.participants
      .filter((participant) => participant.controller === "AI")
      .map((participant) => participant.characterId),
  );
  const validation = validateDialoguePlan(proposed, {
    participantIds,
    aiParticipantIds,
    eligibleCandidateIds: new Set(selection.selected.map((candidate) => candidate.characterId)),
    availablePutativeIds: new Set(
      input.participants.filter((participant) => participant.available).map((p) => p.characterId),
    ),
    messageIds: new Set(input.messages.map((message) => message.id)),
    maxTurns: window.maxInitialResponders + window.maxReactions,
    remainingBudget: input.budgetRemaining,
  });
  const dialogue = validation.valid ? proposed : buildFallbackPlan(candidateSet);
  const candidateById = new Map(candidateSet.candidates.map((candidate) => [candidate.characterId, candidate]));
  return {
    energy,
    window,
    planned: dialogue.turns.flatMap((turn) => {
      const candidate = candidateById.get(turn.speakerCharacterId);
      if (!candidate) return [];
      return [
        {
          characterId: candidate.characterId,
          name: candidate.name,
          score: candidate.score,
          opportunity: candidate.opportunity,
          reasons: [...candidate.reasons, `INTENT_${turn.intent}`],
        },
      ];
    }),
    stopReason: dialogue.stopReason === "SELECTED" ? "SELECTED" : dialogue.stopReason,
    dialogue,
    candidates: candidateSet.candidates.map((candidate) => ({
      characterId: candidate.characterId,
      score: candidate.score,
      opportunity: candidate.opportunity,
      reasons: candidate.reasons,
      eligible: candidate.eligible,
    })),
  };
}

function realizerVoice(affinity: number | undefined) {
  const value = affinity ?? 0.5;
  return {
    informality: Math.min(1, 0.4 + value * 0.4),
    warmth: value,
    humor: 0.4,
    emojiTendency: Math.min(1, 0.2 + value * 0.4),
    verbosity: 0.3,
  };
}

export async function simulateConversationTurn(
  conversationId: string,
  options: {
    readonly userId: string;
    readonly worldDate?: Date;
    readonly provider?: GenerationProvider;
    readonly maxDepth?: number;
  },
): Promise<SimulationResult> {
  const plan = await getSimulationPlan(conversationId, {
    userId: options.userId,
    ...(options.worldDate ? { worldDate: options.worldDate } : {}),
  });
  const steps: SimulationStep[] = [];
  const selection: SimulationSelectionTrace[] = [];
  const alreadyResponded = new Set<string>();
  let stopReason: SimulationStopReason = plan.stopReason;

  if (plan.planned.length === 0) {
    return { executed: false, stopReason, depth: 0, steps, selection, plan };
  }

  const initialInput = await loadPlanInput(conversationId, options.userId);
  if (!initialInput) {
    return { executed: false, stopReason: "CONVERSATION_INACTIVE", depth: 0, steps, selection, plan };
  }
  const realizer = createDialogueRealizer(resolveDialogueRealizerKind());
  const nameById = new Map(initialInput.participants.map((p) => [p.characterId, p.name]));
  const messageById = new Map<string, { characterId: string | null; content: string; name: string }>();
  for (const message of initialInput.messages) {
    messageById.set(message.id, {
      characterId: message.characterId,
      content: message.content,
      name: message.characterId ? nameById.get(message.characterId) ?? "" : "",
    });
  }
  let lastMessageId: string | null = plan.dialogue.turns[0]?.replyToMessageId ?? null;
  let producedAny = false;
  const executionTrace: DialogueExecutionTrace[] = [];
  const deterministicRealizer = new DeterministicDialogueRealizer();
  const referenceDate =
    options.worldDate ??
    initialInput.messages[initialInput.messages.length - 1]?.createdAt ??
    new Date(0);

  async function realizeAndPersist(input: {
    readonly candidate: { characterId: string; name: string };
    readonly intent: DialogueIntent;
    readonly replyToMessageId: string | null;
    readonly maxMessages: 1 | 2 | 3;
    readonly depth: number;
  }): Promise<boolean> {
    const affinity = initialInput!.affinity[input.candidate.characterId];
    const recentMessages = [...messageById.entries()]
      .slice(-3)
      .map(([, message]) => ({ speakerName: message.name, content: message.content }));
    const authorizedMemories = await retrieveRelevantMemories({
      universeId: initialInput!.universeId,
      characterId: input.candidate.characterId,
      participantIds: initialInput!.participantIds,
      worldDate: referenceDate,
      now: referenceDate,
      limit: 3,
    });
    const memoryContext = buildDialogueMemoryContext({
      characterId: input.candidate.characterId,
      conversationParticipantIds: initialInput!.participantIds,
      memories: authorizedMemories,
    });
    const emotion = deriveDialogueEmotion({
      energy: plan.energy,
      affinity: typeof affinity === "number" ? affinity : null,
      recentMessages,
    });
    const topicContext = deriveDialogueTopic({
      messages: recentMessages,
      previousTopic: null,
    });
    const knowledgeContext = buildDialogueKnowledgeContext({
      universeId: initialInput!.universeId,
      memories: authorizedMemories.map((memory) => ({
        id: memory.id,
        summary: memory.summary,
        content: memory.content,
        importance: memory.importance,
        universeId: initialInput!.universeId,
      })),
    });
    const dialogueContext = buildDialogueContext({
      speakerCharacterId: input.candidate.characterId,
      emotion,
      topic: topicContext,
      memory: memoryContext,
      knowledge: knowledgeContext,
      affinity: typeof affinity === "number" ? affinity : null,
    });
    const context = buildDialogueRealizerContext({
      speakerCharacterId: input.candidate.characterId,
      speakerName: input.candidate.name,
      intent: input.intent,
      replyToMessageId: input.replyToMessageId,
      replyToContent: input.replyToMessageId
        ? messageById.get(input.replyToMessageId)?.content ?? null
        : null,
      recentMessages,
      emotion: dialogueContext.emotion,
      topic: plan.dialogue.topic,
      topicContext: dialogueContext.topic,
      emotionalTone: plan.dialogue.emotionalTone,
      relationshipAffinity: dialogueContext.relationship.affinity,
      memorySummaries: memoryContext.items.map((item) => item.summary),
      memoryContext,
      knowledgeContext: dialogueContext.knowledge,
      voice: realizerVoice(affinity),
      maxMessages: input.maxMessages,
      language: "pt-BR",
    });
    const utterance = await realizer.realize(context);
    const lastPersisted = [...messageById.values()].slice(-1)[0]?.content ?? null;
    const replyToKnown = input.replyToMessageId === null || messageById.has(input.replyToMessageId);
    let outputValidation = validateDialogueOutput({
      context,
      utterance,
      previousMessageContent: lastPersisted,
      replyToKnown,
    });
    let usedFallback = false;
    if (!outputValidation.valid) {
      usedFallback = true;
      const fallbackUtterance = await deterministicRealizer.realize(context);
      outputValidation = validateDialogueOutput({
        context,
        utterance: fallbackUtterance,
        previousMessageContent: lastPersisted,
        replyToKnown,
      });
      if (!outputValidation.valid) {
        stopReason = outputValidation.reason ?? "OUTPUT_INVALID";
        return false;
      }
    }
    const effective = outputValidation.normalized!;
    if (effective.messages.length === 0) {
      executionTrace.push({
        speakerCharacterId: input.candidate.characterId,
        intent: input.intent,
        replyToMessageId: input.replyToMessageId,
        realizerKind: realizer.kind,
        fallback: usedFallback,
        violations: outputValidation.violations,
        messageIds: [],
      });
      return true;
    }
    let replyTo = input.replyToMessageId;
    const persistedIds: string[] = [];
    for (const fragment of effective.messages) {
      const turn: AutonomousTurnResult = await runAutonomousConversationTurn(conversationId, {
        userId: options.userId,
        ...(options.worldDate ? { worldDate: options.worldDate } : {}),
        forceSpeakerCharacterId: input.candidate.characterId,
        textOverride: fragment.text,
        dialogue: {
          intent: input.intent,
          replyToMessageId: replyTo,
          fragmentIndex: fragment.fragmentIndex,
          topicTag: plan.dialogue.topic,
        },
      });
      if (!turn.executed || !turn.messageId || !turn.speakerCharacterId) {
        stopReason = turn.reasonCode;
        return false;
      }
      producedAny = true;
      alreadyResponded.add(input.candidate.characterId);
      steps.push({
        depth: input.depth,
        characterId: turn.speakerCharacterId,
        name: input.candidate.name,
        messageId: turn.messageId,
        language: turn.language,
      });
      messageById.set(turn.messageId, {
        characterId: input.candidate.characterId,
        content: fragment.text,
        name: input.candidate.name,
      });
      replyTo = turn.messageId;
      lastMessageId = turn.messageId;
      persistedIds.push(turn.messageId);
    }
    executionTrace.push({
      speakerCharacterId: input.candidate.characterId,
      intent: input.intent,
      replyToMessageId: input.replyToMessageId,
      realizerKind: realizer.kind,
      fallback: usedFallback,
      violations: outputValidation.violations,
      messageIds: persistedIds,
    });
    return true;
  }

  const candidateById = new Map(plan.planned.map((candidate) => [candidate.characterId, candidate]));
  for (const [index, turn] of plan.dialogue.turns.entries()) {
    const candidate = candidateById.get(turn.speakerCharacterId);
    if (!candidate) continue;
    const replyTo = index === 0 ? turn.replyToMessageId : lastMessageId;
    const ok = await realizeAndPersist({
      candidate,
      intent: turn.intent,
      replyToMessageId: replyTo,
      maxMessages: turn.maxMessages,
      depth: index,
    });
    if (!ok) break;
  }

  const maxDepth = Math.min(
    options.maxDepth ?? plan.window.maxChainDepth,
    plan.window.maxChainDepth,
  );
  let reactions = 0;
  while (
    producedAny &&
    steps.length < maxDepth &&
    reactions < plan.window.maxReactions &&
    stopReason !== "CONVERSATION_INACTIVE"
  ) {
    const input = await loadPlanInput(conversationId, options.userId);
    if (!input) {
      stopReason = "CONVERSATION_INACTIVE";
      break;
    }
    const lastMessage = input.messages[input.messages.length - 1];
    if (!lastMessage) break;
    const reactionSelection = selectResponseCandidates({
      participants: input.participants.map((participant) => ({ ...participant })),
      messages: input.messages.map((message) => ({ ...message })),
      relationshipAffinity: input.affinity,
      depth: steps.length,
      alreadyResponded: [...alreadyResponded],
      recentAiMessages: recentAiMessages(input),
      seed: {
        universeId: input.universeId,
        conversationId,
        lastMessageId: lastMessage.id,
        worldDate: options.worldDate ?? lastMessage.createdAt,
      },
      limits: { maxResponders: 1, minScore: plan.window.stopThresholds.reaction },
    });
    selection.push({
      depth: steps.length,
      candidates: reactionSelection.candidates.map((candidate) => ({
        characterId: candidate.characterId,
        score: candidate.score,
        opportunity: candidate.opportunity,
        reasons: candidate.reasons,
      })),
      selected: reactionSelection.selected.map((candidate) => candidate.characterId),
      stopReason: reactionSelection.stopReason,
    });
    const chosen = reactionSelection.selected[0];
    if (!chosen) {
      stopReason = "NO_OPPORTUNITY";
      break;
    }
    const intent = deriveDialogueIntent({
      content: lastMessage.content,
      mentioned: false,
      energy: plan.energy,
    });
    const ok = await realizeAndPersist({
      candidate: { characterId: chosen.characterId, name: chosen.name },
      intent,
      replyToMessageId: lastMessage.id,
      maxMessages: 1,
      depth: steps.length,
    });
    if (!ok) break;
    reactions += 1;
    stopReason = "NATURAL_END";
  }

  if (steps.length > 0 && steps.length >= maxDepth) stopReason = "DEPTH_LIMIT";
  return {
    executed: steps.length > 0,
    stopReason,
    depth: steps.length,
    steps,
    selection,
    plan,
    trace: executionTrace,
  };
}
