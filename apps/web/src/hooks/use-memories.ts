"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addMemoryParticipant,
  createMemory,
  deleteMemory,
  getMemory,
  listCharacterMemories,
  listMemories,
  removeMemoryParticipant,
  updateMemory,
  type CreateMemoryInput,
  type Memory,
  type MemoryFilters,
  type UpdateMemoryInput,
} from "@/lib/memories";

export const memoriesKey = ["memories"] as const;

export function memoryKey(id: string) {
  return ["memories", id] as const;
}

export function characterMemoriesKey(characterId: string) {
  return ["characters", characterId, "memories"] as const;
}

export function memoryParticipantsKey(memoryId: string) {
  return ["memories", memoryId, "participants"] as const;
}

export function useCharacterMemories(characterId: string | undefined) {
  return useQuery({
    queryKey: characterMemoriesKey(characterId ?? ""),
    queryFn: () => listCharacterMemories(characterId as string),
    enabled: Boolean(characterId),
  });
}

export function useMemories(filters: MemoryFilters = {}) {
  return useQuery({
    queryKey: ["memories", filters] as const,
    queryFn: () => listMemories(filters),
  });
}

export function useMemory(id: string | undefined) {
  return useQuery({
    queryKey: memoryKey(id ?? ""),
    queryFn: () => getMemory(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateMemory(characterId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMemoryInput) => createMemory(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memoriesKey });
      if (characterId) {
        void queryClient.invalidateQueries({
          queryKey: characterMemoriesKey(characterId),
        });
      }
    },
  });
}

export function useUpdateMemory(characterId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; input: UpdateMemoryInput }) =>
      updateMemory(vars.id, vars.input),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: memoriesKey });
      void queryClient.invalidateQueries({ queryKey: memoryKey(vars.id) });
      if (characterId) {
        void queryClient.invalidateQueries({
          queryKey: characterMemoriesKey(characterId),
        });
      }
    },
  });
}

export function useDeleteMemory(characterId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteMemory(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: memoriesKey });
      void queryClient.removeQueries({ queryKey: memoryKey(id) });
      void queryClient.removeQueries({
        queryKey: memoryParticipantsKey(id),
      });
      if (characterId) {
        void queryClient.invalidateQueries({
          queryKey: characterMemoriesKey(characterId),
        });
      }
    },
  });
}

export function useAddMemoryParticipant(memoryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (characterId: string) =>
      addMemoryParticipant(memoryId, characterId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memoryKey(memoryId) });
      void queryClient.invalidateQueries({
        queryKey: memoryParticipantsKey(memoryId),
      });
    },
  });
}

export function useRemoveMemoryParticipant(memoryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (characterId: string) =>
      removeMemoryParticipant(memoryId, characterId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memoryKey(memoryId) });
      void queryClient.invalidateQueries({
        queryKey: memoryParticipantsKey(memoryId),
      });
    },
  });
}

export type { Memory };