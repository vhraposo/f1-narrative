import type { AiDecision } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { ensureUniverse } from "../universe/universe.service.js";
import { createEventWithDerivations } from "../events/event-create.js";
import { simulateConversationTurn } from "../conversation/conversation.simulation.js";
import { buildBehaviorContext, decideBehavior } from "./ai-behavior.decide.js";
import {
  AiBehaviorError,
  AI_BEHAVIOR_CONTEXT_VERSION,
  assertBehaviorAllowed,
  requireOwnedAiCharacter,
  toDecisionView,
  validateEventParticipants,
  validateMessageTarget,
  type AiDecisionView,
} from "./ai-behavior.policy.js";

const WORLD_KEY = "default";

export const AI_EXECUTING_STALE_MS = 15 * 60_000;

type ExecutableActionType = "SEND_MESSAGE" | "CREATE_EVENT";

export async function evaluateCharacterBehavior(
  userId: string,
  characterId: string,
  trigger = "MANUAL",
): Promise<AiDecisionView> {
  const { character, universeId } = await requireOwnedAiCharacter(
    userId,
    characterId,
  );
  const context = await buildBehaviorContext(prisma, character.id, userId);
  const decision = decideBehavior(context);

  const row = await prisma.aiDecision.create({
    data: {
      universeId,
      characterId: character.id,
      status: decision.actionType === "NO_ACTION" ? "NO_ACTION" : "DECIDED",
      actionType: decision.actionType,
      conversationId: decision.conversationId,
      reason: decision.reason,
      contextVersion: AI_BEHAVIOR_CONTEXT_VERSION,
      metadata: {
        trigger: trigger.slice(0, 40),
        seasonId: decision.metadata.seasonId,
        raceId: decision.metadata.raceId,
        participantIds: decision.metadata.participantIds,
      },
    },
  });

  return toDecisionView(row);
}

export async function recoverStaleExecutions(
  userId: string,
): Promise<{ recovered: number }> {
  const universe = await ensureUniverse(userId);
  const result = await prisma.aiDecision.updateMany({
    where: {
      universeId: universe.id,
      status: "EXECUTING",
      updatedAt: { lt: new Date(Date.now() - AI_EXECUTING_STALE_MS) },
    },
    data: { status: "FAILED", policyCode: "EXECUTION_STALE" },
  });
  return { recovered: result.count };
}

export async function listCharacterDecisions(
  userId: string,
  characterId: string | undefined,
  limit: number,
): Promise<AiDecisionView[]> {
  const universe = await ensureUniverse(userId);
  if (characterId) {
    const owned = await prisma.character.findFirst({
      where: { id: characterId, userId },
      select: { id: true },
    });
    if (!owned) {
      throw new AiBehaviorError(
        "CHARACTER_NOT_FOUND",
        "Personagem não encontrado",
        404,
      );
    }
  }

  const rows = await prisma.aiDecision.findMany({
    where: {
      universeId: universe.id,
      ...(characterId !== undefined ? { characterId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(toDecisionView);
}

export async function executeCharacterDecision(
  userId: string,
  decisionId: string,
): Promise<AiDecisionView> {
  const decision = await prisma.aiDecision.findUnique({
    where: { id: decisionId },
  });
  if (!decision) {
    throw new AiBehaviorError(
      "DECISION_NOT_FOUND",
      "Decisão não encontrada",
      404,
    );
  }

  const { character, universeId } = await requireOwnedAiCharacter(
    userId,
    decision.characterId,
  );
  if (decision.universeId !== universeId) {
    throw new AiBehaviorError(
      "DECISION_NOT_IN_UNIVERSE",
      "Decisão não pertence ao seu Universe",
      403,
    );
  }
  if (decision.status !== "DECIDED") {
    throw new AiBehaviorError(
      "DECISION_NOT_EXECUTABLE",
      "Decisão não está mais pendente",
      409,
    );
  }
  if (decision.actionType === "NO_ACTION") {
    throw new AiBehaviorError(
      "DECISION_NOT_EXECUTABLE",
      "Decisão não possui ação executável",
      409,
    );
  }
  const actionType = decision.actionType as ExecutableActionType;

  const claim = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-behavior:${character.id}`}))`;
    const pending = await tx.aiDecision.findFirst({
      where: { id: decision.id, status: "DECIDED" },
      select: { id: true },
    });
    if (!pending) {
      return {
        ok: false as const,
        code: "DECISION_NOT_EXECUTABLE",
        message: "Decisão não está mais pendente",
        statusCode: 409,
      };
    }
    try {
      await assertBehaviorAllowed(tx, character.id, actionType);
    } catch (error) {
      const policyError =
        error instanceof AiBehaviorError
          ? error
          : new AiBehaviorError("POLICY", "Ação não permitida", 409);
      await tx.aiDecision.update({
        where: { id: decision.id },
        data: { status: "REJECTED", policyCode: policyError.code },
      });
      return {
        ok: false as const,
        code: policyError.code,
        message: policyError.message,
        statusCode: policyError.statusCode,
      };
    }
    const claimed = await tx.aiDecision.updateMany({
      where: { id: decision.id, status: "DECIDED" },
      data: { status: "EXECUTING" },
    });
    if (claimed.count === 0) {
      return {
        ok: false as const,
        code: "DECISION_NOT_EXECUTABLE",
        message: "Decisão não está mais pendente",
        statusCode: 409,
      };
    }
    return { ok: true as const };
  });

  if (!claim.ok) {
    throw new AiBehaviorError(claim.code, claim.message, claim.statusCode);
  }

  try {
    if (actionType === "SEND_MESSAGE") {
      return await executeSendMessage(userId, character.id, universeId, decision);
    }
    return await executeCreateEvent(userId, universeId, decision);
  } catch (error) {
    const policyCode =
      error instanceof AiBehaviorError ? error.code : "EXECUTION_FAILED";
    const failed = await prisma.aiDecision.update({
      where: { id: decision.id },
      data: {
        status: error instanceof AiBehaviorError ? "REJECTED" : "FAILED",
        policyCode,
      },
    });
    return toDecisionView(failed);
  }
}

async function executeSendMessage(
  userId: string,
  characterId: string,
  universeId: string,
  decision: AiDecision,
): Promise<AiDecisionView> {
  if (!decision.conversationId) {
    throw new AiBehaviorError(
      "TARGET_NOT_FOUND",
      "Conversa alvo ausente",
      409,
    );
  }
  const target = await validateMessageTarget(
    prisma,
    universeId,
    decision.conversationId,
    characterId,
    userId,
  );
  const worldState = await prisma.worldState.findUnique({
    where: { universeId_key: { universeId, key: WORLD_KEY } },
    select: { currentDate: true },
  });
  if (!worldState?.currentDate) {
    throw new AiBehaviorError(
      "PRECONDITION_FAILED",
      "WorldState sem currentDate",
      409,
    );
  }

  const simulation = await simulateConversationTurn(target.conversationId, {
    userId,
    worldDate: worldState.currentDate,
    maxDepth: 1,
    opportunity: {
      conversationId: target.conversationId,
      characterId,
      targetCharacterId: null,
      fingerprint: decision.id,
      windowStart: worldState.currentDate.toISOString(),
    },
  });
  const step = simulation.steps[0];
  if (!simulation.executed || !step) {
    throw new AiBehaviorError(
      "EXECUTION_REJECTED",
      simulation.stopReason,
      409,
    );
  }

  const updated = await prisma.aiDecision.update({
    where: { id: decision.id },
    data: { status: "EXECUTED", executedMessageId: step.messageId },
  });
  return toDecisionView(updated);
}

async function executeCreateEvent(
  userId: string,
  universeId: string,
  decision: AiDecision,
): Promise<AiDecisionView> {
  const metadata =
    decision.metadata !== null &&
    typeof decision.metadata === "object" &&
    !Array.isArray(decision.metadata)
      ? (decision.metadata as Record<string, unknown>)
      : {};
  const raceId = typeof metadata.raceId === "string" ? metadata.raceId : null;
  const seasonId =
    typeof metadata.seasonId === "string" ? metadata.seasonId : null;
  const participantIds = Array.isArray(metadata.participantIds)
    ? metadata.participantIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];

  if (!raceId) {
    throw new AiBehaviorError(
      "TARGET_NOT_FOUND",
      "Contexto de corrida ausente",
      409,
    );
  }
  const race = await prisma.race.findUnique({
    where: { id: raceId },
    select: {
      id: true,
      name: true,
      seasonId: true,
      season: { select: { universeId: true } },
    },
  });
  if (!race || race.season.universeId !== universeId) {
    throw new AiBehaviorError(
      "TARGET_NOT_IN_UNIVERSE",
      "Corrida alvo não pertence ao seu Universe",
      403,
    );
  }
  if (seasonId && race.seasonId !== seasonId) {
    throw new AiBehaviorError(
      "TARGET_NOT_IN_UNIVERSE",
      "Temporada alvo inconsistente para a corrida",
      403,
    );
  }

  const participants = await validateEventParticipants(
    prisma,
    universeId,
    participantIds,
    userId,
  );
  const character = await prisma.character.findUniqueOrThrow({
    where: { id: decision.characterId },
    select: { name: true },
  });
  const world = await prisma.worldState.findUnique({
    where: { universeId_key: { universeId, key: WORLD_KEY } },
    select: { currentDate: true },
  });

  const created = await prisma.$transaction((tx) =>
    createEventWithDerivations(
      tx,
      {
        type: "SOCIAL",
        importance: "MEDIUM",
        source: "GENERATED_EVENT",
        title: `${character.name} comenta ${race.name}`,
        description: null,
        worldDate: world?.currentDate ?? new Date(),
        payload: {
          origin: "ai_behavior",
          universeId,
          seasonId: race.seasonId,
          raceId: race.id,
          characterId: decision.characterId,
          decisionId: decision.id,
        },
      },
      participants,
    ),
  );

  const updated = await prisma.aiDecision.update({
    where: { id: decision.id },
    data: { status: "EXECUTED", executedEventId: created.id },
  });
  return toDecisionView(updated);
}
