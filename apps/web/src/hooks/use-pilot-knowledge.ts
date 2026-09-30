"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createUniverseRelationship,
  deleteUniverseRelationship,
  getPilotKnowledge,
  updateUniverseRelationship,
  type PilotKnowledgeView,
  type UniverseRelationshipInput,
} from "@/lib/pilot-knowledge";

export function pilotKnowledgeQueryKey(characterId: string, topic?: string) {
  return ["pilot-knowledge", characterId, topic ?? ""] as const;
}

export function usePilotKnowledge(characterId: string | undefined, topic?: string) {
  return useQuery({
    queryKey: pilotKnowledgeQueryKey(characterId ?? "", topic),
    queryFn: () => getPilotKnowledge(characterId as string, topic),
    enabled: typeof characterId === "string" && characterId.length > 0,
  });
}

function useInvalidatePilotKnowledge(characterId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["pilot-knowledge", characterId] });
  };
}

export function useCreateUniverseRelationship(characterId: string) {
  const invalidate = useInvalidatePilotKnowledge(characterId);
  return useMutation({
    mutationFn: (input: UniverseRelationshipInput) =>
      createUniverseRelationship(characterId, input),
    onSuccess: invalidate,
  });
}

export function useUpdateUniverseRelationship(characterId: string) {
  const invalidate = useInvalidatePilotKnowledge(characterId);
  return useMutation({
    mutationFn: (vars: { id: string; input: Partial<UniverseRelationshipInput> }) =>
      updateUniverseRelationship(vars.id, vars.input),
    onSuccess: invalidate,
  });
}

export function useDeleteUniverseRelationship(characterId: string) {
  const invalidate = useInvalidatePilotKnowledge(characterId);
  return useMutation({
    mutationFn: (id: string) => deleteUniverseRelationship(id),
    onSuccess: invalidate,
  });
}

export type PilotKnowledgeQueryData = { pilot: PilotKnowledgeView } | undefined;
