import type { MemoryImportance, PilotExperienceType } from "@prisma/client";

export type RelevanceMemoryInput = {
  readonly id: string;
  readonly revision: number;
  readonly importance: MemoryImportance;
  readonly memoryType: PilotExperienceType | null;
  readonly content: string;
  readonly summary: string | null;
  readonly occurredAt: Date | null;
  readonly createdAt: Date;
  readonly derivedKey: string | null;
};

export type MemoryRelevanceContext = {
  readonly topic: string | null;
  readonly worldDate: Date | null;
};

const SALIENCE_SCORE: Record<MemoryImportance, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

const CAREER_DEFINING: ReadonlySet<PilotExperienceType> = new Set([
  "CHAMPIONSHIP",
  "CAREER_MILESTONE",
  "SPORTING_VICTORY",
  "SPORTING_DEFEAT",
]);

export function extractMentionedYear(topic: string | null | undefined): number | null {
  if (!topic) return null;
  const match = /\b(19|20)\d{2}\b/.exec(topic.toLowerCase());
  return match ? Number(match[0]) : null;
}

export function scoreMemoryRelevance(
  memory: RelevanceMemoryInput,
  context: MemoryRelevanceContext,
): number {
  let score = SALIENCE_SCORE[memory.importance] * 10;
  const normalizedTopic = context.topic?.trim().toLowerCase() ?? "";
  const mentionedYear = extractMentionedYear(normalizedTopic);
  const occurredYear = memory.occurredAt ? memory.occurredAt.getUTCFullYear() : null;

  if (mentionedYear !== null && occurredYear === mentionedYear) score += 14;
  if (mentionedYear !== null && /\b(19|20)\d{2}\b/.test(memory.content) && memory.content.includes(String(mentionedYear))) {
    score += 8;
  }
  if (normalizedTopic.length >= 3) {
    const haystack = `${memory.content} ${memory.summary ?? ""}`.toLowerCase();
    if (haystack.includes(normalizedTopic)) score += 12;
  }
  if (memory.memoryType && CAREER_DEFINING.has(memory.memoryType)) score += 5;

  const reference = memory.occurredAt ?? memory.createdAt;
  const worldDate = context.worldDate ?? new Date();
  const daysAgo = Math.max(0, (worldDate.getTime() - reference.getTime()) / (24 * 60 * 60 * 1000));
  score -= Math.min(daysAgo / 30, 6);

  return score;
}

export function selectRelevantMemories<T extends RelevanceMemoryInput>(
  memories: readonly T[],
  context: MemoryRelevanceContext,
  limit: number,
): readonly T[] {
  return [...memories]
    .sort((a, b) => {
      const scoreDiff = scoreMemoryRelevance(b, context) - scoreMemoryRelevance(a, context);
      if (scoreDiff !== 0) return scoreDiff;
      const aRef = (a.occurredAt ?? a.createdAt).getTime();
      const bRef = (b.occurredAt ?? b.createdAt).getTime();
      if (bRef !== aRef) return bRef - aRef;
      if (b.revision !== a.revision) return b.revision - a.revision;
      return a.id.localeCompare(b.id);
    })
    .slice(0, limit);
}
