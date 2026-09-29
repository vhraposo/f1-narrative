import type { AiDecision } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { ensureUniverse } from "../universe/universe.service.js";
import { createEventWithDerivations } from "../events/event-create.js";
import {
  assembleGenerationBundle,
  type GenerationProvider,
} from "../generation/generation.assembly.js";
import { persistGeneratedMessage } from "../generation/generation-persist.js";
import { OllamaProviderError } from "../generation/ollama-provider.js";
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

export const AI_BEHAVIOR_INSTRUCTION =
  "Continue a conversa de forma coerente com o contexto narrativo. Não invente fatos, resultados ou declarações de terceiros.";

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
  provider: GenerationProvider,
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
      return await executeSendMessage(
        userId,
        character.id,
        universeId,
        decision,
        provider,
      );
    }
    return await executeCreateEvent(userId, universeId, decision);
  } catch (error) {
    const policyCode =
      error instanceof AiBehaviorError
        ? error.code
        : error instanceof OllamaProviderError
          ? error.category === "timeout"
            ? "PROVIDER_TIMEOUT"
            : "PROVIDER_ERROR"
          : "EXECUTION_FAILED";
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
  provider: GenerationProvider,
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

  const result = await assembleGenerationBundle(
    prisma,
    {
      conversationId: target.conversationId,
      userId,
      userPrompt: AI_BEHAVIOR_INSTRUCTION,
      targetCharacterId: characterId,
    },
    provider,
  );

  const persisted = await persistGeneratedMessage(prisma, result, userId);
  if (!persisted.persisted) {
    throw new AiBehaviorError(
      persisted.reason.toUpperCase().replace(/-/g, "_"),
      "Resposta não pôde ser persistida",
      409,
    );
  }

  const updated = await prisma.aiDecision.update({
    where: { id: decision.id },
    data: { status: "EXECUTED", executedMessageId: persisted.message.id },
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
