import type {
  AiDecisionStatus,
  CharacterController,
  CharacterGoalKind,
  CharacterGoalSource,
  CharacterGoalStatus,
  MemoryImportance,
  PilotExperienceType,
  RaceSession,
} from "@prisma/client";

export const BEHAVIOR_CONTEXT_VERSION_PREFIX = "behavior-context.v1";
export const BEHAVIOR_POLICY_CODE = "behavior-policy.v1";

export type BehaviorTrigger =
  | "MESSAGE_RECEIVED"
  | "EVENT_CREATED"
  | "RACE_SESSION_COMPLETED"
  | "RACE_FINISHED"
  | "RELATIONSHIP_CHANGED"
  | "MEMORY_CREATED"
  | "SCHEDULE_DUE"
  | "WORLD_ADVANCED"
  | "USER_REQUESTED"
  | "AUTONOMOUS_TICK";

export type BehaviorActionType =
  | "NO_ACTION"
  | "RESPOND"
  | "SEND_MESSAGE"
  | "CREATE_EVENT"
  | "CREATE_MEMORY"
  | "UPDATE_RELATIONSHIP";

export type BehaviorContextSection =
  | "IDENTITY"
  | "PERSONALITY"
  | "CURRENT_STATE"
  | "GOALS"
  | "MEMORY"
  | "EXPERIENCE"
  | "RELATIONSHIPS"
  | "WORLD"
  | "MOTORSPORT"
  | "CONVERSATION"
  | "AVAILABILITY"
  | "SCHEDULE"
  | "NEWS";

export type BehaviorContextOmission = {
  readonly section: BehaviorContextSection;
  readonly reason: string;
};

export type BehaviorDecisionRequest = {
  readonly universeId: string;
  readonly characterId: string;
  readonly trigger: BehaviorTrigger;
  readonly worldDate: Date;
  readonly conversationId?: string | null;
  readonly eventId?: string | null;
  readonly raceId?: string | null;
  readonly session?: RaceSession | null;
  readonly userInitiated: boolean;
  readonly metadata?: Record<string, unknown>;
};

export type BehaviorIdentitySection = {
  readonly name: string;
  readonly nationality: string;
  readonly controller: CharacterController;
  readonly biography: string | null;
};

export type BehaviorPersonalitySection = {
  readonly traits: ReadonlyArray<{
    readonly key: string;
    readonly value: string;
    readonly confidence: number;
  }>;
};

export type BehaviorCurrentStateSection = {
  readonly trigger: BehaviorTrigger;
  readonly userInitiated: boolean;
  readonly event: {
    readonly id: string;
    readonly type: string;
    readonly importance: string;
    readonly title: string;
    readonly participantIds: readonly string[];
  } | null;
  readonly race: {
    readonly id: string;
    readonly name: string;
    readonly round: number | null;
    readonly status: string;
    readonly date: Date | null;
  } | null;
  readonly session: RaceSession | null;
};

export type BehaviorMemorySection = {
  readonly recent: ReadonlyArray<{
    readonly id: string;
    readonly summary: string | null;
    readonly content: string;
    readonly importance: MemoryImportance;
    readonly memoryType: PilotExperienceType | null;
    readonly createdAt: Date;
  }>;
};

export type BehaviorExperienceSection = {
  readonly recent: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly experienceType: PilotExperienceType;
    readonly salience: MemoryImportance;
    readonly occurredAt: Date | null;
  }>;
};

export type BehaviorRelationshipSection = {
  readonly entries: ReadonlyArray<{
    readonly id: string;
    readonly otherCharacterId: string;
    readonly otherName: string;
    readonly otherController: CharacterController;
    readonly dimensions: Record<string, number>;
  }>;
};

export type BehaviorWorldSection = {
  readonly currentDate: Date | null;
  readonly currentSeasonId: string | null;
  readonly currentRaceId: string | null;
  readonly currentSession: RaceSession | null;
};

export type BehaviorMotorsportSection = {
  readonly teamName: string | null;
  readonly number: number | null;
  readonly standing: {
    readonly seasonId: string;
    readonly position: number | null;
    readonly points: number;
    readonly wins: number;
    readonly podiums: number;
  } | null;
  readonly teammate: {
    readonly characterId: string;
    readonly name: string;
    readonly position: number | null;
    readonly points: number;
  } | null;
  readonly recentResults: ReadonlyArray<{
    readonly raceName: string;
    readonly round: number | null;
    readonly date: Date | null;
    readonly position: number | null;
    readonly points: number;
    readonly fastestLap: boolean;
    readonly status: string | null;
  }>;
};

export type BehaviorConversationSection = {
  readonly id: string;
  readonly type: string;
  readonly participantIds: readonly string[];
  readonly isParticipant: boolean;
  readonly recentMessages: ReadonlyArray<{
    readonly senderType: string;
    readonly characterId: string | null;
    readonly content: string;
    readonly createdAt: Date;
  }>;
};

export type BehaviorAvailabilitySection = {
  readonly status: string;
  readonly reason: string | null;
  readonly until: Date | null;
};

export type BehaviorScheduleSection = {
  readonly due: ReadonlyArray<{
    readonly id: string;
    readonly activity: string;
    readonly startsAt: Date;
    readonly endsAt: Date | null;
  }>;
  readonly upcoming: ReadonlyArray<{
    readonly id: string;
    readonly activity: string;
    readonly startsAt: Date;
    readonly endsAt: Date | null;
  }>;
};

export type BehaviorNewsSection = {
  readonly recent: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly worldDate: Date | null;
  }>;
};

export type BehaviorContextView = {
  readonly version: string;
  readonly fingerprint: string;
  readonly assembledAt: Date;
  readonly worldDate: Date;
  readonly universeId: string;
  readonly characterId: string;
  readonly identity: BehaviorIdentitySection;
  readonly personality: BehaviorPersonalitySection;
  readonly currentState: BehaviorCurrentStateSection;
  readonly goals: readonly unknown[];
  readonly memory: BehaviorMemorySection;
  readonly experience: BehaviorExperienceSection;
  readonly relationships: BehaviorRelationshipSection;
  readonly world: BehaviorWorldSection;
  readonly motorsport: BehaviorMotorsportSection;
  readonly conversation: BehaviorConversationSection | null;
  readonly availability: BehaviorAvailabilitySection | null;
  readonly schedule: BehaviorScheduleSection;
  readonly news: BehaviorNewsSection;
  readonly omitted: readonly BehaviorContextOmission[];
};

export type BehaviorScoreBreakdown = {
  readonly total: number;
  readonly goalAlignment: number;
  readonly triggerRelevance: number;
  readonly contextRelevance: number;
  readonly relationshipRelevance: number;
  readonly experienceRelevance: number;
  readonly availabilityBonus: number;
  readonly cooldownPenalty: number;
  readonly duplicatePenalty: number;
  readonly policyBonus: number;
};

export type BehaviorCandidate = {
  readonly id: string;
  readonly actionType: BehaviorActionType;
  readonly priority: number;
  readonly reasonCode: string;
  readonly requiredContext: readonly BehaviorContextSection[];
  readonly targetCharacterId: string | null;
  readonly conversationId: string | null;
  readonly preconditions: readonly string[];
  readonly failedPreconditions: readonly string[];
  readonly consequencesPreview: readonly string[];
  readonly metadata: Record<string, unknown>;
  readonly goalIds: readonly string[];
  readonly goalAlignment: number;
  readonly score: number;
  readonly scoreBreakdown: BehaviorScoreBreakdown;
};

export type ResolvedGoal = {
  readonly id: string;
  readonly kind: CharacterGoalKind;
  readonly priority: number;
  readonly status: CharacterGoalStatus;
  readonly source: CharacterGoalSource;
  readonly ruleCode: string | null;
  readonly fingerprint: string | null;
  readonly targetCharacterId: string | null;
  readonly targetRaceId: string | null;
  readonly seasonId: string | null;
  readonly validTo: Date | null;
};

export type BehaviorCooldownState = {
  readonly keys: ReadonlySet<string>;
  readonly fingerprints: ReadonlySet<string>;
};

export const EMPTY_COOLDOWN_STATE: BehaviorCooldownState = {
  keys: new Set<string>(),
  fingerprints: new Set<string>(),
};

export type BehaviorExecutionStatus = "EXECUTED" | "REJECTED" | "FAILED" | "ALREADY_EXECUTED";

export type BehaviorExecutionResult = {
  readonly decisionId: string;
  readonly status: BehaviorExecutionStatus;
  readonly actionType: BehaviorActionType;
  readonly reasonCode: string | null;
  readonly errorCode: string | null;
  readonly executedMessageId: string | null;
  readonly executedEventId: string | null;
  readonly latencyMs: number | null;
};

export type BehaviorPolicyResult = {
  readonly policyCode: string;
  readonly candidates: readonly BehaviorCandidate[];
  readonly selected: BehaviorCandidate;
  readonly rejected: readonly BehaviorCandidate[];
};

export type BehaviorDecisionResult = {
  readonly decisionId: string;
  readonly status: AiDecisionStatus;
  readonly actionType: BehaviorActionType;
  readonly reasonCode: string;
  readonly contextVersion: string;
  readonly contextFingerprint: string;
  readonly policyCode: string;
  readonly trigger: BehaviorTrigger;
  readonly goals: readonly ResolvedGoal[];
  readonly actionFingerprint: string;
  readonly worldDateBucket: string;
  readonly candidates: readonly BehaviorCandidate[];
  readonly selected: BehaviorCandidate;
  readonly rejected: readonly BehaviorCandidate[];
  readonly llmUsed: false;
};

export class BehaviorError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "BehaviorError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function isBehaviorActionType(value: string): value is BehaviorActionType {
  return (
    value === "NO_ACTION" ||
    value === "RESPOND" ||
    value === "SEND_MESSAGE" ||
    value === "CREATE_EVENT" ||
    value === "CREATE_MEMORY" ||
    value === "UPDATE_RELATIONSHIP"
  );
}
