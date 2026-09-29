"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getRaceWeekend,
  runRaceWeekendSession,
  type RaceWeekend,
  type WeekendSessionName,
} from "@/lib/weekend";

export function raceWeekendKey(raceId: string) {
  return ["race-weekend", raceId] as const;
}

export function useRaceWeekend(raceId: string | undefined) {
  return useQuery<RaceWeekend>({
    queryKey: raceWeekendKey(raceId ?? ""),
    queryFn: () => getRaceWeekend(raceId as string),
    enabled: Boolean(raceId),
  });
}

export function useRunWeekendSession(raceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { session: WeekendSessionName; rerun?: boolean }) =>
      runRaceWeekendSession(raceId, vars.session, {
        ...(vars.rerun !== undefined ? { rerun: vars.rerun } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: raceWeekendKey(raceId) });
      void queryClient.invalidateQueries({ queryKey: ["next-race"] });
      void queryClient.invalidateQueries({ queryKey: ["world"] });
    },
  });
}
