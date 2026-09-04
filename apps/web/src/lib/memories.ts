import { get, patch, post, remove } from "./api";

export type MemoryImportance = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type MemorySource =
  | "CANON"
  | "USER_DEFINED"
  | "GENERATED_EVENT"
  | "EXTERNAL_INFORMATION";

// Participante de uma Memory. controlledBy/userId vêm do backend para
// distinguir Characters USER (userId do usuário) de Characters AI (userId null).
export type MemoryParticipant = {
  id: string;
  name: string;
  nationality: string;
  imageUrl: string | null;
  controlledBy: "USER" | "AI";
  userId: string | null;
};

export type Memory = {
  id: string;
  eventId: string | null;
  importance: MemoryImportance;
  source: MemorySource;
  content: string;
  summary: string | null;
  context: Record<string, unknown> | null;
  emotionalImpact: number | null;
  createdAt: string;
  updatedAt: string;
  participants: MemoryParticipant[];
};

export type CreateMemoryInput = {
  content: string;
  summary?: string | null;
  context?: Record<string, unknown> | null;
  importance?: MemoryImportance;
  source?: MemorySource;
  emotionalImpact?: number | null;
  eventId?: string | null;
  characterIds: string[];
};

export type UpdateMemoryInput = Partial<CreateMemoryInput>;

export type MemoryFilters = {
  importance?: MemoryImportance;
  eventId?: string;
};

export const MEMORY_IMPORTANCE_LABELS: Record<MemoryImportance, string> = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
  CRITICAL: "Crítica",
};

export const MEMORY_IMPORTANCE_OPTIONS = Object.entries(
  MEMORY_IMPORTANCE_LABELS,
).map(([value, label]) => ({ value: value as MemoryImportance, label }));

export const MEMORY_SOURCE_LABELS: Record<MemorySource, string> = {
  CANON: "Cânone",
  USER_DEFINED: "Definido pelo usuário",
  GENERATED_EVENT: "Evento gerado",
  EXTERNAL_INFORMATION: "Informação externa",
};

export const MEMORY_SOURCE_OPTIONS = Object.entries(MEMORY_SOURCE_LABELS).map(
  ([value, label]) => ({ value: value as MemorySource, label }),
);

type MemoriesResponse = { memories: Memory[] };
type MemoryResponse = { memory: Memory };
type ParticipantResponse = { participant: { character: MemoryParticipant } };

export function listCharacterMemories(characterId: string): Promise<Memory[]> {
  return get<MemoriesResponse>(`/api/characters/${characterId}/memories`).then(
    (r) => r.memories,
  );
}

export function listMemories(filters: MemoryFilters = {}): Promise<Memory[]> {
  const params = new URLSearchParams();
  if (filters.importance) params.set("importance", filters.importance);
  if (filters.eventId) params.set("eventId", filters.eventId);
  const query = params.toString();
  return get<MemoriesResponse>(`/api/memories${query ? `?${query}` : ""}`).then(
    (r) => r.memories,
  );
}

export function getMemory(id: string): Promise<Memory> {
  return get<MemoryResponse>(`/api/memories/${id}`).then((r) => r.memory);
}

export function createMemory(input: CreateMemoryInput): Promise<Memory> {
  return post<MemoryResponse>("/api/memories", input).then((r) => r.memory);
}

export function updateMemory(
  id: string,
  input: UpdateMemoryInput,
): Promise<Memory> {
  return patch<MemoryResponse>(`/api/memories/${id}`, input).then((r) => r.memory);
}

export function deleteMemory(id: string): Promise<void> {
  return remove<void>(`/api/memories/${id}`);
}

export function addMemoryParticipant(
  memoryId: string,
  characterId: string,
): Promise<MemoryParticipant> {
  return post<ParticipantResponse>(`/api/memories/${memoryId}/characters`, {
    characterId,
  }).then((r) => r.participant.character);
}

export function removeMemoryParticipant(
  memoryId: string,
  characterId: string,
): Promise<void> {
  return remove<void>(`/api/memories/${memoryId}/characters/${characterId}`);
}