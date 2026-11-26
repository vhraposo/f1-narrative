import { createHash } from "node:crypto";

import type { CharacterGoalKind } from "@prisma/client";

import { isOpenAvailabilityStatus } from "../availability/availability.policy.js";
import type {
  BehaviorActionType,
  BehaviorCandidate,
  BehaviorCooldownState,
  BehaviorContextView,
  BehaviorDecisionRequest,
  BehaviorScoreBreakdown,
  BehaviorTrigger,
  ResolvedGoal,
} from "./behavior.types.js";

export const BEHAVIOR_SCORING_VERSION = "behavior-scoring.v1";

export const BEHAVIOR_SCORE_WEIGHTS = {
  goalAlignment: 40,
  triggerRelevance: 30,
  contextRelevance: 10,
  relationshipRelevance: 5,
  experienceRelevance: 5,
  availabilityBonus: 5,
  cooldownPenalty: -100,
  duplicatePenalty: -100,
  policyBonus: 10,
} as const;

const GOAL_ACTION_ALIGNMENT: Record<BehaviorActionType, Partial<Record<CharacterGoalKind, number>>> = {
  RESPOND: {
    PROTECT_RELATIONSHIP: 0.9,
    SUPPORT_FRIEND: 0.8,
    RECOVER_AFTER_SETBACK: 0.6,
    CONFRONT_RIVAL: 0.5,
  },
  SEND_MESSAGE: {
    WIN_RACE: 0.7,
    WIN_CHAMPIONSHIP: 0.7,
    CONFRONT_RIVAL: 0.85,
    PROTECT_RELATIONSHIP: 0.7,
    SUPPORT_FRIEND: 0.8,
    RECOVER_AFTER_SETBACK: 0.6,
    OUTPERFORM_TEAMMATE: 0.5,
    BUILD_REPUTATION: 0.5,
  },
  CREATE_MEMORY: {
    RECOVER_AFTER_SETBACK: 0.8,
    RESTORE_CONFIDENCE: 0.7,
    WIN_RACE: 0.6,
    WIN_CHAMPIONSHIP: 0.6,
    BUILD_REPUTATION: 0.5,
  },
  UPDATE_RELATIONSHIP: {
    PROTECT_RELATIONSHIP: 0.9,
    CONFRONT_RIVAL: 0.8,
    SUPPORT_FRIEND: 0.8,
    BUILD_REPUTATION: 0.4,
  },
  CREATE_EVENT: {
    BUILD_REPUTATION: 0.7,
    MAINTAIN_POSITION: 0.4,
    SUPPORT_FRIEND: 0.5,
  },
  NO_ACTION: {},
};

const TRIGGER_ACTION_AFFINITY: Record<BehaviorTrigger, readonly BehaviorActionType[]> = {
  MESSAGE_RECEIVED: ["RESPOND"],
  CONVERSATION_TURN_DUE: ["RESPOND"],
  EVENT_CREATED: ["SEND_MESSAGE", "CREATE_MEMORY", "UPDATE_RELATIONSHIP"],
  RACE_SESSION_COMPLETED: ["SEND_MESSAGE"],
  RACE_FINISHED: ["SEND_MESSAGE", "CREATE_MEMORY", "UPDATE_RELATIONSHIP"],
  RELATIONSHIP_CHANGED: ["UPDATE_RELATIONSHIP", "SEND_MESSAGE"],
  MEMORY_CREATED: ["CREATE_MEMORY"],
  SCHEDULE_DUE: ["CREATE_EVENT"],
  WORLD_ADVANCED: ["CREATE_EVENT", "SEND_MESSAGE"],
  USER_REQUESTED: ["RESPOND", "SEND_MESSAGE"],
  AUTONOMOUS_TICK: ["CREATE_EVENT", "CREATE_MEMORY", "UPDATE_RELATIONSHIP"],
};

export function worldDateBucket(worldDate: Date): string {
  return worldDate.toISOString().slice(0, 10);
}

export function actionFingerprint(input: {
  universeId: string;
  characterId: string;
  actionType: BehaviorActionType;
  targetCharacterId: string | null;
  conversationId: string | null;
  eventId: string | null;
  goalIds: readonly string[];
  worldDateBucket: string;
  contextFingerprint: string;
  policyVersion: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        universeId: input.universeId,
        characterId: input.characterId,
        actionType: input.actionType,
        targetCharacterId: input.targetCharacterId,
        conversationId: input.conversationId,
        eventId: input.eventId,
        goalIds: [...input.goalIds].sort(),
        worldDateBucket: input.worldDateBucket,
        contextFingerprint: input.contextFingerprint,
        policyVersion: input.policyVersion,
      }),
    )
    .digest("hex");
}

export function cooldownKey(input: {
  actionType: BehaviorActionType;
  targetCharacterId: string | null;
  bucket: string;
}): string {
  return `${input.actionType}:${input.targetCharacterId ?? "self"}:${input.bucket}`;
}

export function resolveGoalAlignment(
  goals: readonly ResolvedGoal[],
  actionType: BehaviorActionType,
): { alignment: number; goalIds: string[] } {
  const table = GOAL_ACTION_ALIGNMENT[actionType];
  const scored = goals
    .filter((goal) => goal.status === "ACTIVE")
    .map((goal) => {
      const base = table[goal.kind] ?? 0;
      const weighted = base * (goal.priority / 100);
      return { goalId: goal.id, weighted, base };
    })
    .filter((entry) => entry.base > 0)
    .sort((a, b) => {
      if (b.weighted !== a.weighted) return b.weighted - a.weighted;
      return a.goalId.localeCompare(b.goalId);
    });
  const alignment = scored.length > 0 ? Math.max(...scored.map((entry) => entry.weighted)) : 0;
  return { alignment, goalIds: scored.map((entry) => entry.goalId) };
}

function triggerRelevance(
  trigger: BehaviorTrigger,
  actionType: BehaviorActionType,
): number {
  return TRIGGER_ACTION_AFFINITY[trigger].includes(actionType)
    ? BEHAVIOR_SCORE_WEIGHTS.triggerRelevance
    : 0;
}

function contextRelevance(input: {
  actionType: BehaviorActionType;
  context: BehaviorContextView;
  candidate: Pick<BehaviorCandidate, "targetCharacterId" | "conversationId">;
}): number {
  const { actionType, context, candidate } = input;
  if (actionType === "RESPOND") {
    return candidate.conversationId && context.conversation?.isParticipant
      ? BEHAVIOR_SCORE_WEIGHTS.contextRelevance
      : 0;
  }
  if (actionType === "SEND_MESSAGE") {
    return candidate.targetCharacterId ? BEHAVIOR_SCORE_WEIGHTS.contextRelevance : 0;
  }
  if (actionType === "UPDATE_RELATIONSHIP") {
    return candidate.targetCharacterId ? BEHAVIOR_SCORE_WEIGHTS.contextRelevance : 0;
  }
  if (actionType === "CREATE_MEMORY") {
    return context.experience.recent.length > 0 ? BEHAVIOR_SCORE_WEIGHTS.contextRelevance : 0;
  }
  if (actionType === "CREATE_EVENT") {
    return context.world.currentSeasonId ? BEHAVIOR_SCORE_WEIGHTS.contextRelevance : 0;
  }
  return 0;
}

function relationshipRelevance(
  context: BehaviorContextView,
  targetCharacterId: string | null,
): number {
  if (!targetCharacterId) return 0;
  const relationship = context.relationships.entries.find(
    (entry) => entry.otherCharacterId === targetCharacterId,
  );
  if (!relationship) return 0;
  const magnitude = Object.values(relationship.dimensions).reduce(
    (max, value) => Math.max(max, Math.abs(value)),
    0,
  );
  return magnitude > 0 ? BEHAVIOR_SCORE_WEIGHTS.relationshipRelevance : 0;
}

function experienceRelevance(
  context: BehaviorContextView,
  actionType: BehaviorActionType,
): number {
  if (actionType !== "CREATE_MEMORY") return 0;
  const significant = context.experience.recent.some(
    (experience) => experience.salience === "HIGH" || experience.salience === "CRITICAL",
  );
  return significant ? BEHAVIOR_SCORE_WEIGHTS.experienceRelevance : 0;
}

function availabilityBonus(
  context: BehaviorContextView,
  actionType: BehaviorActionType,
): number {
  if (actionType === "NO_ACTION") return 0;
  if (!context.availability) return 0;
  return isOpenAvailabilityStatus(context.availability.status)
    ? BEHAVIOR_SCORE_WEIGHTS.availabilityBonus
    : 0;
}

export function scoreBehaviorCandidate(input: {
  actionType: BehaviorActionType;
  priority: number;
  targetCharacterId: string | null;
  conversationId: string | null;
  fingerprint: string;
  goals: readonly ResolvedGoal[];
  context: BehaviorContextView;
  request: BehaviorDecisionRequest;
  cooldown: BehaviorCooldownState;
  bucket: string;
}): { score: number; breakdown: BehaviorScoreBreakdown; goalIds: string[]; goalAlignment: number } {
  const { alignment, goalIds } = resolveGoalAlignment(input.goals, input.actionType);
  const cooldownPenalty =
    input.actionType === "SEND_MESSAGE" &&
    input.cooldown.keys.has(
      cooldownKey({
        actionType: input.actionType,
        targetCharacterId: input.targetCharacterId,
        bucket: input.bucket,
      }),
    )
      ? BEHAVIOR_SCORE_WEIGHTS.cooldownPenalty
      : 0;
  const duplicatePenalty = input.cooldown.fingerprints.has(input.fingerprint)
    ? BEHAVIOR_SCORE_WEIGHTS.duplicatePenalty
    : 0;

  const breakdown: BehaviorScoreBreakdown = {
    total: 0,
    goalAlignment: Math.round(alignment * BEHAVIOR_SCORE_WEIGHTS.goalAlignment),
    triggerRelevance: triggerRelevance(input.request.trigger, input.actionType),
    contextRelevance: contextRelevance({
      actionType: input.actionType,
      context: input.context,
      candidate: {
        targetCharacterId: input.targetCharacterId,
        conversationId: input.conversationId,
      },
    }),
    relationshipRelevance: relationshipRelevance(input.context, input.targetCharacterId),
    experienceRelevance: experienceRelevance(input.context, input.actionType),
    availabilityBonus: availabilityBonus(input.context, input.actionType),
    cooldownPenalty,
    duplicatePenalty,
    policyBonus: Math.round((input.priority / 90) * BEHAVIOR_SCORE_WEIGHTS.policyBonus),
  };
  const total = Object.entries(breakdown)
    .filter(([key]) => key !== "total")
    .reduce((sum, [, value]) => sum + (value as number), 0);

  return {
    score: total,
    breakdown: { ...breakdown, total },
    goalIds,
    goalAlignment: alignment,
  };
}
