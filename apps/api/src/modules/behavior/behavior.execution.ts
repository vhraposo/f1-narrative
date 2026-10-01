import type { Prisma } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { commandForAction } from "./behavior.commands.js";
import { buildBehaviorContext } from "./behavior.context.js";
import {
  BehaviorError,
  isBehaviorActionType,
  type BehaviorActionType,
  type BehaviorCandidate,
  type BehaviorDecisionRequest,
  type BehaviorExecutionResult,
  type BehaviorTrigger,
} from "./behavior.types.js";

type StoredPayload = {
  readonly universeId: string;
  readonly characterId: string;
  readonly trigger: BehaviorTrigger;
  readonly worldDate: string;
  readonly conversationId: string | null;
  readonly eventId: string | null;
  readonly raceId: string | null;
  readonly session: string | null;
  readonly userInitiated: boolean;
  readonly targetCharacterId: string | null;
};

function parsePayload(metadata: Record<string, unknown>): StoredPayload | null {
  const payload = metadata.requestPayload;
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.universeId !== "string" || typeof record.characterId !== "string") {
    return null;
  }
  if (typeof record.trigger !== "string" || typeof record.worldDate !== "string") return null;
  return {
    universeId: record.universeId,
    characterId: record.characterId,
    trigger: record.trigger as BehaviorTrigger,
    worldDate: record.worldDate,
    conversationId: typeof record.conversationId === "string" ? record.conversationId : null,
    eventId: typeof record.eventId === "string" ? record.eventId : null,
    raceId: typeof record.raceId === "string" ? record.raceId : null,
    session: typeof record.session === "string" ? record.session : null,
    userInitiated: record.userInitiated === true,
    targetCharacterId:
      typeof record.targetCharacterId === "string" ? record.targetCharacterId : null,
  };
}

function requestFromPayload(payload: StoredPayload): BehaviorDecisionRequest {
  return {
    universeId: payload.universeId,
    characterId: payload.characterId,
    trigger: payload.trigger,
    worldDate: new Date(payload.worldDate),
    conversationId: payload.conversationId,
    eventId: payload.eventId,
    raceId: payload.raceId,
    session: payload.session as BehaviorDecisionRequest["session"],
    userInitiated: payload.userInitiated,
    ...(payload.targetCharacterId
      ? { metadata: { targetCharacterId: payload.targetCharacterId } }
      : {}),
  };
}

function candidateFromSummary(
  metadata: Record<string, unknown>,
  fallback: { actionType: BehaviorActionType; reasonCode: string | null },
): BehaviorCandidate {
  const selected =
    metadata.selected && typeof metadata.selected === "object"
      ? (metadata.selected as Record<string, unknown>)
      : {};
  const actionType =
    typeof selected.actionType === "string" && isBehaviorActionType(selected.actionType)
      ? selected.actionType
      : fallback.actionType;
  return {
    id: typeof selected.id === "string" ? selected.id : `cand:${actionType}:self`,
    actionType,
    priority: typeof selected.priority === "number" ? selected.priority : 0,
    reasonCode:
      typeof selected.reasonCode === "string"
        ? selected.reasonCode
        : (fallback.reasonCode ?? "POLICY_NO_ACTION_BASELINE"),
    requiredContext: [],
    targetCharacterId:
      typeof selected.targetCharacterId === "string" ? selected.targetCharacterId : null,
    conversationId: typeof selected.conversationId === "string" ? selected.conversationId : null,
    preconditions: [],
    failedPreconditions: [],
    consequencesPreview: [],
    metadata: {
      actionFingerprint:
        typeof metadata.actionFingerprint === "string" ? metadata.actionFingerprint : null,
    },
    goalIds: Array.isArray(selected.goalIds)
      ? (selected.goalIds as string[]).filter((goalId) => typeof goalId === "string")
      : [],
    goalAlignment: typeof selected.goalAlignment === "number" ? selected.goalAlignment : 0,
    score: typeof selected.score === "number" ? selected.score : 0,
    scoreBreakdown: {
      total: 0,
      goalAlignment: 0,
      triggerRelevance: 0,
      contextRelevance: 0,
      relationshipRelevance: 0,
      experienceRelevance: 0,
      availabilityBonus: 0,
      cooldownPenalty: 0,
      duplicatePenalty: 0,
      policyBonus: 0,
    },
  };
}

export async function executeBehaviorDecision(
  decisionId: string,
): Promise<BehaviorExecutionResult> {
  const decision = await prisma.aiDecision.findUnique({
    where: { id: decisionId },
    select: {
      id: true,
      universeId: true,
      characterId: true,
      status: true,
      actionType: true,
      reason: true,
      metadata: true,
    },
  });
  if (!decision) {
    throw new BehaviorError("GOAL_NOT_FOUND", "Decisão não encontrada", 404);
  }

  const metadata = (decision.metadata ?? {}) as Record<string, unknown>;
  const actionType = decision.actionType as BehaviorActionType;

  if (decision.status === "EXECUTED") {
    return {
      decisionId: decision.id,
      status: "ALREADY_EXECUTED",
      actionType,
      reasonCode: decision.reason,
      errorCode: null,
      executedMessageId:
        typeof metadata.executedMessageId === "string" ? metadata.executedMessageId : null,
      executedEventId:
        typeof metadata.executedEventId === "string" ? metadata.executedEventId : null,
      latencyMs: null,
    };
  }

  if (decision.status !== "DECIDED") {
    return {
      decisionId: decision.id,
      status: "REJECTED",
      actionType,
      reasonCode: decision.reason,
      errorCode: "DECISION_NOT_EXECUTABLE",
      executedMessageId: null,
      executedEventId: null,
      latencyMs: null,
    };
  }

  const payload = parsePayload(metadata);
  if (!payload) {
    await prisma.aiDecision.update({
      where: { id: decision.id },
      data: { status: "REJECTED", reason: "STALE_CONTEXT" },
    });
    return {
      decisionId: decision.id,
      status: "REJECTED",
      actionType,
      reasonCode: "STALE_CONTEXT",
      errorCode: "STALE_CONTEXT",
      executedMessageId: null,
      executedEventId: null,
      latencyMs: null,
    };
  }

  const request = requestFromPayload(payload);
  const context = await buildBehaviorContext(request);
  const storedFingerprint =
    typeof metadata.fingerprint === "string" ? metadata.fingerprint : null;
  if (!storedFingerprint || storedFingerprint !== context.fingerprint) {
    await prisma.aiDecision.update({
      where: { id: decision.id },
      data: { status: "REJECTED", reason: "STALE_CONTEXT" },
    });
    return {
      decisionId: decision.id,
      status: "REJECTED",
      actionType,
      reasonCode: "STALE_CONTEXT",
      errorCode: "STALE_CONTEXT",
      executedMessageId: null,
      executedEventId: null,
      latencyMs: null,
    };
  }

  const candidate = candidateFromSummary(metadata, {
    actionType,
    reasonCode: decision.reason,
  });
  const handler = commandForAction(candidate.actionType);
  if (!handler) {
    await prisma.aiDecision.update({
      where: { id: decision.id },
      data: { status: "REJECTED", reason: "COMMAND_NOT_ALLOWED" },
    });
    return {
      decisionId: decision.id,
      status: "REJECTED",
      actionType,
      reasonCode: "COMMAND_NOT_ALLOWED",
      errorCode: "COMMAND_NOT_ALLOWED",
      executedMessageId: null,
      executedEventId: null,
      latencyMs: null,
    };
  }

  const startedAt = Date.now();
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        `behavior-exec:${decision.characterId}`,
      );
      const current = await tx.aiDecision.findUnique({
        where: { id: decision.id },
        select: { status: true, metadata: true },
      });
      if (!current || current.status !== "DECIDED") {
        return { kind: "already" as const };
      }
      const fingerprint =
        typeof metadata.actionFingerprint === "string" ? metadata.actionFingerprint : null;
      if (fingerprint) {
        const duplicate = await tx.aiDecision.findFirst({
          where: {
            characterId: decision.characterId,
            status: "EXECUTED",
            id: { not: decision.id },
            metadata: { path: ["actionFingerprint"], equals: fingerprint },
          },
          select: { id: true, metadata: true },
        });
        if (duplicate) {
          const duplicateMetadata = (duplicate.metadata ?? {}) as Record<string, unknown>;
          await tx.aiDecision.update({
            where: { id: decision.id },
            data: { status: "REJECTED", reason: "ACTION_DUPLICATE" },
          });
          return {
            kind: "duplicate" as const,
            executedMessageId:
              typeof duplicateMetadata.executedMessageId === "string"
                ? duplicateMetadata.executedMessageId
                : null,
            executedEventId:
              typeof duplicateMetadata.executedEventId === "string"
                ? duplicateMetadata.executedEventId
                : null,
          };
        }
      }

      await tx.aiDecision.update({
        where: { id: decision.id },
        data: { status: "EXECUTING" },
      });
      const result = await handler({
        tx,
        request,
        context,
        candidate,
        worldDate: request.worldDate,
      });
      const execution = {
        command: candidate.actionType,
        actionFingerprint: fingerprint,
        executedAt: request.worldDate.toISOString(),
        latencyMs: Date.now() - startedAt,
      };
      const mergedMetadata = {
        ...metadata,
        executedMessageId: result.messageId ?? null,
        executedEventId: result.eventId ?? null,
        execution,
      } as Prisma.InputJsonValue;
      await tx.aiDecision.update({
        where: { id: decision.id },
        data: {
          status: "EXECUTED",
          executedMessageId: result.messageId ?? null,
          executedEventId: result.eventId ?? null,
          metadata: mergedMetadata,
        },
      });
      return {
        kind: "executed" as const,
        messageId: result.messageId ?? null,
        eventId: result.eventId ?? null,
        latencyMs: execution.latencyMs,
      };
    });

    if (outcome.kind === "already") {
      const reloaded = await prisma.aiDecision.findUniqueOrThrow({
        where: { id: decision.id },
        select: { status: true, metadata: true },
      });
      const reloadedMetadata = (reloaded.metadata ?? {}) as Record<string, unknown>;
      return {
        decisionId: decision.id,
        status: reloaded.status === "EXECUTED" ? "ALREADY_EXECUTED" : "REJECTED",
        actionType,
        reasonCode: reloaded.status === "EXECUTED" ? decision.reason : "DECISION_NOT_EXECUTABLE",
        errorCode: reloaded.status === "EXECUTED" ? null : "DECISION_NOT_EXECUTABLE",
        executedMessageId:
          typeof reloadedMetadata.executedMessageId === "string"
            ? reloadedMetadata.executedMessageId
            : null,
        executedEventId:
          typeof reloadedMetadata.executedEventId === "string"
            ? reloadedMetadata.executedEventId
            : null,
        latencyMs: null,
      };
    }

    if (outcome.kind === "duplicate") {
      return {
        decisionId: decision.id,
        status: "REJECTED",
        actionType,
        reasonCode: "ACTION_DUPLICATE",
        errorCode: "ACTION_DUPLICATE",
        executedMessageId: outcome.executedMessageId,
        executedEventId: outcome.executedEventId,
        latencyMs: null,
      };
    }

    return {
      decisionId: decision.id,
      status: "EXECUTED",
      actionType,
      reasonCode: decision.reason,
      errorCode: null,
      executedMessageId: outcome.messageId,
      executedEventId: outcome.eventId,
      latencyMs: outcome.latencyMs,
    };
  } catch (error) {
    const errorCode =
      error instanceof BehaviorError ? error.code : "EXECUTION_FAILED";
    await prisma.aiDecision.update({
      where: { id: decision.id },
      data: {
        status: error instanceof BehaviorError ? "REJECTED" : "FAILED",
        reason: errorCode,
        metadata: {
          ...metadata,
          execution: {
            command: candidate.actionType,
            errorCode,
            message: error instanceof Error ? error.message.slice(0, 300) : null,
            latencyMs: Date.now() - startedAt,
          },
        } as Prisma.InputJsonValue,
      },
    });
    return {
      decisionId: decision.id,
      status: error instanceof BehaviorError ? "REJECTED" : "FAILED",
      actionType,
      reasonCode: errorCode,
      errorCode,
      executedMessageId: null,
      executedEventId: null,
      latencyMs: Date.now() - startedAt,
    };
  }
}
