import type { DialogueRealizerContext } from "./conversation.dialogue-realizer.js";

export function normalizeContextText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function curateDialogueMemories(
  memories: readonly string[],
  options: { readonly recentTexts: readonly string[]; readonly limit: number },
): string[] {
  const recent = new Set(options.recentTexts.map(normalizeContextText));
  const seen = new Set<string>();
  const curated: string[] = [];
  for (const memory of memories) {
    const trimmed = memory.trim();
    const normalized = normalizeContextText(trimmed);
    if (normalized.length === 0) continue;
    if (seen.has(normalized)) continue;
    if (recent.has(normalized)) continue;
    seen.add(normalized);
    curated.push(trimmed);
    if (curated.length >= options.limit) break;
  }
  return curated;
}

export function measureDialogueContextBudget(context: DialogueRealizerContext): {
  chars: number;
  components: number;
  memories: number;
  recentMessages: number;
} {
  const parts = [
    context.speakerName,
    context.interlocutorName ?? "",
    context.intent,
    context.replyToContent ?? "",
    context.topic ?? "",
    context.emotionalTone ?? "",
    ...context.recentMessages.map((message) => message.content),
    ...context.memorySummaries,
  ];
  return {
    chars: parts.reduce((sum, part) => sum + part.length, 0),
    components: parts.filter((part) => part.length > 0).length,
    memories: context.memorySummaries.length,
    recentMessages: context.recentMessages.length,
  };
}
