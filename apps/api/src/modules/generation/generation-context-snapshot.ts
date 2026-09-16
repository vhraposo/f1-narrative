import type { GenerationResult } from "./generation.assembly.js";

/**
 * Snapshot/metadata do contexto narrativo usado numa geração (STEP 108 FASE 4).
 *
 * Contrato: NÃO é fonte de verdade. A montagem completa continua em request-time
 * no context assembly; este JSON registra referência (generationKey) + metadata
 * (identidades, conta de blocos, RAG) suficiente para reconstrução e auditoria,
 * sem duplicar o contexto integral nem o systemPrompt.
 */
export interface MessageContextJson {
  family: "generation-context.v1";
  generationKey: string;
  provider: string;
  ruleApplied: string;
  conversationType: string;
  assembledAt: string;
  activeSpeaker: { characterId: string | null; senderType: string };
  participantCharacterIds: string[];
  temporal: {
    worldDate: string | null;
    currentSeasonId: string | null;
    currentRaceId: string | null;
    currentSession: string | null;
    phaseMarker: string | null;
  };
  fidelity: {
    messages: number;
    memories: number;
    events: number;
    relationships: number;
    news: number;
    omitted: {
      oldestMessagesTruncated: number;
      memoriesOmitted: number;
      reasons: string[];
    };
  };
  stats: { systemPromptChars: number; contextBlocks: number };
  rag: {
    used: boolean;
    provider: string | null;
    model: string | null;
    dimensions: number | null;
    ruleApplied: string | null;
    items: number;
  };
}

export function buildMessageContextJson(result: GenerationResult): MessageContextJson {
  const context = result.context;
  const rag = context.externalRag;
  return {
    family: "generation-context.v1",
    generationKey: result.generationKey,
    provider: result.meta.provider,
    ruleApplied: result.meta.ruleApplied,
    conversationType: context.meta.conversationType,
    assembledAt: context.meta.assembledAt,
    activeSpeaker: {
      characterId: context.activeSpeaker.characterId,
      senderType: context.activeSpeaker.senderType,
    },
    participantCharacterIds: context.meta.participantCharacterIds,
    temporal: {
      worldDate: context.temporal.worldDate,
      currentSeasonId: context.temporal.currentSeasonId,
      currentRaceId: context.temporal.currentRaceId,
      currentSession: context.temporal.currentSession,
      phaseMarker: context.temporal.phaseMarker,
    },
    fidelity: {
      messages: context.recentMessages.length,
      memories: context.memories.length,
      events: context.events.length,
      relationships: context.relationships.length,
      news: context.news.length,
      omitted: {
        oldestMessagesTruncated: context.omitted.oldestMessagesTruncated,
        memoriesOmitted: context.omitted.memoriesOmitted,
        reasons: [...context.omitted.reasons],
      },
    },
    stats: {
      systemPromptChars: result.meta.tokens.systemPromptChars,
      contextBlocks: result.meta.tokens.contextBlocks,
    },
    rag: {
      used: rag !== undefined,
      provider: rag?.provider ?? null,
      model: rag?.model ?? null,
      dimensions: rag?.dimensions ?? null,
      ruleApplied: rag?.ruleApplied ?? null,
      items: rag?.items.length ?? 0,
    },
  };
}