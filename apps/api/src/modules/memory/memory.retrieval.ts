import type { MemoryImportance, PilotExperienceType } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { rankMemories, type MemoryCandidate } from "./memory.policy.js";

export type MemoryRetrievalInput = {
  readonly universeId: string;
  readonly characterId: string;
  readonly participantIds?: readonly string[];
  readonly relationshipCharacterIds?: readonly string[];
  readonly goalKinds?: readonly string[];
  readonly worldDate: Date;
  readonly now: Date;
  readonly limit?: number;
};

export type RetrievedMemory = {
  readonly id: string;
  readonly summary: string | null;
  readonly content: string;
  readonly importance: MemoryImportance;
  readonly memoryType: PilotExperienceType | null;
  readonly createdAt: Date;
  readonly score: number;
};

const CANDIDATE_LIMIT = 60;
const DEFAULT_LIMIT = 10;

export async function retrieveRelevantMemories(
  input: MemoryRetrievalInput,
): Promise<RetrievedMemory[]> {
  const memories = await prisma.memory.findMany({
    where: {
      status: "ACTIVE",
      participants: { some: { characterId: input.characterId } },
      OR: [{ universeId: input.universeId }, { universeId: null }],
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: CANDIDATE_LIMIT,
    select: {
      id: true,
      summary: true,
      content: true,
      importance: true,
      memoryType: true,
      createdAt: true,
      participants: { select: { characterId: true }, orderBy: { characterId: "asc" } },
    },
  });

  const candidates: MemoryCandidate[] = memories.map((memory) => ({
    id: memory.id,
    importance: memory.importance,
    createdAt: memory.createdAt,
    memoryType: memory.memoryType,
    participantIds: memory.participants.map((participant) => participant.characterId),
  }));
  const ranked = rankMemories(candidates, {
    characterId: input.characterId,
    participantIds: input.participantIds,
    relationshipCharacterIds: input.relationshipCharacterIds,
    goalKinds: input.goalKinds,
    worldDate: input.worldDate,
    now: input.now,
  });
  const limit = input.limit ?? DEFAULT_LIMIT;
  const byId = new Map(memories.map((memory) => [memory.id, memory]));
  return ranked.slice(0, limit).map((entry) => {
    const memory = byId.get(entry.id);
    return {
      id: entry.id,
      summary: memory?.summary ?? null,
      content: memory?.content ?? "",
      importance: entry.importance,
      memoryType: memory?.memoryType ?? null,
      createdAt: entry.createdAt,
      score: entry.score,
    };
  });
}
