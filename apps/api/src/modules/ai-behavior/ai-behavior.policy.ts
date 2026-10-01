import type { AiActionType, AiDecision, AiDecisionStatus, PrismaClient } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { ensureUniverse } from "../universe/universe.service.js";

export class AiBehaviorError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "AiBehaviorError";
  }
}

export const AI_BEHAVIOR_CONTEXT_VERSION = "ai-behavior.v1";

export const AI_COOLDOWN_MS: Record<"SEND_MESSAGE" | "CREATE_EVENT", number> = {
  SEND_MESSAGE: 5 * 60_000,
  CREATE_EVENT: 30 * 60_000,
};

export const AI_MAX_ACTIONS_PER_HOUR = 5;

type BehaviorActionType = Extract<AiActionType, "SEND_MESSAGE" | "CREATE_EVENT">;

type PrismaLike = {
  aiDecision: PrismaClient["aiDecision"];
  character: PrismaClient["character"];
  conversation: PrismaClient["conversation"];
};

export type AiDecisionView = {
  id: string;
  characterId: string;
  status: AiDecisionStatus;
  actionType: AiActionType;
  conversationId: string | null;
  reason: string | null;
  contextVersion: string;
  policyCode: string | null;
  executedMessageId: string | null;
  executedEventId: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export function toDecisionView(row: AiDecision): AiDecisionView {
  return {
    id: row.id,
    characterId: row.characterId,
    status: row.status,
    actionType: row.actionType,
    conversationId: row.conversationId,
    reason: row.reason,
    contextVersion: row.contextVersion,
    policyCode: row.policyCode,
    executedMessageId: row.executedMessageId,
    executedEventId: row.executedEventId,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function requireOwnedAiCharacter(
  userId: string,
  characterId: string,
): Promise<{
  character: { id: string; name: string; controlledBy: string; universeId: string | null };
  universeId: string;
}> {
  const universe = await ensureUniverse(userId);
  const character = await prisma.character.findFirst({
    where: { id: characterId, userId },
    select: { id: true, name: true, controlledBy: true, universeId: true },
  });
  if (!character) {
    throw new AiBehaviorError(
      "CHARACTER_NOT_FOUND",
      "Personagem não encontrado",
      404,
    );
  }
  if (character.controlledBy !== "AI") {
    throw new AiBehaviorError(
      "CHARACTER_NOT_AI",
      "Apenas personagens AI participam do comportamento autônomo",
      403,
    );
  }
  if (character.universeId !== universe.id) {
    throw new AiBehaviorError(
      "CHARACTER_NOT_IN_UNIVERSE",
      "Personagem não pertence ao seu Universe",
      403,
    );
  }
  return { character, universeId: universe.id };
}

export async function assertBehaviorAllowed(
  client: PrismaLike,
  characterId: string,
  actionType: BehaviorActionType,
): Promise<void> {
  const windowStart = new Date(Date.now() - AI_COOLDOWN_MS[actionType]);
  const hourStart = new Date(Date.now() - 60 * 60_000);

  const [cooldownRow, hourlyCount] = await Promise.all([
    client.aiDecision.findFirst({
      where: {
        characterId,
        actionType,
        status: { in: ["EXECUTING", "EXECUTED"] },
        createdAt: { gte: windowStart },
      },
      select: { id: true },
    }),
    client.aiDecision.count({
      where: {
        characterId,
        status: { in: ["EXECUTING", "EXECUTED"] },
        createdAt: { gte: hourStart },
      },
    }),
  ]);

  if (cooldownRow) {
    throw new AiBehaviorError(
      "COOLDOWN",
      "Ação em cooldown para este personagem",
      409,
    );
  }
  if (hourlyCount >= AI_MAX_ACTIONS_PER_HOUR) {
    throw new AiBehaviorError(
      "FREQUENCY_LIMIT",
      "Limite de ações por hora atingido",
      409,
    );
  }
}

export async function validateMessageTarget(
  client: PrismaLike,
  universeId: string,
  conversationId: string,
  aiCharacterId: string,
  userId: string,
): Promise<{ conversationId: string }> {
  const conversation = await client.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      participants: {
        select: {
          character: {
            select: {
              id: true,
              userId: true,
              controlledBy: true,
              universeId: true,
            },
          },
        },
      },
    },
  });
  if (!conversation) {
    throw new AiBehaviorError(
      "TARGET_NOT_FOUND",
      "Conversa alvo não encontrada",
      409,
    );
  }
  const participants = conversation.participants.map((item) => item.character);
  if (!participants.some((item) => item.id === aiCharacterId)) {
    throw new AiBehaviorError(
      "TARGET_NOT_FOUND",
      "Personagem não participa da conversa alvo",
      409,
    );
  }
  const hasUserCharacter = participants.some(
    (item) => item.controlledBy === "USER" && item.userId === userId,
  );
  if (!hasUserCharacter) {
    throw new AiBehaviorError(
      "TARGET_NOT_ACCESSIBLE",
      "Usuário não participa da conversa alvo",
      403,
    );
  }
  const foreign = participants.some(
    (item) => item.universeId !== null && item.universeId !== universeId,
  );
  if (foreign) {
    throw new AiBehaviorError(
      "TARGET_NOT_IN_UNIVERSE",
      "Conversa alvo inclui personagem de outro Universe",
      403,
    );
  }
  return { conversationId: conversation.id };
}

export async function validateEventParticipants(
  client: PrismaLike,
  universeId: string,
  participantIds: string[],
  userId: string,
): Promise<string[]> {
  if (participantIds.length < 2) {
    throw new AiBehaviorError(
      "TARGET_NOT_FOUND",
      "Participantes insuficientes para o evento",
      409,
    );
  }
  const characters = await client.character.findMany({
    where: { id: { in: participantIds } },
    select: { id: true, userId: true, controlledBy: true, universeId: true },
  });
  const validated: string[] = [];
  for (const id of participantIds) {
    const character = characters.find((item) => item.id === id);
    if (!character) {
      throw new AiBehaviorError(
        "TARGET_NOT_FOUND",
        "Personagem alvo não encontrado",
        409,
      );
    }
    if (character.universeId !== universeId) {
      throw new AiBehaviorError(
        "TARGET_NOT_IN_UNIVERSE",
        "Personagem alvo não pertence ao seu Universe",
        403,
      );
    }
    if (character.controlledBy === "USER" && character.userId !== userId) {
      throw new AiBehaviorError(
        "TARGET_NOT_ACCESSIBLE",
        "Personagem de usuário fora do seu perfil",
        403,
      );
    }
    validated.push(character.id);
  }
  return validated;
}
