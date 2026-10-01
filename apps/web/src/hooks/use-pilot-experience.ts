"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  applyPilotEvolution,
  createPilotMemory,
  listPilotExperiences,
  listPilotMemories,
  patchPilotMemory,
  previewPilotEvolution,
  reconcilePilotContext,
  type PilotImportance,
  type PilotMemoryStatus,
  type PilotMemoryType,
} from "@/lib/pilot-experience";

export function pilotMemoriesQueryKey(
  characterId: string,
  filters: { status?: PilotMemoryStatus; type?: PilotMemoryType; importance?: PilotImportance },
) {
  return [
    "pilot-memories",
    characterId,
    filters.status ?? "",
    filters.type ?? "",
    filters.importance ?? "",
  ] as const;
}

export function usePilotMemories(
  characterId: string,
  filters: { status?: PilotMemoryStatus; type?: PilotMemoryType; importance?: PilotImportance } = {},
) {
  return useQuery({
    queryKey: pilotMemoriesQueryKey(characterId, filters),
    queryFn: () => listPilotMemories(characterId, filters),
  });
}

function useInvalidatePilotExperience(characterId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["pilot-memories", characterId] });
    void queryClient.invalidateQueries({ queryKey: ["pilot-experiences", characterId] });
    void queryClient.invalidateQueries({ queryKey: ["pilot-knowledge", characterId] });
  };
}

export function useCreatePilotMemory(characterId: string) {
  const invalidate = useInvalidatePilotExperience(characterId);
  return useMutation({
    mutationFn: (input: Parameters<typeof createPilotMemory>[1]) =>
      createPilotMemory(characterId, input),
    onSuccess: invalidate,
  });
}

export function usePatchPilotMemory(characterId: string) {
  const invalidate = useInvalidatePilotExperience(characterId);
  return useMutation({
    mutationFn: (vars: { memoryId: string; input: Parameters<typeof patchPilotMemory>[2] }) =>
      patchPilotMemory(characterId, vars.memoryId, vars.input),
    onSuccess: invalidate,
  });
}

export function useReconcilePilotContext(characterId: string) {
  const invalidate = useInvalidatePilotExperience(characterId);
  return useMutation({
    mutationFn: () => reconcilePilotContext(characterId),
    onSuccess: invalidate,
  });
}

export function usePilotExperiences(characterId: string) {
  return useQuery({
    queryKey: ["pilot-experiences", characterId],
    queryFn: () => listPilotExperiences(characterId),
  });
}

export function usePreviewPilotEvolution(characterId: string) {
  return useMutation({
    mutationFn: () => previewPilotEvolution(characterId),
  });
}

export function useApplyPilotEvolution(characterId: string) {
  const invalidate = useInvalidatePilotExperience(characterId);
  return useMutation({
    mutationFn: (input: { expectedRevision: number; expectedPendingFingerprint: string }) =>
      applyPilotEvolution(characterId, input),
    onSuccess: invalidate,
  });
}
