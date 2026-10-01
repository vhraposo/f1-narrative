import type { AiActionType, AiDecisionStatus, Prisma } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { buildBehaviorContext } from "./behavior.context.js";
import { reconcileCharacterGoals } from "./behavior.goals.js";
import { evaluateBehaviorPolicy } from "./behavior.policy.js";
import { worldDateBucket } from "./behavior.scoring.js";
import type {
  BehaviorCandidate,
  BehaviorCooldownState,
  BehaviorDecisionRequest,
  BehaviorDecisionResult,
} from "./behavior.types.js";

const SENSITIVE_KEY_PATTERN = /(authorization|api[-_]?key|token|secret|password|cookie)/i;
const COOLDOWN_LOOKBACK = 200;

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitizeValue(entry, depth + 1);
    }
    return output;
  }
  if (typeof value === "string") return value.slice(0, 2000);
  return value;
}

function candidateSummary(candidate: BehaviorCandidate) {
  return {
    id: candidate.id,
    actionType: candidate.actionType,
    priority: candidate.priority,
    reasonCode: candidate.reasonCode,
    requiredContext: candidate.requiredContext,
    targetCharacterId: candidate.targetCharacterId,
    conversationId: candidate.conversationId,
    preconditions: candidate.preconditions,
    failedPreconditions: candidate.failedPreconditions,
    consequencesPreview: candidate.consequencesPreview,
    goalIds: candidate.goalIds,
    goalAlignment: candidate.goalAlignment,
    score: candidate.score,
    scoreBreakdown: candidate.scoreBreakdown,
    actionFingerprint: candidate.metadata.actionFingerprint ?? null,
  };
}

async function loadCooldownState(
  characterId: string,
  bucket: string,
): Promise<BehaviorCooldownState> {
  const executed = await prisma.aiDecision.findMany({
    where: { characterId, status: "EXECUTED" },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: COOLDOWN_LOOKBACK,
    select: { actionType: true, metadata: true },
  });
  const keys = new Set<string>();
  const fingerprints = new Set<string>();
  for (const decision of executed) {
    const metadata = (decision.metadata ?? {}) as Record<string, unknown>;
    const fingerprint =
      typeof metadata.actionFingerprint === "string" ? metadata.actionFingerprint : null;
    if (fingerprint) fingerprints.add(fingerprint);
    const executedBucket =
      typeof metadata.worldDateBucket === "string" ? metadata.worldDateBucket : null;
    if (executedBucket !== bucket) continue;
    const target =
      typeof metadata.targetCharacterId === "string" ? metadata.targetCharacterId : "self";
    keys.add(`${decision.actionType}:${target}:${bucket}`);
  }
  return { keys, fingerprints };
}

export async function evaluateBehaviorDecision(
  request: BehaviorDecisionRequest,
): Promise<BehaviorDecisionResult> {
  const context = await buildBehaviorContext(request);
  const bucket = worldDateBucket(request.worldDate);
  const [goalReport, cooldown] = await Promise.all([
    reconcileCharacterGoals(context, request),
    loadCooldownState(request.characterId, bucket),
  ]);
  const policy = evaluateBehaviorPolicy(context, request, {
    goals: goalReport.goals,
    cooldown,
  });
  const status: AiDecisionStatus =
    policy.selected.actionType === "NO_ACTION" ? "NO_ACTION" : "DECIDED";
  const selectedFingerprint =
    typeof policy.selected.metadata.actionFingerprint === "string"
      ? policy.selected.metadata.actionFingerprint
      : null;

  const metadata = {
    trigger: request.trigger,
    worldDate: request.worldDate.toISOString(),
    worldDateBucket: bucket,
    userInitiated: request.userInitiated,
    targetCharacterId:
      typeof request.metadata?.targetCharacterId === "string"
        ? request.metadata.targetCharacterId
        : null,
    fingerprint: context.fingerprint,
    actionFingerprint: selectedFingerprint,
    engine: "deterministic",
    llmUsed: false,
    scoringVersion: "behavior-scoring.v1",
    goals: goalReport.goals.map((goal) => ({
      id: goal.id,
      kind: goal.kind,
      priority: goal.priority,
      source: goal.source,
      ruleCode: goal.ruleCode,
      status: goal.status,
      targetCharacterId: goal.targetCharacterId,
    })),
    goalReconcile: {
      created: goalReport.created,
      reactivated: goalReport.reactivated,
      completed: goalReport.completed,
      failed: goalReport.failed,
      expired: goalReport.expired,
      manualConflicts: goalReport.manualConflicts,
    },
    candidates: policy.candidates.map(candidateSummary),
    selected: candidateSummary(policy.selected),
    rejected: policy.rejected.map(candidateSummary),
    contextOmissions: context.omitted,
    requestPayload: {
      universeId: request.universeId,
      characterId: request.characterId,
      trigger: request.trigger,
      worldDate: request.worldDate.toISOString(),
      conversationId: request.conversationId ?? null,
      eventId: request.eventId ?? null,
      raceId: request.raceId ?? null,
      session: request.session ?? null,
      userInitiated: request.userInitiated,
      targetCharacterId:
        typeof request.metadata?.targetCharacterId === "string"
          ? request.metadata.targetCharacterId
          : null,
    },
    ...(request.metadata ? { requestMetadata: sanitizeValue(request.metadata) } : {}),
  } as Prisma.InputJsonValue;

  const decision = await prisma.aiDecision.create({
    data: {
      universeId: request.universeId,
      characterId: request.characterId,
      status,
      actionType: policy.selected.actionType as AiActionType,
      conversationId: request.conversationId ?? null,
      reason: policy.selected.reasonCode,
      contextVersion: context.version,
      policyCode: policy.policyCode,
      metadata,
    },
    select: { id: true },
  });

  return {
    decisionId: decision.id,
    status,
    actionType: policy.selected.actionType,
    reasonCode: policy.selected.reasonCode,
    contextVersion: context.version,
    contextFingerprint: context.fingerprint,
    policyCode: policy.policyCode,
    trigger: request.trigger,
    goals: goalReport.goals,
    actionFingerprint: selectedFingerprint ?? "",
    worldDateBucket: bucket,
    candidates: policy.candidates,
    selected: policy.selected,
    rejected: policy.rejected,
    llmUsed: false,
  };
}
