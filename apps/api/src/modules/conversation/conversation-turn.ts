import type { PrismaClient } from "@prisma/client";
import { assembleContext, type AssembledContext } from "../context/context.assembly.js";
import { readConversationRag } from "../context/conversation-rag-read.js";
import {
  assembleGenerationBundle,
  GenerationSpeakerTargetError,
  GenerationUserInputError,
  type GenerationProvider,
} from "../generation/generation.assembly.js";
import {
  type GenerationMessage,
  persistGeneratedMessage,
} from "../generation/generation-persist.js";
import {
  GenerationRagFrameNotFoundError,
  resolveGenerationRagContext,
} from "../generation/generation-rag-context.js";
import { OllamaProviderError } from "../generation/ollama-provider.js";
import { materializeConversationRag } from "../external-research/conversation-rag-materialization.js";
import type { EmbeddingProviderWithInputType } from "../external-research/external-embedding-store.js";
import {
  shouldResearch,
  type ResearchTriggerInternalContext,
} from "../external-research/research-trigger.js";
import { selectSpeakers } from "./response-orchestrator.js";


export interface TurnInput {
  conversationId: string;
  userId: string;
  userPrompt: string;
  ragFrameId?: string;
}

export interface TurnUserMessage {
  id: string;
  conversationId: string;
  senderType: "USER_CHARACTER";
  characterId: string;
  content: string;
  createdAt: Date;
}

export interface TurnFailedSpeaker {
  characterId: string;
  error: string;
}

export interface TurnResult {
  userMessage: TurnUserMessage;
  messages: GenerationMessage[];
  failedSpeakers: TurnFailedSpeaker[];
}

export class TurnUserCharacterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TurnUserCharacterError";
  }
}

const userMessageSelect = {
  id: true,
  conversationId: true,
  senderType: true,
  characterId: true,
  content: true,
  createdAt: true,
} as const;

function toTurnUserMessage(row: {
  id: string;
  conversationId: string;
  senderType: string;
  characterId: string | null;
  content: string;
  createdAt: Date;
}): TurnUserMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderType: "USER_CHARACTER",
    characterId: row.characterId as string,
    content: row.content,
    createdAt: row.createdAt,
  };
}

async function resolveUserCharacter(
  db: PrismaClient,
  conversationId: string,
  userId: string,
): Promise<string | null> {
  const participant = await db.conversationParticipant.findFirst({
    where: {
      conversationId,
      character: { userId, controlledBy: "USER" },
    },
    select: { characterId: true },
    orderBy: { characterId: "asc" },
  });
  return participant?.characterId ?? null;
}

async function persistUserMessage(
  db: PrismaClient,
  conversationId: string,
  characterId: string,
  content: string,
): Promise<TurnUserMessage> {
  const message = await db.message.create({
    data: {
      conversationId,
      senderType: "USER_CHARACTER",
      characterId,
      content,
    },
    select: userMessageSelect,
  });

  await db.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  return toTurnUserMessage(message);
}

function describeTurnFailure(err: unknown): string {
  if (err instanceof GenerationUserInputError) return "user-input";
  if (err instanceof GenerationSpeakerTargetError) return err.code;
  if (err instanceof GenerationRagFrameNotFoundError) return "rag-frame-not-found";
  if (err instanceof OllamaProviderError) return "provider-error";
  return "generation-error";
}

export interface ExecuteTurnOptions {
  ragProvider?: EmbeddingProviderWithInputType;
}

function toTriggerInternalContext(signals: AssembledContext): ResearchTriggerInternalContext {
  return {
    participants: signals.participants.map((p) => ({
      name: p.name,
      dna: p.dna,
      biography: p.biography,
    })),
    memories: signals.memories.map((m) => ({ content: m.content, summary: m.summary })),
    events: signals.events.map((e) => ({ title: e.title, description: e.description })),
    relationships: signals.relationships.map((r) => ({
      characterAName: r.characterAName,
      characterBName: r.characterBName,
    })),
    recentMessages: signals.recentMessages.map((m) => ({ content: m.content })),
    worldState: {
      worldDate: signals.temporal.worldDate,
      currentSeasonId: signals.temporal.currentSeasonId,
      currentRaceId: signals.temporal.currentRaceId,
      raceNames: signals.motorsport?.races.map((r) => r.name) ?? [],
    },
  };
}

async function autoResearchFrame(
  db: PrismaClient,
  ragProvider: EmbeddingProviderWithInputType | undefined,
  hasAiSpeakers: boolean,
  input: { conversationId: string; userId: string; userPrompt: string; signals: AssembledContext },
): Promise<string | undefined> {
  if (ragProvider === undefined || !hasAiSpeakers) return undefined;
  const decision = shouldResearch({
    message: input.userPrompt,
    internal: toTriggerInternalContext(input.signals),
  });
  if (!decision.shouldResearch || decision.queryHint === undefined) return undefined;
  try {
    const result = await materializeConversationRag(db, ragProvider, {
      conversationId: input.conversationId,
      ownerId: input.userId,
      frame: { query: decision.queryHint },
    });
    return result.itemCount > 0 ? result.frameId : undefined;
  } catch {
    return undefined;
  }
}

export async function executeTurn(
  db: PrismaClient,
  provider: GenerationProvider,
  input: TurnInput,
  options?: ExecuteTurnOptions,
): Promise<TurnResult> {
  if (input.ragFrameId !== undefined) {
    const readRag = await readConversationRag(
      db,
      input.conversationId,
      input.userId,
    );
    resolveGenerationRagContext(readRag, input.ragFrameId);
  }

  const userCharacterId = await resolveUserCharacter(
    db,
    input.conversationId,
    input.userId,
  );
  if (!userCharacterId) {
    throw new TurnUserCharacterError(
      "Nenhum personagem USER deste usuário participa da conversa.",
    );
  }

  const signals = await assembleContext(db, {
    conversationId: input.conversationId,
    userId: input.userId,
  });

  const selection = selectSpeakers({
    userMessage: {
      content: input.userPrompt,
      senderCharacterId: userCharacterId,
    },
    participants: signals.participants.map((p) => ({
      characterId: p.characterId,
      name: p.name,
      controlledBy: p.controlledBy,
    })),
    recentMessages: signals.recentMessages.map((m) => ({
      characterId: m.characterId,
      senderType: m.senderType,
    })),
    memories: signals.memories.map((m) => ({
      participantCharacterIds: m.participantCharacterIds,
    })),
    events: signals.events.map((e) => ({
      participantCharacterIds: e.participantCharacterIds,
    })),
    relationships: signals.relationships.map((r) => ({
      characterAId: r.characterAId,
      characterBId: r.characterBId,
    })),
  });

  const userMessage = await persistUserMessage(
    db,
    input.conversationId,
    userCharacterId,
    input.userPrompt,
  );

  const autoRagFrameId = await autoResearchFrame(
    db,
    options?.ragProvider,
    selection.selected.length > 0,
    {
      conversationId: input.conversationId,
      userId: input.userId,
      userPrompt: input.userPrompt,
      signals,
    },
  );
  const effectiveRagFrameId = input.ragFrameId ?? autoRagFrameId;

  const messages: GenerationMessage[] = [];
  const failedSpeakers: TurnFailedSpeaker[] = [];

  for (const speakerId of selection.selected) {
    try {
      const result = await assembleGenerationBundle(
        db,
        {
          conversationId: input.conversationId,
          userId: input.userId,
          userPrompt: input.userPrompt,
          targetCharacterId: speakerId,
          ...(effectiveRagFrameId !== undefined
            ? { ragFrameId: effectiveRagFrameId }
            : {}),
        },
        provider,
      );

      if (result.meta.mode !== "generated") {
        failedSpeakers.push({ characterId: speakerId, error: "mode-not-generated" });
        continue;
      }

      const decision = await persistGeneratedMessage(db, result, input.userId);
      if (decision.persisted) {
        messages.push(decision.message);
      } else {
        failedSpeakers.push({ characterId: speakerId, error: decision.reason });
      }
    } catch (err) {
      failedSpeakers.push({
        characterId: speakerId,
        error: describeTurnFailure(err),
      });
    }
  }

  return { userMessage, messages, failedSpeakers };
}