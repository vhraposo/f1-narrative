import type { AiActionType, AiDecisionStatus, Prisma } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { buildBehaviorContext } from "./behavior.context.js";
import { evaluateBehaviorPolicy } from "./behavior.policy.js";
import type {
  BehaviorCandidate,
  BehaviorDecisionRequest,
  BehaviorDecisionResult,
} from "./behavior.types.js";

const SENSITIVE_KEY_PATTERN = /(authorization|api[-_]?key|token|secret|password|cookie)/i;

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
  };
}

export async function evaluateBehaviorDecision(
  request: BehaviorDecisionRequest,
): Promise<BehaviorDecisionResult> {
  const context = await buildBehaviorContext(request);
  const policy = evaluateBehaviorPolicy(context, request);
  const status: AiDecisionStatus =
    policy.selected.actionType === "NO_ACTION" ? "NO_ACTION" : "DECIDED";

  const metadata = {
    trigger: request.trigger,
    worldDate: request.worldDate.toISOString(),
    userInitiated: request.userInitiated,
    fingerprint: context.fingerprint,
    engine: "deterministic",
    llmUsed: false,
    candidates: policy.candidates.map(candidateSummary),
    selected: candidateSummary(policy.selected),
    rejected: policy.rejected.map(candidateSummary),
    contextOmissions: context.omitted,
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
    candidates: policy.candidates,
    selected: policy.selected,
    rejected: policy.rejected,
    llmUsed: false,
  };
}
