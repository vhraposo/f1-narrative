import { z } from "zod";

import { DialogueEmotionContextSchema, type DialogueEmotionContext } from "./conversation.dialogue-emotion.js";
import { DialogueTopicContextSchema, type DialogueTopicContext } from "./conversation.dialogue-topic.js";
import { DialogueMemoryContextSchema, type DialogueMemoryContext } from "./conversation.dialogue-memory.js";

export const DIALOGUE_KNOWLEDGE_MAX_FACTS = 3;
export const DIALOGUE_KNOWLEDGE_PUBLIC_MAX = 3;
export const DIALOGUE_CONTEXT_SUMMARY_MAX_CHARS = 120;

export const DialogueKnowledgeFactSchema = z.object({
  factId: z.string().min(1),
  summary: z.string().min(1).max(DIALOGUE_CONTEXT_SUMMARY_MAX_CHARS),
});
export type DialogueKnowledgeFact = z.infer<typeof DialogueKnowledgeFactSchema>;

export const DialogueKnowledgeContextSchema = z.object({
  knownFacts: z.array(DialogueKnowledgeFactSchema).max(DIALOGUE_KNOWLEDGE_MAX_FACTS),
  publicFacts: z.array(DialogueKnowledgeFactSchema).max(DIALOGUE_KNOWLEDGE_PUBLIC_MAX),
  source: z.literal("MEMORY_SCOPE"),
});
export type DialogueKnowledgeContext = z.infer<typeof DialogueKnowledgeContextSchema>;

export type KnowledgeMemoryInput = {
  readonly id: string;
  readonly summary: string | null;
  readonly content: string;
  readonly importance: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  readonly universeId: string | null;
};

export const DialogueRelationshipContextSchema = z.object({
  affinity: z.number().min(0).max(1).nullable(),
  closeness: z.enum(["CLOSE", "NEUTRAL", "DISTANT"]),
});
export type DialogueRelationshipContext = z.infer<typeof DialogueRelationshipContextSchema>;

export const DialogueContextSchema = z.object({
  speakerCharacterId: z.string().min(1),
  emotion: DialogueEmotionContextSchema.nullable(),
  topic: DialogueTopicContextSchema.nullable(),
  memory: DialogueMemoryContextSchema,
  knowledge: DialogueKnowledgeContextSchema,
  relationship: DialogueRelationshipContextSchema,
});
export type DialogueContext = z.infer<typeof DialogueContextSchema>;

export function buildDialogueRelationshipContext(
  affinity: number | null,
): DialogueRelationshipContext {
  if (affinity === null) return { affinity: null, closeness: "NEUTRAL" };
  if (affinity >= 0.7) return { affinity, closeness: "CLOSE" };
  if (affinity <= 0.3) return { affinity, closeness: "DISTANT" };
  return { affinity, closeness: "NEUTRAL" };
}

// knownFacts deriva somente das memórias já autorizadas ao personagem pelo retrieval (participants.some.characterId);
// publicFacts permanece vazio porque o domínio atual não possui fonte confiável de fatos globais por personagem.
export function buildDialogueKnowledgeContext(input: {
  readonly universeId: string;
  readonly memories: readonly KnowledgeMemoryInput[];
}): DialogueKnowledgeContext {
  const knownFacts: DialogueKnowledgeFact[] = [];
  for (const memory of input.memories) {
    if (knownFacts.length >= DIALOGUE_KNOWLEDGE_MAX_FACTS) break;
    if (memory.universeId !== null && memory.universeId !== input.universeId) continue;
    if (memory.importance === "LOW") continue;
    const summary = (memory.summary?.trim() || memory.content.trim()).slice(
      0,
      DIALOGUE_CONTEXT_SUMMARY_MAX_CHARS,
    );
    if (summary.length === 0) continue;
    knownFacts.push({ factId: memory.id, summary });
  }
  return { knownFacts, publicFacts: [], source: "MEMORY_SCOPE" };
}

export function buildDialogueContext(input: {
  readonly speakerCharacterId: string;
  readonly emotion: DialogueEmotionContext | null;
  readonly topic: DialogueTopicContext | null;
  readonly memory: DialogueMemoryContext;
  readonly knowledge: DialogueKnowledgeContext;
  readonly affinity: number | null;
}): DialogueContext {
  return {
    speakerCharacterId: input.speakerCharacterId,
    emotion: input.emotion,
    topic: input.topic,
    memory: input.memory,
    knowledge: input.knowledge,
    relationship: buildDialogueRelationshipContext(input.affinity),
  };
}
