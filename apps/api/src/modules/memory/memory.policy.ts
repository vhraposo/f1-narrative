import type { MemoryImportance } from "@prisma/client";

export const MEMORY_POLICY_VERSION = "memory-policy.v1";

const IMPORTANCE_WEIGHT: Record<MemoryImportance, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export function memoryImportanceWeight(importance: MemoryImportance): number {
  return IMPORTANCE_WEIGHT[importance];
}

export function memorySalienceWeight(importance: MemoryImportance): number {
  return IMPORTANCE_WEIGHT[importance] / 4;
}

export type MemoryCandidate = {
  readonly id: string;
  readonly importance: MemoryImportance;
  readonly createdAt: Date;
  readonly memoryType: string | null;
  readonly participantIds: readonly string[];
};

export type MemoryRetrievalCriteria = {
  readonly characterId: string;
  readonly participantIds?: readonly string[];
  readonly relationshipCharacterIds?: readonly string[];
  readonly goalKinds?: readonly string[];
  readonly worldDate: Date;
  readonly now: Date;
};

export type RankedMemory = MemoryCandidate & { readonly score: number };

const GOAL_MEMORY_TYPES: Record<string, readonly string[]> = {
  WIN_RACE: ["SPORTING_VICTORY", "SIGNIFICANT_RACE", "SPORTING_DEFEAT"],
  WIN_CHAMPIONSHIP: ["CHAMPIONSHIP"],
  RECOVER_AFTER_SETBACK: ["SPORTING_DEFEAT", "CONFLICT"],
  CONFRONT_RIVAL: ["CONFLICT", "SPORTING_DEFEAT"],
  PROTECT_RELATIONSHIP: ["RELATIONSHIP_EVENT", "CONFLICT"],
  OUTPERFORM_TEAMMATE: ["SPORTING_DEFEAT", "SPORTING_VICTORY"],
};

const RECENCY_BUCKET_MS = 30 * 24 * 60 * 60 * 1000;

export function rankMemories(
  candidates: readonly MemoryCandidate[],
  criteria: MemoryRetrievalCriteria,
): RankedMemory[] {
  const relevantParticipants = new Set(criteria.participantIds ?? []);
  const relevantRelationships = new Set(criteria.relationshipCharacterIds ?? []);
  const goalTypes = new Set(
    (criteria.goalKinds ?? []).flatMap((kind) => GOAL_MEMORY_TYPES[kind] ?? []),
  );

  return candidates
    .map((candidate) => {
      let score = memoryImportanceWeight(candidate.importance) * 4;
      const overlap = candidate.participantIds.filter((id) => relevantParticipants.has(id)).length;
      score += Math.min(overlap, 3) * 3;
      if (candidate.participantIds.includes(criteria.characterId)) score += 1;
      const relationshipOverlap = candidate.participantIds.filter((id) =>
        relevantRelationships.has(id),
      ).length;
      score += Math.min(relationshipOverlap, 2) * 2;
      if (candidate.memoryType && goalTypes.has(candidate.memoryType)) score += 2;
      const ageMs = Math.max(0, criteria.now.getTime() - candidate.createdAt.getTime());
      const recency = Math.max(0, 2 - Math.floor(ageMs / RECENCY_BUCKET_MS));
      score += recency;
      return { ...candidate, score };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const created = b.createdAt.getTime() - a.createdAt.getTime();
      if (created !== 0) return created;
      return a.id.localeCompare(b.id);
    });
}
