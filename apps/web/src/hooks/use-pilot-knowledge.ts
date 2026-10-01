"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useToast } from "@/components/ui/toast";
import { driversKey } from "@/hooks/use-driver-profiles";
import {
  createUniverseRelationship,
  deleteUniverseRelationship,
  getBiographyGenerationRun,
  getPilotKnowledge,
  requestBiographyGeneration,
  restorePilotBiography,
  updatePilotBiography,
  updateUniverseRelationship,
  type PilotBiographyStatusView,
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

export function useUpdatePilotBiography(characterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (display: string) => updatePilotBiography(characterId, display),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pilot-knowledge", characterId] });
      void queryClient.invalidateQueries({ queryKey: driversKey });
    },
  });
}

export function useRestorePilotBiography(characterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => restorePilotBiography(characterId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pilot-knowledge", characterId] });
      void queryClient.invalidateQueries({ queryKey: driversKey });
    },
  });
}

export type PilotKnowledgeQueryData = { pilot: PilotKnowledgeView } | undefined;

export function biographyGenerationQueryKey(characterId: string) {
  return ["pilot-knowledge", characterId, "generation"] as const;
}

export function useBiographyLifecycle(
  characterId: string,
  biographyStatus: PilotBiographyStatusView | undefined,
) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const requestedKeyRef = useRef<string | null>(null);
  const pendingToastRef = useRef<number | null>(null);

  const generationQuery = useQuery({
    queryKey: biographyGenerationQueryKey(characterId),
    queryFn: () => getBiographyGenerationRun(characterId),
    enabled: Boolean(characterId) && biographyStatus?.status === "GENERATING",
    refetchInterval: 1500,
  });

  const requestMutation = useMutation({
    mutationFn: () => requestBiographyGeneration(characterId),
  });

  useEffect(() => {
    if (!biographyStatus || !characterId) return;
    if (biographyStatus.status !== "MISSING" && biographyStatus.status !== "STALE") return;
    const requestKey = `${biographyStatus.status}:${biographyStatus.evidenceVersion ?? ""}:${
      biographyStatus.generatorVersion ?? ""
    }`;
    if (requestedKeyRef.current === requestKey) return;
    requestedKeyRef.current = requestKey;
    const message =
      biographyStatus.status === "MISSING"
        ? "Preparando biografia…"
        : "Atualizando biografia…";
    pendingToastRef.current = toast.show({ message, tone: "info", persistent: true });
    requestMutation.mutate(undefined, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: pilotKnowledgeQueryKey(characterId) });
      },
      onError: () => {
        if (pendingToastRef.current !== null) {
          toast.update(pendingToastRef.current, {
            message: "Não foi possível gerar a biografia.",
            tone: "error",
          });
          pendingToastRef.current = null;
        }
      },
    });
  }, [biographyStatus, characterId, queryClient, requestMutation, toast]);

  const run = generationQuery.data?.generation;
  useEffect(() => {
    if (!run) return;
    const terminal =
      run.status === "SUCCEEDED" || run.status === "SUCCEEDED_FALLBACK" || run.status === "FAILED";
    if (!terminal) return;
    if (pendingToastRef.current !== null) {
      const message =
        run.status === "SUCCEEDED"
          ? "Biografia atualizada."
          : run.status === "SUCCEEDED_FALLBACK"
            ? "Biografia preparada com dados verificados."
            : "Não foi possível gerar a biografia.";
      toast.update(pendingToastRef.current, {
        message,
        tone: run.status === "FAILED" ? "error" : "success",
      });
      pendingToastRef.current = null;
    }
    void queryClient.invalidateQueries({ queryKey: pilotKnowledgeQueryKey(characterId) });
  }, [run, characterId, queryClient, toast]);

  useEffect(() => {
    if (!biographyStatus || pendingToastRef.current === null) return;
    if (biographyStatus.status === "READY" || biographyStatus.status === "READY_FALLBACK") {
      toast.update(pendingToastRef.current, { message: "Biografia atualizada.", tone: "success" });
      pendingToastRef.current = null;
    }
  }, [biographyStatus, toast]);

  return { isGenerating: biographyStatus?.status === "GENERATING" };
}
