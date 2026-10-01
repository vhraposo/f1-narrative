import type { PrismaClient } from "@prisma/client";

const WORLD_KEY = "default";

export type AiActionTypeValue =
  | "NO_ACTION"
  | "SEND_MESSAGE"
  | "CREATE_EVENT";

export type BehaviorDecision = {
  actionType: AiActionTypeValue;
  conversationId: string | null;
  reason: string;
  metadata: {
    seasonId: string | null;
    raceId: string | null;
    participantIds: string[];
  };
};

export type BehaviorContext = {
  characterId: string;
  world: {
    currentSeasonId: string | null;
    currentRaceId: string | null;
    currentDate: Date | null;
  };
  conversation: {
    id: string;
    userCharacterId: string;
  } | null;
  raceHasBehaviorEvent: boolean;
};

export async function buildBehaviorContext(
  client: PrismaClient,
  characterId: string,
  userId: string,
): Promise<BehaviorContext> {
  const character = await client.character.findUniqueOrThrow({
    where: { id: characterId },
    select: { universeId: true },
  });
  const world = character.universeId
    ? await client.worldState.findUnique({
        where: {
          universeId_key: {
            universeId: character.universeId,
            key: WORLD_KEY,
          },
        },
        select: { currentSeasonId: true, currentRaceId: true, currentDate: true },
      })
    : null;

  const conversation = await client.conversation.findFirst({
    where: {
      participants: { some: { characterId } },
      AND: {
        participants: {
          some: { character: { userId, controlledBy: "USER" } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      participants: {
        select: { character: { select: { id: true, userId: true, controlledBy: true } } },
      },
    },
  });

  const userCharacterId =
    conversation?.participants
      .map((item) => item.character)
      .find((item) => item.controlledBy === "USER" && item.userId === userId)?.id ??
    null;

  const raceId = world?.currentRaceId ?? null;
  const raceHasBehaviorEvent = raceId
    ? (await client.event.count({
        where: {
          payload: { path: ["raceId"], equals: raceId },
          AND: [
            { payload: { path: ["origin"], equals: "ai_behavior" } },
            { payload: { path: ["characterId"], equals: characterId } },
          ],
        },
      })) > 0
    : false;

  return {
    characterId,
    world: {
      currentSeasonId: world?.currentSeasonId ?? null,
      currentRaceId: raceId,
      currentDate: world?.currentDate ?? null,
    },
    conversation:
      conversation && userCharacterId
        ? { id: conversation.id, userCharacterId }
        : null,
    raceHasBehaviorEvent,
  };
}

export function decideBehavior(context: BehaviorContext): BehaviorDecision {
  const seasonId = context.world.currentSeasonId;
  const raceId = context.world.currentRaceId;

  if (
    seasonId &&
    raceId &&
    context.conversation &&
    !context.raceHasBehaviorEvent
  ) {
    return {
      actionType: "CREATE_EVENT",
      conversationId: null,
      reason: "corrida atual ainda sem acontecimento espontâneo do personagem",
      metadata: {
        seasonId,
        raceId,
        participantIds: [
          context.characterId,
          context.conversation.userCharacterId,
        ],
      },
    };
  }

  if (context.conversation) {
    return {
      actionType: "SEND_MESSAGE",
      conversationId: context.conversation.id,
      reason: "conversa ativa com personagem do usuário",
      metadata: {
        seasonId,
        raceId,
        participantIds: [
          context.characterId,
          context.conversation.userCharacterId,
        ],
      },
    };
  }

  return {
    actionType: "NO_ACTION",
    conversationId: null,
    reason: "contexto insuficiente para agir",
    metadata: { seasonId, raceId, participantIds: [] },
  };
}
