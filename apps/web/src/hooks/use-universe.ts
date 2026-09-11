"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getRosterComparison,
  keepUniverseConfig,
  restoreSourceConfig,
  type RosterComparison,
} from "@/lib/universe";

export const rosterComparisonKey = ["universe", "roster-comparison"] as const;

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

export type {
  RestoreSourceResult,
  RosterComparison,
  UniverseSeat,
  UniverseSeatStatus,
  UniverseTeam,
  UniverseTeamStatus,
} from "@/lib/universe";