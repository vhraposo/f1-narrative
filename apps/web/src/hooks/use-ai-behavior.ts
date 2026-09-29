"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  evaluateCharacterBehavior,
  executeCharacterDecision,
  listCharacterDecisions,
  type AiDecision,
} from "@/lib/ai-behavior";

export function aiDecisionsKey(characterId: string) {
  return ["ai-behavior", characterId] as const;
}

export function useAiDecisions(characterId: string | undefined) {
  return useQuery<AiDecision[]>({
    queryKey: aiDecisionsKey(characterId ?? ""),
    queryFn: () => listCharacterDecisions(characterId as string),
    enabled: Boolean(characterId),
  });
}

export function useEvaluateAiBehavior(characterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => evaluateCharacterBehavior(characterId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: aiDecisionsKey(characterId),
      });
    },
  });
}

export function useExecuteAiDecision(characterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (decisionId: string) =>
      executeCharacterDecision(decisionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: aiDecisionsKey(characterId),
      });
    },
  });
}
