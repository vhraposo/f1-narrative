import { z } from "zod";

import type { RetrievedMemory } from "../memory/memory.retrieval.js";

export const DIALOGUE_MEMORY_MAX_ITEMS = 3;
export const DIALOGUE_MEMORY_SUMMARY_MAX_CHARS = 120;

export const DialogueMemoryScopeSchema = z.enum(["CHARACTER", "SHARED"]);
export type DialogueMemoryScope = z.infer<typeof DialogueMemoryScopeSchema>;

export const DialogueMemoryItemSchema = z.object({
  memoryId: z.string().min(1),
  summary: z.string().min(1).max(DIALOGUE_MEMORY_SUMMARY_MAX_CHARS),
  relevance: z.number().min(0).max(1),
  scope: DialogueMemoryScopeSchema,
});
export type DialogueMemoryItem = z.infer<typeof DialogueMemoryItemSchema>;

export const DialogueMemoryContextSchema = z.object({
  items: z.array(DialogueMemoryItemSchema).max(DIALOGUE_MEMORY_MAX_ITEMS),
});
export type DialogueMemoryContext = z.infer<typeof DialogueMemoryContextSchema>;

export function buildDialogueMemoryContext(input: {
  readonly characterId: string;
  readonly conversationParticipantIds: readonly string[];
  readonly memories: readonly RetrievedMemory[];
}): DialogueMemoryContext {
  const scope: DialogueMemoryScope =
    input.conversationParticipantIds.length > 2 ? "SHARED" : "CHARACTER";
  const maxScore = input.memories.reduce((max, memory) => Math.max(max, memory.score), 0);
  const items: DialogueMemoryItem[] = [];
  for (const memory of input.memories) {
    if (items.length >= DIALOGUE_MEMORY_MAX_ITEMS) break;
    const summary = (memory.summary?.trim() || memory.content.trim()).slice(
      0,
      DIALOGUE_MEMORY_SUMMARY_MAX_CHARS,
    );
    if (summary.length === 0) continue;
    items.push({
      memoryId: memory.id,
      summary,
      relevance: maxScore > 0 ? Math.max(0, Math.min(1, memory.score / maxScore)) : 0,
      scope,
    });
  }
  return { items };
}
