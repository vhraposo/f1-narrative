"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  confirmDriverBinding,
  getDriverReconciliation,
  getRosterComparison,
  keepUniverseConfig,
  restoreSourceConfig,
  suggestDriverBinding,
  unbindDriverBinding,
  type DriverReconciliationListing,
  type RosterComparison,
} from "@/lib/universe";

export const rosterComparisonKey = ["universe", "roster-comparison"] as const;
export const driverReconciliationKey = ["universe", "driver-reconciliation"] as const;

export function useRosterComparison(seasonId?: string) {
  return useQuery<RosterComparison>({
    queryKey: [...rosterComparisonKey, seasonId ?? "none"],
    queryFn: () => getRosterComparison(seasonId as string),
    enabled: seasonId != null && seasonId.length > 0,
  });
}

export function useKeepUniverseConfig(seasonId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (teamId: string) =>
      keepUniverseConfig({ seasonId, teamId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...rosterComparisonKey, seasonId],
      });
    },
  });
}

export function useRestoreSourceConfig(seasonId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (teamId: string) =>
      restoreSourceConfig({ seasonId, teamId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...rosterComparisonKey, seasonId],
      });
    },
  });
}

export function useDriverReconciliation(externalDriverId?: string) {
  return useQuery<DriverReconciliationListing>({
    queryKey: [...driverReconciliationKey, externalDriverId ?? "none"],
    queryFn: () => getDriverReconciliation(externalDriverId as string),
    enabled: externalDriverId != null && externalDriverId.length > 0,
  });
}

export function useConfirmDriverBinding(seasonId: string, externalDriverId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => confirmDriverBinding(externalDriverId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...rosterComparisonKey, seasonId],
      });
      void queryClient.invalidateQueries({
        queryKey: [...driverReconciliationKey, externalDriverId],
      });
    },
  });
}

export function useSuggestDriverBinding(externalDriverId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (candidateId: string) =>
      suggestDriverBinding(externalDriverId, candidateId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...driverReconciliationKey, externalDriverId],
      });
    },
  });
}

export function useUnbindDriverBinding(seasonId: string, externalDriverId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bindingId: string) => unbindDriverBinding(bindingId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...rosterComparisonKey, seasonId],
      });
      void queryClient.invalidateQueries({
        queryKey: [...driverReconciliationKey, externalDriverId],
      });
    },
  });
}

export type {
  DriverReconciliationListing,
  RestoreSourceResult,
  RosterComparison,
  UniverseSeat,
  UniverseSeatStatus,
  UniverseTeam,
  UniverseTeamStatus,
} from "@/lib/universe";