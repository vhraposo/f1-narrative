import {
  actionFingerprint,
  cooldownKey,
  scoreBehaviorCandidate,
  worldDateBucket,
} from "./behavior.scoring.js";
import {
  BEHAVIOR_POLICY_CODE,
  EMPTY_COOLDOWN_STATE,
  type BehaviorActionType,
  type BehaviorCandidate,
  type BehaviorCooldownState,
  type BehaviorContextView,
  type BehaviorDecisionRequest,
  type BehaviorPolicyResult,
  type ResolvedGoal,
} from "./behavior.types.js";

const ACTION_ORDER: readonly BehaviorActionType[] = [
  "RESPOND",
  "SEND_MESSAGE",
  "CREATE_MEMORY",
  "UPDATE_RELATIONSHIP",
  "CREATE_EVENT",
  "NO_ACTION",
];

const PRIORITY: Record<BehaviorActionType, number> = {
  RESPOND: 90,
  SEND_MESSAGE: 70,
  CREATE_MEMORY: 60,
  UPDATE_RELATIONSHIP: 50,
  CREATE_EVENT: 40,
  NO_ACTION: 0,
};

function isAutonomous(request: BehaviorDecisionRequest): boolean {
  if (request.userInitiated) return false;
  return request.trigger !== "USER_REQUESTED";
}

function resolveTargetCharacterId(request: BehaviorDecisionRequest): string | null {
  const target = request.metadata?.targetCharacterId;
  return typeof target === "string" && target.length > 0 ? target : null;
}

function hasRelationshipWith(context: BehaviorContextView, targetId: string | null): boolean {
  if (!targetId) return false;
  return context.relationships.entries.some((entry) => entry.otherCharacterId === targetId);
}

function isAvailabilityOpen(context: BehaviorContextView): boolean {
  const status = context.availability?.status;
  return status === "AVAILABLE" || status === "RACE_WEEKEND";
}

function hasSignificantExperience(context: BehaviorContextView): boolean {
  return context.experience.recent.some(
    (experience) => experience.salience === "HIGH" || experience.salience === "CRITICAL",
  );
}

type CandidateDraft = {
  readonly actionType: BehaviorActionType;
  readonly reasonCode: string;
  readonly requiredContext: BehaviorCandidate["requiredContext"];
  readonly preconditions: readonly string[];
  readonly targetCharacterId: string | null;
  readonly consequencesPreview: readonly string[];
  readonly metadata: Record<string, unknown>;
};

function evaluatePrecondition(
  code: string,
  context: BehaviorContextView,
  request: BehaviorDecisionRequest,
  candidate: { targetCharacterId: string | null; fingerprint: string },
  cooldown: BehaviorCooldownState,
): boolean {
  switch (code) {
    case "CONTROLLER_IS_AI":
      return !isAutonomous(request) || context.identity.controller === "AI";
    case "CHARACTER_IS_PARTICIPANT":
      return context.conversation?.isParticipant === true;
    case "AVAILABILITY_OPEN":
      return isAvailabilityOpen(context);
    case "RELATIONSHIP_TARGET_PRESENT":
      return hasRelationshipWith(context, candidate.targetCharacterId);
    case "SIGNIFICANT_EXPERIENCE_PRESENT":
      return hasSignificantExperience(context);
    case "ACTIVE_SEASON_PRESENT":
      return context.world.currentSeasonId !== null;
    case "COOLDOWN_CLEAR":
      return !cooldown.keys.has(
        cooldownKey({
          actionType: "SEND_MESSAGE",
          targetCharacterId: candidate.targetCharacterId,
          bucket: worldDateBucket(request.worldDate),
        }),
      );
    case "NO_DUPLICATE_ACTION":
      return !cooldown.fingerprints.has(candidate.fingerprint);
    default:
      return false;
  }
}

export function evaluateBehaviorPolicy(
  context: BehaviorContextView,
  request: BehaviorDecisionRequest,
  options: {
    readonly goals?: readonly ResolvedGoal[];
    readonly cooldown?: BehaviorCooldownState;
  } = {},
): BehaviorPolicyResult {
  const goals = options.goals ?? [];
  const cooldown = options.cooldown ?? EMPTY_COOLDOWN_STATE;
  const targetCharacterId = resolveTargetCharacterId(request);
  const bucket = worldDateBucket(request.worldDate);
  const drafts: CandidateDraft[] = [];

  if (request.trigger === "MESSAGE_RECEIVED" && request.conversationId) {
    drafts.push({
      actionType: "RESPOND",
      reasonCode: "POLICY_RESPOND_TO_DIRECT_MESSAGE",
      requiredContext: ["CONVERSATION", "PERSONALITY", "MEMORY"],
      preconditions: [
        "CONTROLLER_IS_AI",
        "CHARACTER_IS_PARTICIPANT",
        "AVAILABILITY_OPEN",
        "NO_DUPLICATE_ACTION",
      ],
      targetCharacterId,
      consequencesPreview: ["MESSAGE_SENT", "RELATIONSHIP_POSSIBLE_DELTA"],
      metadata: {},
    });
  }

  if (
    request.trigger === "EVENT_CREATED" ||
    request.trigger === "RACE_FINISHED" ||
    request.trigger === "RACE_SESSION_COMPLETED" ||
    request.trigger === "RELATIONSHIP_CHANGED" ||
    request.trigger === "WORLD_ADVANCED"
  ) {
    drafts.push({
      actionType: "SEND_MESSAGE",
      reasonCode: "POLICY_REACT_TO_WORLD_CHANGE",
      requiredContext: ["CURRENT_STATE", "RELATIONSHIPS", "MEMORY"],
      preconditions: [
        "CONTROLLER_IS_AI",
        "RELATIONSHIP_TARGET_PRESENT",
        "AVAILABILITY_OPEN",
        "COOLDOWN_CLEAR",
        "NO_DUPLICATE_ACTION",
      ],
      targetCharacterId,
      consequencesPreview: ["MESSAGE_SENT"],
      metadata: {},
    });
  }

  if (
    request.trigger === "RACE_FINISHED" ||
    request.trigger === "EVENT_CREATED" ||
    request.trigger === "MEMORY_CREATED"
  ) {
    drafts.push({
      actionType: "CREATE_MEMORY",
      reasonCode: "POLICY_CONSOLIDATE_SIGNIFICANT_EXPERIENCE",
      requiredContext: ["EXPERIENCE", "CURRENT_STATE"],
      preconditions: ["CONTROLLER_IS_AI", "SIGNIFICANT_EXPERIENCE_PRESENT", "NO_DUPLICATE_ACTION"],
      targetCharacterId,
      consequencesPreview: ["MEMORY_CANDIDATE_CREATED"],
      metadata: {},
    });
  }

  if (
    request.trigger === "RELATIONSHIP_CHANGED" ||
    request.trigger === "EVENT_CREATED" ||
    request.trigger === "RACE_FINISHED"
  ) {
    drafts.push({
      actionType: "UPDATE_RELATIONSHIP",
      reasonCode: "POLICY_APPLY_SOCIAL_CONSEQUENCE",
      requiredContext: ["RELATIONSHIPS", "CURRENT_STATE"],
      preconditions: ["CONTROLLER_IS_AI", "RELATIONSHIP_TARGET_PRESENT", "NO_DUPLICATE_ACTION"],
      targetCharacterId,
      consequencesPreview: ["RELATIONSHIP_DELTA_APPLIED"],
      metadata: {},
    });
  }

  if (
    request.trigger === "WORLD_ADVANCED" ||
    request.trigger === "SCHEDULE_DUE" ||
    request.trigger === "AUTONOMOUS_TICK"
  ) {
    drafts.push({
      actionType: "CREATE_EVENT",
      reasonCode: "POLICY_EMIT_SCHEDULED_EVENT",
      requiredContext: ["SCHEDULE", "WORLD"],
      preconditions: ["CONTROLLER_IS_AI", "ACTIVE_SEASON_PRESENT", "NO_DUPLICATE_ACTION"],
      targetCharacterId,
      consequencesPreview: ["EVENT_CREATED"],
      metadata: {},
    });
  }

  drafts.push({
    actionType: "NO_ACTION",
    reasonCode: "POLICY_NO_ACTION_BASELINE",
    requiredContext: [],
    preconditions: [],
    targetCharacterId: null,
    consequencesPreview: [],
    metadata: {},
  });

  const candidates: BehaviorCandidate[] = drafts.map((draft) => {
    const scored = scoreBehaviorCandidate({
      actionType: draft.actionType,
      priority: PRIORITY[draft.actionType],
      targetCharacterId: draft.targetCharacterId,
      conversationId: request.conversationId ?? null,
      fingerprint: "",
      goals,
      context,
      request,
      cooldown,
      bucket,
    });
    const finalFingerprint = actionFingerprint({
      universeId: request.universeId,
      characterId: request.characterId,
      actionType: draft.actionType,
      targetCharacterId: draft.targetCharacterId,
      conversationId: request.conversationId ?? null,
      eventId: request.eventId ?? null,
      goalIds: scored.goalIds,
      worldDateBucket: bucket,
      contextFingerprint: context.fingerprint,
      policyVersion: BEHAVIOR_POLICY_CODE,
    });
    const failed = draft.preconditions.filter(
      (code) =>
        !evaluatePrecondition(
          code,
          context,
          request,
          { targetCharacterId: draft.targetCharacterId, fingerprint: finalFingerprint },
          cooldown,
        ),
    );
    return {
      id: `cand:${draft.actionType}:${draft.targetCharacterId ?? "self"}`,
      actionType: draft.actionType,
      priority: PRIORITY[draft.actionType],
      reasonCode: draft.reasonCode,
      requiredContext: draft.requiredContext,
      targetCharacterId: draft.targetCharacterId,
      conversationId: request.conversationId ?? null,
      preconditions: draft.preconditions,
      failedPreconditions: failed,
      consequencesPreview: draft.consequencesPreview,
      metadata: { ...draft.metadata, actionFingerprint: finalFingerprint },
      goalIds: scored.goalIds,
      goalAlignment: scored.goalAlignment,
      score: scored.score,
      scoreBreakdown: scored.breakdown,
    };
  });

  const eligible = candidates
    .filter((candidate) => candidate.failedPreconditions.length === 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.priority !== b.priority) return b.priority - a.priority;
      const orderA = ACTION_ORDER.indexOf(a.actionType);
      const orderB = ACTION_ORDER.indexOf(b.actionType);
      if (orderA !== orderB) return orderA - orderB;
      return a.id.localeCompare(b.id);
    });
  const rejected = candidates
    .filter((candidate) => candidate.failedPreconditions.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
  const selected = eligible[0] ?? candidates[candidates.length - 1]!;

  return { policyCode: BEHAVIOR_POLICY_CODE, candidates, selected, rejected };
}
