"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getExternalSyncStatus,
  refreshExternalSeason,
  type ExternalRefreshResult,
  type ExternalSyncStatus,
} from "@/lib/external-sync";

export const externalSyncStatusKey = ["external", "sync", "status"] as const;

export function useExternalSyncStatus() {
  return useQuery<ExternalSyncStatus>({
    queryKey: externalSyncStatusKey,
    queryFn: () => getExternalSyncStatus(),
    staleTime: 15_000,
  });
}

export function useRefreshExternalData() {
  const queryClient = useQueryClient();
  return useMutation<ExternalRefreshResult, Error, number>({
    mutationFn: (seasonYear: number) => refreshExternalSeason(seasonYear),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["external"] });
    },
  });
}
