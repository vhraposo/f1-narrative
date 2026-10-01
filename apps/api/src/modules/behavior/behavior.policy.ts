import {
  BEHAVIOR_POLICY_CODE,
  type BehaviorActionType,
  type BehaviorCandidate,
  type BehaviorContextView,
  type BehaviorDecisionRequest,
  type BehaviorPolicyResult,
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

function evaluatePrecondition(
  code: string,
  context: BehaviorContextView,
  request: BehaviorDecisionRequest,
): boolean {
  switch (code) {
    case "CONTROLLER_IS_AI":
      return !isAutonomous(request) || context.identity.controller === "AI";
    case "CHARACTER_IS_PARTICIPANT":
      return context.conversation?.isParticipant === true;
    case "AVAILABILITY_OPEN":
      return isAvailabilityOpen(context);
    case "RELATIONSHIP_TARGET_PRESENT":
      return hasRelationshipWith(context, resolveTargetCharacterId(request));
    case "SIGNIFICANT_EXPERIENCE_PRESENT":
      return hasSignificantExperience(context);
    case "ACTIVE_SEASON_PRESENT":
      return context.world.currentSeasonId !== null;
    default:
      return false;
  }
}

function makeCandidate(input: {
  actionType: BehaviorActionType;
  reasonCode: string;
  requiredContext: BehaviorCandidate["requiredContext"];
  preconditions: readonly string[];
  context: BehaviorContextView;
  request: BehaviorDecisionRequest;
  targetCharacterId?: string | null;
  consequencesPreview?: readonly string[];
  metadata?: Record<string, unknown>;
}): BehaviorCandidate {
  const failed = input.preconditions.filter(
    (code) => !evaluatePrecondition(code, input.context, input.request),
  );
  const targetCharacterId = input.targetCharacterId ?? null;
  return {
    id: `cand:${input.actionType}:${targetCharacterId ?? "self"}`,
    actionType: input.actionType,
    priority: PRIORITY[input.actionType],
    reasonCode: input.reasonCode,
    requiredContext: input.requiredContext,
    targetCharacterId,
    conversationId: input.request.conversationId ?? null,
    preconditions: input.preconditions,
    failedPreconditions: failed,
    consequencesPreview: input.consequencesPreview ?? [],
    metadata: input.metadata ?? {},
  };
}

export function evaluateBehaviorPolicy(
  context: BehaviorContextView,
  request: BehaviorDecisionRequest,
): BehaviorPolicyResult {
  const targetCharacterId = resolveTargetCharacterId(request);
  const candidates: BehaviorCandidate[] = [];

  if (request.trigger === "MESSAGE_RECEIVED" && request.conversationId) {
    candidates.push(
      makeCandidate({
        actionType: "RESPOND",
        reasonCode: "POLICY_RESPOND_TO_DIRECT_MESSAGE",
        requiredContext: ["CONVERSATION", "PERSONALITY", "MEMORY"],
        preconditions: ["CONTROLLER_IS_AI", "CHARACTER_IS_PARTICIPANT", "AVAILABILITY_OPEN"],
        context,
        request,
        targetCharacterId,
        consequencesPreview: ["MESSAGE_SENT", "RELATIONSHIP_POSSIBLE_DELTA"],
      }),
    );
  }

  if (
    request.trigger === "EVENT_CREATED" ||
    request.trigger === "RACE_FINISHED" ||
    request.trigger === "RACE_SESSION_COMPLETED" ||
    request.trigger === "RELATIONSHIP_CHANGED" ||
    request.trigger === "WORLD_ADVANCED"
  ) {
    candidates.push(
      makeCandidate({
        actionType: "SEND_MESSAGE",
        reasonCode: "POLICY_REACT_TO_WORLD_CHANGE",
        requiredContext: ["CURRENT_STATE", "RELATIONSHIPS", "MEMORY"],
        preconditions: ["CONTROLLER_IS_AI", "RELATIONSHIP_TARGET_PRESENT", "AVAILABILITY_OPEN"],
        context,
        request,
        targetCharacterId,
        consequencesPreview: ["MESSAGE_SENT"],
      }),
    );
  }

  if (
    request.trigger === "RACE_FINISHED" ||
    request.trigger === "EVENT_CREATED" ||
    request.trigger === "MEMORY_CREATED"
  ) {
    candidates.push(
      makeCandidate({
        actionType: "CREATE_MEMORY",
        reasonCode: "POLICY_CONSOLIDATE_SIGNIFICANT_EXPERIENCE",
        requiredContext: ["EXPERIENCE", "CURRENT_STATE"],
        preconditions: ["CONTROLLER_IS_AI", "SIGNIFICANT_EXPERIENCE_PRESENT"],
        context,
        request,
        consequencesPreview: ["MEMORY_CANDIDATE_CREATED"],
      }),
    );
  }

  if (
    request.trigger === "RELATIONSHIP_CHANGED" ||
    request.trigger === "EVENT_CREATED" ||
    request.trigger === "RACE_FINISHED"
  ) {
    candidates.push(
      makeCandidate({
        actionType: "UPDATE_RELATIONSHIP",
        reasonCode: "POLICY_APPLY_SOCIAL_CONSEQUENCE",
        requiredContext: ["RELATIONSHIPS", "CURRENT_STATE"],
        preconditions: ["CONTROLLER_IS_AI", "RELATIONSHIP_TARGET_PRESENT"],
        context,
        request,
        targetCharacterId,
        consequencesPreview: ["RELATIONSHIP_DELTA_APPLIED"],
      }),
    );
  }

  if (
    request.trigger === "WORLD_ADVANCED" ||
    request.trigger === "SCHEDULE_DUE" ||
    request.trigger === "AUTONOMOUS_TICK"
  ) {
    candidates.push(
      makeCandidate({
        actionType: "CREATE_EVENT",
        reasonCode: "POLICY_EMIT_SCHEDULED_EVENT",
        requiredContext: ["SCHEDULE", "WORLD"],
        preconditions: ["CONTROLLER_IS_AI", "ACTIVE_SEASON_PRESENT"],
        context,
        request,
        consequencesPreview: ["EVENT_CREATED"],
      }),
    );
  }

  candidates.push(
    makeCandidate({
      actionType: "NO_ACTION",
      reasonCode: "POLICY_NO_ACTION_BASELINE",
      requiredContext: [],
      preconditions: [],
      context,
      request,
    }),
  );

  const eligible = candidates
    .filter((candidate) => candidate.failedPreconditions.length === 0)
    .sort((a, b) => {
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
